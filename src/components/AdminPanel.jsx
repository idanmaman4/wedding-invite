import { createSignal, onMount, onCleanup, Show, For } from 'solid-js';

const API = '/api';

// Invite "sides" — keys are what the API stores, labels are what the admin sees.
const SIDES = ['vered_parents', 'idan_parents', 'vered', 'idan'];
// "other" is not a side anybody can be invited as — it is where guests who
// answered without a personal link end up, so the breakdown still adds up.
const OTHER_SIDE = 'other';
const SIDES_WITH_OTHER = [...SIDES, OTHER_SIDE];
const SIDE_LABELS = {
  vered_parents: 'הורי ורד',
  idan_parents: 'הורי עידן',
  vered: 'ורד',
  idan: 'עידן',
  other: 'אחר',
};
const sideLabel = (s) => SIDE_LABELS[s] || s || SIDE_LABELS.other;
// The bulk textarea accepts either the key or the Hebrew label.
const SIDE_FROM_LABEL = Object.fromEntries(Object.entries(SIDE_LABELS).map(([k, v]) => [v, k]));
const parseSide = (raw) => {
  const v = String(raw || '').trim();
  return SIDE_FROM_LABEL[v] || (SIDES.includes(v) ? v : '');
};

// Guest-table filters.
const STATUS_FILTERS = [
  ['all', 'הכול'],
  ['attending', 'אישרו'],
  ['declined', 'לא מגיעים'],
  ['pending', 'טרם השיבו'],
];
// Israeli numbers arrive in every shape; compare them by their digits only.
const waDigits = (raw) => {
  let s = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('972')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  return s;
};
// ── The ledger ───────────────────────────────────────────────────────────────
// Colour carries meaning here and nowhere else: red is a person who is coming,
// gold is an invitation still waiting for an answer, faded ink is a decline.
// The same three appear in the rail, the chips and the table, so a glance at
// any of them reads the same way.
const INK = '#1A0A0A';
const COMING = '#B22222';
const WAITING = '#C9A96E';
const DECLINED = 'rgba(26,10,10,0.28)';

const RSVP_DEADLINE = new Date('2026-10-15T23:59:59+03:00');
const WEDDING_DAY = new Date('2026-10-25T18:30:00+03:00');

// Calendar days in Israel, not rounded-up 24h spans: on the morning of 25.9
// the wedding (25.10) is 30 days away, not 31.
const israelDay = (d) => Date.parse(`${d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })}T00:00:00Z`);
const daysUntil = (date) => Math.round((israelDay(date) - israelDay(new Date())) / 86400000);

/** Numbers are for comparing, so they get tabular figures everywhere. */
const FIGURES = 'font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1;';

/**
 * The one number the couple actually needs: how many chairs to book. Everything
 * else on the page is a way of explaining or chasing this figure, so it is the
 * only thing set at display size.
 */
