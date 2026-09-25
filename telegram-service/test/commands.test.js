'use strict';

/**
 * The bot's command handlers, driven through grammY's real update pipeline.
 *
 * Nothing talks to Telegram: an api transformer intercepts every outgoing call
 * and records it, and the admin API is a local HTTP server. So these are real
 * end-to-end handler runs — update in, Telegram calls out — with only the two
 * network edges faked.
 */

const test = require('node:test');
const { before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let bot;
let isAdmin;
let store;
let apiServer;
let apiBase;
let dir;

/** Outgoing Telegram calls: `{ method, payload }`. */
let sent = [];
/** Admin-API routes for the test at hand, keyed by "METHOD /path". */
let routes = {};
let apiCalls = [];

let SIDES;   // filled in before(): requiring ../api early would lock API_BASE

let updateId = 0;
const CHAT = 4242;

/** A tapped inline button. */
function callbackUpdate(data, chatId = CHAT) {
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from: { id: chatId, is_bot: false, first_name: 'עידן' },
      chat_instance: 'ci',
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: 'private', first_name: 'עידן' },
        text: 'previous',
      },
    },
  };
}

/** A contact card shared from the phone's address book. */
function contactUpdate(phone, firstName = 'איש קשר', chatId = CHAT) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private', first_name: 'עידן' },
      from: { id: chatId, is_bot: false, first_name: 'עידן' },
      contact: { phone_number: phone, first_name: firstName, user_id: 999 },
    },
  };
}

/** A plain message — an answer to a step, not a command. */
function plainUpdate(text, chatId = CHAT) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private', first_name: 'עידן' },
      from: { id: chatId, is_bot: false, first_name: 'עידן' },
      text,
    },
  };
}

function textUpdate(text, chatId = CHAT) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private', first_name: 'עידן' },
      from: { id: chatId, is_bot: false, first_name: 'עידן', username: 'idan' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    },
  };
}

/** Every message body the bot sent, concatenated. */
const allText = () => sent.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text).join('\n---\n');

/** The inline keyboard on the most recent message that carried one. */
function lastKeyboard() {
  for (let i = sent.length - 1; i >= 0; i--) {
    const kb = sent[i].payload && sent[i].payload.reply_markup;
    if (kb && kb.inline_keyboard) return kb.inline_keyboard;
  }
  return [];
}

/** Every callback_data currently offered as a button. */
const buttonData = () => lastKeyboard().flat().map((b) => b.callback_data).filter(Boolean);

