'use strict';

/**
 * Exercises the admin-API client against a real HTTP server on localhost, so
 * headers, status handling, timeouts and the /stats → /invites → /guests
 * fallback chain are all tested end to end over a socket.
 */

const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let api;
let server;
let baseUrl;

/** Swapped per test: `(req) => { status, body }` keyed by "METHOD /path". */
let routes = {};
/** Every request the client made, for asserting on headers and bodies. */
let calls = [];

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const key = `${req.method} ${req.url}`;
      calls.push({ key, headers: req.headers, body: raw ? JSON.parse(raw) : null });

      const route = routes[key];
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'no route' }));
      }
      if (route.hang) return; // never answers — drives the timeout path
      const payload = route.raw !== undefined ? route.raw : JSON.stringify(route.body);
      res.writeHead(route.status || 200, { 'Content-Type': 'application/json' });
      res.end(payload);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  process.env.API_BASE = baseUrl + '/'; // the trailing slash must be trimmed
  process.env.ADMIN_PASSWORD = 'test-password';
  process.env.API_TIMEOUT_MS = '400';
  api = require('../api');
});

after(() => new Promise((r) => server.close(r)));

test.beforeEach(() => {
  routes = {};
  calls = [];
});

test('API_BASE drops a trailing slash so paths do not double up', () => {
  assert.equal(api.API_BASE, baseUrl);
});

test('every request carries the admin password header', async () => {
  routes['GET /api/guests'] = { body: [] };
  await api.getGuests();
  assert.equal(calls[0].headers['x-admin-password'], 'test-password');
});

test('a POST sends JSON with the right content type', async () => {
  routes['POST /api/invites'] = { body: { token: 't1', name: 'דנה', side: 'vered' } };
  await api.createInvite({ name: 'דנה', phone: '0501234567', side: 'vered' });
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.deepEqual(calls[0].body, { name: 'דנה', phone: '0501234567', side: 'vered' });
});

test('a 404 becomes a "missing" ApiError, not a crash', async () => {
  await assert.rejects(() => api.getInvites(), (err) => {
    assert.ok(err instanceof api.ApiError);
    assert.equal(err.missing, true);
    assert.equal(err.status, 404);
    return true;
  });
});

test('401 and 403 are flagged as unauthorized and named in Hebrew', async () => {
  for (const status of [401, 403]) {
    routes['GET /api/guests'] = { status, body: { detail: 'nope' } };
    await assert.rejects(() => api.getGuests(), (err) => {
      assert.equal(err.unauthorized, true);
      assert.equal(err.status, status);
      assert.ok(err.message.includes('ADMIN_PASSWORD'));
      return true;
    });
  }
});

test('a 500 carries the status and a trimmed body', async () => {
  routes['GET /api/guests'] = { status: 500, raw: 'x'.repeat(500) };
  await assert.rejects(() => api.getGuests(), (err) => {
    assert.equal(err.status, 500);
    assert.ok(err.message.length < 300, 'the server body must be truncated');
    return true;
  });
});

test('unparseable JSON is reported as a bad response', async () => {
  routes['GET /api/guests'] = { raw: 'not json at all' };
  await assert.rejects(() => api.getGuests(), (err) => {
    assert.ok(err.message.includes('תשובה לא תקינה'));
    return true;
  });
});

test('an empty body is a null result, not an error', async () => {
  routes['GET /api/guests'] = { raw: '' };
  assert.deepEqual(await api.getGuests(), []);
});

test('a request that never answers aborts on the timeout', async () => {
  routes['GET /api/guests'] = { hang: true };
  await assert.rejects(() => api.getGuests(), (err) => {
    assert.ok(err instanceof api.ApiError);
    assert.equal(err.status, 0);
    assert.ok(err.message.includes('לא נענתה בזמן'));
    return true;
  });
});

test('getInvites accepts both a bare array and a wrapped object', async () => {
  routes['GET /api/invites'] = { body: [{ token: 'a', name: 'A' }] };
  assert.equal((await api.getInvites()).length, 1);

  routes['GET /api/invites'] = { body: { invites: [{ token: 'b' }, { token: 'c' }] } };
  assert.equal((await api.getInvites()).length, 2);

  routes['GET /api/invites'] = { body: { something: 'else' } };
  assert.deepEqual(await api.getInvites(), []);
});

