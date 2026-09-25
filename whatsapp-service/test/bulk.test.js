'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startApp, fakeClient, req, json } = require('./helpers');

test('POST /send-bulk sends every message and summarises the run', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const { status, body } = await req(app.url, '/send-bulk', json({
    sender: 'idan',
    messages: [
      { phone: '0501111111', text: 'א' },
      { phone: '+972502222222', text: 'ב' },
      { phone: '503333333', text: 'ג' },
    ],
  }));

  assert.equal(status, 200);
  assert.equal(body.total, 3);
  assert.equal(body.sent, 3);
  assert.equal(body.failed, 0);
  assert.equal(body.aborted, false);
  assert.deepEqual(app.sessions.idan.client.sent.map((m) => m.chatId), [
    '972501111111@c.us',
    '972502222222@c.us',
    '972503333333@c.us',
  ]);
});

test('POST /send-bulk keeps going past a bad row and reports it per phone', async (t) => {
  const app = await startApp();
  app.sessions.idan.client = fakeClient({ failOn: (chatId) => chatId.startsWith('972509') });
  t.after(app.close);

  const { body } = await req(app.url, '/send-bulk', json({
    sender: 'idan',
    messages: [
      { phone: '0501111111', text: 'ok' },
      { phone: 'garbage', text: 'bad number' },
      { phone: '0502222222', text: '   ' },
      { phone: '0509999999', text: 'whatsapp refuses' },
      { phone: '0503333333', text: 'ok again' },
    ],
  }));

  assert.equal(body.total, 5);
  assert.equal(body.sent, 2);
  assert.equal(body.failed, 3);
  assert.deepEqual(body.results.map((r) => r.ok), [true, false, false, false, true]);
  assert.equal(body.results[1].error, 'מספר טלפון לא תקין');
  assert.equal(body.results[2].error, 'הודעה ריקה');
  assert.equal(body.results[3].error, 'send failed');
  // the last message still went out — one bad row must not end the run
  assert.equal(app.sessions.idan.client.sent.at(-1).chatId, '972503333333@c.us');
});

test('POST /send-bulk rejects a missing or empty list', async (t) => {
  const app = await startApp();
  t.after(app.close);

  for (const payload of [{ sender: 'idan' }, { sender: 'idan', messages: [] }, { sender: 'idan', messages: 'nope' }]) {
    const { status, body } = await req(app.url, '/send-bulk', json(payload));
    assert.equal(status, 400);
    assert.ok(body.error.includes('non-empty array'));
  }
});

test('POST /send-bulk validates the list before the connection', async (t) => {
  const app = await startApp();
  t.after(app.close);

  // vered is offline, but an empty list is the more useful error to return
  const { status } = await req(app.url, '/send-bulk', json({ sender: 'vered', messages: [] }));
  assert.equal(status, 400);
});

test('POST /send-bulk streams NDJSON progress when asked', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const res = await fetch(app.url + '/send-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ sender: 'idan', messages: [{ phone: '0501111111', text: 'א' }, { phone: 'bad', text: 'ב' }] }),
  });

  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type').includes('application/x-ndjson'));
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));

  assert.equal(lines[0].type, 'start');
  assert.equal(lines[0].total, 2);
  assert.equal(lines[1].type, 'progress');
  assert.equal(lines[1].index, 0);
  assert.equal(lines[1].ok, true);
  assert.equal(lines[2].index, 1);
  assert.equal(lines[2].ok, false);
  assert.equal(lines.at(-1).type, 'done');
  assert.equal(lines.at(-1).sent, 1);
  assert.equal(lines.at(-1).failed, 1);
});

test('POST /send-bulk honours stream:true in the body as well as the Accept header', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const res = await fetch(app.url + '/send-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: 'idan', stream: true, messages: [{ phone: '0501111111', text: 'א' }] }),
  });
  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].type, 'start');
  assert.equal(lines.at(-1).type, 'done');
});

test('POST /send-bulk reports the delay window it will pace with', async (t) => {
  const app = await startApp({ minDelay: 3000, maxDelay: 7000 });
  t.after(app.close);

  const res = await fetch(app.url + '/send-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: 'idan', stream: true, minDelayMs: 0, maxDelayMs: 0, messages: [{ phone: '0501111111', text: 'א' }] }),
  });
  const first = JSON.parse((await res.text()).trim().split('\n')[0]);
  assert.equal(first.minDelay, 0);
  assert.equal(first.maxDelay, 0);
});

test('POST /send-bulk paces between messages but never after the last one', async (t) => {
  const app = await startApp({ minDelay: 60, maxDelay: 60 });
  t.after(app.close);

  const started = Date.now();
  const { body } = await req(app.url, '/send-bulk', json({
    sender: 'idan',
    messages: [
      { phone: '0501111111', text: 'א' },
      { phone: '0502222222', text: 'ב' },
      { phone: '0503333333', text: 'ג' },
    ],
  }));
  const elapsed = Date.now() - started;

  assert.equal(body.sent, 3);
  // two gaps of 60ms between three messages, and no trailing wait
  assert.ok(elapsed >= 110, `expected pacing between messages, took ${elapsed}ms`);
  assert.ok(elapsed < 400, `expected no trailing delay, took ${elapsed}ms`);
});

test('POST /send-bulk sends strictly in order', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const messages = Array.from({ length: 12 }, (_, i) => ({ phone: `05011111${String(i).padStart(2, '0')}`, text: `#${i}` }));
  await req(app.url, '/send-bulk', json({ sender: 'idan', messages }));

  assert.deepEqual(app.sessions.idan.client.sent.map((m) => m.body), messages.map((m) => m.text));
});
