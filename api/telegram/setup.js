'use strict';

/**
 * POST /api/telegram/setup — point Telegram at this deployment.
 *
 * Registers the webhook (with its secret) and the "/" command list, then
 * reports what Telegram thinks the webhook is. Idempotent: run it after every
 * deploy that could have changed the URL, or whenever /health says the bot is
 * not receiving anything. Admin password required.
 */

const { getBot, send } = require('./_bot');
const { COMMANDS } = require('../../telegram-service/bot');

module.exports = async (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword || req.headers['x-admin-password'] !== adminPassword) {
    return send(res, 401, { error: 'unauthorized' });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  if (!secret) return send(res, 503, { error: 'TELEGRAM_WEBHOOK_SECRET is not set' });

  // Vercel tells a function its own host; SITE_URL wins when set, so the
  // webhook lands on the production alias rather than a deployment hash.
  const host = (process.env.SITE_URL || '').replace(/\/+$/, '') || `https://${req.headers.host}`;
  const url = `${host}/api/telegram/webhook`;

  try {
    const { bot } = getBot();
    const me = await bot.api.getMe();
    await bot.api.setWebhook(url, {
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    });
    await bot.api.setMyCommands(COMMANDS);
    const info = await bot.api.getWebhookInfo();
    return send(res, 200, {
      ok: true,
      bot: `@${me.username}`,
      webhook: info.url,
      pending_updates: info.pending_update_count,
      last_error: info.last_error_message || null,
    });
  } catch (err) {
    console.error('[setup] failed:', err && err.message ? err.message : err);
    return send(res, 500, { ok: false, error: err && err.message ? err.message : String(err) });
  }
};
