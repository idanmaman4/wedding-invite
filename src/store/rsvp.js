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
      throw new Error(err.detail || `HTTP ${response.status}`);
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
