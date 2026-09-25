'use strict';

/** Hebrew message building, side parsing, and Telegram-safe message splitting. */

const { SIDES } = require('./api');

// Telegram hard-caps a message at 4096 characters. Stay well under it so a
// long blessing or an unusually long name can never push a chunk over.
const CHAR_LIMIT = 3500;
const ITEMS_PER_MESSAGE = 30;

/** Telegram HTML parse mode only needs these three escaped. */
function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Guests with no personal link belong to no side; they are shown as "other". */
const OTHER_SIDE_LABEL = 'אחר';

function sideLabel(key) {
  if (key === 'other') return OTHER_SIDE_LABEL;
  return SIDES[key] || (key ? String(key) : OTHER_SIDE_LABEL);
}

/** Accept a side as a canonical key, a Hebrew label, or a loose Hebrew phrase. */
function parseSide(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (Object.prototype.hasOwnProperty.call(SIDES, lower)) return lower;

  for (const [key, label] of Object.entries(SIDES)) {
    if (raw === label) return key;
  }

  const hasVered = raw.includes('ורד');
  const hasIdan = raw.includes('עידן');
  const isParents = raw.includes('הורי') || raw.includes('הורים');
  if (hasVered && !hasIdan) return isParents ? 'vered_parents' : 'vered';
  if (hasIdan && !hasVered) return isParents ? 'idan_parents' : 'idan';
  return null;
}

const sidesHelp = () =>
  Object.entries(SIDES)
    .map(([key, label]) => `${label} (${key})`)
    .join(' · ');

/**
 * Split a list of already-formatted lines into several messages: at most
 * ITEMS_PER_MESSAGE entries and CHAR_LIMIT characters each. Nothing is ever
 * dropped — a list too long for one message becomes "(1/3)", "(2/3)"…
 */
function chunk(header, lines, { perMessage = ITEMS_PER_MESSAGE, limit = CHAR_LIMIT } = {}) {
  if (!lines.length) return [`${header}\n\n(אין רשומות)`];

  const groups = [];
  let current = [];
  let size = 0;

  for (const line of lines) {
    const cost = line.length + 1;
    if (current.length >= perMessage || (current.length && size + cost > limit)) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += cost;
  }
  if (current.length) groups.push(current);

  return groups.map((group, i) => {
    const counter = groups.length > 1 ? ` (${i + 1}/${groups.length})` : '';
    return `${header}${counter}\n\n${group.join('\n')}`;
  });
}

const phoneOrDash = (phone) => (phone ? esc(phone) : '—');

/** One line describing somebody who has answered. */
function rsvpLine(index, entry) {
  const mark = entry.attending ? '✅' : '❌';
  const parts = [`${index}. ${mark} <b>${esc(entry.name || 'ללא שם')}</b>`];
  if (entry.attending) parts.push(`${entry.guests > 0 ? entry.guests : 1} אורחים`);
  else parts.push('לא מגיעים');
  parts.push(`צד ${esc(sideLabel(entry.side))}`);
  parts.push(`📞 ${phoneOrDash(entry.phone)}`);
  return parts.join(' · ');
}

/** One line describing somebody who has not answered yet. */
function pendingLine(index, invite) {
  const parts = [`${index}. <b>${esc(invite.name || 'ללא שם')}</b>`];
  if (invite.side) parts.push(`צד ${esc(sideLabel(invite.side))}`);
  parts.push(`📞 ${phoneOrDash(invite.phone)}`);
  return parts.join(' · ');
}

function formatStats(stats) {
  const lines = ['📊 <b>סטטוס אישורי הגעה</b>', ''];

  if (stats.invites !== null && stats.invites !== undefined) {
    lines.push(`הזמנות שנשלחו: <b>${stats.invites}</b>`);
  }
  lines.push(`ענו: <b>${stats.responded}</b>`);
  if (stats.not_responded !== null && stats.not_responded !== undefined) {
    lines.push(`טרם ענו: <b>${stats.not_responded}</b>`);
  }
  lines.push(`סה״כ אנשים שמגיעים: <b>${stats.coming}</b>`);

  if (stats.by_side) {
    lines.push('', '<b>לפי צד:</b>');
    for (const [key, label] of Object.entries(SIDES)) {
      const s = stats.by_side[key] || { invites: 0, responded: 0, coming: 0 };
      lines.push(`• ${esc(label)} — הזמנות ${s.invites} · ענו ${s.responded} · מגיעים ${s.coming}`);
    }
    const other = stats.by_side.other;
    if (other && (other.responded || other.coming)) {
      lines.push(`• ${OTHER_SIDE_LABEL} (ללא הזמנה אישית) — ענו ${other.responded} · מגיעים ${other.coming}`);
    }
    if (stats.unknown_side) lines.push(`• ללא צד מוגדר — ${stats.unknown_side}`);
  } else {
    lines.push('', 'ℹ️ פילוח לפי צד יהיה זמין כשה-API יחזיר הזמנות עם צד.');
  }

  if (stats.source === 'guests') {
    lines.push('', 'ℹ️ המספרים חושבו מרשימת המאשרים בלבד — ה-API עדיין לא חושף הזמנות.');
  }

  return lines.join('\n');
}

