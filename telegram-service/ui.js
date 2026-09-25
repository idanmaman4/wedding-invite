'use strict';

/**
 * Keyboards, and the short-lived conversation state behind the stepped flows.
 *
 * Telegram has no notion of "this person is halfway through creating an
 * invite", so the bot keeps that itself: one entry per chat, dropped as soon
 * as the flow finishes, is cancelled, or goes stale.
 *
 * It lives in the site's database (Supabase) through the admin API
 * (`/api/bot/state`), the same way the subscriber registry does — see
 * store.js. Nothing is kept in memory, so a serverless function (which shares
 * nothing between invocations) and a long-running laptop process behave alike.
 */

const { InlineKeyboard, Keyboard } = require('grammy');
const { SIDES, request, ApiError } = require('./api');

/** A flow left untouched for this long is forgotten. */
const FLOW_TTL_MS = Number(process.env.FLOW_TTL_MS || 15 * 60 * 1000);

// ─── Conversation state ──────────────────────────────────────────────────────

const statePath = (chatId) => `/api/bot/state/${encodeURIComponent(String(chatId))}`;

async function readState(chatId) {
  try {
    const res = await request('GET', statePath(chatId));
    return res && res.data && typeof res.data === 'object' && res.data.flow ? res.data : null;
  } catch (err) {
    if (err instanceof ApiError && err.missing) return null;
    throw err;
  }
}

async function writeState(chatId, state) {
  await request('PUT', statePath(chatId), { data: state });
}

async function clearState(chatId) {
  await request('DELETE', statePath(chatId));
}

async function startFlow(chatId, flow, data = {}) {
  const state = { flow, step: 0, data, at: Date.now() };
  await writeState(chatId, state);
  return state;
}

async function getFlow(chatId) {
  const state = await readState(chatId);
  if (!state) return null;
  if (Date.now() - (state.at || 0) > FLOW_TTL_MS) {
    await clearState(chatId);
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
  await writeState(chatId, state);
  return state;
}

async function endFlow(chatId) {
  await clearState(chatId);
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
    .text('⚙️ צד ברירת מחדל', 'menu:side')
    .text('❓ עזרה', 'menu:help');

/** Shown under a result, so the couple never has to type a command twice. */
const backToMenu = () => new InlineKeyboard().text('⬅️ תפריט', 'menu:home');

const cancelOnly = () => new InlineKeyboard().text('✖️ ביטול', 'flow:cancel');

/** Step 2 of the invite flow: a phone is optional. */
const phoneStep = () =>
  new InlineKeyboard().text('⏭ דילוג על הטלפון', 'invite:nophone').row().text('✖️ ביטול', 'flow:cancel');

/** Step 3: one button per side, two to a row. */
function sideStep({ rename = false } = {}) {
  const kb = new InlineKeyboard();
  const keys = Object.keys(SIDES);
  keys.forEach((key, i) => {
    kb.text(SIDES[key], `invite:side:${key}`);
    if (i % 2 === 1 && i < keys.length - 1) kb.row();
  });
  // From a shared contact: the card's name may not be what the invite says.
  if (rename) kb.row().text('✏️ שם אחר', 'invite:rename');
  return kb.row().text('✖️ ביטול', 'flow:cancel');
}

/** Pick this chat's default side; the current one is ticked. */
function defaultSideMenu(current) {
  const kb = new InlineKeyboard();
  const keys = Object.keys(SIDES);
  keys.forEach((key, i) => {
    kb.text(`${current === key ? '✓ ' : ''}${SIDES[key]}`, `defside:${key}`);
    if (i % 2 === 1) kb.row();
  });
  return kb
    .text(`${current ? '' : '✓ '}🔄 לשאול בכל פעם`, 'defside:none')
    .row()
    .text('⬅️ תפריט', 'menu:home');
}

/** Offered after an invite is created. */
/**
 * After an invite: send it on WhatsApp in one tap (when there is a number),
 * rename it (when it was made straight from a contact card), then carry on.
 */
const afterInvite = (whatsappUrl, renameToken) => {
  const kb = new InlineKeyboard();
  if (whatsappUrl) kb.url('📲 שליחה בוואטסאפ', whatsappUrl).row();
  if (renameToken) kb.text('✏️ שם אחר', `invite:rename:${renameToken}`).row();
  return kb.text('➕ עוד הזמנה', 'menu:invite').text('⬅️ תפריט', 'menu:home');
};

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
  mainMenu,
  backToMenu,
  cancelOnly,
  phoneStep,
  sideStep,
  defaultSideMenu,
  afterInvite,
  shareContact,
};
