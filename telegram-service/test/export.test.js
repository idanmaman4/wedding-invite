'use strict';

/**
 * The workbook builder, exercised on synthetic rows and verified by reading the
 * written .xlsx back with SheetJS. Nothing here touches the network.
 *
 *   node --test test/
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const exporter = require('../export');
const { NOW, invites, guests } = require('./fixtures');

const TZ = 'Asia/Jerusalem';

/** Build → write → read back. Returns both the live and the round-tripped book. */
function roundTrip(data = { invites, guests }) {
  const { workbook, summary } = exporter.buildWorkbook({ ...data, now: NOW, tz: TZ });
  const fileName = exporter.exportFileName(NOW, TZ);
  const { filePath, dir } = exporter.writeWorkbookFile(workbook, fileName);
  const buffer = fs.readFileSync(filePath);
  const back = XLSX.read(buffer, { type: 'buffer', bookFiles: true, cellStyles: true });
  return { workbook, summary, back, filePath, dir, fileName };
}

const aoa = (wb, name) =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });

test('file name is wedding-rsvp-YYYY-MM-DD.xlsx in the export timezone', () => {
  assert.equal(exporter.exportFileName(NOW, TZ), 'wedding-rsvp-2026-09-04.xlsx');
  // 21:30 UTC on the 3rd is already the 4th in Jerusalem.
  assert.equal(exporter.exportFileName(new Date('2026-09-03T21:30:00Z'), TZ), 'wedding-rsvp-2026-09-04.xlsx');
});

test('a platform TZ that is not a real zone falls back instead of crashing', () => {
  // Vercel sets TZ=":UTC" — the leading colon is rejected by Intl, and a report
  // dated in UTC would be wrong for the couple regardless.
  assert.equal(exporter.exportTimezone({ TZ: ':UTC' }), 'Asia/Jerusalem');
  assert.equal(exporter.exportTimezone({ TZ: 'UTC' }), 'Asia/Jerusalem');
  assert.equal(exporter.exportTimezone({ TZ: 'Not/AZone' }), 'Asia/Jerusalem');
  assert.equal(exporter.exportTimezone({ TZ: ':Europe/Paris' }), 'Europe/Paris', 'a colon-prefixed real zone is accepted');
  assert.equal(exporter.exportTimezone({ TZ: ':UTC', DAILY_EXPORT_TZ: 'Asia/Tokyo' }), 'Asia/Tokyo', 'an explicit zone still wins');
  assert.equal(exporter.exportTimezone({ DAILY_EXPORT_TZ: 'garbage' }), 'Asia/Jerusalem', 'an explicit but invalid zone is ignored');
});

test('the timezone is DAILY_EXPORT_TZ, then TZ, then Asia/Jerusalem', () => {
  assert.equal(exporter.exportTimezone({}), 'Asia/Jerusalem');
  assert.equal(exporter.exportTimezone({ TZ: 'Europe/Berlin' }), 'Europe/Berlin');
  assert.equal(
    exporter.exportTimezone({ TZ: 'Europe/Berlin', DAILY_EXPORT_TZ: 'Asia/Jerusalem' }),
    'Asia/Jerusalem',
  );
});