function SeatingLedger(props) {
  const sides = () => props.stats && props.stats.by_side ? props.stats.by_side : null;
  const coming = () => (props.stats ? props.stats.total_people : props.fallbackPeople) || 0;
  const waiting = () => (props.stats ? props.stats.not_responded : props.fallbackPending) || 0;
  const declined = () => (props.stats ? props.stats.declined : 0) || 0;

  // Each side's share of the people who are coming. Sides nobody has answered
  // for get no segment at all rather than a sliver.
  const segments = () => {
    const by = sides();
    if (!by) return [];
    const total = coming();
    if (!total) return [];
    return props.sideKeys
      .map((key) => ({ key, label: props.sideLabel(key), people: (by[key] || {}).total_people || 0 }))
      .filter((s) => s.people > 0)
      .map((s) => ({ ...s, pct: (s.people / total) * 100 }));
  };

  const deadlineDays = () => daysUntil(RSVP_DEADLINE);
  const weddingDays = () => daysUntil(WEDDING_DAY);

  return (
    <section
      class="mb-10 px-6 py-8 md:px-10 md:py-10"
      style={`border: 1px solid rgba(178,34,34,0.18); background: linear-gradient(180deg, rgba(178,34,34,0.035), rgba(201,169,110,0.05));`}
      aria-label="סיכום הגעה"
    >
      <div class="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
        <div>
          <p class="font-sans text-xs tracking-[0.18em] mb-3" style={`color: ${COMING}`}>מקומות לשריין</p>
          <p
            class="font-serif font-light leading-none"
            style={`color: ${INK}; font-size: clamp(3.5rem, 12vw, 5.5rem); ${FIGURES}`}
          >
            {coming()}
          </p>
        </div>

        <dl class="flex gap-x-10 gap-y-4 flex-wrap">
          <div>
            <dt class="font-sans text-xs tracking-[0.14em] mb-1.5" style="color: rgba(26,10,10,0.45)">אישרו</dt>
            <dd class="font-serif text-3xl font-light" style={`color: ${COMING}; ${FIGURES}`}>
              {(props.stats ? props.stats.attending_responses : props.fallbackAttending) || 0}
            </dd>
          </div>
          <div>
            <dt class="font-sans text-xs tracking-[0.14em] mb-1.5" style="color: rgba(26,10,10,0.45)">טרם השיבו</dt>
            <dd class="font-serif text-3xl font-light" style={`color: ${WAITING}; ${FIGURES}`}>{waiting()}</dd>
          </div>
          <div>
            <dt class="font-sans text-xs tracking-[0.14em] mb-1.5" style="color: rgba(26,10,10,0.45)">לא מגיעים</dt>
            <dd class="font-serif text-3xl font-light" style={`color: ${DECLINED}; ${FIGURES}`}>{declined()}</dd>
          </div>
        </dl>
      </div>

      {/* The rail: who those chairs belong to. */}
      <Show when={segments().length > 0}>
        <div class="mt-8">
          <div
            class="flex w-full overflow-hidden"
            style="height: 10px; background: rgba(26,10,10,0.06)"
            role="img"
            aria-label={`חלוקת המגיעים לפי צד: ${segments().map((s) => `${s.label} ${s.people}`).join(', ')}`}
          >
            <For each={segments()}>
              {(seg, i) => (
                <div
                  style={`width: ${seg.pct}%; background: ${COMING}; opacity: ${1 - i() * 0.17};`}
                  title={`${seg.label} — ${seg.people}`}
                />
              )}
            </For>
          </div>
          <div class="flex flex-wrap gap-x-6 gap-y-2 mt-3">
            <For each={segments()}>
              {(seg, i) => (
                <span class="font-sans text-xs" style="color: rgba(26,10,10,0.55)">
                  <span
                    class="inline-block align-middle ms-1.5"
                    style={`width: 8px; height: 8px; background: ${COMING}; opacity: ${1 - i() * 0.17}`}
                  />
                  {seg.label}
                  <span style={`color: ${INK}; ${FIGURES}`}> {seg.people}</span>
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* The only two dates that matter, and they are running down. */}
      <div
        class="flex flex-wrap gap-x-8 gap-y-2 mt-8 pt-6 font-sans text-sm"
        style="border-top: 1px solid rgba(178,34,34,0.12); color: rgba(26,10,10,0.5)"
      >
        <Show
          when={deadlineDays() > 0}
          fallback={<span>מועד אישור ההגעה עבר · 15.10.2026</span>}
        >
          <span>
            <span style={`color: ${COMING}; ${FIGURES}`}>{deadlineDays()}</span> ימים לסגירת אישורי ההגעה
          </span>
        </Show>
        <Show when={weddingDays() > 0}>
          <span>
            <span style={`color: ${INK}; ${FIGURES}`}>{weddingDays()}</span> ימים לחתונה
          </span>
        </Show>
      </div>
    </section>
  );
}


export default function AdminPanel() {
  const [locked, setLocked] = createSignal(true);
  const [password, setPassword] = createSignal('');
  const [authError, setAuthError] = createSignal('');
  const [unlocking, setUnlocking] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal('guests'); // 'guests' | 'invites'

  // Guests state
  const [guests, setGuests] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [fetchError, setFetchError] = createSignal('');
  const [deletingId, setDeletingId] = createSignal(null);
  const [statusFilter, setStatusFilter] = createSignal('all');
  const [sideFilter, setSideFilter] = createSignal('all');

  // Invites state
  const [invites, setInvites] = createSignal([]);
  const [stats, setStats] = createSignal(null);
  const [invLoading, setInvLoading] = createSignal(false);
  const [invError, setInvError] = createSignal('');
  const [invName, setInvName] = createSignal('');
  const [invPhone, setInvPhone] = createSignal('');
  const [invSide, setInvSide] = createSignal('vered_parents');
  const [invCreating, setInvCreating] = createSignal(false);
  const [bulkText, setBulkText] = createSignal('');
  const [bulkBusy, setBulkBusy] = createSignal(false);
  const [bulkNote, setBulkNote] = createSignal('');
  const [copiedToken, setCopiedToken] = createSignal('');
  const [exporting, setExporting] = createSignal(false);

  const attendingCount = () => guests().filter((g) => g.attending === 1 || g.attending === true).length;
  const declinedCount = () => guests().filter((g) => g.attending === 0 || g.attending === false).length;
  // Total people expected: the party size of every attending reply (older rows
  // predate the count and fall back to 1, or 2 when the legacy plus_one was set).
  const partySize = (g) => Number(g.guests) || ((g.plus_one === 1 || g.plus_one === true) ? 2 : 1);
  const totalAttendingPeople = () => guests().filter((g) => g.attending === 1 || g.attending === true).reduce((n, g) => n + partySize(g), 0);

  // Whatever was typed at the gate is what every request carries. The API is
  // the only authority on whether it is right — nothing is hardcoded here,
  // because anything in this file ships to every visitor in the bundle.
  const adminHeaders = () => ({ 'X-Admin-Password': password(), 'Content-Type': 'application/json' });

  // ── Guests ────────────────────────────────────────────────────────────────
  const fetchGuests = async () => {
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch(`${API}/guests`, { headers: adminHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGuests(await res.json());
    } catch (err) {
      setFetchError(err.message || 'טעינת רשימת האורחים נכשלה.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('להסיר את האורח/ת מהרשימה?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API}/guests/${id}`, { method: 'DELETE', headers: adminHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGuests((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      alert(`המחיקה נכשלה: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
    // The freed invite goes back to "טרם השיבו".
    refreshInvites();
  };

  // ── Invites ───────────────────────────────────────────────────────────────
  const fetchInvites = async () => {
    setInvLoading(true);
    setInvError('');
    try {
      const res = await fetch(`${API}/invites`, { headers: adminHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInvites(await res.json());
    } catch (err) {
      setInvError(err.message || 'טעינת ההזמנות נכשלה.');
    } finally {
      setInvLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API}/stats`, { headers: adminHeaders() });
      if (res.ok) setStats(await res.json());
    } catch {}
  };

  const refreshInvites = async () => { await Promise.all([fetchInvites(), fetchStats()]); };
  const refreshAll = async () => { await Promise.all([fetchGuests(), refreshInvites()]); };

  const createInvite = async (e) => {
    if (e) e.preventDefault();
    const name = invName().trim();
    if (!name) return;
    setInvCreating(true);
    setInvError('');
    try {
      const res = await fetch(`${API}/invites`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ name, phone: invPhone().trim(), side: invSide() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ? JSON.stringify(err.detail) : `HTTP ${res.status}`);
      }
      setInvName('');
      setInvPhone('');
      await refreshInvites();
    } catch (err) {
      setInvError(`יצירת הקישור נכשלה: ${err.message}`);
    } finally {
      setInvCreating(false);
    }
  };

  // "שם, טלפון, צד" per line. A missing/unknown side is reported, never guessed.
  const parseBulk = (text) => {
    const rows = [];
    const bad = [];
    String(text || '').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const parts = line.split(',').map((p) => p.trim());
      const name = parts[0] || '';
      const phone = parts[1] || '';
      const side = parseSide(parts[2]);
      if (!name) { bad.push(`שורה ${i + 1}: חסר שם`); return; }
      if (!side) {
        bad.push(`שורה ${i + 1} (${name}): צד חסר או לא מוכר — ${SIDES.map(sideLabel).join(' / ')}`);
        return;
      }
      rows.push({ name, phone, side });
    });
    return { rows, bad };
  };

  const createBulk = async () => {
    const { rows, bad } = parseBulk(bulkText());
    if (bad.length) {
      setBulkNote('');
      setInvError(`לא נוצרו קישורים — תקנו את השורות הבאות:\n${bad.join('\n')}`);
      return;
    }
    if (!rows.length) { setInvError('אין שורות ליצירה.'); return; }
    setBulkBusy(true);
    setInvError('');
    setBulkNote('');
    try {
      const res = await fetch(`${API}/invites/bulk`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ rows }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ? JSON.stringify(err.detail) : `HTTP ${res.status}`);
      }
      const created = await res.json();
      setBulkText('');
      setBulkNote(`נוצרו ${created.length} קישורים אישיים.`);
      await refreshInvites();
    } catch (err) {
      setInvError(`יצירת הקישורים נכשלה: ${err.message}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const deleteInvite = async (token) => {
    if (!confirm('למחוק את ההזמנה והקישור האישי?')) return;
    try {
      const res = await fetch(`${API}/invites/${token}`, { method: 'DELETE', headers: adminHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInvites((prev) => prev.filter((i) => i.token !== token));
      fetchStats();
    } catch (err) {
      alert(`המחיקה נכשלה: ${err.message}`);
    }
  };

  const toggleSent = async (token) => {
    try {
      const res = await fetch(`${API}/invites/${token}/sent`, { method: 'POST', headers: adminHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInvites((prev) => prev.map((i) => (i.token === token ? { ...i, sent_at: data.sent_at } : i)));
    } catch (err) {
      alert(`העדכון נכשל: ${err.message}`);
    }
  };

  const copyLink = async (inv) => {
    try {
      await navigator.clipboard.writeText(inv.url);
    } catch {
      // Clipboard API needs a secure context; fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = inv.url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
    setCopiedToken(inv.token);
    setTimeout(() => setCopiedToken((t) => (t === inv.token ? '' : t)), 1800);
  };

  const inviteText = (inv) =>
    `שלום ${inv.name}! 🌿\nעידן וורד מזמינים אתכם לחגוג איתם ביום ראשון, 25.10.2026, באולם תרין בראשון לציון.\nקבלת פנים 18:30 · חופה 19:30.\nאישור הגעה בקישור האישי שלכם:\n${inv.url}`;

  const waShareUrl = (inv) => {
    const digits = waDigits(inv.phone);
    const to = digits ? `972${digits}` : '';
    return `https://wa.me/${to}?text=${encodeURIComponent(inviteText(inv))}`;
  };

  const inviteStatusLabel = (inv) => {
    if (!inv.responded) return 'טרם השיבו';
    return inv.attending ? `מגיעים ${inv.guests || 1}` : 'לא מגיעים';
  };

  // Invites that have not answered — also the source of the "טרם השיבו" chip.
  const pendingInvites = () => invites().filter((i) => !i.responded);
  const pendingWithSide = () =>
    pendingInvites().filter((i) => sideFilter() === 'all' || i.side === sideFilter());

  const filteredInvites = () =>
    invites().filter((i) => {
      if (sideFilter() !== 'all' && i.side !== sideFilter()) return false;
      if (statusFilter() === 'attending') return i.responded && i.attending;
      if (statusFilter() === 'declined') return i.responded && !i.attending;
      if (statusFilter() === 'pending') return !i.responded;
      return true;
    });

  // guest id → side, so the guest table and the exports can show it.
  const sideByGuestId = () => {
    const map = {};
    invites().forEach((i) => { if (i.guest_id) map[i.guest_id] = i.side; });
    return map;
  };
  const guestSide = (g) => sideByGuestId()[g.id] || OTHER_SIDE;

  const filteredGuests = () =>
    guests().filter((g) => {
      const isAttending = g.attending === 1 || g.attending === true;
      if (sideFilter() !== 'all' && guestSide(g) !== sideFilter()) return false;
      if (statusFilter() === 'attending') return isAttending;
      if (statusFilter() === 'declined') return !isAttending;
      if (statusFilter() === 'pending') return false;  // handled by the invite list
      return true;
    });

  // ── Exports ───────────────────────────────────────────────────────────────
  const exportRows = () =>
    guests().map((g) => {
      const isAttending = g.attending === 1 || g.attending === true;
      return {
        'שם': g.name || '',
        'טלפון': g.phone || '',
        'צד': sideLabel(guestSide(g)),
        'מגיעים': isAttending ? 'כן' : 'לא',
        'כמות': isAttending ? partySize(g) : '',
        'תזונה': g.dietary || '',
        'ברכה': g.message || '',
        'תאריך': formatDate(g.created_at),
      };
    });

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportCSV = () => {
    const rows = exportRows();
    const headers = ['שם', 'טלפון', 'צד', 'מגיעים', 'כמות', 'תזונה', 'ברכה', 'תאריך'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n');
    // Excel only reads UTF-8 CSV correctly when it starts with a BOM.
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `wedding-guests-${stamp()}.csv`);
  };

  const exportXLSX = async () => {
    setExporting(true);
    setInvError('');
    try {
      // Lazy: SheetJS is ~800KB and nothing but this button needs it.
      const XLSX = await import('xlsx');
      const rtl = (ws) => { ws['!views'] = [{ RTL: true }]; return ws; };

      const wsGuests = rtl(XLSX.utils.json_to_sheet(exportRows(), {
        header: ['שם', 'טלפון', 'צד', 'מגיעים', 'כמות', 'תזונה', 'ברכה', 'תאריך'],
      }));

      const wsPending = rtl(XLSX.utils.json_to_sheet(
        pendingInvites().map((i) => ({
          'שם': i.name,
          'טלפון': i.phone || '',
          'צד': sideLabel(i.side),
          'קישור': i.url,
        })),
        { header: ['שם', 'טלפון', 'צד', 'קישור'] }
      ));

      const s = stats();
      const wsSummary = rtl(XLSX.utils.json_to_sheet(
        SIDES_WITH_OTHER.map((key) => {
          const row = (s && s.by_side && s.by_side[key]) || {};
          return {
            'צד': sideLabel(key),
            'הזמנות': row.invites || 0,
            'השיבו': row.responded || 0,
            'מגיעים': row.attending || 0,
            'לא מגיעים': row.declined || 0,
            'סה״כ אנשים': row.total_people || 0,
          };
        }).concat([{
          'צד': 'סה״כ',
          'הזמנות': (s && s.invites) || 0,
          'השיבו': (s && s.responses) || 0,
          'מגיעים': (s && s.attending_responses) || 0,
          'לא מגיעים': (s && s.declined) || 0,
          'סה״כ אנשים': (s && s.total_people) || 0,
        }]),
        { header: ['צד', 'הזמנות', 'השיבו', 'מגיעים', 'לא מגיעים', 'סה״כ אנשים'] }
      ));

      const wb = XLSX.utils.book_new();
      // SheetJS only writes sheetView rightToLeft="1" from the *workbook*
      // views — the per-sheet ws['!views'] above is read back but never
      // written — so set both and the file really opens right-to-left.
      wb.Workbook = { ...(wb.Workbook || {}), Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(wb, wsGuests, 'אורחים');
      XLSX.utils.book_append_sheet(wb, wsPending, 'טרם השיבו');
      XLSX.utils.book_append_sheet(wb, wsSummary, 'סיכום');

      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      downloadBlob(
        new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        `wedding-guests-${stamp()}.xlsx`
      );
    } catch (err) {
      setInvError(`הייצוא נכשל: ${err.message || err}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  // The gate is a real request, not a string comparison: ask the API for the
  // stats with the typed password and let it decide.
  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!password().trim() || unlocking()) return;
    setUnlocking(true);
    setAuthError('');
    try {
      const res = await fetch(`${API}/stats`, { headers: adminHeaders() });
      if (res.status === 401 || res.status === 403) {
        setAuthError('סיסמה שגויה.');
        return;
      }
      if (!res.ok) {
        setAuthError(`השרת לא זמין כרגע (HTTP ${res.status}). נסו שוב בעוד רגע.`);
        return;
      }
      setStats(await res.json());
      setLocked(false);
      fetchGuests();
      refreshInvites();
    } catch (err) {
      setAuthError(`אין חיבור לשרת: ${err.message || err}`);
    } finally {
      setUnlocking(false);
    }
  };


  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('he-IL', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return dateStr; }
  };

  return (
    <div class="min-h-screen px-6 py-16" style="background: #FDFAF7">
      <div class="max-w-6xl mx-auto">
        {/* Header */}
        <div class="text-center mb-16">
          <p class="font-sans text-sm tracking-[0.1em] mb-4" style="color: #B22222">ניהול</p>
          <h1 class="font-serif text-5xl font-light mb-4" style="color: #1A0A0A">רשימת האורחים</h1>
          <div class="h-px w-24 mx-auto mb-4" style="background: rgba(178,34,34,0.3)" />
          <p class="font-sans text-sm" style="color: rgba(26,10,10,0.4)">עידן &amp; ורד · 25 באוקטובר 2026</p>
        </div>

        {/* ── Password gate ── */}
        <Show when={locked()}>
          <div class="max-w-sm mx-auto">
            <form
              onSubmit={handleUnlock}
              class="p-8"
              style="border: 1px solid rgba(178,34,34,0.2); background: rgba(178,34,34,0.02)"
            >
              <div class="text-center mb-8">
                <div class="flex items-center justify-center gap-3 mb-4">
                  <div class="h-px flex-1" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.5))" />
                  <span class="text-base" style="color: #C9A96E">✦</span>
                  <div class="h-px flex-1" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.5))" />
                </div>
                <h2 class="font-serif text-2xl font-light mb-2" style="color: #1A0A0A">גישה מוגבלת</h2>
                <p class="font-sans text-xs" style="color: rgba(26,10,10,0.4)">הזינו את סיסמת הניהול</p>
              </div>
              <div class="mb-4">
                <label class="block font-sans text-sm font-medium tracking-[0.12em] mb-2" style="color: #B22222">סיסמה</label>
                <input
                  type="password"
                  value={password()}
                  onInput={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  class="w-full font-sans text-sm px-4 py-3"
                  style="outline:none; background: rgba(178,34,34,0.02); border: 1px solid rgba(178,34,34,0.2); color: #1A0A0A"
                  onFocus={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.6)'}
                  onBlur={(e) => e.target.style.borderColor = 'rgba(178,34,34,0.2)'}
                  autofocus
                />
              </div>
              <Show when={authError()}>
                <div class="mb-4 px-3 py-2" style="border: 1px solid rgba(178,34,34,0.3); background: rgba(178,34,34,0.06)">
                  <p class="font-sans text-xs" style="color: #B22222">{authError()}</p>
                </div>
              </Show>
              <button
                type="submit"
                disabled={unlocking() || !password().trim()}
                class="w-full py-3 font-sans text-sm font-medium tracking-[0.12em] transition-all duration-300 disabled:opacity-40"
                style="border: 1px solid rgba(178,34,34,0.4); color: #B22222; background: rgba(178,34,34,0.05)"
                onMouseEnter={(e) => e.target.style.background = 'rgba(178,34,34,0.12)'}
                onMouseLeave={(e) => e.target.style.background = 'rgba(178,34,34,0.05)'}
              >
                {unlocking() ? 'בודק…' : 'כניסה'}
              </button>
            </form>
          </div>
        </Show>

        {/* ── Dashboard ── */}
        <Show when={!locked()}>
          {/* Served by GET /api/stats, with the locally computed numbers as a
              fallback while it loads or if it fails. */}
          <SeatingLedger
            stats={stats()}
            sideKeys={SIDES_WITH_OTHER}
            sideLabel={sideLabel}
            fallbackPeople={totalAttendingPeople()}
            fallbackPending={pendingInvites().length}
            fallbackAttending={attendingCount()}
          />

          {/* The same figures, side by side — this is the table they argue over. */}
          <Show when={stats() && stats().by_side}>
            <div class="mb-10 overflow-x-auto" style="border: 1px solid rgba(178,34,34,0.15)">
              <table class="w-full border-collapse" style={FIGURES}>
                <thead>
                  <tr style="border-bottom: 1px solid rgba(178,34,34,0.15); background: rgba(178,34,34,0.02)">
                    {['צד', 'הזמנות', 'השיבו', 'מגיעים', 'לא מגיעים', 'סה״כ אנשים'].map((h, i) => (
                      <th
                        class={`py-2.5 px-4 font-sans text-xs tracking-[0.08em] font-medium ${i === 0 ? 'text-start' : 'text-end'}`}
                        style="color: #B22222"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <For each={SIDES_WITH_OTHER}>
                    {(key) => {
                      const row = () => (stats().by_side || {})[key] || {};
                      const empty = () => !(row().invites || row().responded);
                      return (
                        <tr
                          style={`border-bottom: 1px solid rgba(178,34,34,0.05); ${empty() ? 'opacity: 0.4' : ''}`}
                        >
                          <td class="py-2.5 px-4 font-sans text-sm text-start" style="color: #1A0A0A">{sideLabel(key)}</td>
                          <td class="py-2.5 px-4 font-sans text-sm text-end" style="color: rgba(26,10,10,0.55)">{row().invites || 0}</td>
                          <td class="py-2.5 px-4 font-sans text-sm text-end" style="color: rgba(26,10,10,0.55)">{row().responded || 0}</td>
                          <td class="py-2.5 px-4 font-sans text-sm text-end" style="color: #B22222">{row().attending || 0}</td>
                          <td class="py-2.5 px-4 font-sans text-sm text-end" style="color: rgba(26,10,10,0.35)">{row().declined || 0}</td>
                          <td class="py-2.5 px-4 font-sans text-sm text-end font-medium" style="color: #1A0A0A">{row().total_people || 0}</td>
                        </tr>
                      );
                    }}
                  </For>
                  {/* The columns only mean something if they add up. */}
                  <tr style="border-top: 1px solid rgba(178,34,34,0.2); background: rgba(178,34,34,0.02)">
                    <td class="py-2.5 px-4 font-sans text-sm font-medium text-start" style="color: #B22222">סה״כ</td>
                    <td class="py-2.5 px-4 font-sans text-sm text-end" style="color: rgba(26,10,10,0.7)">{stats().invites}</td>
                    <td class="py-2.5 px-4 font-sans text-sm text-end" style="color: rgba(26,10,10,0.7)">{stats().responses}</td>
                    <td class="py-2.5 px-4 font-sans text-sm text-end" style="color: #B22222">{stats().attending_responses}</td>
                    <td class="py-2.5 px-4 font-sans text-sm text-end" style="color: rgba(26,10,10,0.45)">{stats().declined}</td>
                    <td class="py-2.5 px-4 font-sans text-sm text-end font-medium" style="color: #1A0A0A">{stats().total_people}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Show>

          {/* Tabs */}
          <div class="flex gap-1 mb-8" style="border-bottom: 1px solid rgba(178,34,34,0.1)">
            {[['guests', 'אורחים'], ['invites', 'הזמנות']].map(([tab, label]) => (
              <button
                onClick={() => setActiveTab(tab)}
                class="px-6 py-3 font-sans text-sm font-medium tracking-[0.12em] transition-all duration-200"
                style={
                  activeTab() === tab
                    ? 'color: #B22222; border-bottom: 1px solid #B22222; margin-bottom: -1px'
                    : 'color: rgba(26,10,10,0.3)'
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* ── Guests Tab ── */}
          <Show when={activeTab() === 'guests'}>
            <div class="flex flex-wrap gap-3 justify-between items-center mb-6">
              <h2 class="font-serif text-2xl font-light" style="color: #1A0A0A">רשימת האורחים</h2>
              <div class="flex flex-wrap gap-2">
                <button
                  onClick={exportXLSX}
                  disabled={exporting() || guests().length === 0}
                  class="font-sans text-sm tracking-[0.06em] px-4 py-2 transition-all duration-300 disabled:opacity-40"
                  style="color: #B22222; border: 1px solid rgba(178,34,34,0.3)"
                  onMouseEnter={(e) => e.target.style.background = 'rgba(178,34,34,0.07)'}
                  onMouseLeave={(e) => e.target.style.background = 'transparent'}
                >
                  {exporting() ? 'מייצא…' : 'ייצוא ל-Excel'}
                </button>
                <button
                  onClick={exportCSV}
                  disabled={guests().length === 0}
                  class="font-sans text-sm tracking-[0.06em] px-4 py-2 transition-all duration-300 disabled:opacity-40"
                  style="color: rgba(26,10,10,0.5); border: 1px solid rgba(26,10,10,0.15)"
                  onMouseEnter={(e) => e.target.style.background = 'rgba(26,10,10,0.04)'}
                  onMouseLeave={(e) => e.target.style.background = 'transparent'}
                >
                  ייצוא CSV
                </button>
                <button
                  onClick={refreshAll}
                  disabled={loading()}
                  class="font-sans text-sm tracking-[0.06em] px-4 py-2 transition-all duration-300 disabled:opacity-40"
                  style="color: #B22222; border: 1px solid rgba(178,34,34,0.3)"
                  onMouseEnter={(e) => e.target.style.background = 'rgba(178,34,34,0.07)'}
                  onMouseLeave={(e) => e.target.style.background = 'transparent'}
                >
                  {loading() ? 'טוען…' : 'רענון'}
                </button>
              </div>
            </div>

            {/* Filters: response status, then side */}
            <div class="flex flex-wrap items-center gap-2 mb-6">
              <For each={STATUS_FILTERS}>
                {([key, label]) => (
                  <button
                    onClick={() => setStatusFilter(key)}
                    class="font-sans text-xs px-3 py-1.5 transition-all duration-200"
                    style={
                      statusFilter() === key
                        ? 'border: 1px solid #B22222; color: white; background: #B22222'
                        : 'border: 1px solid rgba(178,34,34,0.25); color: #B22222; background: transparent'
                    }
                  >
                    {label}
                  </button>
                )}
              </For>
              {/* Desktop: a divider between the two chip groups. Phones: the
                  groups wrap anyway, so start the side chips on their own row
                  instead of leaving the divider dangling at a line end. */}
              <span class="hidden sm:inline mx-2" style="color: rgba(26,10,10,0.15)">|</span>
              <span class="basis-full h-0 sm:hidden" aria-hidden="true" />
              <button
                onClick={() => setSideFilter('all')}
                class="font-sans text-xs px-3 py-1.5 transition-all duration-200"
                style={
                  sideFilter() === 'all'
                    ? 'border: 1px solid #C9A96E; color: white; background: #C9A96E'
                    : 'border: 1px solid rgba(201,169,110,0.4); color: #8B6347; background: transparent'
                }
              >
                כל הצדדים
              </button>
              <For each={SIDES}>
                {(key) => (
                  <button
                    onClick={() => setSideFilter(key)}
                    class="font-sans text-xs px-3 py-1.5 transition-all duration-200"
                    style={
                      sideFilter() === key
                        ? 'border: 1px solid #C9A96E; color: white; background: #C9A96E'
                        : 'border: 1px solid rgba(201,169,110,0.4); color: #8B6347; background: transparent'
                    }
                  >
                    {sideLabel(key)}
                  </button>
                )}
              </For>
            </div>

            <Show when={fetchError()}>
              <div class="mb-6 px-4 py-3" style="border: 1px solid rgba(178,34,34,0.3); background: rgba(178,34,34,0.06)">
                <p class="font-sans text-sm" style="color: #B22222">{fetchError()}</p>
              </div>
            </Show>

            <Show when={loading()}>
              <div class="text-center py-16">
                <svg class="animate-spin w-6 h-6 mx-auto" style="color: #B22222" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            </Show>

            {/* "טרם השיבו" is a list of invites, not of guest rows. */}
            <Show when={!loading() && statusFilter() === 'pending'}>
              <Show when={pendingWithSide().length === 0}>
                <div class="text-center py-16" style="border: 1px solid rgba(178,34,34,0.1)">
                  <p class="font-serif text-xl" style="color: rgba(26,10,10,0.3)">
                    {invites().length === 0 ? 'עדיין לא נוצרו הזמנות' : 'כולם השיבו'}
                  </p>
                </div>
              </Show>
              <Show when={pendingWithSide().length > 0}>
                <div class="overflow-x-auto">
                  <table class="w-full border-collapse">
                    <thead>
                      <tr style="border-bottom: 1px solid rgba(178,34,34,0.2)">
                        {['שם', 'טלפון', 'צד', 'נשלח', 'קישור אישי'].map((h) => (
                          <th class="text-start py-3 px-3 font-sans text-sm tracking-[0.06em]" style="color: #B22222">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <For each={pendingWithSide()}>
                        {(inv) => (
                          <tr style="border-bottom: 1px solid rgba(178,34,34,0.05)">
                            <td class="py-3 px-3 font-sans text-sm font-medium" style="color: #1A0A0A">{inv.name}</td>
                            <td class="py-3 px-3 font-sans text-xs" dir="ltr" style="color: rgba(26,10,10,0.5); text-align: right">{inv.phone || '—'}</td>
                            <td class="py-3 px-3 font-sans text-xs" style="color: rgba(26,10,10,0.5)">{sideLabel(inv.side)}</td>
                            <td class="py-3 px-3 font-sans text-xs" style="color: rgba(26,10,10,0.4)">{inv.sent_at ? formatDate(inv.sent_at) : '—'}</td>
                            <td class="py-3 px-3">
                              <button
                                onClick={() => copyLink(inv)}
                                class="font-sans text-xs px-2 py-1"
                                style="color: #B22222; border: 1px solid rgba(178,34,34,0.25)"
                              >
                                {copiedToken() === inv.token ? 'הועתק ✓' : 'העתקה'}
                              </button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <div class="mt-4 pt-4" style="border-top: 1px solid rgba(178,34,34,0.1)">
                  <p class="font-sans text-xs" style="color: rgba(26,10,10,0.3)">{pendingWithSide().length} הזמנות ללא מענה</p>
                </div>
              </Show>
            </Show>

            <Show when={!loading() && statusFilter() !== 'pending' && filteredGuests().length === 0}>
              <div class="text-center py-16" style="border: 1px solid rgba(178,34,34,0.1)">
                <div class="flex items-center justify-center gap-3 mb-4 max-w-[160px] mx-auto">
                  <div class="h-px flex-1" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.4))" />
                  <span class="text-sm" style="color: rgba(201,169,110,0.6)">✦</span>
                  <div class="h-px flex-1" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.4))" />
                </div>
                <p class="font-serif text-xl" style="color: rgba(26,10,10,0.3)">
                  {guests().length === 0 ? 'עדיין אין אישורי הגעה' : 'אין תוצאות לסינון הזה'}
                </p>
              </div>
            </Show>

            <Show when={!loading() && statusFilter() !== 'pending' && filteredGuests().length > 0}>
              <div class="overflow-x-auto">
                <table class="w-full border-collapse">
                  <thead>
                    <tr style="border-bottom: 1px solid rgba(178,34,34,0.2)">
                      {['#', 'שם', 'צד', 'מגיע/ה', 'כמות', 'טלפון', 'תזונה', 'ברכה', 'תאריך', ''].map((h) => (
                        <th class="text-start py-3 px-3 font-sans text-sm tracking-[0.06em]" style="color: #B22222">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <For each={filteredGuests()}>
                      {(guest, index) => {
                        const isAttending = guest.attending === 1 || guest.attending === true;
                        const partyOf = partySize(guest);
                        return (
                          <tr
                            style={`border-bottom: 1px solid rgba(178,34,34,0.05); ${index() % 2 !== 0 ? 'background: rgba(178,34,34,0.01)' : ''}`}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(178,34,34,0.03)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = index() % 2 !== 0 ? 'rgba(178,34,34,0.01)' : ''}
                          >
                            <td class="py-3 px-3 font-sans text-xs" style="color: rgba(26,10,10,0.3)">{guest.id}</td>
                            <td class="py-3 px-3 font-sans text-sm font-medium" style="color: #1A0A0A">{guest.name}</td>
                            <td class="py-3 px-3 font-sans text-xs" style="color: rgba(26,10,10,0.5)">
                              {guestSide(guest) ? sideLabel(guestSide(guest)) : '—'}
                            </td>
                            <td class="py-3 px-3">
                              <span
                                class="font-sans text-xs px-2 py-1"
                                style={
                                  isAttending
                                    ? 'border: 1px solid rgba(178,34,34,0.4); color: #B22222; background: rgba(178,34,34,0.08)'
                                    : 'border: 1px solid rgba(26,10,10,0.15); color: rgba(26,10,10,0.35)'
                                }
                              >
                                {isAttending ? 'כן' : 'לא'}
                              </span>
                            </td>
                            <td class="py-3 px-3 font-sans text-sm" style="color: rgba(26,10,10,0.5)">{isAttending ? partyOf : '—'}</td>
                            <td class="py-3 px-3 font-sans text-xs" dir="ltr" style="color: rgba(26,10,10,0.5); text-align: right">{guest.phone || '—'}</td>
                            <td class="py-3 px-3 font-sans text-xs max-w-[120px]" style="color: rgba(26,10,10,0.5)">
                              <span class="truncate block">{guest.dietary || '—'}</span>
                            </td>
                            <td class="py-3 px-3 font-sans text-xs max-w-[160px]" style="color: rgba(26,10,10,0.5)">
                              <span class="truncate block">{guest.message || '—'}</span>
                            </td>
                            <td class="py-3 px-3 font-sans text-xs whitespace-nowrap" style="color: rgba(26,10,10,0.3)">
                              {formatDate(guest.created_at)}
                            </td>
                            <td class="py-3 px-3">
                              <button
                                onClick={() => handleDelete(guest.id)}
                                disabled={deletingId() === guest.id}
                                class="font-sans text-xs px-2 py-1 transition-all duration-200 disabled:opacity-30"
                                style="color: rgba(178,34,34,0.5); border: 1px solid rgba(178,34,34,0.2)"
                                onMouseEnter={(e) => { e.target.style.color = '#B22222'; e.target.style.borderColor = 'rgba(178,34,34,0.5)'; }}
                                onMouseLeave={(e) => { e.target.style.color = 'rgba(178,34,34,0.5)'; e.target.style.borderColor = 'rgba(178,34,34,0.2)'; }}
                              >
                                {deletingId() === guest.id ? '…' : 'מחיקה'}
                              </button>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
              <div class="mt-4 pt-4 flex justify-between" style="border-top: 1px solid rgba(178,34,34,0.1)">
                <p class="font-sans text-xs" style="color: rgba(26,10,10,0.3)">
                  {filteredGuests().length === guests().length
                    ? `${guests().length} תשובות`
                    : `${filteredGuests().length} מתוך ${guests().length} תשובות`}
                </p>
                <p class="font-sans text-xs" style="color: rgba(26,10,10,0.3)">{attendingCount()} תשובות חיוביות · {totalAttendingPeople()} צפויים בסך הכול</p>
              </div>
            </Show>
          </Show>

          {/* ── Invites Tab ── */}
          <Show when={activeTab() === 'invites'}>
            <div class="flex flex-wrap gap-3 justify-between items-center mb-6">
              <h2 class="font-serif text-2xl font-light" style="color: #1A0A0A">הזמנות אישיות</h2>
              <button
                onClick={refreshInvites}
                disabled={invLoading()}
                class="font-sans text-sm tracking-[0.06em] px-4 py-2 transition-all duration-300 disabled:opacity-40"
                style="color: #B22222; border: 1px solid rgba(178,34,34,0.3)"
                onMouseEnter={(e) => e.target.style.background = 'rgba(178,34,34,0.07)'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                {invLoading() ? 'טוען…' : 'רענון'}
              </button>
            </div>

            <Show when={invError()}>
              <div class="mb-6 px-4 py-3" style="border: 1px solid rgba(178,34,34,0.3); background: rgba(178,34,34,0.06)">
                <p class="font-sans text-sm whitespace-pre-line" style="color: #B22222">{invError()}</p>
              </div>
            </Show>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
              {/* Single invite */}
              <form
                onSubmit={createInvite}
                class="p-6"
                style="border: 1px solid rgba(178,34,34,0.2); background: rgba(178,34,34,0.02)"
              >
                <h3 class="font-serif text-xl mb-4" style="color: #1A0A0A">הזמנה חדשה</h3>
                <label class="block font-sans text-xs font-medium tracking-[0.12em] mb-2" style="color: #B22222">שם *</label>
                <input
                  type="text"
                  value={invName()}
                  onInput={(e) => setInvName(e.target.value)}
                  placeholder="שם האורח/ת"
                  class="w-full font-sans text-sm px-4 py-2 mb-4"
                  style="outline:none; background: white; border: 1px solid rgba(178,34,34,0.2); color: #1A0A0A"
                />
                <label class="block font-sans text-xs font-medium tracking-[0.12em] mb-2" style="color: #B22222">טלפון</label>
                <input
                  type="tel"
                  dir="ltr"
                  value={invPhone()}
                  onInput={(e) => setInvPhone(e.target.value)}
                  placeholder="050-123-4567"
                  class="w-full font-sans text-sm px-4 py-2 mb-4"
                  style="outline:none; background: white; border: 1px solid rgba(178,34,34,0.2); color: #1A0A0A; text-align: right"
                />
                <label class="block font-sans text-xs font-medium tracking-[0.12em] mb-2" style="color: #B22222">צד *</label>
                <select
                  value={invSide()}
                  onChange={(e) => setInvSide(e.currentTarget.value)}
                  class="w-full font-sans text-sm px-4 py-2 mb-5"
                  style="outline:none; background: white; border: 1px solid rgba(178,34,34,0.2); color: #1A0A0A"
                >
                  {/* "other" is where un-invited answers land — never something
                      you can create an invitation as. */}
                  <For each={SIDES}>
                    {(key) => <option value={key} selected={invSide() === key}>{sideLabel(key)}</option>}
                  </For>
                </select>
                <button
                  type="submit"
                  disabled={invCreating() || !invName().trim()}
                  class="w-full py-2.5 font-sans text-sm font-medium tracking-[0.12em] transition-all duration-300 disabled:opacity-40"
                  style="border: 1px solid rgba(178,34,34,0.4); color: #B22222; background: rgba(178,34,34,0.05)"
                >
                  {invCreating() ? 'יוצר…' : 'צור קישור'}
                </button>
              </form>

              {/* Bulk paste */}
              <div class="p-6" style="border: 1px solid rgba(178,34,34,0.2); background: rgba(178,34,34,0.02)">
                <h3 class="font-serif text-xl mb-2" style="color: #1A0A0A">הדבקת רשימה</h3>
                <p class="font-sans text-xs mb-4" style="color: rgba(26,10,10,0.45)">
                  שורה לכל אורח בפורמט <span dir="ltr">שם, טלפון, צד</span>. הצד יכול להיות {SIDES.map(sideLabel).join(' / ')}.
                </p>
                <textarea
                  rows="7"
                  value={bulkText()}
                  onInput={(e) => setBulkText(e.target.value)}
                  placeholder={'דנה כהן, 0501234567, הורי ורד\nיוסי לוי, 0529876543, עידן'}
                  class="w-full font-sans text-sm px-4 py-2 mb-4"
                  style="outline:none; background: white; border: 1px solid rgba(178,34,34,0.2); color: #1A0A0A; resize: vertical"
                />
                <Show when={bulkNote()}>
                  <p class="font-sans text-xs mb-3" style="color: #4ade80">{bulkNote()}</p>
                </Show>
                <button
                  onClick={createBulk}
                  disabled={bulkBusy() || !bulkText().trim()}
                  class="w-full py-2.5 font-sans text-sm font-medium tracking-[0.12em] transition-all duration-300 disabled:opacity-40"
                  style="border: 1px solid rgba(178,34,34,0.4); color: #B22222; background: rgba(178,34,34,0.05)"
                >
                  {bulkBusy() ? 'יוצר…' : 'צור קישורים'}
                </button>
              </div>
            </div>

            {/* Filters, shared with the guests tab */}
            <div class="flex flex-wrap items-center gap-2 mb-6">
              <For each={STATUS_FILTERS}>
                {([key, label]) => (
                  <button
                    onClick={() => setStatusFilter(key)}
                    class="font-sans text-xs px-3 py-1.5 transition-all duration-200"
                    style={
                      statusFilter() === key
                        ? 'border: 1px solid #B22222; color: white; background: #B22222'
                        : 'border: 1px solid rgba(178,34,34,0.25); color: #B22222; background: transparent'
                    }
                  >
                    {label}
                  </button>
                )}
              </For>
              {/* Desktop: a divider between the two chip groups. Phones: the
                  groups wrap anyway, so start the side chips on their own row
                  instead of leaving the divider dangling at a line end. */}
              <span class="hidden sm:inline mx-2" style="color: rgba(26,10,10,0.15)">|</span>
              <span class="basis-full h-0 sm:hidden" aria-hidden="true" />
              <button
                onClick={() => setSideFilter('all')}
                class="font-sans text-xs px-3 py-1.5 transition-all duration-200"
                style={
                  sideFilter() === 'all'
                    ? 'border: 1px solid #C9A96E; color: white; background: #C9A96E'
                    : 'border: 1px solid rgba(201,169,110,0.4); color: #8B6347; background: transparent'
                }
              >
                כל הצדדים
              </button>
              <For each={SIDES}>
                {(key) => (
                  <button
                    onClick={() => setSideFilter(key)}
                    class="font-sans text-xs px-3 py-1.5 transition-all duration-200"
                    style={
                      sideFilter() === key
                        ? 'border: 1px solid #C9A96E; color: white; background: #C9A96E'
                        : 'border: 1px solid rgba(201,169,110,0.4); color: #8B6347; background: transparent'
                    }
                  >
                    {sideLabel(key)}
                  </button>
                )}
              </For>
            </div>

            <Show when={!invLoading() && filteredInvites().length === 0}>
              <div class="text-center py-16" style="border: 1px solid rgba(178,34,34,0.1)">
                <p class="font-serif text-xl" style="color: rgba(26,10,10,0.3)">
                  {invites().length === 0 ? 'עדיין לא נוצרו הזמנות' : 'אין תוצאות לסינון הזה'}
                </p>
              </div>
            </Show>

            <Show when={filteredInvites().length > 0}>
              <div class="overflow-x-auto">
                <table class="w-full border-collapse">
                  <thead>
                    <tr style="border-bottom: 1px solid rgba(178,34,34,0.2)">
                      {['שם', 'טלפון', 'צד', 'סטטוס', 'קישור אישי', 'נשלח', ''].map((h) => (
                        <th class="text-start py-3 px-3 font-sans text-sm tracking-[0.06em]" style="color: #B22222">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <For each={filteredInvites()}>
                      {(inv, index) => (
                        <tr style={`border-bottom: 1px solid rgba(178,34,34,0.05); ${index() % 2 !== 0 ? 'background: rgba(178,34,34,0.01)' : ''}`}>
                          <td class="py-3 px-3 font-sans text-sm font-medium" style="color: #1A0A0A">{inv.name}</td>
                          <td class="py-3 px-3 font-sans text-xs" dir="ltr" style="color: rgba(26,10,10,0.5); text-align: right">{inv.phone || '—'}</td>
                          <td class="py-3 px-3 font-sans text-xs" style="color: rgba(26,10,10,0.5)">{sideLabel(inv.side)}</td>
                          <td class="py-3 px-3">
                            <span
                              class="font-sans text-xs px-2 py-1 whitespace-nowrap"
                              style={
                                !inv.responded
                                  ? 'border: 1px solid rgba(26,10,10,0.15); color: rgba(26,10,10,0.4)'
                                  : inv.attending
                                    ? 'border: 1px solid rgba(178,34,34,0.4); color: #B22222; background: rgba(178,34,34,0.08)'
                                    : 'border: 1px solid rgba(26,10,10,0.2); color: rgba(26,10,10,0.45)'
                              }
                            >
                              {inviteStatusLabel(inv)}
                            </span>
                          </td>
                          <td class="py-3 px-3">
                            <div class="flex items-center gap-2">
                              <span
                                class="font-sans text-xs truncate max-w-[190px] inline-block"
                                dir="ltr"
                                style="color: rgba(26,10,10,0.35)"
                                title={inv.url}
                              >
                                {inv.url}
                              </span>
                              <button
                                onClick={() => copyLink(inv)}
                                class="font-sans text-xs px-2 py-1 whitespace-nowrap"
                                style="color: #B22222; border: 1px solid rgba(178,34,34,0.25)"
                              >
                                {copiedToken() === inv.token ? 'הועתק ✓' : 'העתקה'}
                              </button>
                              <a
                                href={waShareUrl(inv)}
                                target="_blank"
                                rel="noopener"
                                class="font-sans text-xs px-2 py-1 whitespace-nowrap"
                                style="color: #128C7E; border: 1px solid rgba(18,140,126,0.35); text-decoration: none"
                              >
                                וואטסאפ
                              </a>
                            </div>
                          </td>
                          <td class="py-3 px-3">
                            <button
                              onClick={() => toggleSent(inv.token)}
                              class="font-sans text-xs px-2 py-1 whitespace-nowrap"
                              style={
                                inv.sent_at
                                  ? 'color: #4ade80; border: 1px solid rgba(74,222,128,0.4)'
                                  : 'color: rgba(26,10,10,0.4); border: 1px solid rgba(26,10,10,0.15)'
                              }
                              title={inv.sent_at ? formatDate(inv.sent_at) : ''}
                            >
                              {inv.sent_at ? '✓ נשלח' : 'סמנו כנשלח'}
                            </button>
                          </td>
                          <td class="py-3 px-3">
                            <button
                              onClick={() => deleteInvite(inv.token)}
                              class="font-sans text-xs px-2 py-1"
                              style="color: rgba(178,34,34,0.5); border: 1px solid rgba(178,34,34,0.2)"
                            >
                              מחיקה
                            </button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <div class="mt-4 pt-4 flex justify-between" style="border-top: 1px solid rgba(178,34,34,0.1)">
                <p class="font-sans text-xs" style="color: rgba(26,10,10,0.3)">
                  {filteredInvites().length === invites().length
                    ? `${invites().length} הזמנות`
                    : `${filteredInvites().length} מתוך ${invites().length} הזמנות`}
                </p>
                <p class="font-sans text-xs" style="color: rgba(26,10,10,0.3)">{pendingInvites().length} טרם השיבו</p>
              </div>
            </Show>
          </Show>

        </Show>
      </div>
    </div>
  );
}
