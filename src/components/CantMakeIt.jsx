import { createSignal, Show } from 'solid-js';
import { cancelAttendance } from '../store/rsvp';

/**
 * "לא נוכל להגיע" for a guest who confirmed: a quiet link, then a confirm
 * step (it frees their seats, so it must not be one accidental tap). Calls
 * props.onCancelled() once the server has recorded it.
 */
export default function CantMakeIt(props) {
  const [asking, setAsking] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await cancelAttendance(props.token);
      props.onCancelled?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const quiet = 'background: none; border: none; cursor: pointer; font-family: inherit; text-decoration: underline; text-underline-offset: 4px;';
  return (
    <div class="cant-make-it" style="margin-top: 22px; text-align: center;">
      <Show
        when={asking()}
        fallback={
          <button type="button" onClick={() => setAsking(true)} style={quiet + 'font-size: 0.9rem; color: rgba(26,10,10,0.5);'}>
            לא נוכל להגיע
          </button>
        }
      >
        <p style="font-size: 0.95rem; color: #1A0A0A; margin-bottom: 12px;">
          לעדכן שלא תוכלו להגיע? נצטער לא לראות אתכם.
        </p>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button
            type="button"
            disabled={busy()}
            onClick={confirm}
            style="padding: 10px 22px; border: 1px solid #B22222; background: #B22222; color: white; cursor: pointer; font-family: inherit; font-size: 0.95rem;"
          >
            {busy() ? 'מעדכנים…' : 'כן, לא נוכל להגיע'}
          </button>
          <button
            type="button"
            disabled={busy()}
            onClick={() => setAsking(false)}
            style="padding: 10px 22px; border: 1px solid rgba(26,10,10,0.2); background: white; color: #1A0A0A; cursor: pointer; font-family: inherit; font-size: 0.95rem;"
          >
            חזרה
          </button>
        </div>
        <Show when={error()}>
          <p style="margin-top: 10px; font-size: 0.85rem; color: #B22222;">{error()}</p>
        </Show>
      </Show>
    </div>
  );
}
