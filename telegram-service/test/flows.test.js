'use strict';

/**
 * The button-driven UI: the main menu, the three-step invite flow, and the
 * stepped search. Driven through grammY's real update pipeline exactly like
 * commands.test.js — updates in, Telegram calls out.
 */

const test = require('node:test');
const { before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBotDb, isBotRoute } = require('./helpers/bot-db');

let bot;
let store;
let ui;
let apiServer;
let apiBase;

let sent = [];
let routes = {};
let apiCalls = [];
/** The bot's own tables (subscribers, flow state), answered when no route is set. */
const botDb = createBotDb();
/** Calls to the guest list itself, leaving out the bot's own bookkeeping. */
const siteCalls = () => apiCalls.filter((c) => !isBotRoute(c));
let updateId = 0;
const CHAT = 777;

const { SIDES } = (() => ({ SIDES: null }))(); // replaced in before()
let sides;

function message(fields) {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT, type: 'private', first_name: 'עידן' },
      from: { id: CHAT, is_bot: false, first_name: 'עידן' },
      ...fields,
    },
  };
}

const command = (text) =>
  message({ text, entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] });

const plain = (text) => message({ text });

const contact = (phone, firstName = 'איש קשר') =>
  message({ contact: { phone_number: phone, first_name: firstName, user_id: 999 } });

function tap(data) {
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      from: { id: CHAT, is_bot: false, first_name: 'עידן' },
      chat_instance: 'ci',
      data,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT, type: 'private', first_name: 'עידן' },
        text: 'previous',
      },
    },
  };
}

const messages = () => sent.filter((c) => c.method === 'sendMessage');
const allText = () => messages().map((c) => c.payload.text).join('\n---\n');

function lastKeyboard() {
  for (let i = sent.length - 1; i >= 0; i--) {
    const kb = sent[i].payload && sent[i].payload.reply_markup;
    if (kb && kb.inline_keyboard) return kb.inline_keyboard;
  }
  return [];
}
const buttonData = () => lastKeyboard().flat().map((b) => b.callback_data).filter(Boolean);

const answered = () => sent.filter((c) => c.method === 'answerCallbackQuery');

before(async () => {
  apiServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const key = `${req.method} ${req.url}`;
      const body = raw ? JSON.parse(raw) : null;
      apiCalls.push({ key, body });
      const route = routes[key] || botDb.handle(req.method, req.url, body);
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

  process.env.TELEGRAM_BOT_TOKEN = '123456:test-token-not-real';
  process.env.API_BASE = apiBase;
  process.env.ADMIN_PASSWORD = 'pw';
  process.env.NOTIFY_SECRET = 'notify-secret';
  process.env.TELEGRAM_ADMIN_IDS = '';

  const { createBot } = require('../bot');
  ({ bot } = createBot({ token: process.env.TELEGRAM_BOT_TOKEN, log: { log() {}, error() {} } }));
  store = require('../store');
  ui = require('../ui');
  sides = require('../api').SIDES;

  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    return { ok: true, result: { message_id: sent.length, date: 0, chat: { id: CHAT } } };
  });
  bot.botInfo = {
    id: 123456, is_bot: true, first_name: 'Wedding', username: 'wedding_test_bot',
    can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  };
  await bot.init();
});

after(async () => {
  await new Promise((r) => apiServer.close(r));
});

beforeEach(async () => {
  sent = [];
  routes = {};
  botDb.reset();
  await bot.handleUpdate(command('/start'));  // subscribe → admin rights
  sent = [];
  apiCalls = [];
});

// ─── The menu ────────────────────────────────────────────────────────────────

test('/start ends on a menu with a button for every job', () => {
  // (the /start in beforeEach cleared `sent`, so send another)
  return bot.handleUpdate(command('/start')).then(() => {
    const data = buttonData();
    for (const expected of ['menu:stats', 'menu:rsvps', 'menu:pending', 'menu:search', 'menu:invite', 'menu:export', 'menu:help']) {
      assert.ok(data.includes(expected), `the menu is missing ${expected}`);
    }
  });
});

