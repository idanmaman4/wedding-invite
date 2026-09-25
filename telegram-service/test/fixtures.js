'use strict';

/**
 * Synthetic rows shaped exactly like api.normalizeInvite / api.normalizeGuest
 * output. No network, no real people.
 */

const NOW = new Date('2026-09-04T12:00:00Z'); // 15:00 Asia/Jerusalem

const invite = (over) => ({
  token: '',
  name: '',
  phone: '',
  side: '',
  url: '',
  responded: false,
  attending: null,
  guests: 0,
  guest_id: null,
  created_at: '',
  ...over,
});

const guest = (over) => ({
  id: null,
  name: '',
  phone: '',
  attending: false,
  guests: 1,
  message: '',
  side: '',
  dietary: '',
  created_at: '',
  ...over,
});

// 7 invites: 3 answered, 4 still waiting (one of them with no side at all).
const invites = [
  invite({
    token: 't1',
    name: 'דני כהן',
    phone: '0501111111',
    side: 'vered_parents',
    url: 'https://example.test/i/t1',
    responded: true,
    attending: true,
    guests: 3,
    guest_id: 11,
    created_at: '2026-09-01T08:00:00Z',
  }),
  invite({
    token: 't2',
    name: 'רותי לוי',
    phone: '0502222222',
    side: 'idan_parents',
    url: 'https://example.test/i/t2',
    responded: true,
    attending: false,
    guest_id: 12,
  }),
  invite({ token: 't3', name: 'משה פרץ', phone: '0503333333', side: 'vered', url: 'https://example.test/i/t3' }),
  invite({ token: 't4', name: 'שרה אבן', phone: '0504444444', side: 'idan', url: 'https://example.test/i/t4' }),
  invite({ token: 't5', name: 'אבי מור', phone: '0505555555', side: 'vered_parents', url: 'https://example.test/i/t5' }),
  invite({
    token: 't6',
    name: 'נועה שגב',
    phone: '0506666666',
    side: 'idan',
    url: 'https://example.test/i/t6',
    responded: true,
    attending: true,
    guests: 2,
    guest_id: 13,
  }),
  invite({ token: 't7', name: 'בלי צד', phone: '0507777777', side: '', url: 'https://example.test/i/t7' }),
];

// 4 RSVP rows: three joined to invites by guest_id, one walk-in with no invite.
const guests = [
  guest({
    id: 11,
    name: 'דני כהן',
    phone: '0501111111',
    attending: true,
    guests: 3,
    dietary: 'צמחוני',
    message: 'מזל טוב!',
    created_at: '2026-09-04T06:00:00Z', // inside the last 24h
  }),
  guest({
    id: 12,
    name: 'רותי לוי',
    phone: '0502222222',
    attending: false,
    guests: 0,
    message: 'סליחה, לא נוכל',
    created_at: '2026-09-01T10:00:00Z', // older than 24h
  }),
  guest({
    id: 13,
    name: 'נועה שגב',
    phone: '0506666666',
    attending: true,
    guests: 2,
    created_at: '2026-09-03T20:00:00Z', // inside the last 24h
  }),
  guest({
    id: 14,
    name: 'אורח מזדמן',
    phone: '0509999999',
    attending: true,
    guests: 1,
    created_at: '2026-09-04T09:00:00Z', // inside the last 24h
  }),
];

module.exports = { NOW, invite, guest, invites, guests };
