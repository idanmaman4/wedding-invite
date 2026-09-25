'use strict';

/**
 * XLSX export of everything the site knows: RSVPs, invites still waiting for an
 * answer, and a per-side summary.
 *
 * Everything here is pure and injectable so it can be unit-tested without a
 * network or a Telegram token:
 *   • `buildWorkbook({invites, guests, stats, now})` — synthetic rows in, a
 *     SheetJS workbook out.
 *   • `collectData()` — the only function that talks to the API. It tolerates
 *     the 404/500s the site's API still throws while it is being migrated and
 *     raises `ExportDataError` when nothing usable came back, so the caller can
 *     send a short Hebrew notice instead of a broken file.
 *   • `buildExport()` — the two together, written to a file in the OS temp dir.
 *     The caller must call the returned `cleanup()` when the send is done.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const api = require('./api');

const { SIDES } = api;

const SHEETS = {
  rsvp: 'אישורי הגעה',
  pending: 'טרם השיבו',
  summary: 'סיכום',
};

const HEADERS = {
  rsvp: ['שם', 'טלפון', 'צד', 'מגיעים', 'כמות', 'תזונה', 'ברכה', 'תאריך'],
  pending: ['שם', 'טלפון', 'צד', 'קישור אישי'],
  summary: ['צד', 'הזמנות', 'השיבו', 'מגיעים (אנשים)', 'לא מגיעים', 'טרם השיבו'],
};

const COL_WIDTHS = {
  rsvp: [24, 16, 14, 10, 8, 20, 44, 18],
  pending: [24, 16, 14, 48],
  summary: [16, 10, 10, 16, 12, 12],
};

const UNKNOWN_SIDE = 'ללא צד';
const TOTAL_LABEL = 'סה״כ';
const DEFAULT_TZ = 'Asia/Jerusalem';

/** A data source that could not answer at all — the caller sends a notice. */
class ExportDataError extends Error {
  constructor(message, { causes = [] } = {}) {
    super(message);
    this.name = 'ExportDataError';
    this.causes = causes;
  }
}

/** True when Intl knows the zone — the only judge that matters, since Intl does the formatting. */
function isValidTimezone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Timezone used for the file name, the caption date and every cell date.
 *
 * DAILY_EXPORT_TZ wins; then the process TZ; then Asia/Jerusalem. The process
 * TZ is only trusted when it names a real zone: Vercel sets it to ":UTC" with a
 * leading colon, which Intl rejects outright, and a report dated in UTC would
 * be wrong for the couple anyway.
 */