before(async () => {
  apiServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const key = `${req.method} ${req.url}`;
      apiCalls.push(key);
      const route = routes[key];
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end('{"error":"missing"}');
      }
      res.writeHead(route.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(route.body === undefined ? {} : route.body));
    });
  });
  await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${apiServer.address().port}`;

  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-bot-'));
  process.env.TELEGRAM_SUBSCRIBERS_FILE = path.join(dir, 'subscribers.json');
  process.env.TELEGRAM_BOT_TOKEN = '123456:test-token-not-real';
  process.env.API_BASE = apiBase;
  process.env.ADMIN_PASSWORD = 'pw';
  process.env.NOTIFY_SECRET = 'notify-secret';
  process.env.TELEGRAM_ADMIN_IDS = '';
  process.env.API_TIMEOUT_MS = '2000';

  process.env.BOT_STORE = 'file';
  const { createBot } = require('../bot');
  ({ bot, isAdmin } = createBot({ token: process.env.TELEGRAM_BOT_TOKEN, log: { log() {}, error() {} } }));
  store = require('../store');
  SIDES = require('../api').SIDES;

  // Intercept everything the bot would send to Telegram.
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: CHAT } } };
  });
  // Skip getMe: hand grammY the bot identity directly.
  bot.botInfo = {
    id: 123456, is_bot: true, first_name: 'Wedding', username: 'wedding_test_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  };
  await bot.init();
});

after(async () => {
  await new Promise((r) => apiServer.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  sent = [];
  routes = {};
  apiCalls = [];
  fs.rmSync(process.env.TELEGRAM_SUBSCRIBERS_FILE, { force: true });
});

// ─── Subscription ────────────────────────────────────────────────────────────

test('/start subscribes the sender and confirms it', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  assert.equal(await store.has(CHAT), true);
  assert.ok(allText().includes('נרשמת לעדכונים'));
});

test('/start a second time says they are already subscribed', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  await bot.handleUpdate(textUpdate('/start'));
  assert.ok(allText().includes('כבר רשומים'));
  assert.equal((await store.all()).length, 1);
});

test('anyone who has run /start gets admin rights', async () => {
  assert.equal(await isAdmin(CHAT), false, 'a stranger is not an admin');
  await bot.handleUpdate(textUpdate('/start'));
  assert.equal(await isAdmin(CHAT), true, 'subscribing grants admin');
  assert.ok(allText().includes('גישה לפקודות הניהול'));
});

test('/stop unsubscribes, and with it the admin rights', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  await bot.handleUpdate(textUpdate('/stop'));
  assert.equal(await store.has(CHAT), false);
  assert.equal(await isAdmin(CHAT), false);
  assert.ok(allText().includes('הוסרת'));
});

test('/stop when never subscribed says so instead of erroring', async () => {
  await bot.handleUpdate(textUpdate('/stop'));
  assert.ok(allText().includes('לא היית רשומים'));
});

test('/whoami reports the chat id', async () => {
  await bot.handleUpdate(textUpdate('/whoami'));
  assert.ok(allText().includes(String(CHAT)));
});

test('/help lists the commands', async () => {
  await bot.handleUpdate(textUpdate('/help'));
  const text = allText();
  for (const cmd of ['/stats', '/rsvps', '/pending', '/search', '/invite', '/export']) {
    assert.ok(text.includes(cmd), `missing ${cmd}`);
  }
});

// ─── Admin gate ──────────────────────────────────────────────────────────────

test('admin commands are refused to somebody who never ran /start', async () => {
  for (const cmd of ['/stats', '/rsvps', '/pending', '/search דוד', '/invite א | 0501234567 | vered']) {
    sent = [];
    await bot.handleUpdate(textUpdate(cmd, 9999));
    assert.ok(allText().includes('אין הרשאה'), `${cmd} should have been refused`);
  }
});

// ─── Reading the guest list ──────────────────────────────────────────────────

test('/stats renders the summary from the API', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/stats'] = { body: { invites: 12, responded: 5, not_responded: 7, coming: 14 } };

  await bot.handleUpdate(textUpdate('/stats'));
  const text = allText();
  assert.ok(text.includes('סטטוס אישורי הגעה'));
  assert.ok(text.includes('<b>12</b>'));
  assert.ok(text.includes('<b>14</b>'));
});

test('/stats explains an API outage rather than throwing', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/stats'] = { status: 401, body: {} };

  await bot.handleUpdate(textUpdate('/stats'));
  assert.ok(allText().includes('ADMIN_PASSWORD'));
});

test('/rsvps lists everyone who answered', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/invites'] = {
    body: [
      { token: 't1', name: 'דוד', phone: '0501111111', side: 'idan', responded: true, attending: true, guests: 2 },
      { token: 't2', name: 'רונית', phone: '0502222222', side: 'vered', responded: true, attending: false, guests: 0 },
      { token: 't3', name: 'טרם ענה', phone: '0503333333', side: 'vered', responded: false },
    ],
  };

  await bot.handleUpdate(textUpdate('/rsvps'));
  const text = allText();
  assert.ok(text.includes('דוד'));
  assert.ok(text.includes('רונית'));
  assert.ok(!text.includes('טרם ענה'), 'somebody who has not answered is not an RSVP');
});

test('/pending lists only the people still owed an answer', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/invites'] = {
    body: [
      { token: 't1', name: 'ענה', responded: true, attending: true, guests: 1 },
      { token: 't2', name: 'לא ענה', phone: '0509999999', side: 'idan', responded: false },
    ],
  };

  await bot.handleUpdate(textUpdate('/pending'));
  const text = allText();
  assert.ok(text.includes('לא ענה'));
  assert.ok(text.includes('0509999999'));
  assert.ok(!text.includes('1. <b>ענה</b>'));
});

test('a long list is split across messages instead of being cut off', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/invites'] = {
    body: Array.from({ length: 80 }, (_, i) => ({
      token: `t${i}`, name: `אורח ${i}`, phone: '0501111111', side: 'idan', responded: true, attending: true, guests: 1,
    })),
  };

  await bot.handleUpdate(textUpdate('/rsvps'));
  const messages = sent.filter((c) => c.method === 'sendMessage');
  assert.ok(messages.length > 1, 'the list should have been chunked');
  const joined = allText();
  for (let i = 0; i < 80; i++) assert.ok(joined.includes(`אורח ${i}`), `lost אורח ${i}`);
  for (const m of messages) assert.ok(m.payload.text.length <= 4096);
});

// ─── Search ──────────────────────────────────────────────────────────────────

test('/search finds by name and by phone', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  routes['GET /api/invites'] = {
    body: [
      { token: 't1', name: 'דוד כהן', phone: '0501111111', side: 'idan', responded: true, attending: true, guests: 2 },
      { token: 't2', name: 'רונית לוי', phone: '0502222222', side: 'vered', responded: false },
    ],
  };

  sent = [];
  await bot.handleUpdate(textUpdate('/search דוד'));
  assert.ok(allText().includes('דוד כהן'));
  assert.ok(!allText().includes('רונית לוי'));

  sent = [];
  await bot.handleUpdate(textUpdate('/search 2222222'));
  assert.ok(allText().includes('רונית לוי'));
});

test('/search with no term asks for one', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  await bot.handleUpdate(textUpdate('/search'));
  assert.ok(allText().length > 0);
  assert.equal(apiCalls.length, 0, 'no API call should be made without a search term');
});

test('/search that matches nothing says so', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  routes['GET /api/invites'] = { body: [{ token: 't1', name: 'דוד', phone: '0501111111' }] };
  sent = [];
  await bot.handleUpdate(textUpdate('/search קוקוריקו'));
  assert.ok(allText().length > 0, 'the bot must answer even with no matches');
  assert.ok(!allText().includes('דוד'));
});

// ─── Creating an invite ──────────────────────────────────────────────────────

test('/invite creates a personal link and hands back forwardable text', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['POST /api/invites'] = {
    body: { token: 'abc-123', name: 'דנה כהן', phone: '0501234567', side: 'vered', url: `${apiBase}/?i=abc-123` },
  };

  await bot.handleUpdate(textUpdate('/invite דנה כהן | 0501234567 | ורד'));
  const text = allText();
  assert.ok(apiCalls.includes('POST /api/invites'));
  assert.ok(text.includes('abc-123'), 'the personal link must be in the reply');
  assert.ok(text.includes('דנה כהן'));
  assert.ok(text.includes('25.10.2026'), 'the ready-to-send invitation text comes with it');
});

test('/invite accepts a Hebrew side label as well as the key', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  routes['POST /api/invites'] = { body: { token: 't', name: 'x', url: `${apiBase}/?i=t` } };

  for (const side of ['ורד', 'vered', 'הורי עידן', 'idan_parents']) {
    sent = [];
    await bot.handleUpdate(textUpdate(`/invite שם | 0501234567 | ${side}`));
    assert.ok(allText().includes('?i=t'), `side "${side}" should have been accepted`);
  }
});

test('/invite with an unusable side falls back to the side buttons', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  await bot.handleUpdate(textUpdate('/invite שם | 0501234567 | חבר מהצבא'));

  assert.ok(allText().includes('צד לא מוכר'));
  assert.ok(!apiCalls.includes('POST /api/invites'), 'nothing should be created yet');
  // Every side is offered as a button, and the name and phone are remembered.
  const buttons = lastKeyboard().flat().map((b) => b.callback_data);
  for (const key of Object.keys(SIDES)) {
    assert.ok(buttons.includes(`invite:side:${key}`), `missing button for ${key}`);
  }
});

test('/invite with no arguments explains the format', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  await bot.handleUpdate(textUpdate('/invite'));
  assert.ok(allText().length > 0);
  assert.ok(!apiCalls.includes('POST /api/invites'));
});

test('/invite reports an API failure in Hebrew instead of crashing', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['POST /api/invites'] = { status: 500, body: { detail: 'boom' } };
  await bot.handleUpdate(textUpdate('/invite שם | 0501234567 | ורד'));
  assert.ok(allText().includes('⚠️'));
});

// ─── The notify endpoint ─────────────────────────────────────────────────────

test('secretMatches is a constant-time comparison that rejects wrong secrets', () => {
  const { secretMatches } = require('../bot');
  assert.equal(secretMatches('notify-secret', 'notify-secret'), true);
  assert.equal(secretMatches('notify-secreT', 'notify-secret'), false);
  assert.equal(secretMatches('short', 'notify-secret'), false);
  assert.equal(secretMatches('', 'notify-secret'), false);
  assert.equal(secretMatches(undefined, 'notify-secret'), false);
  assert.equal(secretMatches('anything', ''), false, 'no configured secret means nothing matches');
});

test('broadcast reaches every subscriber', async () => {
  const { createBot } = require('../bot');
  const b = createBot({ token: process.env.TELEGRAM_BOT_TOKEN, log: { log() {}, error() {} } });
  b.bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: CHAT } } };
  });
  const { broadcast } = b;
  await store.add({ chat_id: 1 });
  await store.add({ chat_id: 2 });
  await store.add({ chat_id: 3 });
  sent = [];

  const result = await broadcast('שלום');
  assert.equal(result.total, 3);
  assert.equal(result.sent, 3);
  assert.equal(sent.filter((c) => c.method === 'sendMessage').length, 3);
});

test('broadcast with no subscribers is a no-op', async () => {
  const { createBot } = require('../bot');
  const b = createBot({ token: process.env.TELEGRAM_BOT_TOKEN, log: { log() {}, error() {} } });
  b.bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: CHAT } } };
  });
  const { broadcast } = b;
  sent = [];
  const result = await broadcast('שלום');
  assert.equal(result.total, 0);
  assert.equal(sent.length, 0);
});

test('isDeadChat recognises the errors that mean "stop writing here"', () => {
  const { isDeadChat } = require('../bot');
  const { GrammyError } = require('grammy');
  const gErr = (error_code, description) =>
    new GrammyError(description, { ok: false, error_code, description }, 'sendMessage', { chat_id: 1 });

  assert.equal(isDeadChat(gErr(403, 'Forbidden: bot was blocked by the user')), true);
  assert.equal(isDeadChat(gErr(400, 'Bad Request: chat not found')), true);
  assert.equal(isDeadChat(gErr(400, 'Forbidden: user is deactivated')), true);
  // Retryable: the chat is alive, Telegram is just throttling or unhappy
  assert.equal(isDeadChat(gErr(429, 'Too Many Requests: retry after 5')), false);
  assert.equal(isDeadChat(gErr(400, 'Bad Request: message text is empty')), false);
  // Not a Telegram error at all — a network blip must not prune anybody
  assert.equal(isDeadChat(new Error('socket hang up')), false);
  assert.equal(isDeadChat({ description: 'bot was blocked' }), false, 'a look-alike object is not a GrammyError');
});

// ── Regression: /rsvps must list walk-ins as well as answered invitations ────

test('/rsvps lists a walk-in alongside the invited guests who answered', async () => {
  // Regression: the two sources were an either/or, so as soon as one invited
  // guest answered, everybody who RSVPed without a personal link vanished.
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/invites'] = {
    body: [
      { token: 't1', name: 'מוזמן', phone: '0501111111', side: 'idan', responded: true, attending: true, guests: 2, guest_id: 10 },
    ],
  };
  routes['GET /api/guests'] = {
    body: [
      { id: 10, name: 'מוזמן', phone: '0501111111', attending: true, guests: 2 },
      { id: 11, name: 'נכנס מהרחוב', phone: '0502222222', attending: true, guests: 3 },
    ],
  };

  await bot.handleUpdate(textUpdate('/rsvps'));
  const text = allText();
  assert.ok(text.includes('מוזמן'), 'the invited guest is missing');
  assert.ok(text.includes('נכנס מהרחוב'), 'the walk-in was dropped');
  assert.ok(text.includes('— 2'), 'the count should be two people');
  // and the invited guest is listed once, not twice
  assert.equal((text.match(/מוזמן/g) || []).length, 1, 'the invited guest was duplicated');
});

test('/rsvps lists a walk-in when there are no invitations at all', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/invites'] = { body: [] };
  routes['GET /api/guests'] = { body: [{ id: 1, name: 'לבד', attending: true, guests: 1 }] };

  await bot.handleUpdate(textUpdate('/rsvps'));
  assert.ok(allText().includes('לבד'));
});

test('/rsvps falls back to the guest list when invites are unavailable', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/invites'] = { status: 500, body: {} };
  routes['GET /api/guests'] = { body: [{ id: 1, name: 'שרד', attending: true, guests: 4 }] };

  await bot.handleUpdate(textUpdate('/rsvps'));
  assert.ok(allText().includes('שרד'));
});

test('/rsvps de-duplicates by name when the API omits guest_id', async () => {
  await bot.handleUpdate(textUpdate('/start'));
  sent = [];
  routes['GET /api/invites'] = {
    body: [{ token: 't1', name: 'ישן', responded: true, attending: true, guests: 2 }],   // no guest_id
  };
  routes['GET /api/guests'] = {
    body: [
      { id: 1, name: 'ישן', attending: true, guests: 2 },
      { id: 2, name: 'חדש', attending: true, guests: 1 },
    ],
  };

  await bot.handleUpdate(textUpdate('/rsvps'));
  const text = allText();
  assert.equal((text.match(/ישן/g) || []).length, 1, 'the same person was listed twice');
  assert.ok(text.includes('חדש'));
});
