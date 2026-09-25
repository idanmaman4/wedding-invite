'use strict';

/**
 * The subscriber registry and the flow state, both behind the admin API.
 *
 * A local HTTP server stands in for the site. Explicit routes pin the exact
 * request shapes the Python side receives (and its failures); everything else
 * falls through to test/helpers/bot-db.js, an in-memory copy of the bot's
 * tables with the real endpoints' responses, so the registry's behaviour is
 * exercised end to end.
 */

const test = require('node:test');
const { before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBotDb } = require('./helpers/bot-db');

let store;
let ui;
let server;
let routes = {};
let calls = [];
const botDb = createBotDb();

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const key = `${req.method} ${req.url}`;
      const body = raw ? JSON.parse(raw) : null;
      calls.push({ key, body, headers: req.headers });
      const route = routes[key] || botDb.handle(req.method, req.url, body);
      res.writeHead(route ? route.status || 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(route ? route.body : { error: 'missing' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.ADMIN_PASSWORD = 'pw';

  store = require('../store');
  ui = require('../ui');
});

after(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  routes = {};
  calls = [];
  botDb.reset();
});

// ─── Where it lives ──────────────────────────────────────────────────────────

test('the registry is always the database, on Vercel or off it', () => {
  const saved = { VERCEL: process.env.VERCEL, BOT_STORE: process.env.BOT_STORE };
  try {
    delete process.env.VERCEL;
    process.env.BOT_STORE = 'file'; // a leftover setting from the old file store
    assert.equal(store.backend(), 'api');
    process.env.VERCEL = '1';
    assert.equal(store.backend(), 'api');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('the old file-store knobs are gone from the module', () => {
  assert.equal(store.FILE, undefined);
  assert.deepEqual(Object.keys(store).sort(), ['add', 'all', 'backend', 'getDefaultSide', 'has', 'remove', 'setDefaultSide']);
});

// ─── Behaviour, against the in-memory tables ────────────────────────────────

test('an empty registry reads as empty', async () => {
  assert.deepEqual(await store.all(), []);
  assert.equal(await store.has(123), false);
});

test('add stores the subscriber and reports it as new exactly once', async () => {
  assert.equal(await store.add({ chat_id: 111, first_name: 'עידן', username: 'idan' }), true);
  assert.equal(await store.add({ chat_id: 111, first_name: 'עידן', username: 'idan' }), false);
  assert.equal((await store.all()).length, 1);

  const [s] = await store.all();
  assert.equal(s.chat_id, '111', 'the database keys chats by their id as text');
  assert.equal(s.first_name, 'עידן');
  assert.equal(s.username, 'idan');
  assert.ok(!Number.isNaN(Date.parse(s.subscribed_at)), 'subscribed_at is an ISO timestamp');
});

test('a numeric and a string chat id are the same subscriber', async () => {
  await store.add({ chat_id: 222 });
  assert.equal(await store.add({ chat_id: '222' }), false);
  assert.equal((await store.all()).length, 1);
  assert.equal(await store.has('222'), true);
  assert.equal(await store.has(222), true);
});

test('re-adding refreshes the name but keeps the original signup time', async () => {
  await store.add({ chat_id: 333, first_name: 'ורד', username: '' });
  const first = (await store.all())[0].subscribed_at;

  await store.add({ chat_id: 333, first_name: 'ורד כהן', username: 'vered' });
  const [s] = await store.all();
  assert.equal(s.first_name, 'ורד כהן');
  assert.equal(s.username, 'vered');
  assert.equal(s.subscribed_at, first);
});

test('re-adding with blank details does not wipe what is already known', async () => {
  await store.add({ chat_id: 444, first_name: 'דנה', username: 'dana' });
  await store.add({ chat_id: 444, first_name: '', username: undefined });
  const [s] = await store.all();
  assert.equal(s.first_name, 'דנה');
  assert.equal(s.username, 'dana');
});

test('remove drops a subscriber and says whether it did anything', async () => {
  await store.add({ chat_id: 555 });
  await store.add({ chat_id: 666 });

  assert.equal(await store.remove('555'), true);
  assert.equal(await store.remove('555'), false, 'removing twice is a no-op');
  assert.deepEqual((await store.all()).map((s) => s.chat_id), ['666']);
});

test('removing a subscriber also drops their half-finished flow', async () => {
  await store.add({ chat_id: 888 });
  await ui.startFlow(888, 'invite');
  assert.ok(await ui.getFlow(888));
  await store.remove(888);
  assert.equal(await ui.getFlow(888), null);
});

// ─── Request shapes and failures ─────────────────────────────────────────────

test('add posts the subscriber with the admin password and reports created', async () => {
  routes['POST /api/bot/subscribers'] = { body: { created: true, subscriber: { chat_id: '42' } } };

  assert.equal(await store.add({ chat_id: 42, first_name: 'עידן', username: 'idan' }), true);
  const call = calls.find((c) => c.key === 'POST /api/bot/subscribers');
  assert.deepEqual(call.body, { chat_id: '42', first_name: 'עידן', username: 'idan' });
  assert.equal(call.headers['x-admin-password'], 'pw');

  routes['POST /api/bot/subscribers'] = { body: { created: false, subscriber: { chat_id: '42' } } };
  assert.equal(await store.add({ chat_id: 42 }), false, 'a second add is not new');
  assert.deepEqual(calls.at(-1).body, { chat_id: '42', first_name: '', username: '' }, 'missing names go as blanks');
});

test('all and has read the list from the site', async () => {
  routes['GET /api/bot/subscribers'] = { body: [{ chat_id: '1' }, { chat_id: '2' }] };

  assert.deepEqual((await store.all()).map((s) => s.chat_id), ['1', '2']);
  assert.equal(await store.has(2), true, 'a numeric id matches a string row');
  assert.equal(await store.has(3), false);
});

test('a response that is not a list reads as no subscribers', async () => {
  routes['GET /api/bot/subscribers'] = { body: { chat_id: '1' } };
  assert.deepEqual(await store.all(), []);
});

test('remove deletes by chat id and reports whether anything went', async () => {
  routes['DELETE /api/bot/subscribers/7'] = { body: { removed: true } };
  assert.equal(await store.remove(7), true);
  routes['DELETE /api/bot/subscribers/7'] = { body: { removed: false } };
  assert.equal(await store.remove(7), false);
});

test('a chat id is escaped in the path', async () => {
  await store.remove('a/b');
  assert.equal(calls.at(-1).key, 'DELETE /api/bot/subscribers/a%2Fb');
});

test('a rejected password surfaces instead of reading as "no subscribers"', async () => {
  routes['GET /api/bot/subscribers'] = { status: 401, body: { detail: 'Unauthorized' } };
  await assert.rejects(() => store.all(), (err) => err.unauthorized === true);
});

test('a database outage on add surfaces instead of claiming success', async () => {
  routes['POST /api/bot/subscribers'] = { status: 500, body: { detail: 'db down' } };
  await assert.rejects(() => store.add({ chat_id: 9 }));
});

// ─── Flow state ──────────────────────────────────────────────────────────────

test('a flow is written, read back and cleared through /api/bot/state', async () => {
  const started = await ui.startFlow(12, 'invite', { name: 'דנה' });
  const put = calls.find((c) => c.key === 'PUT /api/bot/state/12');
  assert.deepEqual(put.body, { data: started }, 'the whole state goes as `data`');
  assert.equal(put.headers['x-admin-password'], 'pw');

  const read = await ui.getFlow(12);
  assert.equal(read.flow, 'invite');
  assert.deepEqual(read.data, { name: 'דנה' });

  await ui.advanceFlow(12, { step: 2, data: { phone: '050' } });
  const advanced = await ui.getFlow(12);
  assert.equal(advanced.step, 2);
  assert.deepEqual(advanced.data, { name: 'דנה', phone: '050' });

  await ui.endFlow(12);
  assert.ok(calls.some((c) => c.key === 'DELETE /api/bot/state/12'));
  assert.equal(await ui.getFlow(12), null);
});

test('no stored state (a 404) reads as no flow', async () => {
  assert.equal(await ui.getFlow(13), null);
  assert.equal(await ui.advanceFlow(13, { step: 1 }), null, 'nothing to advance');
});

test('a stored row without a flow in it reads as no flow', async () => {
  routes['GET /api/bot/state/14'] = { body: { chat_id: '14', data: {} } };
  assert.equal(await ui.getFlow(14), null);
});

test('a stale flow is forgotten and deleted from the database', async () => {
  botDb.states.set('15', JSON.stringify({ flow: 'search', step: 0, data: {}, at: Date.now() - ui.FLOW_TTL_MS - 1000 }));
  assert.equal(await ui.getFlow(15), null);
  assert.equal(botDb.states.has('15'), false);
});

test('a state-read failure other than 404 surfaces', async () => {
  routes['GET /api/bot/state/16'] = { status: 500, body: { detail: 'db down' } };
  await assert.rejects(() => ui.getFlow(16));
});

test('flows belong to one chat each', async () => {
  await ui.startFlow(17, 'invite');
  assert.equal(await ui.getFlow(18), null);
});