test('the workbook has the three RTL sheets with the right headers and row counts', () => {
  const { workbook, back, filePath, dir } = roundTrip();
  try {
    assert.deepEqual(back.SheetNames, [
      exporter.SHEETS.rsvp,
      exporter.SHEETS.pending,
      exporter.SHEETS.summary,
    ]);

    // Right-to-left: set per sheet on the live workbook…
    for (const name of workbook.SheetNames) {
      assert.deepEqual(workbook.Sheets[name]['!views'], [{ RTL: true }], `${name} !views`);
      assert.ok(workbook.Sheets[name]['!cols'].length > 0, `${name} !cols`);
    }
    // …and present in the file that was actually written.
    assert.deepEqual(back.Workbook.Views, [{ RTL: true }]);
    for (const entry of ['sheet1', 'sheet2', 'sheet3']) {
      const xml = String(back.files[`xl/worksheets/${entry}.xml`].content);
      assert.match(xml, /rightToLeft="1"/, `${entry} rightToLeft`);
    }
    // Column widths survive the round trip too.
    assert.equal(back.Sheets[exporter.SHEETS.rsvp]['!cols'].length, exporter.COL_WIDTHS.rsvp.length);

    const rsvp = aoa(back, exporter.SHEETS.rsvp);
    assert.deepEqual(rsvp[0], ['שם', 'טלפון', 'צד', 'מגיעים', 'כמות', 'תזונה', 'ברכה', 'תאריך']);
    assert.deepEqual(rsvp[0], exporter.HEADERS.rsvp);
    assert.equal(rsvp.length - 1, 4, 'one row per RSVP');

    const pending = aoa(back, exporter.SHEETS.pending);
    assert.deepEqual(pending[0], ['שם', 'טלפון', 'צד', 'קישור אישי']);
    assert.equal(pending.length - 1, 4, 'four invites with no answer');

    const summary = aoa(back, exporter.SHEETS.summary);
    assert.deepEqual(summary[0], ['צד', 'הזמנות', 'השיבו', 'מגיעים (אנשים)', 'לא מגיעים', 'טרם השיבו']);
    // four sides + the "no side" bucket (the walk-in) + the total row
    assert.equal(summary.length - 1, 6);
  } finally {
    exporter.cleanupExport({ dir });
    assert.equal(fs.existsSync(filePath), false);
  }
});

test('RSVP rows carry the answer, the party size, the diet, the blessing and a date', () => {
  const { back, dir } = roundTrip();
  try {
    const rows = aoa(back, exporter.SHEETS.rsvp).slice(1);
    const dani = rows.find((r) => r[0] === 'דני כהן');
    assert.deepEqual(dani.slice(0, 7), [
      'דני כהן',
      '0501111111',
      'הורי ורד', // side folded in from the matching invite
      'כן',
      '3',
      'צמחוני',
      'מזל טוב!',
    ]);
    assert.equal(dani[7], '04/09/2026 09:00'); // 06:00Z in Jerusalem

    const ruti = rows.find((r) => r[0] === 'רותי לוי');
    assert.equal(ruti[3], 'לא');
    assert.equal(ruti[4], '0');

    const walkIn = rows.find((r) => r[0] === 'אורח מזדמן');
    assert.equal(walkIn[2], exporter.UNKNOWN_SIDE, 'an RSVP with no invite has no side');
  } finally {
    exporter.cleanupExport({ dir });
  }
});

test('the pending sheet lists only unanswered invites, with their personal link', () => {
  const { back, dir } = roundTrip();
  try {
    const rows = aoa(back, exporter.SHEETS.pending).slice(1);
    assert.deepEqual(
      rows.map((r) => r[0]).sort(),
      ['אבי מור', 'בלי צד', 'משה פרץ', 'שרה אבן'].sort(),
    );
    const moshe = rows.find((r) => r[0] === 'משה פרץ');
    assert.deepEqual(moshe, ['משה פרץ', '0503333333', 'ורד', 'https://example.test/i/t3']);
  } finally {
    exporter.cleanupExport({ dir });
  }
});

test('the summary sheet adds up per side and in the total row', () => {
  const { back, dir } = roundTrip();
  try {
    const rows = aoa(back, exporter.SHEETS.summary).slice(1);
    const byLabel = new Map(rows.map((r) => [r[0], r.slice(1).map(Number)]));

    // [הזמנות, השיבו, מגיעים, לא מגיעים, טרם השיבו]
    assert.deepEqual(byLabel.get('הורי ורד'), [2, 1, 3, 0, 1]);
    assert.deepEqual(byLabel.get('הורי עידן'), [1, 1, 0, 1, 0]);
    assert.deepEqual(byLabel.get('ורד'), [1, 0, 0, 0, 1]);
    assert.deepEqual(byLabel.get('עידן'), [2, 1, 2, 0, 1]);
    assert.deepEqual(byLabel.get(exporter.UNKNOWN_SIDE), [1, 1, 1, 0, 0]);
    assert.deepEqual(byLabel.get(exporter.TOTAL_LABEL), [7, 4, 6, 1, 3]);
  } finally {
    exporter.cleanupExport({ dir });
  }
});

