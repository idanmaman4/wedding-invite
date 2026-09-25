'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CHAR_LIMIT,
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
} = require('../format');
const { SIDES } = require('../api');

test('esc neutralises the three characters Telegram HTML cares about', () => {
  assert.equal(esc('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  // Hebrew and the ampersand in the couple's name survive intact
  assert.equal(esc('עידן & ורד'), 'עידן &amp; ורד');
});

test('esc escapes the ampersand first, so entities are not double-encoded', () => {
  assert.equal(esc('a & <b'), 'a &amp; &lt;b');
});

test('sideLabel maps every canonical key, and degrades gracefully', () => {
  for (const [key, label] of Object.entries(SIDES)) {
    assert.equal(sideLabel(key), label);
  }
  assert.equal(sideLabel('mystery'), 'mystery');
  // Nobody without a personal link has a side; they are all "other".
  assert.equal(sideLabel('other'), 'אחר');
  assert.equal(sideLabel(''), 'אחר');
  assert.equal(sideLabel(null), 'אחר');
  assert.equal(sideLabel(undefined), 'אחר');
});

test('a guest with no personal link is listed as "other", not blank', () => {
  const line = rsvpLine(1, { name: 'נכנס מהרחוב', attending: true, guests: 3, side: '', phone: '' });
  assert.ok(line.includes('צד אחר'), `expected an "other" side in: ${line}`);
});

test('formatStats gives the un-invited answers their own line', () => {
  const out = formatStats({
    invites: 2, responded: 3, not_responded: 0, coming: 7,
    by_side: {
      vered_parents: { invites: 1, responded: 1, coming: 2 },
      idan_parents: { invites: 0, responded: 0, coming: 0 },
      vered: { invites: 1, responded: 1, coming: 2 },
      idan: { invites: 0, responded: 0, coming: 0 },
      other: { invites: 0, responded: 1, coming: 3 },
    },
    unknown_side: 0, source: 'api',
  });
  assert.ok(out.includes('אחר'), 'the "other" bucket should have a line of its own');
  assert.ok(out.includes('מגיעים 3'));
});

test('formatStats leaves the "other" line out when nobody is in it', () => {
  const out = formatStats({
    invites: 1, responded: 1, not_responded: 0, coming: 2,
    by_side: {
      vered_parents: { invites: 1, responded: 1, coming: 2 },
      idan_parents: { invites: 0, responded: 0, coming: 0 },
      vered: { invites: 0, responded: 0, coming: 0 },
      idan: { invites: 0, responded: 0, coming: 0 },
      other: { invites: 0, responded: 0, coming: 0 },
    },
    unknown_side: 0, source: 'api',
  });
  assert.ok(!out.includes('ללא הזמנה אישית'), 'an empty bucket should not add noise');
});

test('parseSide accepts canonical keys', () => {
  for (const key of Object.keys(SIDES)) {
    assert.equal(parseSide(key), key);
  }
  assert.equal(parseSide('VERED_PARENTS'), 'vered_parents');
  assert.equal(parseSide('vered parents'), 'vered_parents');
  assert.equal(parseSide('vered-parents'), 'vered_parents');
});

test('parseSide accepts the exact Hebrew labels', () => {
  for (const [key, label] of Object.entries(SIDES)) {
    assert.equal(parseSide(label), key, `label ${label}`);
  }
});

test('parseSide accepts loose Hebrew phrasing', () => {
  assert.equal(parseSide('ורד'), 'vered');
  assert.equal(parseSide('עידן'), 'idan');
  assert.equal(parseSide('הורים של ורד'), 'vered_parents');
  assert.equal(parseSide('ההורים של עידן'), 'idan_parents');
});

test('parseSide refuses what it cannot tell apart', () => {
  assert.equal(parseSide(''), null);
  assert.equal(parseSide('   '), null);
  assert.equal(parseSide(null), null);
  assert.equal(parseSide('חבר מהצבא'), null);
  assert.equal(parseSide('ורד ועידן'), null, 'both names named — ambiguous');
});

test('sidesHelp lists every side with its key', () => {
  const help = sidesHelp();
  for (const [key, label] of Object.entries(SIDES)) {
    assert.ok(help.includes(key), `missing key ${key}`);
    assert.ok(help.includes(label), `missing label ${label}`);
  }
});

test('chunk says so when there is nothing to list', () => {
  const out = chunk('כותרת', []);
  assert.equal(out.length, 1);
  assert.ok(out[0].includes('(אין רשומות)'));
});

test('chunk keeps a short list in one message with no counter', () => {
  const out = chunk('כותרת', ['a', 'b', 'c']);
  assert.equal(out.length, 1);
  assert.ok(out[0].startsWith('כותרת\n\n'));
  assert.ok(!out[0].includes('(1/'));
});

test('chunk splits on the per-message item cap and numbers the parts', () => {
  const lines = Array.from({ length: 65 }, (_, i) => `line ${i}`);
  const out = chunk('כותרת', lines);
  assert.equal(out.length, 3);
  assert.ok(out[0].includes('(1/3)'));
  assert.ok(out[2].includes('(3/3)'));
});

test('chunk never drops a line', () => {
  const lines = Array.from({ length: 137 }, (_, i) => `line ${i}`);
  const joined = chunk('כותרת', lines).join('\n');
  for (const line of lines) assert.ok(joined.includes(line), `lost ${line}`);
});

test('chunk splits on the character limit before Telegram would reject it', () => {
  const long = 'x'.repeat(900);
  const out = chunk('כותרת', [long, long, long, long, long, long]);
  assert.ok(out.length > 1);
  for (const msg of out) {
    assert.ok(msg.length <= 4096, `message of ${msg.length} chars exceeds the Telegram cap`);
  }
});

test('chunk keeps a single over-long line rather than losing it', () => {
  const huge = 'y'.repeat(CHAR_LIMIT + 500);
  const out = chunk('כותרת', [huge]);
  assert.equal(out.length, 1);
  assert.ok(out[0].includes(huge));
});

test('rsvpLine shows attendance, count, side and phone', () => {
  const line = rsvpLine(1, { name: 'דוד', attending: true, guests: 3, side: 'idan', phone: '050-123-4567' });
  assert.ok(line.includes('1. ✅'));
  assert.ok(line.includes('<b>דוד</b>'));
  assert.ok(line.includes('3 אורחים'));
  assert.ok(line.includes(SIDES.idan));
  assert.ok(line.includes('050-123-4567'));
});

test('rsvpLine marks a decline and never claims a guest count', () => {
  const line = rsvpLine(2, { name: 'רונית', attending: false, guests: 0, phone: '' });
  assert.ok(line.includes('❌'));
  assert.ok(line.includes('לא מגיעים'));
  assert.ok(!line.includes('אורחים'));
  assert.ok(line.includes('—'), 'a missing phone renders as a dash');
});

test('rsvpLine defaults a zero guest count for an attendee to one', () => {
  assert.ok(rsvpLine(1, { name: 'x', attending: true, guests: 0 }).includes('1 אורחים'));
});

test('rsvpLine escapes a name that looks like markup', () => {
  const line = rsvpLine(1, { name: '<script>', attending: true, guests: 1 });
  assert.ok(line.includes('&lt;script&gt;'));
  assert.ok(!line.includes('<script>'));
});

test('rsvpLine falls back when the name is missing', () => {
  assert.ok(rsvpLine(1, { attending: true, guests: 1 }).includes('ללא שם'));
});

test('pendingLine carries the phone needed to chase somebody', () => {
  const line = pendingLine(4, { name: 'משה', side: 'vered_parents', phone: '0509999999' });
  assert.ok(line.startsWith('4. '));
  assert.ok(line.includes('משה'));
  assert.ok(line.includes(SIDES.vered_parents));
  assert.ok(line.includes('0509999999'));
});

test('formatStats reports the headline numbers and the per-side split', () => {
  const out = formatStats({
    invites: 40,
    responded: 25,
    not_responded: 15,
    coming: 61,
    by_side: {
      vered_parents: { invites: 10, responded: 7, coming: 18 },
      idan_parents: { invites: 10, responded: 6, coming: 15 },
      vered: { invites: 10, responded: 6, coming: 14 },
      idan: { invites: 10, responded: 6, coming: 14 },
    },
    unknown_side: 0,
    source: 'invites',
  });
  assert.ok(out.includes('הזמנות שנשלחו: <b>40</b>'));
  assert.ok(out.includes('ענו: <b>25</b>'));
  assert.ok(out.includes('טרם ענו: <b>15</b>'));
  assert.ok(out.includes('סה״כ אנשים שמגיעים: <b>61</b>'));
  for (const label of Object.values(SIDES)) assert.ok(out.includes(label), `missing ${label}`);
});

test('formatStats omits invite counts the API could not supply', () => {
  const out = formatStats({ invites: null, responded: 5, not_responded: null, coming: 12, by_side: null, source: 'guests' });
  assert.ok(!out.includes('הזמנות שנשלחו'));
  assert.ok(!out.includes('טרם ענו'));
  assert.ok(out.includes('ענו: <b>5</b>'));
  assert.ok(out.includes('פילוח לפי צד יהיה זמין'));
  assert.ok(out.includes('רשימת המאשרים בלבד'), 'the guests-only caveat must be shown');
});

test('formatStats notes guests with no side assigned', () => {
  const out = formatStats({
    invites: 3, responded: 3, not_responded: 0, coming: 5,
    by_side: { vered_parents: { invites: 1, responded: 1, coming: 2 } },
    unknown_side: 2, source: 'invites',
  });
  assert.ok(out.includes('ללא צד מוגדר — 2'));
});

test('formatRsvpNotification celebrates an acceptance', () => {
  const out = formatRsvpNotification({ name: 'דוד כהן', attending: true, guests: 4, side: 'idan', phone: '0501234567', message: 'מזל טוב!' });
  assert.ok(out.includes('אישור הגעה חדש'));
  assert.ok(out.includes('דוד כהן'));
  assert.ok(out.includes('4 אורחים'));
  assert.ok(out.includes(SIDES.idan));
  assert.ok(out.includes('0501234567'));
  assert.ok(out.includes('מזל טוב!'));
});

test('formatRsvpNotification reports a decline without a guest count', () => {
  const out = formatRsvpNotification({ name: 'רונית', attending: false, guests: 0, side: 'vered' });
  assert.ok(out.includes('לא יוכלו להגיע'));
  assert.ok(!out.includes('אורחים'));
});

test('formatRsvpNotification accepts the truthy shapes the API may send', () => {
  for (const attending of [true, 'true', 1]) {
    assert.ok(formatRsvpNotification({ name: 'x', attending, guests: 2 }).includes('אישור הגעה חדש'), String(attending));
  }
  for (const attending of [false, 'false', 0, null, undefined]) {
    assert.ok(formatRsvpNotification({ name: 'x', attending }).includes('לא יוכלו להגיע'), String(attending));
  }
});

test('formatRsvpNotification survives an empty payload', () => {
  const out = formatRsvpNotification({});
  assert.ok(out.includes('אורח/ת'));
});

test('formatRsvpNotification escapes a hostile blessing', () => {
  const out = formatRsvpNotification({ name: 'x', attending: true, message: '<img src=x>' });
  assert.ok(out.includes('&lt;img src=x&gt;'));
  assert.ok(!out.includes('<img'));
});

test('buildInvitationText matches the confirmed wedding facts and carries the link', () => {
  const text = buildInvitationText('דוד', 'https://example.test/?i=abc');
  assert.ok(text.includes('שלום דוד,'));
  assert.ok(text.includes('25.10.2026'));
  assert.ok(text.includes('י״ד בחשוון תשפ״ז'));
  assert.ok(text.includes('18:30'));
  assert.ok(text.includes('19:30'));
  assert.ok(text.includes('אולם האירועים תרין'));
  assert.ok(text.includes('15 באוקטובר 2026'));
  assert.ok(text.includes('https://example.test/?i=abc'));
  assert.ok(buildInvitationText('', 'u').includes('שלום,'));
});

test('HELP documents every command the bot answers', () => {
  for (const cmd of ['/start', '/stop', '/stats', '/rsvps', '/pending', '/search', '/invite', '/export', '/exportall', '/whoami', '/help']) {
    assert.ok(HELP.includes(cmd), `HELP is missing ${cmd}`);
  }
});

test('whatsappShareUrl opens the guest chat with the text written', () => {
  const { whatsappShareUrl } = require('../format');
  const text = 'שלום! https://x/?i=1';
  const q = `?text=${encodeURIComponent(text)}`;
  // Israeli numbers in every spelling a contact card or a person uses.
  for (const p of ['050-111-2233', '0501112233', '+972 50-111-2233', '972501112233', '00972501112233']) {
    assert.equal(whatsappShareUrl(p, text), `https://wa.me/972501112233${q}`, p);
  }
  // A foreign number keeps its own country code.
  assert.equal(whatsappShareUrl('+44 7700 900123', text), `https://wa.me/447700900123${q}`);
  // No number: WhatsApp lets the couple choose the chat.
  assert.equal(whatsappShareUrl('', text), `https://wa.me/${q}`);
});

test('a cancellation says who and how many seats it frees', () => {
  const { formatRsvpNotification } = require('../format');
  const text = formatRsvpNotification({ name: 'משפחת לוי', attending: false, guests: 4, side: 'vered', cancelled: true });
  assert.ok(text.includes('ביטול הגעה'));
  assert.ok(text.includes('משפחת לוי') && text.includes('היו רשומים 4'));
  assert.ok(!text.includes('לא יוכלו להגיע'), 'not worded as a fresh decline');
});
