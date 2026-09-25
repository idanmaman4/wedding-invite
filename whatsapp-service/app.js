'use strict';

/**
 * The HTTP surface of the WhatsApp sender, with no WhatsApp in it.
 *
 * `index.js` wires this to a real whatsapp-web.js client and listens; the tests
 * wire it to a fake one. Everything that can be reasoned about without a phone
 * — phone normalisation, the invitation text, the auth gate, bulk sequencing —
 * lives here so it can be exercised directly.
 */

const express = require('express');
const cors = require('cors');

const MAX_CONTACTS = 2000;

// ─── Phone helpers ───────────────────────────────────────────────────────────
// Israeli numbers arrive as 05X-XXX-XXXX, +972 5X…, 972…, (05X) … — all of
// them have to end up as the E.164 digits whatsapp-web.js wants: 9725XXXXXXXX.
function normalizePhone(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  s = s.replace(/[\s\-().‎‏]/g, ''); // spaces, dashes, parens, dots, RTL marks
  s = s.replace(/^00/, '+');
  const plus = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (!s) return null;

  if (!plus) {
    if (s.startsWith('972')) {
      // already international
    } else if (s.startsWith('0')) {
      s = '972' + s.slice(1);
    } else if (s.length === 9 && s.startsWith('5')) {
      s = '972' + s; // bare mobile without the leading zero
    }
  } else if (s.startsWith('9720')) {
    s = '972' + s.slice(4); // +972 0 5x… — drop the stray zero
  }

  if (s.length < 8 || s.length > 15) return null;
  return s;
}

function toChatId(raw) {
  const digits = normalizePhone(raw);
  return digits ? `${digits}@c.us` : null;
}

// Never print a full number to the console.
function maskPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 5) return '***';
  return `${d.slice(0, 5)}***${d.slice(-2)}`;
}

// Internal status → the coarse three-state the admin panel renders.
function coarse(status) {
  if (status === 'connected') return 'ready';
  if (status === 'awaiting_scan') return 'qr';
  return 'offline';
}

function buildInviteMessage(guestName, siteUrl) {
  const greeting = guestName ? `שלום ${guestName},` : 'שלום,';
  return (
    `🌿 *עידן & ורד מתחתנים* 🌿\n\n` +
    `${greeting}\n\n` +
    `בשמחה רבה אנו מזמינים אתכם לחגוג איתנו את חתונתנו!\n\n` +
    `📅 יום ראשון, י״ד בחשוון תשפ״ז · 25.10.2026\n` +
    `⏰ קבלת פנים ב-18:30, חופה ב-19:30\n` +
    `📍 אולם האירועים תרין, רח׳ אליעזר מזל 6, ראשון לציון\n\n` +
    `נשמח לאישור הגעתכם עד 15 באוקטובר 2026:\n${siteUrl}\n\n` +
    `באהבה,\nעידן & ורד 💍`
  );
}

