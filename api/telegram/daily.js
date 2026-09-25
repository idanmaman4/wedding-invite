'use strict';

/**
 * GET /api/telegram/daily — the daily XLSX to every subscriber.
 *
 * Fired by the cron in vercel.json. Vercel sends `Authorization: Bearer
 * $CRON_SECRET` with each scheduled call, and nothing else may trigger it —
 * except an admin with the password, for a manual run.
 */

const { getBot, send } = require('./_bot');

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  const auth = String(req.headers.authorization || '');
  const byCron = cronSecret && auth === `Bearer ${cronSecret}`;
  const byAdmin = adminPassword && req.headers['x-admin-password'] === adminPassword;
  if (!byCron && !byAdmin) return send(res, 401, { error: 'unauthorized' });

  try {
    const { exportJob } = getBot();
    const result = await exportJob();
    console.log(`[daily] export — sent ${result.sent}/${result.total}, dropped ${result.dropped}` +
      (result.notice ? ' (notice, not a file)' : '') + (result.skipped ? ' (no subscribers)' : ''));
    return send(res, 200, { ok: true, ...result, error: undefined });
  } catch (err) {
    console.error('[daily] failed:', err && err.message ? err.message : err);
    return send(res, 500, { ok: false, error: err && err.message ? err.message : String(err) });
  }
};
