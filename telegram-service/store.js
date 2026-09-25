'use strict';

/**
 * Subscriber registry.
 *
 * Two backends behind one async interface:
 *
 *   - **api**  — rows in the site's database, via the admin API. This is what
 *     runs in production: the bot is a serverless function there, with no disk
 *     that outlives a request.
 *   - **file** — a JSON file next to the bot, read fresh on every access so it
 *     can be hand-edited, written via temp file + rename so a crash mid-write
 *     never leaves a half-written registry. For a bot run by hand on a laptop.
 *
 * `BOT_STORE=api|file` picks; unset, it is `api` on Vercel and `file` elsewhere.
 */

const fs = require('fs');
const path = require('path');

const FILE = process.env.TELEGRAM_SUBSCRIBERS_FILE
  ? path.resolve(process.env.TELEGRAM_SUBSCRIBERS_FILE)
  : path.join(__dirname, 'subscribers.json');

function backend() {
  const explicit = String(process.env.BOT_STORE || '').trim().toLowerCase();
  if (explicit === 'api' || explicit === 'file') return explicit;
  return process.env.VERCEL ? 'api' : 'file';
}

// ─── File backend ────────────────────────────────────────────────────────────

function loadFile() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => s && s.chat_id != null) : [];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // A corrupt file must not take the bot down; start from empty and say so.
      console.error('[store] could not read subscribers.json:', err.message);
    }
    return [];
  }
}

function saveFile(list) {
  const tmp = `${FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('[store] could not write subscribers.json:', err.message);
  }
}

const fileStore = {
  async add({ chat_id, first_name, username }) {
    const list = loadFile();
    const existing = list.find((s) => String(s.chat_id) === String(chat_id));
    if (existing) {
      existing.first_name = first_name || existing.first_name || '';
      existing.username = username || existing.username || '';
      saveFile(list);
      return false;
    }
    list.push({
      chat_id,
      first_name: first_name || '',
      username: username || '',
      subscribed_at: new Date().toISOString(),
    });
    saveFile(list);
    return true;
  },

  async remove(chat_id) {
    const list = loadFile();
    const next = list.filter((s) => String(s.chat_id) !== String(chat_id));
    if (next.length === list.length) return false;
    saveFile(next);
    return true;
  },

  async all() {
    return loadFile();
  },

  async has(chat_id) {
    return loadFile().some((s) => String(s.chat_id) === String(chat_id));
  },
};

// ─── API backend ─────────────────────────────────────────────────────────────

// Required lazily so the file backend never touches the network module.
const apiStore = {
  async add({ chat_id, first_name, username }) {
    const { request } = require('./api');
    const res = await request('POST', '/api/bot/subscribers', {
      chat_id: String(chat_id),
      first_name: first_name || '',
      username: username || '',
    });
    return Boolean(res && res.created);
  },

  async remove(chat_id) {
    const { request } = require('./api');
    const res = await request('DELETE', `/api/bot/subscribers/${encodeURIComponent(String(chat_id))}`);
    return Boolean(res && res.removed);
  },

  async all() {
    const { request } = require('./api');
    const rows = await request('GET', '/api/bot/subscribers');
    return Array.isArray(rows) ? rows : [];
  },

  async has(chat_id) {
    const rows = await apiStore.all();
    return rows.some((s) => String(s.chat_id) === String(chat_id));
  },
};

function impl() {
  return backend() === 'api' ? apiStore : fileStore;
}

/** Add (or refresh) a subscriber. Resolves true when this is a brand-new one. */
const add = (sub) => impl().add(sub);
/** Drop a subscriber. Resolves true when one was actually removed. */
const remove = (chatId) => impl().remove(chatId);
const all = () => impl().all();
const has = (chatId) => impl().has(chatId);

module.exports = { add, remove, all, has, backend, FILE };
