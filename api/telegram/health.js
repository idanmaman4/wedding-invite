'use strict';

/**
 * GET /api/telegram/health — is the bot wired up on this deployment?
 *
 * Open, but says nothing sensitive: whether the token and secrets are present,
 * what Telegram reports as the webhook, and the subscriber count.
 */

const { getBot, send } = require('./_bot');
const store = require('../../telegram-service/store');

module.exports = async (_req, res) => {
  const out = {
    ok: true,
    token: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    webhook_secret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    notify_secret: Boolean(process.env.NOTIFY_SECRET),
    cron_secret: Boolean(process.env.CRON_SECRET),
    store: store.backend(),
  };

  try {
    out.subscribers = (await store.all()).length;
  } catch (err) {
    out.subscribers = null;
    out.store_error = err && err.message ? err.message : String(err);
  }

  try {
    const { bot } = getBot();
    const info = await bot.api.getWebhookInfo();
    out.webhook = info.url || null;
    out.pending_updates = info.pending_update_count;
    out.last_error = info.last_error_message || null;
  } catch (err) {
    out.webhook = null;
    out.telegram_error = err && err.message ? err.message : String(err);
  }

  out.ok = Boolean(out.token && out.webhook_secret && out.notify_secret && out.webhook && out.subscribers !== null);
  return send(res, 200, out);
};
