'use strict';

/**
 * One bot instance per serverless container, shared by the functions in this
 * folder. Vercel keeps a warm container around between requests, so the
 * handlers register once; a cold start pays for it again, which is fine.
 *
 * Everything the bot needs comes from the environment set on the project:
 *   TELEGRAM_BOT_TOKEN, ADMIN_PASSWORD, SITE_URL (as API_BASE),
 *   TELEGRAM_WEBHOOK_SECRET, NOTIFY_SECRET, CRON_SECRET.
 */

const { createBot } = require('../../telegram-service/bot');

let instance = null;

function getBot() {
  if (instance) return instance;
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set on this deployment');
  instance = createBot({
    token,
    adminIds: (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    openAdmin: String(process.env.TELEGRAM_OPEN_ADMIN || '1') !== '0',
  });
  return instance;
}

/**
 * Read a JSON body whether Vercel has parsed it already or not. Vercel parses
 * by Content-Type: JSON becomes an object, but text/* arrives as a string and
 * anything else as a Buffer — and by then the stream is drained, so reading
 * it again would yield an empty body.
 */
async function readJson(req) {
  const body = req.body;
  if (Buffer.isBuffer(body)) return body.length ? JSON.parse(body.toString('utf8')) : {};
  if (typeof body === 'string') return body ? JSON.parse(body) : {};
  if (body && typeof body === 'object') return body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

module.exports = { getBot, readJson, send };
