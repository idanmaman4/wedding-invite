'use strict';

/**
 * Long-polling launcher: the bot from bot.js, run as a process that stays up.
 *
 * This is the way to run the bot from a laptop or any always-on machine. It
 * polls Telegram, listens for the site's RSVP notifications on a small HTTP
 * endpoint, and fires the daily export from a cron inside the process.
 *
 * In production none of this runs: the same bot is wrapped as Vercel functions
 * under api/telegram/, where Telegram pushes updates to a webhook and Vercel's
 * cron fires the daily export.
 *
 * Subscribers and half-finished flows are not kept here: like the Vercel
 * functions, this process reads and writes them in the site's database through
 * the admin API, so it needs ADMIN_PASSWORD and an API_BASE (or SITE_URL) that
 * points at the deployed site.
 *
 * The token comes from the environment only and is never logged.
 */

const path = require('path');
const dotenv = require('dotenv');

// Service-local .env wins; the repo-root .env.local (gitignored) fills the rest.
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const express = require('express');

const api = require('./api');
const store = require('./store');
const fmt = require('./format');
const schedule = require('./schedule');
const { createBot, isDeadChat, secretMatches, COMMANDS } = require('./bot');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const PORT = Number(process.env.PORT || 8787);
const NOTIFY_SECRET = process.env.NOTIFY_SECRET || '';
const ADMIN_IDS = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const OPEN_ADMIN = String(process.env.TELEGRAM_OPEN_ADMIN || '1') !== '0';

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set — put it in .env.local (repo root) or telegram-service/.env');
  process.exit(1);
}

const { bot, broadcast, isAdmin, exportJob, sendExportDocument, HTML } = createBot({
  token: TOKEN,
  adminIds: ADMIN_IDS,
  openAdmin: OPEN_ADMIN,
});

// ─── HTTP surface ────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '256kb' }));

const secretOk = (header) => secretMatches(header, NOTIFY_SECRET);

app.get('/health', async (_req, res) => {
  res.json({ status: 'ok', subscribers: (await store.all()).length, api_base: api.API_BASE, store: store.backend() });
});

app.post('/notify/rsvp', async (req, res) => {
  if (!NOTIFY_SECRET) {
    return res.status(503).json({ error: 'NOTIFY_SECRET is not configured on the bot service' });
  }
  if (!secretOk(req.get('X-Notify-Secret'))) {
    return res.status(401).json({ error: 'bad secret' });
  }

  const payload = req.body || {};
  if (!payload.name) {
    return res.status(400).json({ error: 'name is required' });
  }

  // Answer immediately — the site must never wait on Telegram to save an RSVP.
  res.json({ ok: true, subscribers: (await store.all()).length });

  try {
    const result = await broadcast(fmt.formatRsvpNotification(payload));
    console.log(`[notify] rsvp broadcast — sent ${result.sent}/${result.total}, dropped ${result.dropped}`);
  } catch (err) {
    console.error('[notify] broadcast failed:', err.message);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection:', reason && reason.message ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception:', err && err.message ? err.message : err);
});

// ─── Start ───────────────────────────────────────────────────────────────────

let server = null;

async function start() {
  const me = await bot.api.getMe();
  console.log(`Telegram bot @${me.username} (id ${me.id}) authenticated ✓`);
  console.log(`API base: ${api.API_BASE}`);
  console.log(`Subscriber store: ${store.backend()}`);
  console.log(`Admins: ${ADMIN_IDS.length ? ADMIN_IDS.join(', ') : OPEN_ADMIN ? '(everyone who sends /start)' : '(none)'}`);
  console.log(`Subscribers: ${(await store.all()).length}`);
  if (!NOTIFY_SECRET) console.warn('NOTIFY_SECRET is not set — POST /notify/rsvp will refuse every request.');

  // A webhook left over from a Vercel deployment would stop polling from
  // receiving anything; clear it so this process actually gets updates.
  await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
  await bot.api.setMyCommands(COMMANDS).catch((err) => console.error('[bot] setMyCommands failed:', err.message));

  server = app.listen(PORT, () => {
    console.log(`Notify endpoint listening on http://localhost:${PORT}/notify/rsvp`);
  });

  // Only fires while this process is alive — it is not a serverless cron.
  schedule.start({
    listSubscribers: () => store.all(),
    removeSubscriber: (chatId) => store.remove(chatId),
    isDeadChat,
    sendDocument: sendExportDocument,
    sendMessage: (chatId, text) => bot.api.sendMessage(chatId, text, HTML),
  });

  // bot.start() only resolves when polling stops, so it is intentionally not awaited.
  bot.start({ drop_pending_updates: false, onStart: () => console.log('Polling started ✓') });
}

async function stop() {
  schedule.stop();
  await bot.stop().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.log(`\n${signal} — shutting down…`);
    await stop();
    process.exit(0);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start:', err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { app, bot, start, stop, broadcast, isAdmin, isDeadChat, secretOk, exportJob, sendExportDocument };