function exportTimezone(env = process.env) {
  const explicit = String(env.DAILY_EXPORT_TZ || '').trim().replace(/^:/, '');
  if (isValidTimezone(explicit)) return explicit;
  const platform = String(env.TZ || '').trim().replace(/^:/, '');
  if (platform && platform.toUpperCase() !== 'UTC' && isValidTimezone(platform)) return platform;
  return DEFAULT_TZ;
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const digits = (s) => String(s == null ? '' : s).replace(/\D+/g, '');
const normName = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

const sideKeyOf = (side) => (Object.prototype.hasOwnProperty.call(SIDES, side) ? side : null);
const sideLabelOf = (side) => SIDES[side] || UNKNOWN_SIDE;

function parts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** `2026-09-04` in the export timezone — used for the file name. */
function isoDate(date = new Date(), tz = exportTimezone()) {
  const p = parts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `04/09/2026` — the caption's date. */
function humanDate(date = new Date(), tz = exportTimezone()) {
  const p = parts(date, tz);
  return `${p.day}/${p.month}/${p.year}`;
}

/**
 * Parse an API timestamp. The API stores naive UTC; an ISO string without an
 * offset is read by `new Date()` as *local* time, which on a laptop in Israel
 * shifts every answer three hours (and can move it across the 24h window).
 */
function parseDate(value) {
  if (value instanceof Date) return value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return new Date(`${s.replace(' ', 'T')}Z`);
  return new Date(s);
}

/** `04/09/2026 19:30` for a cell, or '' when the value is not a real date. */
function humanDateTime(value, tz = exportTimezone()) {
  if (!value) return '';
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = parts(d, tz);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function exportFileName(date = new Date(), tz = exportTimezone()) {
  return `wedding-rsvp-${isoDate(date, tz)}.xlsx`;
}

/**
 * One row per RSVP: the /api/guests rows (which carry the answer, the party
 * size, the dietary note and the blessing) joined to their invite (which
 * carries the side). Invites flagged `responded` with no matching RSVP row are
 * appended, so a missing/partial /api/guests still produces a usable sheet.
 */
function mergeRsvps(invites = [], guests = []) {
  const byGuestId = new Map();
  const byPhone = new Map();
  const byName = new Map();

  for (const inv of invites) {
    if (inv.guest_id !== null && inv.guest_id !== undefined) {
      byGuestId.set(String(inv.guest_id), inv);
      // Already bound to its own RSVP row: it must not also be claimed by a
      // walk-in who happens to share the name or phone (that walk-in would be
      // filed under this invite's side and the invite counted twice).
      continue;
    }
    const d = digits(inv.phone);
    if (d.length >= 7 && !byPhone.has(d)) byPhone.set(d, inv);
    const n = normName(inv.name);
    if (n && !byName.has(n)) byName.set(n, inv);
  }

  const matched = new Set();
  const findInvite = (g) => {
    const byId = g.id === null || g.id === undefined ? null : byGuestId.get(String(g.id));
    if (byId) return byId;
    const d = digits(g.phone);
    if (d.length >= 7 && byPhone.has(d)) return byPhone.get(d);
    const n = normName(g.name);
    if (n && byName.has(n)) return byName.get(n);
    return null;
  };

  const rows = (guests || []).map((g) => {
    const inv = findInvite(g);
    if (inv) matched.add(inv);
    const attending = Boolean(g.attending);
    return {
      name: g.name || (inv && inv.name) || '',
      phone: g.phone || (inv && inv.phone) || '',
      side: g.side || (inv && inv.side) || '',
      attending,
      guests: attending ? (Number(g.guests) > 0 ? Number(g.guests) : 1) : 0,
      dietary: g.dietary || '',
      message: g.message || '',
      date: g.created_at || (inv && inv.created_at) || '',
    };
  });

  for (const inv of invites || []) {
    if (!inv.responded || matched.has(inv)) continue;
    const attending = Boolean(inv.attending);
    rows.push({
      name: inv.name || '',
      phone: inv.phone || '',
      side: inv.side || '',
      attending,
      guests: attending ? (Number(inv.guests) > 0 ? Number(inv.guests) : 1) : 0,
      dietary: '',
      message: '',
      date: inv.created_at || '',
    });
  }

  return rows;
}

const pendingInvites = (invites = []) => invites.filter((i) => !i.responded);

/**
 * The numbers behind the caption and the "סיכום" sheet.
 *
 * Invite rows are the authority for "how many were invited" and "how many are
 * still missing"; the merged RSVP rows are the authority for headcount. Where
 * the two disagree (an invite whose `responded` flag lags behind its RSVP row)
 * the larger of the two wins, so the report never under-reports answers.
 */
function summarize({ invites = [], guests = [], stats = null, now = new Date() } = {}) {
  const rows = mergeRsvps(invites, guests);
  const at = now instanceof Date ? now : new Date(now);
  const dayAgo = at.getTime() - 24 * 60 * 60 * 1000;

  const bucket = () => ({ invites: 0, responded: 0, coming: 0, notComing: 0, notResponded: 0 });
  const bySide = new Map();
  for (const key of Object.keys(SIDES)) bySide.set(key, bucket());
  bySide.set(UNKNOWN_SIDE, bucket());

  const keyFor = (side) => sideKeyOf(side) || UNKNOWN_SIDE;

  for (const inv of invites) {
    const b = bySide.get(keyFor(inv.side));
    b.invites += 1;
    if (inv.responded) b.responded += 1;
  }

  const rowsPerSide = new Map();
  for (const row of rows) {
    const key = keyFor(row.side);
    rowsPerSide.set(key, (rowsPerSide.get(key) || 0) + 1);
    const b = bySide.get(key);
    if (row.attending) b.coming += row.guests;
    else b.notComing += 1;
  }

  for (const [key, b] of bySide) {
    b.responded = Math.max(b.responded, rowsPerSide.get(key) || 0);
    b.notResponded = Math.max(0, b.invites - b.responded);
  }

  const totalInvitesFromRows = invites.length;
  const fallbackInvites = stats && Number.isFinite(Number(stats.invites)) ? Number(stats.invites) : 0;
  const totalInvites = totalInvitesFromRows || fallbackInvites;

  const respondedFromInvites = invites.filter((i) => i.responded).length;
  const totalResponded = Math.max(respondedFromInvites, rows.length);

  const comingFromRows = rows.reduce((sum, r) => sum + (r.attending ? r.guests : 0), 0);
  const totalComing =
    comingFromRows || (stats && Number.isFinite(Number(stats.coming)) ? Number(stats.coming) : 0);

  const totalNotComing = rows.filter((r) => !r.attending).length;

  let last24h = 0;
  for (const row of rows) {
    if (!row.date) continue;
    const t = parseDate(row.date).getTime();
    if (Number.isFinite(t) && t >= dayAgo && t <= at.getTime() + 60 * 1000) last24h += 1;
  }

  return {
    rows,
    pending: pendingInvites(invites),
    bySide,
    totals: {
      invites: totalInvites,
      responded: totalResponded,
      coming: totalComing,
      notComing: totalNotComing,
      notResponded: Math.max(0, totalInvites - totalResponded),
      last24h,
    },
  };
}

/** Right-to-left sheet from an array-of-arrays, with column widths. */
function sheetFrom(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!views'] = [{ RTL: true }];
  ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

function buildWorkbook({ invites = [], guests = [], stats = null, now = new Date(), tz } = {}) {
  const zone = tz || exportTimezone();
  const summary = summarize({ invites, guests, stats, now });

  const rsvpRows = summary.rows.map((r) => [
    r.name,
    r.phone,
    r.side ? sideLabelOf(r.side) : UNKNOWN_SIDE,
    r.attending ? 'כן' : 'לא',
    r.attending ? r.guests : 0,
    r.dietary,
    r.message,
    humanDateTime(r.date, zone),
  ]);

  const pendingRows = summary.pending.map((i) => [
    i.name,
    i.phone,
    i.side ? sideLabelOf(i.side) : UNKNOWN_SIDE,
    i.url || '',
  ]);

  const summaryRows = [];
  for (const key of Object.keys(SIDES)) {
    const b = summary.bySide.get(key);
    summaryRows.push([SIDES[key], b.invites, b.responded, b.coming, b.notComing, b.notResponded]);
  }
  const unknown = summary.bySide.get(UNKNOWN_SIDE);
  if (unknown.invites || unknown.responded || unknown.coming || unknown.notComing) {
    summaryRows.push([
      UNKNOWN_SIDE,
      unknown.invites,
      unknown.responded,
      unknown.coming,
      unknown.notComing,
      unknown.notResponded,
    ]);
  }
  const t = summary.totals;
  summaryRows.push([TOTAL_LABEL, t.invites, t.responded, t.coming, t.notComing, t.notResponded]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom([HEADERS.rsvp, ...rsvpRows], COL_WIDTHS.rsvp), SHEETS.rsvp);
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom([HEADERS.pending, ...pendingRows], COL_WIDTHS.pending),
    SHEETS.pending,
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheetFrom([HEADERS.summary, ...summaryRows], COL_WIDTHS.summary),
    SHEETS.summary,
  );

  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Views = [{ RTL: true }];

  return { workbook: wb, summary };
}

/** The Hebrew caption that rides along with the document. */
function buildCaption(summary, { now = new Date(), tz, partial = false } = {}) {
  const t = summary.totals;
  const lines = [
    `📊 <b>דוח יומי — ${humanDate(now, tz || exportTimezone())}</b>`,
    '',
    `📨 הזמנות: <b>${t.invites}</b>`,
    `✅ השיבו: <b>${t.responded}</b>`,
    `🎉 מגיעים: <b>${t.coming}</b> אנשים`,
    `🕐 השיבו ב-24 השעות האחרונות: <b>${t.last24h}</b>`,
  ];
  if (partial) {
    lines.push('', 'ℹ️ חלק מהנתונים חסרים — ה-API לא החזיר את כל המקורות.');
  }
  return lines.join('\n');
}

/** The message sent instead of a file when the API cannot be read at all. */
function fallbackNotice(err, { now = new Date(), tz } = {}) {
  const reason = err && err.message ? String(err.message) : 'שגיאה לא ידועה';
  return [
    `⚠️ <b>הדוח היומי (${humanDate(now, tz || exportTimezone())}) לא נוצר</b>`,
    '',
    'ה-API של האתר לא החזיר נתונים, אז לא נשלח קובץ.',
    // Sent as HTML; the reason can quote a raw response body.
    `סיבה: ${escHtml(reason)}`,
    '',
    'אפשר לנסות שוב עם /export אחרי שהאתר יתעדכן.',
  ].join('\n');
}

/**
 * Fetch everything the workbook needs. Each source is optional: a 404/500/
 * timeout on one of them degrades the report instead of failing it. Only when
 * neither invites nor RSVPs answered does this throw.
 */
async function collectData() {
  const causes = [];

  const tolerate = async (fn, label, fallback) => {
    try {
      return await fn();
    } catch (err) {
      causes.push(`${label}: ${err && err.message ? err.message : err}`);
      if (!api.isRecoverable(err)) causes.push(`${label} (לא ניתן להתאוששות)`);
      return fallback;
    }
  };

  const invites = await tolerate(() => api.getInvites(), 'הזמנות', null);
  const guests = await tolerate(() => api.getGuests(), 'אישורי הגעה', null);
  // /api/stats is only needed as a fallback for the totals: when invites came
  // back, everything it could tell us is already derivable from them.
  const stats = invites && invites.length
    ? null
    : await tolerate(() => api.getStats(), 'סטטיסטיקה', null);

  if (invites === null && guests === null) {
    throw new ExportDataError(causes[0] || 'ה-API לא זמין', { causes });
  }

  return {
    invites: invites || [],
    guests: guests || [],
    stats,
    partial: invites === null || guests === null,
    causes,
  };
}

/**
 * Write the workbook into a fresh directory under the OS temp dir. A private
 * directory (rather than a bare temp file) means two concurrent exports on the
 * same day cannot clash on the file name, and cleanup is a single rm.
 */
function writeWorkbookFile(workbook, fileName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-export-'));
  const filePath = path.join(dir, fileName);
  XLSX.writeFile(workbook, filePath);
  return { filePath, dir };
}

/** Remove the temp directory a `writeWorkbookFile`/`buildExport` produced. */
function cleanupExport(target) {
  if (!target) return;
  const dir = typeof target === 'string' ? path.dirname(target) : target.dir;
  if (!dir) return;
  // Belt and braces: only ever delete inside the OS temp dir.
  const resolved = path.resolve(dir);
  if (!path.basename(resolved).startsWith('wedding-export-')) return;
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch (err) {
    console.error('[export] could not remove temp dir:', err.message);
  }
}

/**
 * Build the whole thing: fetch, render, write to temp.
 * Returns {filePath, fileName, caption, summary, partial, cleanup}.
 * Throws `ExportDataError` when the API gave nothing to report on.
 */
async function buildExport({ now = new Date(), collect = collectData, tz } = {}) {
  const zone = tz || exportTimezone();
  const data = await collect();
  const { workbook, summary } = buildWorkbook({
    invites: data.invites,
    guests: data.guests,
    stats: data.stats,
    now,
    tz: zone,
  });
  const fileName = exportFileName(now, zone);
  const { filePath, dir } = writeWorkbookFile(workbook, fileName);

  return {
    filePath,
    fileName,
    dir,
    summary,
    partial: Boolean(data.partial),
    caption: buildCaption(summary, { now, tz: zone, partial: data.partial }),
    cleanup: () => cleanupExport({ dir }),
  };
}

module.exports = {
  isValidTimezone,
  SHEETS,
  HEADERS,
  COL_WIDTHS,
  UNKNOWN_SIDE,
  TOTAL_LABEL,
  DEFAULT_TZ,
  ExportDataError,
  exportTimezone,
  isoDate,
  humanDate,
  humanDateTime,
  parseDate,
  exportFileName,
  mergeRsvps,
  pendingInvites,
  summarize,
  buildWorkbook,
  buildCaption,
  fallbackNotice,
  collectData,
  writeWorkbookFile,
  cleanupExport,
  buildExport,
};