test('normalizeInvite fills in the defaults the bot relies on', async () => {
  routes['GET /api/invites'] = { body: [{ token: 'tok', name: '  דנה  ', guests: '3' }] };
  const [inv] = await api.getInvites();
  assert.equal(inv.name, 'דנה', 'names are trimmed');
  assert.equal(inv.guests, 3, 'a numeric string becomes a number');
  assert.equal(inv.responded, false);
  assert.equal(inv.attending, null, 'unanswered stays null, not false');
  // The site reads ?i=<token> (src/store/rsvp.js); /i/<token> opened no invitation.
  assert.equal(inv.url, `${baseUrl}/?i=tok`, 'a link is derived when the API omits it');
});

test('normalizeGuest tolerates the dietary field under any of its spellings', async () => {
  routes['GET /api/guests'] = {
    body: [
      { id: 1, name: 'A', dietary: 'צמחוני' },
      { id: 2, name: 'B', diet: 'טבעוני' },
      { id: 3, name: 'C', dietary_restrictions: 'ללא גלוטן' },
      { id: 4, name: 'D' },
    ],
  };
  assert.deepEqual((await api.getGuests()).map((g) => g.dietary), ['צמחוני', 'טבעוני', 'ללא גלוטן', '']);
});

test('normalizeGuest defaults a missing guest count to one', async () => {
  routes['GET /api/guests'] = { body: [{ id: 1, name: 'A', attending: true }] };
  assert.equal((await api.getGuests())[0].guests, 1);
});

test('createInvite refuses a response with no invite in it', async () => {
  routes['POST /api/invites'] = { raw: '' };
  await assert.rejects(() => api.createInvite({ name: 'x' }), /לא החזיר טוקן/);
});

test('statsFromInvites counts responses, people and sides', () => {
  const stats = api.statsFromInvites([
    { side: 'vered', responded: true, attending: true, guests: 2 },
    { side: 'vered', responded: true, attending: false, guests: 0 },
    { side: 'idan', responded: true, attending: true, guests: 4 },
    { side: 'idan', responded: false, attending: null, guests: 0 },
    { side: 'idan_parents', responded: true, attending: true, guests: 0 },
    { side: '', responded: false, attending: null, guests: 0 },
  ]);

  assert.equal(stats.source, 'invites');
  assert.equal(stats.invites, 6);
  assert.equal(stats.responded, 4);
  assert.equal(stats.not_responded, 2);
  assert.equal(stats.attending_invites, 3);
  assert.equal(stats.coming, 7, '2 + 4 + a zero-count acceptance counted as 1');
  assert.deepEqual(stats.by_side.vered, { invites: 2, responded: 2, coming: 2 });
  assert.deepEqual(stats.by_side.idan, { invites: 2, responded: 1, coming: 4 });
  assert.equal(stats.unknown_side, 1);
});

test('statsFromInvites reports zeroes for every side when the list is empty', () => {
  const stats = api.statsFromInvites([]);
  assert.equal(stats.invites, 0);
  assert.equal(stats.coming, 0);
  for (const key of Object.keys(api.SIDES)) {
    assert.deepEqual(stats.by_side[key], { invites: 0, responded: 0, coming: 0 });
  }
});

test('statsFromInvites never counts an unanswered invite as attending', () => {
  const stats = api.statsFromInvites([{ side: 'vered', responded: false, attending: true, guests: 5 }]);
  assert.equal(stats.coming, 0);
  assert.equal(stats.responded, 0);
});

test('statsFromGuests gives totals with no invite denominator', () => {
  const stats = api.statsFromGuests([
    { attending: true, guests: 2 },
    { attending: true, guests: 0 },
    { attending: false, guests: 0 },
  ]);
  assert.equal(stats.source, 'guests');
  assert.equal(stats.invites, null);
  assert.equal(stats.not_responded, null);
  assert.equal(stats.responded, 3);
  assert.equal(stats.coming, 3);
  assert.equal(stats.by_side, null);
});

test('isRecoverable: try the next source on 404, 5xx and network trouble', () => {
  assert.equal(api.isRecoverable(new api.ApiError('x', { status: 404, missing: true })), true);
  assert.equal(api.isRecoverable(new api.ApiError('x', { status: 500 })), true);
  assert.equal(api.isRecoverable(new api.ApiError('x', { status: 0 })), true);
  assert.equal(api.isRecoverable(new api.ApiError('x', { status: 401, unauthorized: true })), false);
  assert.equal(api.isRecoverable(new api.ApiError('x', { status: 400 })), false);
  assert.equal(api.isRecoverable(new Error('plain')), false);
});

test('getStats prefers /api/stats when it answers usefully', async () => {
  routes['GET /api/stats'] = { body: { invites: 10, responded: 4, not_responded: 6, coming: 9 } };
  const stats = await api.getStats();
  assert.equal(stats.invites, 10);
  assert.equal(stats.coming, 9);
  assert.equal(calls.length, 1, 'no fallback should have been attempted');
});

