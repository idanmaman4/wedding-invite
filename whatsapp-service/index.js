'use strict';

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { createApp, coarse } = require('./app');

const PORT = process.env.PORT || 3001;
const SITE_URL = process.env.SITE_URL || 'https://wedding-invite-sand-kappa.vercel.app';
const WA_KEY = (process.env.WA_KEY || '').trim();

// Where LocalAuth keeps the session keys. On a host this points at a mounted
// volume, so a redeploy does not mean scanning the QR again.
const SESSION_PATH = process.env.WA_SESSION_PATH || undefined;
// Set in the container image; unset locally, where Puppeteer's own build is fine.
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

// Deployed, this service is reachable from the internet and can send messages
// as you. Refuse to start wide open.
if (process.env.NODE_ENV === 'production' && !WA_KEY) {
  console.error(
    'Refusing to start: WA_KEY is not set.\n' +
    'This service can send WhatsApp messages as you, so it must not be exposed without a shared secret.\n' +
    'Set one (e.g. `fly secrets set WA_KEY=$(openssl rand -hex 24)`) and send it as the X-Wa-Key header.',
  );
  process.exit(1);
}

// Default human-ish pacing between bulk messages (ms).
const DEFAULT_MIN_DELAY = Number(process.env.WA_MIN_DELAY_MS || 3000);
const DEFAULT_MAX_DELAY = Number(process.env.WA_MAX_DELAY_MS || 7000);

// ─── Per-sender state ────────────────────────────────────────────────────────
const sessions = {
  idan: { client: null, status: 'disconnected', qrDataUrl: null },
  vered: { client: null, status: 'disconnected', qrDataUrl: null },
};

// ─── Client lifecycle ────────────────────────────────────────────────────────
function initClient(sender) {
  const session = sessions[sender];
  session.status = 'initializing';
  session.qrDataUrl = null;

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sender, dataPath: SESSION_PATH }),
    puppeteer: {
      headless: true,
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });

  client.on('qr', async (qr) => {
    try {
      session.status = 'awaiting_scan';
      // The QR payload itself is a login credential — never logged.
      session.qrDataUrl = await qrcode.toDataURL(qr);
      console.log(`[${sender}] QR ready — scan it from the admin panel`);
    } catch (err) {
      console.error(`[${sender}] QR render failed: ${err.message}`);
    }
  });

  client.on('ready', () => {
    session.status = 'connected';
    session.qrDataUrl = null;
    console.log(`[${sender}] WhatsApp connected`);
  });

  client.on('authenticated', () => {
    console.log(`[${sender}] Authenticated`);
  });

  client.on('auth_failure', () => {
    session.status = 'auth_failed';
    console.error(`[${sender}] Auth failed — delete .wwebjs_auth and scan again`);
  });

  client.on('disconnected', (reason) => {
    session.status = 'disconnected';
    session.client = null;
    console.log(`[${sender}] Disconnected: ${reason}`);
  });

  // whatsapp-web.js emits this on internal puppeteer trouble; swallowing it
  // keeps the HTTP server alive so the panel can still report the state.
  client.on('error', (err) => {
    console.error(`[${sender}] Client error: ${err && err.message}`);
  });

  client.initialize().catch((err) => {
    session.status = 'error';
    console.error(`[${sender}] Init error: ${err && err.message}`);
  });

  session.client = client;
}

const app = createApp({
  sessions,
  initClient,
  waKey: WA_KEY,
  siteUrl: SITE_URL,
  minDelay: DEFAULT_MIN_DELAY,
  maxDelay: DEFAULT_MAX_DELAY,
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', (reason && reason.message) || reason);
});
process.on('uncaughtException', (err) => {
  // Puppeteer/protocol hiccups must not take the HTTP server down.
  console.error('Uncaught exception:', err && err.message);
});

app.listen(PORT, () => {
  console.log(`WhatsApp service listening on http://localhost:${PORT}`);
  console.log(WA_KEY ? 'WA_KEY is set — send it as the X-Wa-Key header.' : 'WA_KEY not set — no shared secret required.');
  console.log(`Sessions start disconnected (${coarse(sessions.idan.status)}) — connect them from the admin panel.`);
});