/** The broadcast sent to every subscriber when an RSVP lands. */
function formatRsvpNotification(payload) {
  const name = esc((payload.name || '').trim() || 'אורח/ת');
  const guests = Number(payload.guests) > 0 ? Number(payload.guests) : 1;
  const sideKey = payload.side ? esc(sideLabel(payload.side)) : '';
  const attending = payload.attending === true || payload.attending === 'true' || payload.attending === 1;

  const lines = [];
  if (attending) {
    lines.push(`🎉 <b>אישור הגעה חדש</b> — ${name}, ${guests} אורחים${sideKey ? `, צד ${sideKey}` : ''}`);
  } else {
    lines.push(`😔 <b>${name}</b> לא יוכלו להגיע${sideKey ? ` (צד ${sideKey})` : ''}`);
  }
  if (payload.phone) lines.push(`📞 ${esc(payload.phone)}`);
  const blessing = (payload.message || '').trim();
  if (blessing) lines.push('', `💌 <i>${esc(blessing)}</i>`);
  return lines.join('\n');
}

/** Ready-to-forward invitation text — mirrors the WhatsApp service's wording. */
function buildInvitationText(name, url) {
  const greeting = name ? `שלום ${name},` : 'שלום,';
  return (
    '🌿 *עידן & ורד מתחתנים* 🌿\n\n' +
    `${greeting}\n\n` +
    'בשמחה רבה אנו מזמינים אתכם לחגוג איתנו את חתונתנו!\n\n' +
    '📅 יום ראשון, י״ד בחשוון תשפ״ז · 25.10.2026\n' +
    '⏰ קבלת פנים ב-18:30, חופה ב-19:30\n' +
    '📍 אולם האירועים תרין, רח׳ אליעזר מזל 6, ראשון לציון\n\n' +
    `נשמח לאישור הגעתכם עד 15 באוקטובר 2026:\n${url}\n\n` +
    'באהבה,\nעידן & ורד 💍'
  );
}

const HELP = [
  '🤖 <b>הבוט של החתונה של עידן וורד</b>',
  '',
  '/menu — תפריט הכפתורים (הדרך הקלה)',
  '/start — הרשמה לעדכונים על כל אישור הגעה',
  '/stop — הפסקת עדכונים',
  '/stats — סיכום: הזמנות, מי ענה, כמה אנשים מגיעים, ופילוח לפי צד',
  '/rsvps — כל מי שכבר ענה (שם, מגיע/לא, כמות, טלפון)',
  '/pending — כל מי שעדיין לא ענה, עם טלפון למעקב',
  '/search &lt;טקסט&gt; — חיפוש לפי שם או טלפון',
  '/invite — יצירת הזמנה אישית בשלושה שלבים (שם, טלפון, צד)',
  '/export — דוח אקסל מלא (אישורי הגעה, טרם השיבו, סיכום) אליכם עכשיו',
  '/exportall — שליחת אותו דוח אקסל לכל מי שרשום לעדכונים',
  '/whoami — מציג את ה-chat id שלך',
  '/help — ההודעה הזו',
  '',
  `צדדים אפשריים: ${sidesHelp()}`,
  '',
  'ℹ️ דוח האקסל נשלח גם אוטומטית פעם ביום (09:00 שעון ישראל כברירת מחדל).',
].join('\n');

module.exports = {
  OTHER_SIDE_LABEL,
  CHAR_LIMIT,
  ITEMS_PER_MESSAGE,
  HELP,
  esc,
  sideLabel,
  parseSide,
  sidesHelp,
  chunk,
  rsvpLine,
  pendingLine,
  formatStats,
  formatRsvpNotification,
  buildInvitationText,
};