test('summarize counts the answers from the last 24 hours', () => {
  const summary = exporter.summarize({ invites, guests, now: NOW });
  assert.equal(summary.totals.invites, 7);
  assert.equal(summary.totals.responded, 4);
  assert.equal(summary.totals.coming, 6);
  assert.equal(summary.totals.last24h, 3);
});

test('the caption reports invites, answers, headcount and the last 24 hours', () => {
  const { summary } = exporter.buildWorkbook({ invites, guests, now: NOW, tz: TZ });
  const caption = exporter.buildCaption(summary, { now: NOW, tz: TZ });
  assert.match(caption, /04\/09\/2026/);
  assert.match(caption, /הזמנות: <b>7<\/b>/);
  assert.match(caption, /השיבו: <b>4<\/b>/);
  assert.match(caption, /מגיעים: <b>6<\/b>/);
  assert.match(caption, /24 השעות האחרונות: <b>3<\/b>/);
  assert.ok(caption.length < 1024, 'Telegram caps a document caption at 1024 chars');
  assert.doesNotMatch(caption, /חלק מהנתונים חסרים/);
  assert.match(exporter.buildCaption(summary, { now: NOW, tz: TZ, partial: true }), /חלק מהנתונים חסרים/);
});

test('an empty dataset still produces the three sheets', () => {
  const { back, dir, filePath } = roundTrip({ invites: [], guests: [] });
  try {
    assert.equal(back.SheetNames.length, 3);
    assert.equal(aoa(back, exporter.SHEETS.rsvp).length, 1, 'header only');
    assert.equal(aoa(back, exporter.SHEETS.pending).length, 1, 'header only');
    // four sides + total, no "no side" row because there is nothing in it
    assert.equal(aoa(back, exporter.SHEETS.summary).length - 1, 5);
  } finally {
    exporter.cleanupExport({ dir });
    assert.equal(fs.existsSync(filePath), false);
  }
});

test('the workbook is written under the OS temp dir and cleanup removes it', async () => {
  const built = await exporter.buildExport({
    now: NOW,
    tz: TZ,
    collect: async () => ({ invites, guests, stats: null, partial: false }),
  });
  assert.equal(built.fileName, 'wedding-rsvp-2026-09-04.xlsx');
  assert.equal(path.basename(built.filePath), built.fileName);
  assert.ok(
    path.resolve(built.filePath).startsWith(path.resolve(os.tmpdir())),
    `${built.filePath} should live under ${os.tmpdir()}`,
  );
  assert.ok(fs.existsSync(built.filePath));

  built.cleanup();
  assert.equal(fs.existsSync(built.filePath), false);
  assert.equal(fs.existsSync(built.dir), false);
});

test('buildExport bubbles up ExportDataError when the API gave nothing', async () => {
  await assert.rejects(
    () =>
      exporter.buildExport({
        now: NOW,
        collect: async () => {
          throw new exporter.ExportDataError('GET /api/invites לא קיים ב-API');
        },
      }),
    exporter.ExportDataError,
  );
});

test('collectData tolerates one dead source and throws only when both are dead', async () => {
  const api = require('../api');
  const original = { getInvites: api.getInvites, getGuests: api.getGuests, getStats: api.getStats };
  const boom = () => {
    throw new api.ApiError('GET /api/invites לא קיים ב-API', { status: 404, missing: true });
  };

  try {
    api.getInvites = boom;
    api.getGuests = async () => guests;
    api.getStats = boom;
    const partial = await exporter.collectData();
    assert.equal(partial.partial, true);
    assert.equal(partial.invites.length, 0);
    assert.equal(partial.guests.length, guests.length);

    api.getGuests = boom;
    await assert.rejects(() => exporter.collectData(), exporter.ExportDataError);
  } finally {
    Object.assign(api, original);
  }
});

test('the fallback notice is short Hebrew text naming the reason', () => {
  const notice = exporter.fallbackNotice(new Error('ה-API החזיר 500'), { now: NOW, tz: TZ });
  assert.match(notice, /הדוח היומי/);
  assert.match(notice, /04\/09\/2026/);
  assert.match(notice, /ה-API החזיר 500/);
  assert.match(notice, /\/export/);
  assert.ok(notice.length < 700);
});
