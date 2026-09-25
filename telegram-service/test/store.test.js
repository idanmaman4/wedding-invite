'use strict';

/**
 * The subscriber registry, both backends.
 *
 * The file backend is exercised against a real throwaway JSON file so the
 * atomic write and the corrupt-file recovery are actually tested on disk. The
 * API backend is exercised against a local HTTP server standing in for the
 * site, so the request shapes are what the Python side really receives.
 */

const test = require('node:test');
const { before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

let dir;
let file;
let store;
let server;
let routes = {};
let calls = [];

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-store-'));
  file = path.join(dir, 'subscribers.json');
  process.env.TELEGRAM_SUBSCRIBERS_FILE = file;
  process.env.BOT_STORE = 'file';

  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const key = `${req.method} ${req.url}`;
      calls.push({ key, body: raw ? JSON.parse(raw) : null, headers: req.headers });
      const route = routes[key];
      res.writeHead(route ? route.status || 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(route ? route.body : { error: 'missing' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.ADMIN_PASSWORD = 'pw';

  store = require('../store');
});

after(async () => {
  fs.rmSync(dir, { recursive: true, force: true });
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  process.env.BOT_STORE = 'file';
  fs.rmSync(file, { force: true });
  routes = {};
  calls = [];
});

// ─── Backend selection ───────────────────────────────────────────────────────

test('the file backend is the default off Vercel; the API backend on it', () => {
  delete process.env.BOT_STORE;
  delete process.env.VERCEL;
  assert.equal(store.backend(), 'file');
  process.env.VERCEL = '1';
  assert.equal(store.backend(), 'api');
  delete process.env.VERCEL;
  process.env.BOT_STORE = 'api';
  assert.equal(store.backend(), 'api', 'an explicit setting wins');
  process.env.BOT_STORE = 'file';
});

// ─── File backend ────────────────────────────────────────────────────────────

test('the registry file is the one the environment points at', () => {
  assert.equal(store.FILE, file);
});

test('a registry that does not exist yet reads as empty', async () => {
  assert.deepEqual(await store.all(), []);
  assert.equal(await store.has(123), false);
  assert.equal(fs.existsSync(file), false, 'reading must not create the file');
});

test('add stores the subscriber and reports it as new exactly once', async () => {
  assert.equal(await store.add({ chat_id: 111, first_name: 'עידן', username: 'idan' }), true);
  assert.equal(await store.add({ chat_id: 111, first_name: 'עידן', username: 'idan' }), false);
  assert.equal((await store.all()).length, 1);

  const [s] = await store.all();
  assert.equal(s.chat_id, 111);
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
  assert.deepEqual((await store.all()).map((s) => s.chat_id), [666]);
});

test('the registry survives a process restart, because it is on disk', async () => {
  await store.add({ chat_id: 777, first_name: 'משה' });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].chat_id, 777);
});

test('a corrupt registry is treated as empty instead of taking the bot down', async () => {
  fs.writeFileSync(file, '{ this is not json', 'utf8');
  assert.deepEqual(await store.all(), []);
  // and it recovers: the next add rewrites a valid file
  assert.equal(await store.add({ chat_id: 888 }), true);
  assert.deepEqual((await store.all()).map((s) => s.chat_id), [888]);
});

test('rows without a chat id are ignored', async () => {
  fs.writeFileSync(file, JSON.stringify([{ chat_id: 1 }, { first_name: 'no id' }, null, { chat_id: null }]), 'utf8');
  assert.deepEqual((await store.all()).map((s) => s.chat_id), [1]);
});

test('a registry holding something other than an array reads as empty', async () => {
  fs.writeFileSync(file, JSON.stringify({ chat_id: 1 }), 'utf8');
  assert.deepEqual(await store.all(), []);
});

test('the write is atomic — no .tmp file is left behind', async () => {
  await store.add({ chat_id: 999 });
  assert.equal(fs.existsSync(`${file}.tmp`), false);
});

test('hand-edits made while the bot runs are picked up on the next read', async () => {
  await store.add({ chat_id: 1 });
  fs.writeFileSync(file, JSON.stringify([{ chat_id: 1 }, { chat_id: 2, first_name: 'הוסף ביד' }]), 'utf8');
  assert.equal((await store.all()).length, 2, 'the file is re-read on every access');
  assert.equal(await store.has(2), true);
});

// ─── API backend ─────────────────────────────────────────────────────────────

test('api: add posts the subscriber with the admin password and reports created', async () => {
  process.env.BOT_STORE = 'api';
  routes['POST /api/bot/subscribers'] = { body: { created: true, subscriber: { chat_id: '42' } } };

  assert.equal(await store.add({ chat_id: 42, first_name: 'עידן', username: 'idan' }), true);
  const call = calls.find((c) => c.key === 'POST /api/bot/subscribers');
  assert.deepEqual(call.body, { chat_id: '42', first_name: 'עידן', username: 'idan' });
  assert.equal(call.headers['x-admin-password'], 'pw');

  routes['POST /api/bot/subscribers'] = { body: { created: false, subscriber: { chat_id: '42' } } };
  assert.equal(await store.add({ chat_id: 42 }), false, 'a second add is not new');
});

test('api: all and has read the list from the site', async () => {
  process.env.BOT_STORE = 'api';
  routes['GET /api/bot/subscribers'] = { body: [{ chat_id: '1' }, { chat_id: '2' }] };

  assert.deepEqual((await store.all()).map((s) => s.chat_id), ['1', '2']);
  assert.equal(await store.has(2), true, 'a numeric id matches a string row');
  assert.equal(await store.has(3), false);
});

test('api: remove deletes by chat id and reports whether anything went', async () => {
  process.env.BOT_STORE = 'api';
  routes['DELETE /api/bot/subscribers/7'] = { body: { removed: true } };
  assert.equal(await store.remove(7), true);
  routes['DELETE /api/bot/subscribers/7'] = { body: { removed: false } };
  assert.equal(await store.remove(7), false);
});

test('api: a rejected password surfaces instead of reading as "no subscribers"', async () => {
  process.env.BOT_STORE = 'api';
  routes['GET /api/bot/subscribers'] = { status: 401, body: { detail: 'Unauthorized' } };
  await assert.rejects(() => store.all(), (err) => err.unauthorized === true);
});

test('api: the file on disk is never touched', async () => {
  process.env.BOT_STORE = 'api';
  routes['POST /api/bot/subscribers'] = { body: { created: true } };
  await store.add({ chat_id: 5 });
  assert.equal(fs.existsSync(file), false);
});
