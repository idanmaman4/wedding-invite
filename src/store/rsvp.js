import { createSignal, createRoot } from 'solid-js';

const [submitting, setSubmitting, submitted, setSubmitted, submitError, setSubmitError, submitResult, setSubmitResult] =
  createRoot(() => {
    const [submitting, setSubmitting] = createSignal(false);
    const [submitted, setSubmitted] = createSignal(false);
    const [submitError, setSubmitError] = createSignal(null);
    const [submitResult, setSubmitResult] = createSignal(null);
    return [submitting, setSubmitting, submitted, setSubmitted, submitError, setSubmitError, submitResult, setSubmitResult];
  });

/** Read the personal-invite token from the URL: `?i=<token>` or `#i=<token>`. */
export function readInviteToken() {
  if (typeof window === 'undefined') return '';
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('i');
    if (fromQuery) return fromQuery.trim();
    // Some messaging apps mangle query strings; accept the hash form too.
    const hash = (window.location.hash || '').replace(/^#/, '');
    const fromHash = new URLSearchParams(hash.includes('=') ? hash : '').get('i');
    return (fromHash || '').trim();
  } catch {
    return '';
  }
}

/**
 * Look up a personal invite. Returns null for "no token" and for any failure —
 * an unreachable API must never block the ordinary RSVP flow.
 */
export async function fetchInvite(token) {
  if (!token) return null;
  try {
    const res = await fetch(`/api/invite/${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function submitRSVP(formData) {
  setSubmitting(true);
  setSubmitError(null);

  try {
    const response = await fetch('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.name,
        attending: formData.attending,
        guests: formData.guests ?? 1,
        // Legacy flag kept for older API builds; the server re-derives it.
        plus_one: (formData.guests ?? 1) > 1,
        dietary: formData.dietary || '',
        message: formData.message || '',
        phone: formData.phone || '',
        // Links the row to the personal invite so a re-submit edits it.
        invite_token: formData.invite_token || null,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'שגיאה לא ידועה' }));
      // FastAPI validation errors (422) carry `detail` as a list of objects,
      // which would show as "[object Object]"; guests get a plain sentence.
      const detail = typeof err.detail === 'string' ? err.detail : 'חלק מהפרטים לא תקינים, בדקו ונסו שוב.';
      const error = new Error(response.status >= 500 ? 'השליחה נכשלה, נסו שוב בעוד רגע.' : detail);
      // 409: this personal link was already answered (another tab, a second
      // tap). The form shows the invitation and the answer instead of an error.
      error.status = response.status;
      throw error;
    }

    const result = await response.json();
    setSubmitResult(result);
    setSubmitted(true);
    return result;
  } catch (err) {
    setSubmitError(err.message || 'השליחה נכשלה, נסו שוב.');
    throw err;
  } finally {
    setSubmitting(false);
  }
}

export { submitting, submitted, submitError, submitResult };

/**
 * A guest who confirmed says they can't make it after all (from their
 * personal link). Resolves true once recorded (also when it already was).
 */
export async function cancelAttendance(token) {
  const res = await fetch(`/api/invite/${encodeURIComponent(token)}/cancel`, { method: 'POST' });
  if (!res.ok) throw new Error('העדכון לא נשמר, נסו שוב בעוד רגע.');
  return true;
}
