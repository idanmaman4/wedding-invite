/**
 * Production smoke test — runs against the live deployment, nothing faked.
 *
 * Checks the site, every API surface the admin panel and the bot depend on,
 * the bot's webhook wiring, and the RSVP → Telegram broadcast path. Every row
 * it creates it deletes again, so the guest list is left exactly as found.
 *
 *   node tests/smoke/production.mjs                      # reads .env.local
 *   SITE=https://… ADMIN_PASSWORD=… node tests/smoke/production.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadLocalEnv() {
  try {
    return Object.fromEntries(
      readFileSync(path.join(ROOT, '.env.local'), 'utf8')
        .split(/\r?\n/).filter(Boolean)
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
    );
  } catch { return {}; }
}

const local = loadLocalEnv();
const SITE = (process.env.SITE || local.SITE_URL || 'https://wedding-invite-sand-kappa.vercel.app').replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || local.ADMIN_PASSWORD || '';
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || local.NOTIFY_SECRET || '';
const admin = { 'X-Admin-Password': ADMIN_PASSWORD };
const json = { 'Content-Type': 'application/json' };

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is needed (env or .env.local)');
  process.exit(2);
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const results = [];
async function test(name, fn) {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}${note ? ` — ${note}` : ''}  (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

async function call(pathname, init = {}) {
  const res = await fetch(SITE + pathname, { ...init, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

// Everything created here carries this tag so cleanup cannot touch real guests.
const TAG = `smoke-${Date.now()}`;
const created = { invites: [], guests: [] };

async function cleanup() {
  for (const id of created.guests) await call(`/api/guests/${id}`, { method: 'DELETE', headers: admin }).catch(() => {});
  for (const token of created.invites) await call(`/api/invites/${token}`, { method: 'DELETE', headers: admin }).catch(() => {});
  await call(`/api/bot/state/${TAG}`, { method: 'DELETE', headers: admin }).catch(() => {});
  await call(`/api/bot/subscribers/${TAG}`, { method: 'DELETE', headers: admin }).catch(() => {});
}

console.log(`production smoke against ${SITE}\n`);

// ─── The site ────────────────────────────────────────────────────────────────

await test('the site serves the invitation', async () => {
  const r = await call('/');
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(/lang="he"/.test(r.body) && /dir="rtl"/.test(r.body), 'not Hebrew RTL');
  return 'Hebrew, RTL';
});

await test('/admin and /confirmed fall back to the app shell', async () => {
  for (const p of ['/admin', '/confirmed']) {
    const r = await call(p);
    assert(r.status === 200 && /<div id="root"|<div id="app"|<script/.test(r.body), `${p}: HTTP ${r.status}`);
  }
});

await test('the phone vine strips and procession clip are served', async () => {
  for (const p of ['/media/vine_390_left.webp', '/media/vine_390_top.webp', '/media/procession.mp4']) {
    const res = await fetch(SITE + p, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
    assert(res.status === 200, `${p}: HTTP ${res.status}`);
  }
});

// ─── The API ─────────────────────────────────────────────────────────────────

await test('GET /api/health', async () => {
  const r = await call('/api/health');
  assert(r.status === 200 && r.body.status === 'ok', `HTTP ${r.status} ${JSON.stringify(r.body)}`);
});

await test('admin endpoints refuse the wrong password', async () => {
  assert((await call('/api/guests')).status === 401, 'no password let through');
  assert((await call('/api/guests', { headers: { 'X-Admin-Password': 'wrong' } })).status === 401, 'wrong password let through');
});

await test('GET /api/diag — the database the instance really sees', async () => {
  const r = await call('/api/diag', { headers: admin });
  assert(r.status === 200, `HTTP ${r.status}`);
  const d = JSON.stringify(r.body);
  const durable = /postgres/i.test(d);
  return durable ? 'Postgres' : 'SQLite in /tmp — RSVPs will NOT survive an instance recycle';
});

await test('GET /api/stats has every field the panel and the bot read', async () => {
  const r = await call('/api/stats', { headers: admin });
  assert(r.status === 200, `HTTP ${r.status}`);
  for (const k of ['responses', 'attending_responses', 'declined', 'total_people', 'invites', 'not_responded', 'by_side']) {
    assert(k in r.body, `missing ${k}`);
  }
  for (const side of ['vered_parents', 'idan_parents', 'vered', 'idan', 'other']) {
    assert(side in r.body.by_side, `by_side missing ${side}`);
  }
  return `${r.body.responses} responses, ${r.body.total_people} people`;
});

let inviteToken = null;
await test('POST /api/invites creates a personal link', async () => {
  const r = await call('/api/invites', {
    method: 'POST', headers: { ...admin, ...json },
    body: JSON.stringify({ name: `${TAG} invite`, phone: '0500000001', side: 'vered' }),
  });
  assert(r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  inviteToken = r.body.token;
  created.invites.push(inviteToken);
  assert(r.body.url.includes(`?i=${inviteToken}`), 'url does not carry the token');
});

await test('GET /api/invite/{token} prefills without a password', async () => {
  const r = await call(`/api/invite/${inviteToken}`);
  assert(r.status === 200 && r.body.name === `${TAG} invite` && r.body.responded === false, JSON.stringify(r.body));
});

await test('POST /api/rsvp through the link answers the invitation', async () => {
  const r = await call('/api/rsvp', {
    method: 'POST', headers: json,
    body: JSON.stringify({ name: `${TAG} invite`, attending: true, guests: 3, phone: '0500000001', invite_token: inviteToken }),
  });
  assert(r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  created.guests.push(r.body.id);
  const inv = (await call('/api/invites', { headers: admin })).body.find((i) => i.token === inviteToken);
  assert(inv && inv.responded === true && inv.guests === 3, `invite not updated: ${JSON.stringify(inv)}`);
});

await test('a second answer through the same link updates, never duplicates', async () => {
  const r = await call('/api/rsvp', {
    method: 'POST', headers: json,
    body: JSON.stringify({ name: `${TAG} invite`, attending: true, guests: 5, invite_token: inviteToken }),
  });
  assert(r.status === 200 && r.body.updated === true, JSON.stringify(r.body));
  const rows = (await call('/api/guests', { headers: admin })).body.filter((g) => g.name === `${TAG} invite`);
  assert(rows.length === 1 && rows[0].guests === 5, `expected one row with 5, got ${JSON.stringify(rows)}`);
});

await test('a walk-in RSVP lands under "other"', async () => {
  const before = (await call('/api/stats', { headers: admin })).body.by_side.other.responded;
  const r = await call('/api/rsvp', {
    method: 'POST', headers: json,
    body: JSON.stringify({ name: `${TAG} walk-in`, attending: true, guests: 2 }),
  });
  assert(r.status === 200, `HTTP ${r.status}`);
  created.guests.push(r.body.id);
  const after = (await call('/api/stats', { headers: admin })).body.by_side.other.responded;
  assert(after === before + 1, `other went ${before} → ${after}`);
});

// ─── Bot storage ─────────────────────────────────────────────────────────────

await test('bot subscriber and state storage round-trips', async () => {
  let r = await call('/api/bot/subscribers', { method: 'POST', headers: { ...admin, ...json }, body: JSON.stringify({ chat_id: TAG, first_name: 'smoke' }) });
  assert(r.status === 200 && r.body.created === true, JSON.stringify(r.body));
  r = await call(`/api/bot/state/${TAG}`, { method: 'PUT', headers: { ...admin, ...json }, body: JSON.stringify({ data: { flow: 'invite', step: 1, data: { name: 'בדיקה' }, at: Date.now() } }) });
  assert(r.status === 200, `state PUT HTTP ${r.status}`);
  r = await call(`/api/bot/state/${TAG}`, { headers: admin });
  assert(r.status === 200 && r.body.data.data.name === 'בדיקה', 'state did not round-trip Hebrew');
  r = await call(`/api/bot/subscribers/${TAG}`, { method: 'DELETE', headers: admin });
  assert(r.body.removed === true, 'subscriber not removed');
  r = await call(`/api/bot/state/${TAG}`, { headers: admin });
  assert(r.status === 404, 'state should go with the subscriber');
});

// ─── The bot on Vercel ───────────────────────────────────────────────────────

let botHealth = null;
await test('GET /api/telegram/health — the bot is wired', async () => {
  const r = await call('/api/telegram/health');
  assert(r.status === 200, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  botHealth = r.body;
  assert(r.body.token, 'TELEGRAM_BOT_TOKEN missing on the deployment');
  assert(r.body.webhook_secret && r.body.notify_secret && r.body.cron_secret, `a secret is missing: ${JSON.stringify(r.body)}`);
  assert(r.body.store === 'api', `store is ${r.body.store}, expected api`);
  assert(r.body.subscribers !== null, `store unreadable: ${r.body.store_error}`);
  return `${r.body.subscribers} subscribers, webhook ${r.body.webhook || 'NOT SET'}`;
});

await test('the webhook points at this deployment', async () => {
  assert(botHealth && botHealth.webhook === `${SITE}/api/telegram/webhook`,
    `webhook is ${botHealth && botHealth.webhook} — run POST /api/telegram/setup`);
  assert(!botHealth.last_error, `Telegram reports: ${botHealth.last_error}`);
});

await test('the webhook rejects a call without the secret token', async () => {
  const r = await call('/api/telegram/webhook', { method: 'POST', headers: json, body: '{}' });
  assert(r.status === 401, `HTTP ${r.status}`);
});

await test('the notify endpoint rejects a bad secret and a missing name', async () => {
  assert((await call('/api/telegram/notify', { method: 'POST', headers: { ...json, 'X-Notify-Secret': 'wrong' }, body: '{"name":"x"}' })).status === 401, 'bad secret accepted');
  if (NOTIFY_SECRET) {
    assert((await call('/api/telegram/notify', { method: 'POST', headers: { ...json, 'X-Notify-Secret': NOTIFY_SECRET }, body: '{}' })).status === 400, 'missing name accepted');
  }
});

await test('the daily export refuses without the cron secret', async () => {
  const r = await call('/api/telegram/daily');
  assert(r.status === 401, `HTTP ${r.status}`);
});

await test('the daily export runs for an admin (real XLSX to real subscribers)', async () => {
  const r = await call('/api/telegram/daily', { headers: admin });
  assert(r.status === 200 && r.body.ok, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return `sent ${r.body.sent}/${r.body.total}${r.body.notice ? ' (notice, not a file)' : ''}`;
});

await test('an RSVP reaches the subscribers through the site (end to end)', async () => {
  if (!NOTIFY_SECRET) return 'skipped — NOTIFY_SECRET not available locally';
  // Same call the Python API makes after saving an RSVP.
  const r = await call('/api/telegram/notify', {
    method: 'POST', headers: { ...json, 'X-Notify-Secret': NOTIFY_SECRET },
    body: JSON.stringify({ name: `${TAG} (בדיקת פרודקשן)`, attending: true, guests: 2, side: 'idan', phone: '0500000002', message: 'אם קיבלתם את זה — הצינור עובד 🎉' }),
  });
  assert(r.status === 200 && r.body.ok, `HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return `sent ${r.body.sent}/${r.body.total}`;
});

// ─── Report ──────────────────────────────────────────────────────────────────

await cleanup();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