test('/menu opens the same menu on its own', async () => {
  await bot.handleUpdate(command('/menu'));
  assert.ok(buttonData().includes('menu:stats'));
});

test('every button press is acknowledged, so Telegram stops the spinner', async () => {
  routes['GET /api/stats'] = { body: { invites: 1, responses: 1, total_people: 2 } };
  await bot.handleUpdate(tap('menu:stats'));
  assert.equal(answered().length, 1, 'answerCallbackQuery was never called');
});

test('the menu buttons run the same code as the commands', async () => {
  routes['GET /api/stats'] = { body: { invites: 7, responses: 3, not_responded: 4, total_people: 11 } };

  await bot.handleUpdate(tap('menu:stats'));
  const viaButton = allText();
  sent = [];
  await bot.handleUpdate(command('/stats'));
  const viaCommand = allText();

  assert.ok(viaButton.includes('<b>7</b>'));
  assert.equal(viaButton, viaCommand, 'the button and the command should answer identically');
});

test('every result offers a way back to the menu', async () => {
  routes['GET /api/stats'] = { body: { invites: 1, responses: 1, total_people: 2 } };
  routes['GET /api/invites'] = { body: [] };
  routes['GET /api/guests'] = { body: [] };

  for (const press of ['menu:stats', 'menu:rsvps', 'menu:pending']) {
    sent = [];
    await bot.handleUpdate(tap(press));
    assert.ok(buttonData().includes('menu:home'), `${press} left the couple with no way back`);
  }
});

test('the menu home button clears whatever flow was in progress', async () => {
  await bot.handleUpdate(tap('menu:invite'));
  assert.ok(await ui.getFlow(CHAT), 'the invite flow should have started');
  await bot.handleUpdate(tap('menu:home'));
  assert.equal(await ui.getFlow(CHAT), null, 'the flow should have been dropped');
});

test('help is readable without admin rights', async () => {
  await bot.handleUpdate(tap('menu:help', 5555));
  assert.ok(allText().includes('/invite'));
});

// ─── The three-step invite ───────────────────────────────────────────────────

test('/invite with no arguments asks for the name first', async () => {
  await bot.handleUpdate(command('/invite'));
  const text = allText();
  assert.ok(text.includes('שלב 1'), 'the first step should say so');
  assert.ok(text.includes('שם'));
  assert.ok(buttonData().includes('flow:cancel'), 'a way out at every step');
  assert.deepEqual(siteCalls(), [], 'nothing should be created yet');
});

test('the three steps run in order and create the invitation at the end', async () => {
  routes['POST /api/invites'] = { body: { token: 'tok-1', name: 'דנה כהן', url: `${apiBase}/?i=tok-1` } };

  await bot.handleUpdate(command('/invite'));
  sent = [];

  // Step 1 → the name.
  await bot.handleUpdate(plain('דנה כהן'));
  assert.ok(allText().includes('שלב 2'), 'the phone step should follow the name');
  assert.ok(allText().includes('דנה כהן'), 'the name is echoed back');
  assert.deepEqual(siteCalls(), []);
  sent = [];

  // Step 2 → the phone.
  await bot.handleUpdate(plain('050-123-4567'));
  assert.ok(allText().includes('שלב 3'));
  assert.deepEqual(
    buttonData().filter((d) => d.startsWith('invite:side:')).sort(),
    Object.keys(sides).map((k) => `invite:side:${k}`).sort(),
  );
  assert.deepEqual(siteCalls(), []);
  sent = [];

  // Step 3 → the side, tapped.
  await bot.handleUpdate(tap('invite:side:vered_parents'));

  const created = apiCalls.find((c) => c.key === 'POST /api/invites');
  assert.ok(created, 'the invitation was never created');
  assert.deepEqual(created.body, { name: 'דנה כהן', phone: '050-123-4567', side: 'vered_parents' });

  const text = allText();
  assert.ok(text.includes('tok-1'), 'the personal link should come back');
  assert.ok(text.includes(sides.vered_parents), 'the side should be confirmed');
  assert.ok(text.includes('25.10.2026'), 'the forwardable invitation text comes with it');
  assert.equal(await ui.getFlow(CHAT), null, 'the flow should be finished');
});

