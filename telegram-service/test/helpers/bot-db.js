'use strict';

/**
 * An in-memory stand-in for the site's bot tables, answering the admin API's
 * `/api/bot/subscribers` and `/api/bot/state/:chat_id` routes with the same
 * shapes api/main.py returns. The test servers hand it every request no
 * explicit route claimed, so the bot runs against "the database" exactly as it
 * does in production. Not a test file itself (no `.test.js`).
 */

const SIDE_KEYS = ['vered_parents', 'idan_parents', 'vered', 'idan'];

function createBotDb() {
  const subscribers = new Map(); // chat_id → row, in signup order
  const states = new Map(); // chat_id → data

  const reset = () => {
    subscribers.clear();
    states.clear();
  };

  /**
   * Answer `method url` if it is a bot route: `{ status, body }`, or null when
   * the path is not one of ours.
   */
  function handle(method, url, body) {
    const pathname = decodeURI(String(url).split('?')[0]);

    if (pathname === '/api/bot/subscribers') {
      if (method === 'GET') return { status: 200, body: [...subscribers.values()] };
      if (method === 'POST') {
        const chatId = String((body && body.chat_id) || '').trim();
        if (!chatId) return { status: 422, body: { detail: 'chat_id must not be empty.' } };
        const first = (body && body.first_name) || '';
        const user = (body && body.username) || '';
        const existing = subscribers.get(chatId);
        if (!existing) {
          const row = { chat_id: chatId, first_name: first, username: user, default_side: '', subscribed_at: new Date().toISOString() };
          subscribers.set(chatId, row);
          return { status: 200, body: { created: true, subscriber: { ...row } } };
        }
        // A blank name must not erase one we already know.
        if (first) existing.first_name = first;
        if (user) existing.username = user;
        return { status: 200, body: { created: false, subscriber: { ...existing } } };
      }
      return { status: 405, body: { detail: 'Method Not Allowed' } };
    }

    let m = pathname.match(/^\/api\/bot\/subscribers\/([^/]+)\/side$/);
    if (m && method === 'PUT') {
      const row = subscribers.get(m[1]);
      if (!row) return { status: 404, body: { detail: 'Not subscribed' } };
      const side = String((body && body.side) || '').trim();
      if (side && !SIDE_KEYS.includes(side)) return { status: 422, body: { detail: 'unknown side' } };
      row.default_side = side;
      return { status: 200, body: { subscriber: { ...row } } };
    }
    m = pathname.match(/^\/api\/bot\/subscribers\/([^/]+)$/);
    if (m && method === 'DELETE') {
      const chatId = m[1];
      if (!subscribers.delete(chatId)) return { status: 200, body: { removed: false } };
      // Their half-finished flow, if any, goes with them.
      states.delete(chatId);
      return { status: 200, body: { removed: true } };
    }

    m = pathname.match(/^\/api\/bot\/state\/([^/]+)$/);
    if (m) {
      const chatId = m[1];
      if (method === 'GET') {
        if (!states.has(chatId)) return { status: 404, body: { detail: 'No state for this chat' } };
        return {
          status: 200,
          body: { chat_id: chatId, data: JSON.parse(states.get(chatId)), updated_at: new Date().toISOString() },
        };
      }
      if (method === 'PUT') {
        if (!body || typeof body.data !== 'object' || body.data === null) {
          return { status: 422, body: { detail: 'data is required' } };
        }
        states.set(chatId, JSON.stringify(body.data)); // stored as text, like the real column
        return { status: 200, body: { ok: true } };
      }
      if (method === 'DELETE') return { status: 200, body: { removed: states.delete(chatId) } };
      return { status: 405, body: { detail: 'Method Not Allowed' } };
    }

    return null;
  }

  return { handle, reset, subscribers, states };
}

/** True for the bookkeeping calls the bot makes to its own tables. */
const isBotRoute = (key) => / \/api\/bot\//.test(typeof key === 'string' ? key : key.key);

module.exports = { createBotDb, isBotRoute };
