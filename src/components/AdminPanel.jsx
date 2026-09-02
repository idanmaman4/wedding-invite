import { createSignal, onMount, Show, For } from 'solid-js';

const ADMIN_PASSWORD = 'wedding2027';

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

export default function AdminPanel() {
  const [locked, setLocked] = createSignal(true);
  const [password, setPassword] = createSignal('');
  const [authError, setAuthError] = createSignal('');
  const [guests, setGuests] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [fetchError, setFetchError] = createSignal('');
  const [deletingId, setDeletingId] = createSignal(null);

  const attendingCount = () => guests().filter((g) => g.attending === 1 || g.attending === true).length;
  const declinedCount = () => guests().filter((g) => g.attending === 0 || g.attending === false).length;
  const plusOneCount = () => guests().filter((g) => g.plus_one === 1 || g.plus_one === true).length;

  const fetchGuests = async () => {
    setLoading(true);
    setFetchError('');
    try {
      const res = await fetch('/api/guests', {
        headers: { 'X-Admin-Password': ADMIN_PASSWORD },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGuests(data);
    } catch (err) {
      setFetchError(err.message || 'Failed to load guest list.');
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = (e) => {
    e.preventDefault();
    if (password() === ADMIN_PASSWORD) {
      setLocked(false);
      setAuthError('');
      fetchGuests();
    } else {
      setAuthError('Incorrect password. Please try again.');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remove this guest from the list?')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/guests/${id}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Password': ADMIN_PASSWORD },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGuests((prev) => prev.filter((g) => g.id !== id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div class="min-h-screen bg-bg px-6 py-16">
      <div class="max-w-6xl mx-auto">

        {/* Header */}
        <div class="text-center mb-16">
          <p class="font-sans text-xs tracking-[0.4em] text-gold uppercase mb-4">
            Administration
          </p>
          <h1 class="font-serif text-5xl font-light text-cream mb-4">
            Guest Panel
          </h1>
          <div class="gold-divider max-w-xs mx-auto" />
          <p class="mt-4 font-sans text-sm text-cream/40">
            Idan &amp; Vered · June 14, 2027
          </p>
        </div>

        {/* Locked — Password gate */}
        <Show when={locked()}>
          <div class="max-w-sm mx-auto">
            <form
              onSubmit={handleUnlock}
              class="p-8 border border-gold/20 bg-white/[0.02]"
            >
              <div class="text-center mb-8">
                <div class="text-3xl text-gold mb-4">◇</div>
                <h2 class="font-serif text-2xl font-light text-cream mb-2">
                  Restricted Access
                </h2>
                <p class="font-sans text-xs text-cream/40">
                  Enter the admin password to continue
                </p>
              </div>

              <div class="mb-4">
                <label class="block font-sans text-xs tracking-widest text-gold uppercase mb-2">
                  Password
                </label>
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

        {/* Unlocked — Dashboard */}
        <Show when={!locked()}>
          {/* Stats row */}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            <StatCard label="Total RSVPs" value={guests().length} sub="responses received" />
            <StatCard label="Attending" value={attendingCount()} sub="confirmed yes" />
            <StatCard label="Declined" value={declinedCount()} sub="regretfully declining" />
            <StatCard label="Plus Ones" value={plusOneCount()} sub="additional guests" />
          </div>

          {/* Refresh button */}
          <div class="flex justify-between items-center mb-6">
            <h2 class="font-serif text-2xl font-light text-cream">
              Guest List
            </h2>
            <button
              onClick={fetchGuests}
              disabled={loading()}
              class="font-sans text-xs tracking-widest text-gold border border-gold/30 px-4 py-2 hover:bg-gold/10 transition-all duration-300 disabled:opacity-40"
            >
              {loading() ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {/* Error */}
          <Show when={fetchError()}>
            <div class="mb-6 px-4 py-3 border border-red-400/30 bg-red-400/10">
              <p class="font-sans text-sm text-red-300">{fetchError()}</p>
            </div>
          </Show>

          {/* Loading */}
          <Show when={loading()}>
            <div class="text-center py-16">
              <div class="inline-flex items-center gap-3 text-cream/40 font-sans text-sm">
                <svg class="animate-spin w-4 h-4 text-gold" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading guest list…
              </div>
            </div>
          </Show>

          {/* Empty state */}
          <Show when={!loading() && guests().length === 0}>
            <div class="text-center py-16 border border-gold/10">
              <div class="text-4xl text-gold/30 mb-4">◇</div>
              <p class="font-serif text-xl text-cream/30">No RSVPs received yet</p>
              <p class="font-sans text-xs text-cream/20 mt-2">Check back after sharing the invitation</p>
            </div>
          </Show>

          {/* Guest table */}
          <Show when={!loading() && guests().length > 0}>
            <div class="overflow-x-auto">
              <table class="w-full border-collapse">
                <thead>
                  <tr class="border-b border-gold/20">
                    <th class="text-left py-3 px-4 font-sans text-xs tracking-widest text-gold uppercase">#</th>
                    <th class="text-left py-3 px-4 font-sans text-xs tracking-widest text-gold uppercase">Name</th>
                    <th class="text-left py-3 px-4 font-sans text-xs tracking-widest text-gold uppercase">Attending</th>
                    <th class="text-left py-3 px-4 font-sans text-xs tracking-widest text-gold uppercase">+1</th>
                    <th class="text-left py-3 px-4 font-sans text-xs tracking-widest text-gold uppercase">Dietary</th>
                    <th class="text-left py-3 px-4 font-sans text-xs tracking-widest text-gold uppercase">Message</th>
                    <th class="text-left py-3 px-4 font-sans text-xs tracking-widest text-gold uppercase">Date</th>
                    <th class="py-3 px-4" />
                  </tr>
                </thead>
                <tbody>
                  <For each={guests()}>
                    {(guest, index) => {
                      const isAttending = guest.attending === 1 || guest.attending === true;
                      const hasPlusOne = guest.plus_one === 1 || guest.plus_one === true;
                      return (
                        <tr
                          class="border-b border-gold/5 transition-colors duration-200"
                          style={index() % 2 === 0 ? 'background: rgba(255,255,255,0.01)' : ''}
                          classList={{ 'hover:bg-white/[0.03]': true }}
                        >
                          <td class="py-4 px-4 font-sans text-xs text-cream/30">{guest.id}</td>
                          <td class="py-4 px-4 font-sans text-sm text-cream font-medium">{guest.name}</td>
                          <td class="py-4 px-4">
                            <span
                              class="font-sans text-xs tracking-wider px-2 py-1 border"
                              style={
                                isAttending
                                  ? 'border-color: rgba(201,169,110,0.4); color: #C9A96E; background: rgba(201,169,110,0.08)'
                                  : 'border-color: rgba(255,255,255,0.1); color: rgba(245,230,211,0.35)'
                              }
                            >
                              {isAttending ? 'Yes' : 'No'}
                            </span>
                          </td>
                          <td class="py-4 px-4 font-sans text-sm text-cream/50">
                            {hasPlusOne ? '✓' : '—'}
                          </td>
                          <td class="py-4 px-4 font-sans text-xs text-cream/50 max-w-[150px]">
                            <span class="truncate block">{guest.dietary || '—'}</span>
                          </td>
                          <td class="py-4 px-4 font-sans text-xs text-cream/50 max-w-[200px]">
                            <span class="truncate block italic">{guest.message || '—'}</span>
                          </td>
                          <td class="py-4 px-4 font-sans text-xs text-cream/30 whitespace-nowrap">
                            {formatDate(guest.created_at)}
                          </td>
                          <td class="py-4 px-4">
                            <button
                              onClick={() => handleDelete(guest.id)}
                              disabled={deletingId() === guest.id}
                              class="font-sans text-xs text-red-400/50 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 px-2 py-1 transition-all duration-200 disabled:opacity-30"
                            >
                              {deletingId() === guest.id ? '…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>

            {/* Table footer summary */}
            <div class="mt-6 pt-4 border-t border-gold/10 flex justify-between items-center">
              <p class="font-sans text-xs text-cream/30">
                Showing {guests().length} response{guests().length !== 1 ? 's' : ''}
              </p>
              <p class="font-sans text-xs text-cream/30">
                {attendingCount()} attending · {plusOneCount()} plus ones · {attendingCount() + plusOneCount()} total expected
              </p>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