test('a shared contact fills the phone step in one tap', async () => {
  routes['POST /api/invites'] = { body: { token: 't', name: 'x', url: `${apiBase}/?i=t` } };

  await bot.handleUpdate(command('/invite'));
  await bot.handleUpdate(plain('משה לוי'));
  sent = [];

  await bot.handleUpdate(contact('+972501112233'));
  assert.ok(allText().includes('שלב 3'), 'sharing a contact should move to the side step');

  await bot.handleUpdate(tap('invite:side:idan'));
  const created = apiCalls.find((c) => c.key === 'POST /api/invites');
  assert.equal(created.body.phone, '+972501112233');
  assert.equal(created.body.name, 'משה לוי');
});

test('the phone step can be skipped', async () => {
  routes['POST /api/invites'] = { body: { token: 't', name: 'x', url: `${apiBase}/?i=t` } };

  await bot.handleUpdate(command('/invite'));
  await bot.handleUpdate(plain('בלי טלפון'));
  assert.ok(buttonData().includes('invite:nophone'), 'the skip button should be offered');

  await bot.handleUpdate(tap('invite:nophone'));
  await bot.handleUpdate(tap('invite:side:vered'));

  const created = apiCalls.find((c) => c.key === 'POST /api/invites');
  assert.deepEqual(created.body, { name: 'בלי טלפון', phone: '', side: 'vered' });
});

test('the side can be typed instead of tapped', async () => {
  routes['POST /api/invites'] = { body: { token: 't', name: 'x', url: `${apiBase}/?i=t` } };

  await bot.handleUpdate(command('/invite'));
  await bot.handleUpdate(plain('מקליד'));
  await bot.handleUpdate(plain('0501234567'));
  await bot.handleUpdate(plain('הורי עידן'));

  const created = apiCalls.find((c) => c.key === 'POST /api/invites');
  assert.equal(created.body.side, 'idan_parents');
});

test('an unrecognised typed side re-offers the buttons instead of giving up', async () => {
  await bot.handleUpdate(command('/invite'));
  await bot.handleUpdate(plain('מישהו'));
  await bot.handleUpdate(plain('0501234567'));
  sent = [];

  await bot.handleUpdate(plain('חבר מהצבא'));
  assert.ok(allText().includes('לא זיהיתי'));
  assert.ok(buttonData().includes('invite:side:vered'));
  assert.ok(!apiCalls.some((c) => c.key === 'POST /api/invites'), 'nothing should be created');
  assert.ok(await ui.getFlow(CHAT), 'the flow should still be open so they can pick');
});

test('cancel drops the flow at any step', async () => {
  await bot.handleUpdate(command('/invite'));
  await bot.handleUpdate(plain('חצי דרך'));
  await bot.handleUpdate(tap('flow:cancel'));

  assert.equal(await ui.getFlow(CHAT), null);
  assert.ok(buttonData().includes('menu:stats'), 'cancelling should land back on the menu');

  // And a stray message afterwards is not mistaken for an answer.
  sent = [];
  await bot.handleUpdate(plain('סתם הודעה'));
  assert.equal(messages().length, 0, 'the bot should stay quiet outside a flow');
});

test('the one-line form still works for anyone who prefers typing', async () => {
  routes['POST /api/invites'] = { body: { token: 't', name: 'x', url: `${apiBase}/?i=t` } };

  await bot.handleUpdate(command('/invite דני כהן | 0501234567 | ורד'));
  const created = apiCalls.find((c) => c.key === 'POST /api/invites');
  assert.deepEqual(created.body, { name: 'דני כהן', phone: '0501234567', side: 'vered' });
  assert.equal(await ui.getFlow(CHAT), null);
});

