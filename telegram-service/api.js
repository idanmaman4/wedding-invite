'use strict';

/**
 * Thin client for the wedding site's admin API.
 *
 * Every call goes out with the X-Admin-Password header. The invites half of
 * the API is still being built, so a 404 is a first-class, expected outcome:
 * it is surfaced as `ApiError.missing === true` and the bot turns that into a
 * "this isn't exposed yet" reply instead of crashing.
 */

// On Vercel only SITE_URL is set (the bot and the API are one deployment), so
// it stands in for API_BASE; without either, the production alias.
const API_BASE = (process.env.API_BASE || process.env.SITE_URL || 'https://wedding-invite-sand-kappa.vercel.app').replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TIMEOUT_MS = Number(process.env.API_TIMEOUT_MS || 15000);

/** Canonical side keys → Hebrew labels. */
const SIDES = {
  vered_parents: 'הורי ורד',
  idan_parents: 'הורי עידן',
  vered: 'ורד',
  idan: 'עידן',
};

class ApiError extends Error {
  constructor(message, { status = 0, missing = false, unauthorized = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.missing = missing;
    this.unauthorized = unauthorized;
  }
}

async function request(method, path, body) {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'X-Admin-Password': ADMIN_PASSWORD,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ApiError(
      err.name === 'AbortError' ? `הבקשה ל-${path} לא נענתה בזמן` : `לא הצלחתי להתחבר ל-API (${err.message})`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    throw new ApiError(`${method} ${path} לא קיים ב-API`, { status: 404, missing: true });
  }
  if (res.status === 401 || res.status === 403) {
    throw new ApiError('ה-API דחה את סיסמת המנהל (ADMIN_PASSWORD)', {
      status: res.status,
      unauthorized: true,
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`ה-API החזיר ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, {
      status: res.status,
    });
  }

  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(`תשובה לא תקינה מ-${path}`, { status: res.status });
  }
}

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Contract: each row is {token, name, phone, side, url, responded, attending,
 * guests}. `guest_id` and `created_at` are extras the export needs to join an
 * invite to its RSVP row and to date it; both are optional in the payload.
 */
/** A personal link in the one shape the site understands. */
const inviteUrl = (token) => `${API_BASE}/?i=${encodeURIComponent(token)}`;
/** The printed invitation card (public/media), sent with every invitation. */
const invitationCardUrl = () => `${API_BASE}/media/invitation-card.jpg`;

function normalizeInvite(row) {
  return {
    token: row.token || '',
    name: (row.name || '').trim(),
    phone: (row.phone || '').trim(),
    side: row.side || '',
    // The site reads the token from `?i=` (see src/store/rsvp.js); a `/i/<token>`
    // path would open the home page with no invitation attached.
    url: row.url || (row.token ? inviteUrl(row.token) : ''),
    responded: Boolean(row.responded),
    attending: row.attending === null || row.attending === undefined ? null : Boolean(row.attending),
    guests: num(row.guests, 0),
    guest_id: row.guest_id === undefined || row.guest_id === null ? null : row.guest_id,
    created_at: row.created_at || '',
  };
}

function normalizeGuest(row) {
  return {
    id: row.id,
    name: (row.name || '').trim(),
    phone: (row.phone || '').trim(),
    attending: Boolean(row.attending),
    guests: num(row.guests, 1),
    message: (row.message || '').trim(),
    side: row.side || '',
    // The API spells it `dietary`; older/other shapes are accepted too.
    dietary: String(row.dietary || row.diet || row.dietary_restrictions || '').trim(),
    created_at: row.created_at || row.createdAt || '',
  };
}

async function getInvites() {
  const data = await request('GET', '/api/invites');
  const rows = Array.isArray(data) ? data : Array.isArray(data && data.invites) ? data.invites : [];
  return rows.map(normalizeInvite);
}

async function getGuests() {
  const data = await request('GET', '/api/guests');
  const rows = Array.isArray(data) ? data : Array.isArray(data && data.guests) ? data.guests : [];
  return rows.map(normalizeGuest);
}

async function createInvite({ name, phone, side }) {
  const data = await request('POST', '/api/invites', { name, phone, side });
  if (!data || typeof data !== 'object') {
    throw new ApiError('ה-API יצר את ההזמנה אבל לא החזיר טוקן');
  }
  return normalizeInvite(data);
}

/** Rename an invite or move it to another side; its link stays the same. */
async function updateInvite(token, fields) {
  const data = await request('PATCH', `/api/invites/${encodeURIComponent(token)}`, fields);
  if (!data || typeof data !== 'object') {
    throw new ApiError('ה-API לא החזיר את ההזמנה המעודכנת');
  }
  return normalizeInvite(data);
}

/** Derive the whole stats block from the invite rows (the richest source). */
function statsFromInvites(invites) {
  const bySide = {};
  for (const key of Object.keys(SIDES)) {
    bySide[key] = { invites: 0, responded: 0, coming: 0 };
  }
  let responded = 0;
  let coming = 0;
  let attendingCount = 0;

  for (const inv of invites) {
    const key = Object.prototype.hasOwnProperty.call(SIDES, inv.side) ? inv.side : null;
    if (key) bySide[key].invites += 1;
    if (inv.responded) {
      responded += 1;
      if (key) bySide[key].responded += 1;
      if (inv.attending) {
        attendingCount += 1;
        const n = inv.guests > 0 ? inv.guests : 1;
        coming += n;
        if (key) bySide[key].coming += n;
      }
    }
  }

  const unknownSide = invites.filter((i) => !Object.prototype.hasOwnProperty.call(SIDES, i.side)).length;

  return {
    source: 'invites',
    invites: invites.length,
    responded,
    not_responded: invites.length - responded,
    attending_invites: attendingCount,
    coming,
    by_side: bySide,
    unknown_side: unknownSide,
  };
}

/** Fallback when there are no invite rows — RSVPs alone still give totals. */
function statsFromGuests(guests) {
  let coming = 0;
  let attendingCount = 0;
  for (const g of guests) {
    if (g.attending) {
      attendingCount += 1;
      coming += g.guests > 0 ? g.guests : 1;
    }
  }
  return {
    source: 'guests',
    invites: null,
    responded: guests.length,
    not_responded: null,
    attending_invites: attendingCount,
    coming,
    by_side: null,
    unknown_side: 0,
  };
}

/**
 * Worth trying the next source? A missing endpoint, a server-side 500 (the API
 * is redeployed often) or a network blip all qualify; a rejected password does
 * not — every source would reject it the same way.
 */
function isRecoverable(err) {
  return err instanceof ApiError && !err.unauthorized && (err.missing || err.status === 0 || err.status >= 500);
}

/**
 * Try the purpose-built /api/stats first; fall back to deriving everything
 * from /api/invites, then from /api/guests. Throws only when nothing answers.
 */
async function getStats() {
  try {
    const data = await request('GET', '/api/stats');
    const normalized = normalizeServerStats(data);
    if (normalized) return normalized;
  } catch (err) {
    if (!isRecoverable(err)) throw err;
  }

  try {
    return statsFromInvites(await getInvites());
  } catch (err) {
    if (!isRecoverable(err)) throw err;
  }

  return statsFromGuests(await getGuests());
}

/**
 * /api/stats is being written by someone else, so read it leniently: accept a
 * handful of plausible key spellings and return null (→ fall back) if nothing
 * recognisable is in there.
 */
function normalizeServerStats(data) {
  if (!data || typeof data !== 'object') return null;
  const pick = (...keys) => {
    for (const k of keys) {
      if (data[k] !== undefined && data[k] !== null) return data[k];
    }
    return undefined;
  };

  const invites = pick('invites', 'total_invites', 'invites_total');
  const responded = pick('responded', 'responses', 'rsvps', 'total_responded');
  // `total_people` is what this site's /api/stats actually calls it; the rest
  // are spellings other shapes have used.
  const coming = pick('total_people', 'coming', 'total_coming', 'total_guests', 'attending_people', 'people');

  if (invites === undefined && responded === undefined && coming === undefined) return null;

  const rawSides = pick('by_side', 'sides', 'per_side');
  let bySide = null;
  if (rawSides && typeof rawSides === 'object') {
    bySide = {};
    // "other" is not an invitable side, but the API reports it: it holds the
    // guests who answered without a personal link, and they must be shown.
    for (const key of [...Object.keys(SIDES), 'other']) {
      const entry = rawSides[key];
      if (entry && typeof entry === 'object') {
        bySide[key] = {
          invites: num(entry.invites ?? entry.total, 0),
          responded: num(entry.responded ?? entry.responses, 0),
          coming: num(entry.total_people ?? entry.coming ?? entry.guests ?? entry.people, 0),
        };
      } else {
        bySide[key] = { invites: 0, responded: 0, coming: num(entry, 0) };
      }
    }
  }

  const notResponded = pick('not_responded', 'pending', 'no_response');

  return {
    source: 'api',
    invites: invites === undefined ? null : num(invites),
    responded: num(responded, 0),
    not_responded:
      notResponded !== undefined
        ? num(notResponded)
        : invites === undefined
          ? null
          : num(invites) - num(responded, 0),
    attending_invites: num(pick('attending_responses', 'attending', 'attending_invites'), 0),
    coming: num(coming, 0),
    by_side: bySide,
    unknown_side: 0,
  };
}

module.exports = {
  API_BASE,
  SIDES,
  ApiError,
  request,
  getInvites,
  getGuests,
  getStats,
  createInvite,
  updateInvite,
  inviteUrl,
  invitationCardUrl,
  statsFromInvites,
  statsFromGuests,
  isRecoverable,
};
