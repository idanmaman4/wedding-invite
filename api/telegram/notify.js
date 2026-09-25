'use strict';

/**
 * POST /api/telegram/notify — the site tells the bot an RSVP just landed.
 *
 * Called by the Python API (api/notify.py) with the shared NOTIFY_SECRET. The
 * broadcast is awaited before answering: a serverless function is frozen the
 * moment it responds, so "answer first, send later" would send nothing.
 */

const { getBot, readJson, send } = require('./_bot');
const { secretMatches } = require('../../telegram-service/bot');
const fmt = require('../../telegram-service/format');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  const secret = process.env.NOTIFY_SECRET || '';
  if (!secret) return send(res, 503, { error: 'NOTIFY_SECRET is not configured' });
  if (!secretMatches(req.headers['x-notify-secret'], secret)) return send(res, 401, { error: 'bad secret' });

  let payload;
  try {
    payload = await readJson(req);
  } catch {
    return send(res, 400, { error: 'invalid JSON' });
  }
  if (!payload || !payload.name) return send(res, 400, { error: 'name is required' });

  try {
    const { broadcast } = getBot();
    const result = await broadcast(fmt.formatRsvpNotification(payload));
    console.log(`[notify] rsvp broadcast — sent ${result.sent}/${result.total}, dropped ${result.dropped}`);
    return send(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error('[notify] broadcast failed:', err && err.message ? err.message : err);
    return send(res, 500, { ok: false, error: err && err.message ? err.message : String(err) });
  }
};
