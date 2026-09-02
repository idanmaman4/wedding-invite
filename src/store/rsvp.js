import { createSignal } from 'solid-js';

// Global signals for RSVP submission state
const [submitting, setSubmitting] = createSignal(false);
const [submitted, setSubmitted] = createSignal(false);
const [submitError, setSubmitError] = createSignal(null);
const [submitResult, setSubmitResult] = createSignal(null);

/**
 * Submit an RSVP to the backend API.
 * @param {{ name: string, attending: boolean, plus_one: boolean, dietary: string, message: string }} formData
 * @returns {Promise<{ id: number, success: boolean, message: string }>}
 */
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
        plus_one: formData.plus_one,
        dietary: formData.dietary || '',
        message: formData.message || '',
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(err.detail || `HTTP ${response.status}`);
    }

    const result = await response.json();
    setSubmitResult(result);
    setSubmitted(true);
    return result;
  } catch (err) {
    setSubmitError(err.message || 'Failed to submit RSVP. Please try again.');
    throw err;
  } finally {
    setSubmitting(false);
  }
}

export { submitting, setSubmitting, submitted, setSubmitted, submitError, setSubmitError, submitResult };