/** Shape a raw whatsapp-web.js contact list into the panel's rows. */
function shapeContacts(raw, query) {
  const q = String(query || '').trim().toLowerCase();
  const seen = new Set();
  const out = [];

  for (const c of raw) {
    const id = c.id && c.id._serialized;
    if (!id) continue;
    if (c.isGroup) continue;
    if (c.isMe) continue;
    if (!c.isMyContact) continue; // saved contacts only
    if (c.id.server !== 'c.us') continue; // drops status@broadcast, @g.us, @lid
    if (seen.has(id)) continue;

    const number = c.number || c.id.user || '';
    const name = (c.name || c.pushname || c.shortName || c.verifiedName || number || '').trim();
    if (!number) continue;

    const hay = `${name} ${number}`.toLowerCase();
    if (q && !hay.includes(q)) continue;

    seen.add(id);
    out.push({ id, name: name || number, number, isMyContact: true, isGroup: false });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return out;
}

/** Resolve the delay window for a bulk run from the request body. */
function delayWindow(body, defMin, defMax) {
  let minDelay = defMin;
  let maxDelay = defMax;
  // An explicit delayMs becomes the centre of a ±40% jitter.
  if (Number(body.delayMs) > 0) {
    const base = Number(body.delayMs);
    minDelay = Math.round(base * 0.6);
    maxDelay = Math.round(base * 1.4);
  }
  if (Number(body.minDelayMs) >= 0) minDelay = Number(body.minDelayMs);
  if (Number(body.maxDelayMs) >= 0) maxDelay = Number(body.maxDelayMs);
  if (maxDelay < minDelay) maxDelay = minDelay;
  return { minDelay, maxDelay };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randBetween = (min, max) => Math.round(min + Math.random() * Math.max(0, max - min));

/**
 * Build the express app.
 *
 * @param {object}   deps
 * @param {object}   deps.sessions   per-sender `{ client, status, qrDataUrl }`
 * @param {Function} deps.initClient `(sender) => void`, starts a login
 * @param {string}   [deps.waKey]    shared secret; the gate is off when empty
 * @param {string}   [deps.siteUrl]  base URL used in the invitation text
 * @param {number}   [deps.minDelay] default floor between bulk messages (ms)
 * @param {number}   [deps.maxDelay] default ceiling between bulk messages (ms)
 * @param {Function} [deps.log]      console-like sink, silenced in tests
 */
function createApp(deps) {
  const sessions = deps.sessions;
  const initClient = deps.initClient;
  const WA_KEY = (deps.waKey || '').trim();
  const SITE_URL = deps.siteUrl || 'https://wedding-invite-sand-kappa.vercel.app';
  const DEFAULT_MIN_DELAY = Number(deps.minDelay || 3000);
  const DEFAULT_MAX_DELAY = Number(deps.maxDelay || 7000);
  const log = deps.log || console;

  const app = express();

  // ─── CORS ──────────────────────────────────────────────────────────────────
  // The admin panel talks to this service DIRECTLY from the browser, so every
  // origin (the deployed Vercel site, http://localhost:5173, file://) must pass.
  app.use(
    cors({
      origin: true,
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Wa-Key', 'Accept'],
      maxAge: 86400,
    })
  );
  // Explicit preflight answer — some browsers send OPTIONS with unusual headers.
  app.options(/.*/, cors());
  app.use(express.json({ limit: '2mb' }));

  // ─── Shared-secret gate (opt-in) ───────────────────────────────────────────
  // Only enforced when WA_KEY is set in the environment, so a laptop-local run
  // stays friction-free. /health stays open so "test connection" always answers.
  const OPEN_PATHS = new Set(['/health', '/']);
  app.use((req, res, next) => {
    if (!WA_KEY) return next();
    if (req.method === 'OPTIONS') return next();
    if (OPEN_PATHS.has(req.path)) return next();
    const provided = req.get('X-Wa-Key') || req.query.key || '';
    if (provided !== WA_KEY) {
      return res.status(401).json({ error: 'Bad or missing X-Wa-Key' });
    }
    next();
  });

  function requireReady(sender, res) {
    const s = sessions[sender];
    if (!s) {
      res.status(400).json({ error: "Unknown sender — use 'idan' or 'vered'" });
      return null;
    }
    if (s.status !== 'connected' || !s.client) {
      res.status(409).json({
        error: `${sender} is not connected`,
        status: s.status,
        hint: 'POST /connect/' + sender + ' and scan the QR from that phone',
      });
      return null;
    }
    return s;
  }

  // ─── Routes ────────────────────────────────────────────────────────────────

  app.get('/', (_req, res) => {
    res.json({
      service: 'wedding-whatsapp',
      endpoints: ['/health', '/status', '/qr/:sender', '/connect/:sender', '/disconnect/:sender', '/contacts', '/send', '/send-invitation', '/send-bulk'],
    });
  });

  // Cheap liveness + coarse per-client state, used by the admin panel's
  // "test connection" button.
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      authRequired: Boolean(WA_KEY),
      clients: { idan: coarse(sessions.idan.status), vered: coarse(sessions.vered.status) },
    });
  });

  // Raw internal statuses (kept for the FastAPI proxy).
  app.get('/status', (_req, res) => {
    res.json({ idan: sessions.idan.status, vered: sessions.vered.status });
  });

  app.get('/qr/:sender', (req, res) => {
    const { sender } = req.params;
    if (!sessions[sender]) return res.status(400).json({ error: 'Unknown sender' });
    res.json({ status: sessions[sender].status, qr: sessions[sender].qrDataUrl });
  });

  app.post('/connect/:sender', (req, res) => {
    const { sender } = req.params;
    if (!sessions[sender]) return res.status(400).json({ error: 'Unknown sender' });

    const s = sessions[sender];
    if (s.status === 'connected') return res.json({ message: 'Already connected' });

    if (s.client) {
      s.client.destroy().catch(() => {});
      s.client = null;
    }
    initClient(sender);
    res.json({ message: `Initializing ${sender} session…` });
  });

  app.post('/disconnect/:sender', async (req, res) => {
    const { sender } = req.params;
    if (!sessions[sender]) return res.status(400).json({ error: 'Unknown sender' });

    const s = sessions[sender];
    if (s.client) {
      await s.client.destroy().catch(() => {});
      s.client = null;
    }
    s.status = 'disconnected';
    s.qrDataUrl = null;
    res.json({ success: true });
  });

  // ─── Contacts ──────────────────────────────────────────────────────────────
  // GET /contacts?sender=idan&q=דוד
  app.get('/contacts', async (req, res) => {
    const sender = String(req.query.sender || 'idan');
    const s = requireReady(sender, res);
    if (!s) return;

    try {
      const raw = await s.client.getContacts();
      const out = shapeContacts(raw, req.query.q);
      const capped = out.slice(0, MAX_CONTACTS);
      res.json({ sender, total: out.length, truncated: out.length > capped.length, contacts: capped });
    } catch (err) {
      log.error(`[${sender}] getContacts failed: ${err && err.message}`);
      res.status(500).json({ error: err && err.message ? err.message : 'getContacts failed' });
    }
  });

  // ─── Sending ───────────────────────────────────────────────────────────────

  // Raw single message.
  app.post('/send', async (req, res) => {
    const { sender, to, message } = req.body || {};
    const s = requireReady(String(sender || ''), res);
    if (!s) return;

    const chatId = toChatId(to);
    if (!chatId) return res.status(400).json({ error: `Invalid phone number: ${to}` });

    try {
      await s.client.sendMessage(chatId, String(message || ''));
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err && err.message });
    }
  });

  // Wedding invitation to one guest (used by the FastAPI proxy and the per-guest
  // buttons in the admin table).
  app.post('/send-invitation', async (req, res) => {
    const { sender, guestName, phone, websiteUrl, message } = req.body || {};
    const s = requireReady(String(sender || ''), res);
    if (!s) return;

    const chatId = toChatId(phone);
    if (!chatId) return res.status(400).json({ error: `Invalid phone number: ${phone}` });

    const body = message || buildInviteMessage(guestName, websiteUrl || SITE_URL);
    try {
      await s.client.sendMessage(chatId, body);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err && err.message });
    }
  });

  // Bulk send. Body: { sender, messages: [{ phone, text }], delayMs?, minDelayMs?,
  // maxDelayMs?, stream? }.  Streams NDJSON progress when asked, otherwise
  // answers once with the summary.
  app.post('/send-bulk', async (req, res) => {
    const body = req.body || {};
    const sender = String(body.sender || '');
    const messages = Array.isArray(body.messages) ? body.messages : null;

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array of { phone, text }' });
    }
    const s = requireReady(sender, res);
    if (!s) return;

    const { minDelay, maxDelay } = delayWindow(body, DEFAULT_MIN_DELAY, DEFAULT_MAX_DELAY);

    const wantsStream =
      body.stream === true || String(req.get('Accept') || '').includes('application/x-ndjson');

    if (wantsStream) {
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
    }

    const results = [];
    let sent = 0;
    let failed = 0;
    let aborted = false;
    // The *request* stream closes as soon as express.json() has drained the
    // body, so listening there would abort every run after the first message.
    // A real disconnect is the response closing before it was finished.
    res.on('close', () => { if (!res.writableEnded) aborted = true; });

    const emit = (obj) => {
      if (wantsStream && !res.writableEnded) res.write(JSON.stringify(obj) + '\n');
    };

    emit({ type: 'start', total: messages.length, minDelay, maxDelay });

    for (let i = 0; i < messages.length; i++) {
      if (aborted) break;
      const m = messages[i] || {};
      const phone = m.phone;
      const text = String(m.text || '');
      const chatId = toChatId(phone);

      let entry;
      if (!chatId) {
        entry = { phone, ok: false, error: 'מספר טלפון לא תקין' };
      } else if (!text.trim()) {
        entry = { phone, ok: false, error: 'הודעה ריקה' };
      } else {
        try {
          await s.client.sendMessage(chatId, text);
          entry = { phone, ok: true };
        } catch (err) {
          entry = { phone, ok: false, error: (err && err.message) || 'send failed' };
        }
      }

      results.push(entry);
      if (entry.ok) sent++;
      else failed++;
      log.log(`[${sender}] ${i + 1}/${messages.length} ${maskPhone(phone)} ${entry.ok ? 'ok' : 'FAIL'}`);
      emit({ type: 'progress', index: i, total: messages.length, ...entry });

      if (i < messages.length - 1 && !aborted) {
        await sleep(randBetween(minDelay, maxDelay));
      }
    }

    const summary = { type: 'done', sender, total: messages.length, sent, failed, aborted, results };
    if (wantsStream) {
      emit(summary);
      if (!res.writableEnded) res.end();
    } else if (!res.headersSent) {
      res.json(summary);
    }
  });

  // ─── Error safety ──────────────────────────────────────────────────────────
  app.use((err, _req, res, _next) => {
    log.error('Unhandled request error:', err && err.message);
    if (!res.headersSent) res.status(500).json({ error: (err && err.message) || 'Server error' });
  });

  return app;
}

module.exports = {
  createApp,
  normalizePhone,
  toChatId,
  maskPhone,
  coarse,
  buildInviteMessage,
  shapeContacts,
  delayWindow,
  MAX_CONTACTS,
};
