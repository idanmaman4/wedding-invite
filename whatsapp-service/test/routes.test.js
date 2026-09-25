'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { startApp, fakeClient, contact, req, json } = require('./helpers');

test('GET /health reports liveness and the coarse per-sender state', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const { status, body } = await req(app.url, '/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.authRequired, false);
  assert.deepEqual(body.clients, { idan: 'ready', vered: 'offline' });
});

test('GET /status exposes the raw internal statuses for the FastAPI proxy', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const { body } = await req(app.url, '/status');
  assert.deepEqual(body, { idan: 'connected', vered: 'disconnected' });
});

test('CORS lets the deployed admin panel call this service from the browser', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const res = await fetch(app.url + '/health', { headers: { Origin: 'https://wedding-invite-sand-kappa.vercel.app' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://wedding-invite-sand-kappa.vercel.app');

  const pre = await fetch(app.url + '/send-bulk', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-wa-key',
    },
  });
  assert.ok(pre.status === 200 || pre.status === 204, `preflight status ${pre.status}`);
  const allowed = (pre.headers.get('access-control-allow-headers') || '').toLowerCase();
  assert.ok(allowed.includes('x-wa-key'), 'the shared-secret header must survive preflight');
});

test('the WA_KEY gate guards sending but leaves /health open', async (t) => {
  const app = await startApp({ waKey: 's3cret' });
  t.after(app.close);

  const open = await req(app.url, '/health');
  assert.equal(open.status, 200);
  assert.equal(open.body.authRequired, true);

  const denied = await req(app.url, '/contacts?sender=idan');
  assert.equal(denied.status, 401);

  const wrong = await req(app.url, '/contacts?sender=idan', { headers: { 'X-Wa-Key': 'nope' } });
  assert.equal(wrong.status, 401);

  const ok = await req(app.url, '/contacts?sender=idan', { headers: { 'X-Wa-Key': 's3cret' } });
  assert.equal(ok.status, 200);

  const viaQuery = await req(app.url, '/contacts?sender=idan&key=s3cret');
  assert.equal(viaQuery.status, 200);
});

test('preflight is never rejected by the key gate', async (t) => {
  const app = await startApp({ waKey: 's3cret' });
  t.after(app.close);

  const pre = await fetch(app.url + '/send', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
  });
  assert.ok(pre.status < 400, `preflight must pass the gate, got ${pre.status}`);
});

test('every send route refuses a sender that is not connected', async (t) => {
  const app = await startApp();
  t.after(app.close);

  for (const call of [
    ['/contacts?sender=vered', {}],
    ['/send', json({ sender: 'vered', to: '0501234567', message: 'hi' })],
    ['/send-invitation', json({ sender: 'vered', phone: '0501234567' })],
    ['/send-bulk', json({ sender: 'vered', messages: [{ phone: '0501234567', text: 'hi' }] })],
  ]) {
    const { status, body } = await req(app.url, call[0], call[1]);
    assert.equal(status, 409, `${call[0]} should be 409`);
    assert.equal(body.status, 'disconnected');
    assert.ok(body.hint.includes('/connect/vered'));
  }
});

test('an unknown sender is a 400, not a crash', async (t) => {
  const app = await startApp();
  t.after(app.close);

  assert.equal((await req(app.url, '/contacts?sender=bob')).status, 400);
  assert.equal((await req(app.url, '/qr/bob')).status, 400);
  assert.equal((await req(app.url, '/connect/bob', { method: 'POST' })).status, 400);
  assert.equal((await req(app.url, '/send', json({ sender: 'bob', to: '0501234567', message: 'x' }))).status, 400);
});

test('GET /contacts returns shaped rows and honours ?q', async (t) => {
  const app = await startApp();
  app.sessions.idan.client = fakeClient({
    contacts: [
      contact({ user: '972501111111', name: 'דוד כהן' }),
      contact({ user: '972502222222', name: 'רונית לוי' }),
      contact({ user: '972503333333', name: 'קבוצת חתונה', isGroup: true }),
    ],
  });
  t.after(app.close);

  const all = await req(app.url, '/contacts?sender=idan');
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 2);
  assert.equal(all.body.truncated, false);
  assert.deepEqual(all.body.contacts.map((c) => c.name), ['דוד כהן', 'רונית לוי']);

  const filtered = await req(app.url, '/contacts?sender=idan&q=' + encodeURIComponent('רונית'));
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.contacts[0].number, '972502222222');
});

