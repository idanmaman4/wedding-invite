'use strict';

/**
 * Subscriber registry.
 *
 * Rows in the site's database (Supabase), reached through the admin API
 * (`/api/bot/subscribers`). There is no other backend: the bot keeps nothing
 * on disk or in memory, so the Vercel webhook and a laptop running index.js
 * see the same subscribers. Either way it needs ADMIN_PASSWORD and an
 * API_BASE / SITE_URL that points at the deployed site.
 */

const { request } = require('./api');

/** Where subscribers live. Reported by /health; there is only the one. */
function backend() {
  return 'api';
}

/** Add (or refresh) a subscriber. Resolves true when this is a brand-new one. */
async function add({ chat_id, first_name, username }) {
  const res = await request('POST', '/api/bot/subscribers', {
    chat_id: String(chat_id),
    first_name: first_name || '',
    username: username || '',
  });
  return Boolean(res && res.created);
}

/** Drop a subscriber. Resolves true when one was actually removed. */
async function remove(chat_id) {
  const res = await request('DELETE', `/api/bot/subscribers/${encodeURIComponent(String(chat_id))}`);
  return Boolean(res && res.removed);
}

async function all() {
  const rows = await request('GET', '/api/bot/subscribers');
  return Array.isArray(rows) ? rows : [];
}

async function has(chat_id) {
  const rows = await all();
  return rows.some((s) => String(s.chat_id) === String(chat_id));
}

module.exports = { add, remove, all, has, backend };
