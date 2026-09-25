'use strict';

/**
 * POST /api/telegram/webhook — Telegram pushes every update here.
 *
 * Telegram signs each call with the secret we handed setWebhook, in the
 * X-Telegram-Bot-Api-Secret-Token header; anything without it is dropped.
 * grammY's webhookCallback runs the update through the bot and answers 200.
 */

const { webhookCallback } = require('grammy');
const { getBot, send } = require('./_bot');

let handler = null;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const provided = req.headers['x-telegram-bot-api-secret-token'] || '';
  if (!expected || provided !== expected) return send(res, 401, { error: 'bad secret' });

  try {
    if (!handler) {
      const { bot } = getBot();
      // "http" is the plain Node request/response adapter, which is what
      // Vercel hands a function. Answer within Telegram's patience, else it
      // retries the update.
      handler = webhookCallback(bot, 'http', { timeoutMilliseconds: 25000 });
    }
    await handler(req, res);
  } catch (err) {
    console.error('[webhook]', err && err.message ? err.message : err);
    // A 200 with nothing in it: Telegram must not keep re-sending an update
    // that crashes a handler, and the error is already in the logs.
    if (!res.headersSent) send(res, 200, { ok: false });
  }
};