test('a name-only /invite carries on through the remaining steps', async () => {
  routes['POST /api/invites'] = { body: { token: 't', name: 'x', url: `${apiBase}/?i=t` } };

  await bot.handleUpdate(command('/invite רק שם'));
  assert.ok(allText().includes('שלב 2'), 'it should ask for the phone next');

  await bot.handleUpdate(tap('invite:nophone'));
  await bot.handleUpdate(tap('invite:side:idan'));
  const created = apiCalls.find((c) => c.key === 'POST /api/invites');
  assert.equal(created.body.name, 'רק שם');
});

test('tapping a side with no flow open says so instead of creating nonsense', async () => {
  await ui.endFlow(CHAT);
  await bot.handleUpdate(tap('invite:side:vered'));
  assert.ok(allText().includes('פגה'));
  assert.ok(!apiCalls.some((c) => c.key === 'POST /api/invites'));
});

test('an API failure at the last step is reported and the flow is closed', async () => {
  routes['POST /api/invites'] = { status: 500, body: { detail: 'boom' } };

  await bot.handleUpdate(command('/invite'));
  await bot.handleUpdate(plain('נכשל'));
  await bot.handleUpdate(tap('invite:nophone'));
  sent = [];
  await bot.handleUpdate(tap('invite:side:vered'));

  assert.ok(allText().includes('⚠️'));
  assert.equal(await ui.getFlow(CHAT), null, 'a failed attempt must not leave the flow hanging');
  assert.ok(buttonData().includes('menu:home'));
});

// ─── The stepped search ──────────────────────────────────────────────────────

test('/search with no term waits for the next message', async () => {
  routes['GET /api/invites'] = { body: [{ token: 't', name: 'דוד כהן', phone: '0501111111', responded: false }] };
  routes['GET /api/guests'] = { body: [] };

  await bot.handleUpdate(command('/search'));
  assert.ok(buttonData().includes('flow:cancel'));
  assert.deepEqual(siteCalls(), [], 'nothing should be searched yet');
  sent = [];

  await bot.handleUpdate(plain('דוד'));
  assert.ok(allText().includes('דוד כהן'));
  assert.equal(await ui.getFlow(CHAT), null, 'the search flow ends after one term');
});

test('the search button starts the same flow', async () => {
  routes['GET /api/invites'] = { body: [] };
  routes['GET /api/guests'] = { body: [{ id: 1, name: 'רונית', attending: true, guests: 2 }] };

  await bot.handleUpdate(tap('menu:search'));
  await bot.handleUpdate(plain('רונית'));
  assert.ok(allText().includes('רונית'));
});

// ─── Commands are never swallowed by the step handler ────────────────────────

test('a command typed mid-flow still runs', async () => {
  routes['GET /api/stats'] = { body: { invites: 2, responses: 1, total_people: 3 } };

  await bot.handleUpdate(command('/invite'));
  sent = [];
  await bot.handleUpdate(command('/stats'));

  assert.ok(allText().includes('סטטוס אישורי הגעה'), '/stats was swallowed by the invite flow');
});

test('/export still reaches its handler despite the catch-all text handler', async () => {
  routes['GET /api/invites'] = { status: 500, body: {} };
  routes['GET /api/guests'] = { status: 500, body: {} };

  await bot.handleUpdate(command('/export'));
  assert.ok(allText().includes('בונה את הדוח'), '/export never ran');
});

test('a flow belongs to one chat only', async () => {
  await bot.handleUpdate(command('/invite'));
  assert.ok(await ui.getFlow(CHAT));
  assert.equal(await ui.getFlow(9999), null, 'another chat must not inherit the flow');
});
