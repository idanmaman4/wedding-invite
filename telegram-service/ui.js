'use strict';

/**
 * Keyboards, and the short-lived conversation state behind the stepped flows.
 *
 * Telegram has no notion of "this person is halfway through creating an
 * invite", so the bot keeps that itself: one entry per chat, dropped as soon
 * as the flow finishes, is cancelled, or goes stale.
 *
 * Where it lives depends on how the bot runs. A long-lived process keeps it in
 * memory. A serverless function shares nothing between invocations, so there
 * it goes through the site's database (`/api/bot/state`), the same way the
 * subscriber registry does — see store.js for the backend rule.
 */

const { InlineKeyboard, Keyboard } = require('grammy');
const { SIDES } = require('./api');
const { backend } = require('./store');

/** A flow left untouched for this long is forgotten. */
const FLOW_TTL_MS = Number(process.env.FLOW_TTL_MS || 15 * 60 * 1000);

// ─── Conversation state ──────────────────────────────────────────────────────

const memory = new Map();

const memoryState = {
  async read(chatId) {
    return memory.get(String(chatId)) || null;
  },
  async write(chatId, state) {
    memory.set(String(chatId), state);
  },
  async clear(chatId) {
    memory.delete(String(chatId));
  },
};

const apiState = {
  async read(chatId) {
    const { request, ApiError } = require('./api');
    try {
      const res = await request('GET', `/api/bot/state/${encodeURIComponent(String(chatId))}`);
      return res && res.data && typeof res.data === 'object' && res.data.flow ? res.data : null;
    } catch (err) {
      if (err instanceof ApiError && err.missing) return null;
      throw err;
    }
  },
  async write(chatId, state) {
    const { request } = require('./api');
    await request('PUT', `/api/bot/state/${encodeURIComponent(String(chatId))}`, { data: state });
  },
  async clear(chatId) {
    const { request } = require('./api');
    await request('DELETE', `/api/bot/state/${encodeURIComponent(String(chatId))}`);
  },
};

const impl = () => (backend() === 'api' ? apiState : memoryState);

async function startFlow(chatId, flow, data = {}) {
  const state = { flow, step: 0, data, at: Date.now() };
  await impl().write(chatId, state);
  return state;
}

async function getFlow(chatId) {
  const state = await impl().read(chatId);
  if (!state) return null;
  if (Date.now() - (state.at || 0) > FLOW_TTL_MS) {
    await impl().clear(chatId);
    return null;
  }
  return state;
}

async function advanceFlow(chatId, patch = {}) {
  const state = await getFlow(chatId);
  if (!state) return null;
  Object.assign(state.data, patch.data || {});
  if (patch.step !== undefined) state.step = patch.step;
  state.at = Date.now();
  await impl().write(chatId, state);
  return state;
}

async function endFlow(chatId) {
  await impl().clear(chatId);
}

/** Only for tests and diagnostics: how many in-memory flows are open. */
function flowCount() {
  return memory.size;
}

// ─── Keyboards ───────────────────────────────────────────────────────────────

/** The home screen. Every command is one tap away from here. */
const mainMenu = () =>
  new InlineKeyboard()
    .text('📊 סטטוס', 'menu:stats')
    .text('✅ מי ענה', 'menu:rsvps')
    .row()
    .text('⏳ טרם ענו', 'menu:pending')
    .text('🔍 חיפוש', 'menu:search')
    .row()
    .text('➕ הזמנה חדשה', 'menu:invite')
    .text('📄 דוח אקסל', 'menu:export')
    .row()
    .text('❓ עזרה', 'menu:help');

/** Shown under a result, so the couple never has to type a command twice. */
const backToMenu = () => new InlineKeyboard().text('⬅️ תפריט', 'menu:home');

const cancelOnly = () => new InlineKeyboard().text('✖️ ביטול', 'flow:cancel');

/** Step 2 of the invite flow: a phone is optional. */
const phoneStep = () =>
  new InlineKeyboard().text('⏭ דילוג על הטלפון', 'invite:nophone').row().text('✖️ ביטול', 'flow:cancel');

/** Step 3: one button per side, two to a row. */
function sideStep() {
  const kb = new InlineKeyboard();
  const keys = Object.keys(SIDES);
  keys.forEach((key, i) => {
    kb.text(SIDES[key], `invite:side:${key}`);
    if (i % 2 === 1 && i < keys.length - 1) kb.row();
  });
  return kb.row().text('✖️ ביטול', 'flow:cancel');
}

/** Offered after an invite is created. */
const afterInvite = () =>
  new InlineKeyboard().text('➕ עוד הזמנה', 'menu:invite').text('⬅️ תפריט', 'menu:home');

/**
 * A one-tap "share a contact" keyboard for the phone step. Telegram shows this
 * under the text box; picking a contact sends a `contact` message, which saves
 * the couple typing a number by hand.
 */
const shareContact = () =>
  new Keyboard().requestContact('📇 שיתוף איש קשר').resized().oneTime();

module.exports = {
  FLOW_TTL_MS,
  startFlow,
  getFlow,
  advanceFlow,
  endFlow,
  flowCount,
  mainMenu,
  backToMenu,
  cancelOnly,
  phoneStep,
  sideStep,
  afterInvite,
  shareContact,
};
