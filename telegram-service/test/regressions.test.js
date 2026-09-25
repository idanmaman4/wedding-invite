'use strict';

/**
 * Regressions for the production path: the bot on Vercel, its registry behind
 * the admin API, and the messages it sends. Each test names the failure it
 * pins down. Telegram and the admin API are both faked locally.
 */

const test = require('node:test');
const { before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

let server;
let base;
let routes = {};
let apiCalls = [];
let sent = [];

let bot;
let broadcast;
let fmt;
let exporter;
let schedule;
let readJson;

const CHAT = 4242;
let updateId = 0;

function command(text, chatId = CHAT) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private', first_name: 'עידן' },
      from: { id: chatId, is_bot: false, first_name: 'עידן' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    },
  };
}

const replies = () => sent.filter((c) => c.method === 'sendMessage');

before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const key = `${req.method} ${req.url}`;
      apiCalls.push(key);
      const route = routes[key];
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end('{"detail":"Not Found"}');
      }
      const raw = typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {});
      res.writeHead(route.status || 200, { 'Content-Type': typeof route.body === 'string' ? 'text/html' : 'application/json' });
      res.end(raw);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  process.env.API_BASE = base;
  process.env.ADMIN_PASSWORD = 'pw';
  process.env.BOT_STORE = 'api';
  process.env.API_TIMEOUT_MS = '2000';

  fmt = require('../format');
  exporter = require('../export');
  schedule = require('../schedule');
  ({ readJson } = require('../../api/telegram/_bot'));
  const { createBot } = require('../bot');
  ({ bot, broadcast } = createBot({ token: '123456:test-token-not-real', log: { log() {}, error() {} } }));

  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    if (method === 'sendMessage' && String(payload.chat_id) === '1') {
      return { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' };
    }
    return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: payload.chat_id } } };
  });
  bot.botInfo = {
    id: 123456, is_bot: true, first_name: 'Wedding', username: 'wedding_test_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  };
  await bot.init();
});

after(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  routes = {};
  apiCalls = [];
  sent = [];
});

// ─── Broadcast / fan-out ─────────────────────────────────────────────────────

test('a failed prune of a blocked chat does not stop the RSVP reaching everyone else', async () => {
  routes['GET /api/bot/subscribers'] = { body: [{ chat_id: '1' }, { chat_id: '2' }] };
  routes['DELETE /api/bot/subscribers/1'] = { status: 500, body: { detail: 'db down' } };

  const result = await broadcast('hello');
  assert.deepEqual(result, { total: 2, sent: 1, dropped: 1 });
  assert.ok(replies().some((c) => String(c.payload.chat_id) === '2'), 'chat 2 never got the message');
});

test('the daily fan-out survives a failing removeSubscriber too', async () => {
  const dead = Object.assign(new Error('blocked'), { dead: true });
  const got = [];
  const result = await schedule.fanOut(
    [{ chat_id: 'a' }, { chat_id: 'b' }],
    async (id) => {
      if (id === 'a') throw dead;
      got.push(id);
    },
    {
      removeSubscriber: async () => { throw new Error('api down'); },
      isDeadChat: (e) => Boolean(e && e.dead),
      delayMs: 0,
      log: { log() {}, error() {} },
    },
  );
  assert.deepEqual(result, { total: 2, sent: 1, dropped: 1 });
  assert.deepEqual(got, ['b']);
});

// ─── Replies that must never be silent ───────────────────────────────────────

test('/start tells the person when their subscription could not be saved', async () => {
  routes[`POST /api/bot/subscribers`] = { status: 500, body: { detail: 'db down' } };
  await bot.handleUpdate(command('/start'));
  const text = replies().map((c) => c.payload.text).join('\n');
  assert.ok(text.includes('לא הצלחתי לשמור את ההרשמה'), text);
  assert.ok(!text.includes('נרשמת לעדכונים'), 'must not claim success');
});

test('an API error quoting an HTML body is escaped, so Telegram accepts the reply', async () => {
  routes['GET /api/bot/subscribers'] = { body: [{ chat_id: String(CHAT) }] };
  const page = '<html><body>502 Bad Gateway & friends</body></html>';
  routes['GET /api/stats'] = { status: 502, body: page };
  routes['GET /api/invites'] = { status: 502, body: page };
  routes['GET /api/guests'] = { status: 502, body: page };

  await bot.handleUpdate(command('/stats'));
  const [reply] = replies();
  assert.ok(reply, 'nothing was sent');
  assert.equal(reply.payload.parse_mode, 'HTML');
  assert.ok(!reply.payload.text.includes('<html>'), reply.payload.text);
  assert.ok(reply.payload.text.includes('&lt;html&gt;'), reply.payload.text);
  assert.ok(reply.payload.text.includes('&amp; friends'), reply.payload.text);
});