test('getStats falls back to /api/invites when /api/stats is missing', async () => {
  routes['GET /api/invites'] = { body: [{ side: 'vered', responded: true, attending: true, guests: 3 }] };
  const stats = await api.getStats();
  assert.equal(stats.source, 'invites');
  assert.equal(stats.coming, 3);
  assert.deepEqual(calls.map((c) => c.key), ['GET /api/stats', 'GET /api/invites']);
});

test('getStats falls back all the way to /api/guests', async () => {
  routes['GET /api/guests'] = { body: [{ id: 1, attending: true, guests: 2 }] };
  const stats = await api.getStats();
  assert.equal(stats.source, 'guests');
  assert.equal(stats.coming, 2);
  assert.deepEqual(calls.map((c) => c.key), ['GET /api/stats', 'GET /api/invites', 'GET /api/guests']);
});

test('getStats falls back when /api/stats answers with nothing recognisable', async () => {
  routes['GET /api/stats'] = { body: { unrelated: true } };
  routes['GET /api/invites'] = { body: [] };
  const stats = await api.getStats();
  assert.equal(stats.source, 'invites');
});

test('getStats gives up immediately on a bad password rather than retrying', async () => {
  routes['GET /api/stats'] = { status: 401, body: {} };
  await assert.rejects(() => api.getStats(), (err) => {
    assert.equal(err.unauthorized, true);
    return true;
  });
  assert.equal(calls.length, 1, 'a rejected password must not trigger the fallbacks');
});

test('getStats surfaces the last failure when nothing answers', async () => {
  routes['GET /api/guests'] = { status: 500, raw: 'boom' };
  await assert.rejects(() => api.getStats(), (err) => {
    assert.equal(err.status, 500);
    return true;
  });
});

// ── Regressions: the key names this site's /api/stats actually uses ──────────

test('getStats reads total_people, which is what /api/stats really calls it', async () => {
  // Regression: the reader only knew `coming`, so every people-count showed 0
  // even though the API was answering correctly.
  routes['GET /api/stats'] = {
    body: {
      responses: 1,
      attending_responses: 1,
      declined: 0,
      total_people: 3,
      invites: 0,
      not_responded: 0,
      by_side: {
        vered_parents: { invites: 0, responded: 0, attending: 0, declined: 0, total_people: 0 },
        idan_parents: { invites: 0, responded: 0, attending: 0, declined: 0, total_people: 0 },
        vered: { invites: 1, responded: 1, attending: 1, declined: 0, total_people: 3 },
        idan: { invites: 0, responded: 0, attending: 0, declined: 0, total_people: 0 },
      },
    },
  };

  const stats = await api.getStats();
  assert.equal(stats.responded, 1);
  assert.equal(stats.coming, 3, 'total_people must be read as the headline people count');
  assert.equal(stats.attending_invites, 1, 'attending_responses must be read too');
  assert.equal(stats.by_side.vered.coming, 3, 'the per-side people count must be read as well');
  assert.equal(stats.by_side.idan.coming, 0);
});

test('a walk-in RSVP with no invitation still shows up in the totals', async () => {
  routes['GET /api/stats'] = {
    body: { responses: 1, attending_responses: 1, declined: 0, total_people: 2, invites: 0, not_responded: 0 },
  };
  const stats = await api.getStats();
  assert.equal(stats.invites, 0);
  assert.equal(stats.responded, 1);
  assert.equal(stats.coming, 2, 'somebody who answered without a link is still coming');
});

test('normalizeServerStats carries the "other" bucket through', async () => {
  routes['GET /api/stats'] = {
    body: {
      responses: 2, attending_responses: 2, declined: 0, total_people: 5,
      invites: 1, not_responded: 0,
      by_side: {
        vered_parents: { invites: 0, responded: 0, attending: 0, declined: 0, total_people: 0 },
        idan_parents: { invites: 0, responded: 0, attending: 0, declined: 0, total_people: 0 },
        vered: { invites: 1, responded: 1, attending: 1, declined: 0, total_people: 2 },
        idan: { invites: 0, responded: 0, attending: 0, declined: 0, total_people: 0 },
        other: { invites: 0, responded: 1, attending: 1, declined: 0, total_people: 3 },
      },
    },
  };
  const stats = await api.getStats();
  assert.deepEqual(stats.by_side.other, { invites: 0, responded: 1, coming: 3 });
  // and the four real sides plus "other" account for every person
  const total = Object.values(stats.by_side).reduce((n, s) => n + s.coming, 0);
  assert.equal(total, stats.coming);
});
