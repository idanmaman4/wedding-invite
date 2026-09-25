'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePhone,
  toChatId,
  maskPhone,
  coarse,
  buildInviteMessage,
  shapeContacts,
  delayWindow,
} = require('../app');
const { contact } = require('./helpers');

test('normalizePhone: Israeli mobiles in every shape people type them', () => {
  const expected = '972501234567';
  for (const input of [
    '0501234567',
    '050-123-4567',
    '050 123 4567',
    '(050) 123-4567',
    '+972501234567',
    '+972-50-123-4567',
    '972501234567',
    '00972501234567',
    '501234567',            // bare mobile, no leading zero
    '+972 0 50 123 4567',   // stray zero after the country code
    ' 050-1234567 ',
  ]) {
    assert.equal(normalizePhone(input), expected, `failed for ${JSON.stringify(input)}`);
  }
});

test('normalizePhone: strips RTL marks pasted from Hebrew contact lists', () => {
  assert.equal(normalizePhone('‎050-123-4567‏'), '972501234567');
});

test('normalizePhone: keeps genuine foreign numbers international', () => {
  assert.equal(normalizePhone('+1 415 555 0132'), '14155550132');
  assert.equal(normalizePhone('+44 20 7946 0958'), '442079460958');
});

test('normalizePhone: rejects what cannot be a number', () => {
  for (const input of [null, undefined, '', '   ', 'abc', '12345', '-', '+', '0', '1'.repeat(16)]) {
    assert.equal(normalizePhone(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

test('normalizePhone: a landline keeps its area code', () => {
  assert.equal(normalizePhone('03-1234567'), '97231234567');
});

test('toChatId appends the WhatsApp suffix, or gives up', () => {
  assert.equal(toChatId('050-123-4567'), '972501234567@c.us');
  assert.equal(toChatId('nope'), null);
});

test('maskPhone never reveals the middle digits', () => {
  const masked = maskPhone('0501234567');
  assert.equal(masked, '05012***67');
  assert.ok(!masked.includes('1234567'));
  assert.equal(maskPhone('12'), '***');
  assert.equal(maskPhone(null), '***');
});

test('coarse collapses the internal statuses to what the panel renders', () => {
  assert.equal(coarse('connected'), 'ready');
  assert.equal(coarse('awaiting_scan'), 'qr');
  for (const s of ['disconnected', 'initializing', 'auth_failed', 'error', undefined]) {
    assert.equal(coarse(s), 'offline');
  }
});

test('buildInviteMessage carries the confirmed wedding facts', () => {
  const msg = buildInviteMessage('דוד', 'https://example.test');
  assert.ok(msg.includes('שלום דוד,'));
  assert.ok(msg.includes('25.10.2026'));
  assert.ok(msg.includes('י״ד בחשוון תשפ״ז'));
  assert.ok(msg.includes('18:30'));
  assert.ok(msg.includes('19:30'));
  assert.ok(msg.includes('אליעזר מזל 6'));
  assert.ok(msg.includes('15 באוקטובר 2026'));
  assert.ok(msg.includes('https://example.test'));
});

test('buildInviteMessage without a name still greets', () => {
  assert.ok(buildInviteMessage('', 'https://example.test').includes('שלום,'));
});

test('shapeContacts keeps saved one-to-one contacts only', () => {
  const rows = shapeContacts([
    contact({ user: '972501111111', name: 'אבי' }),
    contact({ user: '972502222222', name: 'קבוצה', isGroup: true }),
    contact({ user: '972503333333', name: 'אני', isMe: true }),
    contact({ user: '972504444444', name: 'לא שמור', isMyContact: false }),
    { id: { _serialized: 'status@broadcast', user: 'status', server: 'broadcast' }, number: 'status', isMyContact: true },
  ]);
  assert.deepEqual(rows.map((r) => r.number), ['972501111111']);
});

test('shapeContacts de-duplicates and falls back through the name fields', () => {
  const dup = contact({ user: '972505555555', name: 'כפול' });
  const rows = shapeContacts([
    dup,
    dup,
    contact({ user: '972506666666', name: undefined, pushname: 'פוש' }),
    contact({ user: '972507777777', name: undefined, pushname: undefined, verifiedName: 'מאומת' }),
  ]);
  assert.equal(rows.length, 3);
  assert.ok(rows.some((r) => r.name === 'פוש'));
  assert.ok(rows.some((r) => r.name === 'מאומת'));
});

test('shapeContacts filters on the query across name and number', () => {
  const list = [
    contact({ user: '972501111111', name: 'דוד כהן' }),
    contact({ user: '972509999999', name: 'רונית' }),
  ];
  assert.equal(shapeContacts(list, 'דוד').length, 1);
  assert.equal(shapeContacts(list, '9999').length, 1);
  assert.equal(shapeContacts(list, 'nothing').length, 0);
  assert.equal(shapeContacts(list, '  ').length, 2, 'blank query must not filter');
});

test('shapeContacts sorts by Hebrew collation', () => {
  const rows = shapeContacts([
    contact({ user: '972501111111', name: 'תמר' }),
    contact({ user: '972502222222', name: 'אבי' }),
    contact({ user: '972503333333', name: 'מיכל' }),
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['אבי', 'מיכל', 'תמר']);
});

test('delayWindow: defaults, explicit centre, explicit bounds, inverted bounds', () => {
  assert.deepEqual(delayWindow({}, 3000, 7000), { minDelay: 3000, maxDelay: 7000 });
  // delayMs is the centre of a ±40% jitter
  assert.deepEqual(delayWindow({ delayMs: 1000 }, 3000, 7000), { minDelay: 600, maxDelay: 1400 });
  assert.deepEqual(delayWindow({ minDelayMs: 10, maxDelayMs: 20 }, 3000, 7000), { minDelay: 10, maxDelay: 20 });
  // a max below the min is clamped up, never negative
  assert.deepEqual(delayWindow({ minDelayMs: 500, maxDelayMs: 100 }, 3000, 7000), { minDelay: 500, maxDelay: 500 });
  assert.deepEqual(delayWindow({ minDelayMs: 0, maxDelayMs: 0 }, 3000, 7000), { minDelay: 0, maxDelay: 0 });
});
