import { createSignal, createRoot } from 'solid-js';

const [submitting, setSubmitting, submitted, setSubmitted, submitError, setSubmitError, submitResult, setSubmitResult] =
  createRoot(() => {
    const [submitting, setSubmitting] = createSignal(false);
    const [submitted, setSubmitted] = createSignal(false);
    const [submitError, setSubmitError] = createSignal(null);
    const [submitResult, setSubmitResult] = createSignal(null);
    return [submitting, setSubmitting, submitted, setSubmitted, submitError, setSubmitError, submitResult, setSubmitResult];
  });

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
        plus_one: formData.plus_one ?? false,
        dietary: formData.dietary || '',
        message: formData.message || '',
        phone: formData.phone || '',
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
    setSubmitError(err.message || 'Failed to submit. Please try again.');
    throw err;
  } finally {
    setSubmitting(false);
  }
}

export { submitting, submitted, submitError, submitResult };
