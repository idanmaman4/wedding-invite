import { createSignal, onMount, onCleanup, Show, For } from 'solid-js';

const ADMIN_PASSWORD = 'wedding2027';
const API = '/api';
const WA_SERVICE = 'http://localhost:3001';

function StatCard({ label, value, sub }) {
  return (
    <div class="p-6 border border-gold/20 bg-white/[0.02] text-center">
      <p class="font-sans text-xs tracking-widest text-gold uppercase mb-2">{label}</p>
      <p class="font-serif text-4xl font-light text-cream mb-1">{value}</p>
      <Show when={sub}>
        <p class="font-sans text-xs text-cream/40">{sub}</p>
      </Show>
    </div>
  );
}

function StatusDot({ status }) {
  const color = () => {
    if (status === 'connected') return '#4ade80';
    if (status === 'awaiting_scan') return '#facc15';
    if (status === 'initializing') return '#60a5fa';
    return '#6b7280';
  };
  return (
    <span
      class="inline-block w-2 h-2 rounded-full mr-2"
      style={`background: ${color()}`}
    />
  );
}

export default function AdminPanel() {
  const [locked, setLocked] = createSignal(true);
  const [password, setPassword] = createSignal('');
  const [authError, setAuthError] = createSignal('');
  const [activeTab, setActiveTab] = createSignal('guests'); // 'guests' | 'whatsapp'

  // Guests state
  const [guests, setGuests] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [fetchError, setFetchError] = createSignal('');
  const [deletingId, setDeletingId] = createSignal(null);

  // WhatsApp state
  const [waStatus, setWaStatus] = createSignal({ idan: 'disconnected', vered: 'disconnected' });
  const [qrData, setQrData] = createSignal({ idan: null, vered: null });
  const [sendingWA, setSendingWA] = createSignal(null); // guest id being sent
  const [waError, setWaError] = createSignal('');

  let pollInterval;

  const attendingCount = () => guests().filter((g) => g.attending === 1 || g.attending === true).length;
  const declinedCount = () => guests().filter((g) => g.attending === 0 || g.attending === false).length;
  const plusOneCount = () => guests().filter((g) => g.plus_one === 1 || g.plus_one === true).length;

  const adminHeaders = () => ({ 'X-Admin-Password': ADMIN_PASSWORD, 'Content-Type': 'application/json' });

  // ── Guests ────────────────────────────────────────────────────────────────
  const fetchGuests = async () => {
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch(`${API}/guests`, { headers: adminHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGuests(await res.json());
    } catch (err) {
      setFetchError(err.message || 'Failed to load guest list.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove this guest from the list?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API}/guests/${id}`, { method: 'DELETE', headers: adminHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGuests((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  const pollWaStatus = async () => {
    try {
      const res = await fetch(`${API}/whatsapp/status`, { headers: adminHeaders() });
      if (res.ok) setWaStatus(await res.json());
    } catch {}
  };

  const fetchQr = async (sender) => {
    try {
      const res = await fetch(`${API}/whatsapp/qr/${sender}`, { headers: adminHeaders() });
      if (res.ok) {
        const data = await res.json();
        setQrData((prev) => ({ ...prev, [sender]: data.qr }));
      }
    } catch {}
  };

  const connectSender = async (sender) => {
    try {
      await fetch(`${WA_SERVICE}/connect/${sender}`, { method: 'POST' });
      // start polling for QR
      const poll = setInterval(async () => {
        await fetchQr(sender);
        await pollWaStatus();
        if (waStatus()[sender] === 'connected') clearInterval(poll);
      }, 2000);
    } catch (err) {
      setWaError(`Cannot reach WhatsApp service: ${err.message}`);
    }
  };

  const sendInvitation = async (guest, sender) => {
    if (!guest.phone) return alert('This guest has no phone number.');
    setSendingWA(guest.id);
    setWaError('');
    try {
      const res = await fetch(`${API}/whatsapp/send`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ sender, guest_id: guest.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      // refresh guests to update sent flags
      await fetchGuests();
    } catch (err) {
      setWaError(`Send failed: ${err.message}`);
    } finally {
      setSendingWA(null);
    }
  };

  // ── Auth ──────────────────────────────────────────────────────────────────
  const handleUnlock = (e) => {
    e.preventDefault();
    if (password() === ADMIN_PASSWORD) {
      setLocked(false);
      setAuthError('');
      fetchGuests();
      pollWaStatus();
      pollInterval = setInterval(pollWaStatus, 5000);
    } else {
      setAuthError('Incorrect password.');
    }
  };

  onCleanup(() => clearInterval(pollInterval));

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return dateStr; }
  };

  return (
    <div class="min-h-screen bg-bg px-6 py-16">
      <div class="max-w-6xl mx-auto">
        {/* Header */}
        <div class="text-center mb-16">
          <p class="font-sans text-xs tracking-[0.4em] text-gold uppercase mb-4">Administration</p>
          <h1 class="font-serif text-5xl font-light text-cream mb-4">Guest Panel</h1>
          <div class="h-px w-24 mx-auto bg-gold/30 mb-4" />
          <p class="font-sans text-sm text-cream/40">Idan &amp; Vered · June 14, 2027</p>
        </div>

        {/* ── Password gate ── */}
        <Show when={locked()}>
          <div class="max-w-sm mx-auto">
            <form onSubmit={handleUnlock} class="p-8 border border-gold/20 bg-white/[0.02]">
              <div class="text-center mb-8">
                <div class="text-3xl text-gold mb-4">◇</div>
                <h2 class="font-serif text-2xl font-light text-cream mb-2">Restricted Access</h2>
                <p class="font-sans text-xs text-cream/40">Enter the admin password</p>
              </div>
              <div class="mb-4">
                <label class="block font-sans text-xs tracking-widest text-gold uppercase mb-2">Password</label>
                <input
                  type="password"
                  value={password()}
                  onInput={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  class="w-full bg-white/[0.03] border border-gold/20 text-cream placeholder-cream/20 font-sans text-sm px-4 py-3"
                  style="outline:none"
                  autofocus
                />
              </div>
              <Show when={authError()}>
                <div class="mb-4 px-3 py-2 border border-red-400/30 bg-red-400/10">
                  <p class="font-sans text-xs text-red-300">{authError()}</p>
                </div>
              </Show>
              <button
                type="submit"
                class="w-full py-3 font-sans text-xs tracking-[0.3em] uppercase border border-gold/40 text-gold bg-gold/5 hover:bg-gold/15 transition-all duration-300"
              >
                Unlock
              </button>
            </form>
          </div>
        </Show>

        {/* ── Dashboard ── */}
        <Show when={!locked()}>
          {/* Stats */}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            <StatCard label="Total RSVPs" value={guests().length} sub="responses" />
            <StatCard label="Attending" value={attendingCount()} sub="confirmed" />
            <StatCard label="Declined" value={declinedCount()} sub="not coming" />
            <StatCard label="Plus Ones" value={plusOneCount()} sub="extra guests" />
          </div>

          {/* Tabs */}
          <div class="flex gap-1 mb-8 border-b border-gold/10">
            {['guests', 'whatsapp'].map((tab) => (
              <button
                onClick={() => setActiveTab(tab)}
                class="px-6 py-3 font-sans text-xs tracking-widest uppercase transition-all duration-200"
                style={
                  activeTab() === tab
                    ? 'color: #C9A96E; border-bottom: 1px solid #C9A96E; margin-bottom: -1px'
                    : 'color: rgba(245,230,211,0.3)'
                }
              >
                {tab === 'whatsapp' ? '💬 WhatsApp' : tab}
              </button>
            ))}
          </div>

          {/* ── Guests Tab ── */}
          <Show when={activeTab() === 'guests'}>
            <div class="flex justify-between items-center mb-6">
              <h2 class="font-serif text-2xl font-light text-cream">Guest List</h2>
              <button
                onClick={fetchGuests}
                disabled={loading()}
                class="font-sans text-xs tracking-widest text-gold border border-gold/30 px-4 py-2 hover:bg-gold/10 transition-all duration-300 disabled:opacity-40"
              >
                {loading() ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            <Show when={fetchError()}>
              <div class="mb-6 px-4 py-3 border border-red-400/30 bg-red-400/10">
                <p class="font-sans text-sm text-red-300">{fetchError()}</p>
              </div>
            </Show>

            <Show when={loading()}>
              <div class="text-center py-16">
                <svg class="animate-spin w-6 h-6 text-gold mx-auto" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            </Show>

            <Show when={!loading() && guests().length === 0}>
              <div class="text-center py-16 border border-gold/10">
                <div class="text-4xl text-gold/30 mb-4">◇</div>
                <p class="font-serif text-xl text-cream/30">No RSVPs yet</p>
              </div>
            </Show>

            <Show when={!loading() && guests().length > 0}>
              <div class="overflow-x-auto">
                <table class="w-full border-collapse">
                  <thead>
                    <tr class="border-b border-gold/20">
                      {['#', 'Name', 'Attending', '+1', 'Phone', 'Dietary', 'Message', 'Date', ''].map((h) => (
                        <th class="text-left py-3 px-3 font-sans text-xs tracking-widest text-gold uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <For each={guests()}>
                      {(guest, index) => {
                        const isAttending = guest.attending === 1 || guest.attending === true;
                        const hasPlusOne = guest.plus_one === 1 || guest.plus_one === true;
                        return (
                          <tr
                            class="border-b border-gold/5 hover:bg-white/[0.02] transition-colors duration-150"
                            style={index() % 2 === 0 ? '' : 'background: rgba(255,255,255,0.008)'}
                          >
                            <td class="py-3 px-3 font-sans text-xs text-cream/30">{guest.id}</td>
                            <td class="py-3 px-3 font-sans text-sm text-cream font-medium">{guest.name}</td>
                            <td class="py-3 px-3">
                              <span
                                class="font-sans text-xs px-2 py-1 border"
                                style={
                                  isAttending
                                    ? 'border-color: rgba(201,169,110,0.4); color: #C9A96E; background: rgba(201,169,110,0.08)'
                                    : 'border-color: rgba(255,255,255,0.1); color: rgba(245,230,211,0.35)'
                                }
                              >
                                {isAttending ? 'Yes' : 'No'}
                              </span>
                            </td>
                            <td class="py-3 px-3 font-sans text-sm text-cream/50">{hasPlusOne ? '✓' : '—'}</td>
                            <td class="py-3 px-3 font-sans text-xs text-cream/50">{guest.phone || '—'}</td>
                            <td class="py-3 px-3 font-sans text-xs text-cream/50 max-w-[120px]">
                              <span class="truncate block">{guest.dietary || '—'}</span>
                            </td>
                            <td class="py-3 px-3 font-sans text-xs text-cream/50 max-w-[160px]">
                              <span class="truncate block italic">{guest.message || '—'}</span>
                            </td>
                            <td class="py-3 px-3 font-sans text-xs text-cream/30 whitespace-nowrap">
                              {formatDate(guest.created_at)}
                            </td>
                            <td class="py-3 px-3">
                              <button
                                onClick={() => handleDelete(guest.id)}
                                disabled={deletingId() === guest.id}
                                class="font-sans text-xs text-red-400/50 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 px-2 py-1 transition-all duration-200 disabled:opacity-30"
                              >
                                {deletingId() === guest.id ? '…' : 'Del'}
                              </button>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
              <div class="mt-4 pt-4 border-t border-gold/10 flex justify-between">
                <p class="font-sans text-xs text-cream/30">{guests().length} response{guests().length !== 1 ? 's' : ''}</p>
                <p class="font-sans text-xs text-cream/30">{attendingCount()} attending · {attendingCount() + plusOneCount()} total expected</p>
              </div>
            </Show>
          </Show>

          {/* ── WhatsApp Tab ── */}
          <Show when={activeTab() === 'whatsapp'}>
            <Show when={waError()}>
              <div class="mb-6 px-4 py-3 border border-red-400/30 bg-red-400/10">
                <p class="font-sans text-sm text-red-300">{waError()}</p>
              </div>
            </Show>

            {/* Connection cards */}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
              {['idan', 'vered'].map((sender) => (
                <div class="p-6 border border-gold/20 bg-white/[0.02]">
                  <div class="flex items-center justify-between mb-4">
                    <h3 class="font-serif text-xl text-cream capitalize">{sender}'s WhatsApp</h3>
                    <div class="flex items-center font-sans text-xs text-cream/50">
                      <StatusDot status={waStatus()[sender]} />
                      {waStatus()[sender]}
                    </div>
                  </div>

                  {/* QR Code */}
                  <Show when={waStatus()[sender] === 'awaiting_scan' && qrData()[sender]}>
                    <div class="mb-4 text-center">
                      <p class="font-sans text-xs text-cream/50 mb-3">Scan with {sender}'s phone → WhatsApp → Linked Devices</p>
                      <img
                        src={qrData()[sender]}
                        alt="WhatsApp QR"
                        class="mx-auto border-4 border-white"
                        style="width: 200px; height: 200px"
                      />
                    </div>
                  </Show>

                  <Show when={waStatus()[sender] === 'connected'}>
                    <p class="font-sans text-xs text-green-400/70 mb-4">✓ Connected and ready to send</p>
                  </Show>

                  <Show when={waStatus()[sender] !== 'connected'}>
                    <button
                      onClick={() => connectSender(sender)}
                      class="w-full py-2 font-sans text-xs tracking-widest uppercase border border-gold/40 text-gold bg-gold/5 hover:bg-gold/15 transition-all duration-300"
                    >
                      {waStatus()[sender] === 'initializing' ? 'Starting…' : 'Connect'}
                    </button>
                  </Show>
                </div>
              ))}
            </div>

            {/* Send invitations table */}
            <h2 class="font-serif text-2xl font-light text-cream mb-6">Send Invitations</h2>
            <p class="font-sans text-xs text-cream/40 mb-6">
              Only guests with a phone number can receive WhatsApp invitations. Connect at least one account above first.
            </p>

            <Show when={guests().filter(g => g.phone).length === 0}>
              <div class="text-center py-10 border border-gold/10">
                <p class="font-sans text-sm text-cream/30">No guests with phone numbers yet</p>
              </div>
            </Show>

            <Show when={guests().filter(g => g.phone).length > 0}>
              <div class="overflow-x-auto">
                <table class="w-full border-collapse">
                  <thead>
                    <tr class="border-b border-gold/20">
                      {['Name', 'Phone', 'Send via Idan', 'Send via Vered'].map(h => (
                        <th class="text-left py-3 px-4 font-sans text-xs tracking-widest text-gold uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <For each={guests().filter(g => g.phone)}>
                      {(guest) => (
                        <tr class="border-b border-gold/5 hover:bg-white/[0.02]">
                          <td class="py-3 px-4 font-sans text-sm text-cream">{guest.name}</td>
                          <td class="py-3 px-4 font-sans text-xs text-cream/50">{guest.phone}</td>
                          {['idan', 'vered'].map((sender) => {
                            const sentKey = `whatsapp_sent_${sender}`;
                            const alreadySent = guest[sentKey];
                            const isConnected = waStatus()[sender] === 'connected';
                            return (
                              <td class="py-3 px-4">
                                {alreadySent ? (
                                  <span class="font-sans text-xs text-green-400/60">✓ Sent</span>
                                ) : (
                                  <button
                                    onClick={() => sendInvitation(guest, sender)}
                                    disabled={!isConnected || sendingWA() === guest.id}
                                    class="font-sans text-xs px-3 py-1 border transition-all duration-200"
                                    style={
                                      !isConnected
                                        ? 'border-color: rgba(255,255,255,0.1); color: rgba(245,230,211,0.2); cursor:not-allowed'
                                        : 'border-color: rgba(201,169,110,0.4); color: #C9A96E; cursor:pointer'
                                    }
                                  >
                                    {sendingWA() === guest.id ? '…' : isConnected ? 'Send' : 'Offline'}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
}