test('GET /contacts surfaces a WhatsApp failure as a 500 with the reason', async (t) => {
  const app = await startApp();
  app.sessions.idan.client = fakeClient({ contactsThrow: true });
  t.after(app.close);

  const { status, body } = await req(app.url, '/contacts?sender=idan');
  assert.equal(status, 500);
  assert.equal(body.error, 'getContacts boom');
});

test('POST /send normalises the number before handing it to WhatsApp', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const { status, body } = await req(app.url, '/send', json({ sender: 'idan', to: '050-123-4567', message: 'שלום' }));
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(app.sessions.idan.client.sent, [{ chatId: '972501234567@c.us', body: 'שלום' }]);
});

test('POST /send rejects an unusable number without calling WhatsApp', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const { status, body } = await req(app.url, '/send', json({ sender: 'idan', to: 'not-a-phone', message: 'hi' }));
  assert.equal(status, 400);
  assert.ok(body.error.includes('Invalid phone number'));
  assert.equal(app.sessions.idan.client.sent.length, 0);
});

test('POST /send-invitation builds the Hebrew invitation when no body is given', async (t) => {
  const app = await startApp();
  t.after(app.close);

  await req(app.url, '/send-invitation', json({ sender: 'idan', guestName: 'דוד', phone: '0501234567' }));
  const [msg] = app.sessions.idan.client.sent;
  assert.equal(msg.chatId, '972501234567@c.us');
  assert.ok(msg.body.includes('שלום דוד,'));
  assert.ok(msg.body.includes('https://example.test'), 'falls back to the configured site URL');
  assert.ok(msg.body.includes('25.10.2026'));
});

test('POST /send-invitation prefers an explicit message and websiteUrl', async (t) => {
  const app = await startApp();
  t.after(app.close);

  await req(app.url, '/send-invitation', json({ sender: 'idan', phone: '0501234567', message: 'טקסט משלי' }));
  assert.equal(app.sessions.idan.client.sent[0].body, 'טקסט משלי');

  await req(app.url, '/send-invitation', json({ sender: 'idan', phone: '0501234567', websiteUrl: 'https://custom.test/?i=abc' }));
  assert.ok(app.sessions.idan.client.sent[1].body.includes('https://custom.test/?i=abc'));
});

test('POST /connect starts a login, and is a no-op when already connected', async (t) => {
  const app = await startApp();
  t.after(app.close);

  const already = await req(app.url, '/connect/idan', { method: 'POST' });
  assert.equal(already.body.message, 'Already connected');
  assert.deepEqual(app.initCalls, []);

  const fresh = await req(app.url, '/connect/vered', { method: 'POST' });
  assert.equal(fresh.status, 200);
  assert.deepEqual(app.initCalls, ['vered']);
  assert.equal(app.sessions.vered.status, 'initializing');
});

test('POST /disconnect tears the client down and clears the QR', async (t) => {
  const app = await startApp();
  const client = app.sessions.idan.client;
  app.sessions.idan.qrDataUrl = 'data:image/png;base64,xxx';
  t.after(app.close);

  const { status, body } = await req(app.url, '/disconnect/idan', { method: 'POST' });
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(client.destroyed, true);
  assert.equal(app.sessions.idan.client, null);
  assert.equal(app.sessions.idan.status, 'disconnected');
  assert.equal(app.sessions.idan.qrDataUrl, null);
});

test('GET /qr hands back whatever the login produced', async (t) => {
  const app = await startApp();
  app.sessions.vered.status = 'awaiting_scan';
  app.sessions.vered.qrDataUrl = 'data:image/png;base64,zzz';
  t.after(app.close);

  const { body } = await req(app.url, '/qr/vered');
  assert.deepEqual(body, { status: 'awaiting_scan', qr: 'data:image/png;base64,zzz' });
});