test('the export fallback notice escapes the reason it quotes', () => {
  const out = exporter.fallbackNotice(new Error('<b>boom</b> & more'));
  assert.ok(out.includes('&lt;b&gt;boom&lt;/b&gt; &amp; more'), out);
});

// ─── Message size ────────────────────────────────────────────────────────────

test('an enormous blessing or name cannot push the RSVP broadcast past 4096 characters', () => {
  const out = fmt.formatRsvpNotification({
    name: 'א'.repeat(5000),
    attending: true,
    guests: 2,
    phone: '0'.repeat(500),
    message: 'ברכה '.repeat(3000),
  });
  assert.ok(out.length < 4096, `length ${out.length}`);
  assert.ok(out.includes('…'), 'truncation is visible');
});

test('an edited RSVP is announced as an update, not as a new one', () => {
  const yes = fmt.formatRsvpNotification({ name: 'דנה', attending: true, guests: 3, updated: true });
  assert.ok(yes.includes('עדכון'), yes);
  assert.ok(!yes.includes('אישור הגעה חדש'), yes);
  assert.ok(yes.includes('3 אורחים'));

  const no = fmt.formatRsvpNotification({ name: 'דנה', attending: false, updated: true });
  assert.ok(no.includes('עדכון') && no.includes('לא יוכלו להגיע'), no);

  const fresh = fmt.formatRsvpNotification({ name: 'דנה', attending: true, guests: 1, updated: false });
  assert.ok(fresh.includes('אישור הגעה חדש'));
});

// ─── Export correctness ──────────────────────────────────────────────────────

test('an API timestamp without an offset is read as UTC, not local time', () => {
  assert.equal(exporter.parseDate('2026-09-04T09:00:00.123456').toISOString(), '2026-09-04T09:00:00.123Z');
  assert.equal(exporter.parseDate('2026-09-04 09:00:00').toISOString(), '2026-09-04T09:00:00.000Z');
  assert.equal(exporter.parseDate('2026-09-04T09:00:00+00:00').toISOString(), '2026-09-04T09:00:00.000Z');
  // 09:00 UTC is 12:00 in Israel in September, wherever the bot runs.
  assert.equal(exporter.humanDateTime('2026-09-04T09:00:00', 'Asia/Jerusalem'), '04/09/2026 12:00');
});

test('a walk-in sharing a name with an answered invite is not filed under that invite', () => {
  const invites = [{
    token: 't', name: 'דנה כהן', phone: '0501111111', side: 'vered', url: '',
    responded: true, attending: true, guests: 2, guest_id: 10, created_at: '',
  }];
  const guests = [
    { id: 10, name: 'דנה כהן', phone: '0501111111', attending: true, guests: 2, side: '', message: '', dietary: '', created_at: '' },
    { id: 11, name: 'דנה כהן', phone: '0502222222', attending: true, guests: 4, side: '', message: '', dietary: '', created_at: '' },
  ];
  const rows = exporter.mergeRsvps(invites, guests);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].side, 'vered');
  assert.equal(rows[1].side, '', 'the walk-in has no side of its own');

  const { bySide } = exporter.summarize({ invites, guests });
  assert.equal(bySide.get('vered').coming, 2, 'vered must not absorb the walk-in party');
});

// ─── Vercel plumbing ─────────────────────────────────────────────────────────

test('readJson copes with a body Vercel already parsed as a string or a Buffer', async () => {
  assert.deepEqual(await readJson({ body: '{"name":"דנה"}' }), { name: 'דנה' });
  assert.deepEqual(await readJson({ body: Buffer.from('{"name":"דנה"}') }), { name: 'דנה' });
  assert.deepEqual(await readJson({ body: { name: 'x' } }), { name: 'x' });
  assert.deepEqual(await readJson({ body: '' , [Symbol.asyncIterator]: async function* () {} }), {});
});

test('on Vercel the bot talks to its own deployment via SITE_URL', () => {
  const out = execFileSync(process.execPath, ['-e', "process.stdout.write(require('./api').API_BASE)"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, API_BASE: '', SITE_URL: 'https://preview.example.test/' },
  }).toString();
  assert.equal(out, 'https://preview.example.test');
});

test('a pasted wall of text as a search term still gets an answer under 4096 characters', async () => {
  routes['GET /api/bot/subscribers'] = { body: [{ chat_id: String(CHAT) }] };
  routes['GET /api/invites'] = { body: [] };
  routes['GET /api/guests'] = { body: [] };
  await bot.handleUpdate(command(`/search ${'דנה '.repeat(1500)}`));
  const out = replies();
  assert.ok(out.length, 'nothing was sent');
  for (const r of out) assert.ok(r.payload.text.length < 4096, `length ${r.payload.text.length}`);
});
