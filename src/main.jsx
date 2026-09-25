import { render } from 'solid-js/web';
import { ErrorBoundary, createSignal, Show, Switch, Match } from 'solid-js';
import HomePage from './App';
import AdminPanel from './components/AdminPanel';
import Confirmed from './components/Confirmed';
import AnsweredInvite from './components/AnsweredInvite';
import { readInviteToken, fetchInvite } from './store/rsvp';
import './index.css';

function RootError(err) {
  return (
    <div style="padding:40px;color:#1A0A0A;font-family:monospace;background:#FDFAF7;min-height:100vh">
      <p style="font-size:1.2rem;margin-bottom:1rem;color:#B22222">שגיאת רינדור — בדקו את הקונסול</p>
      <pre style="color:#8B6347;font-size:0.75rem;white-space:pre-wrap">{String(err?.message || err)}</pre>
    </div>
  );
}

// Simple path-based routing — no external router package needed for 3 pages
/**
 * A personal link that was already answered opens as the static details page
 * (AnsweredInvite): no loader, rings, vines or scroll animations. So with a
 * token, look the invite up first — rendering nothing meanwhile leaves the
 * static placeholder from index.html on screen. Any failure or a slow API
 * (4s) falls back to the normal invitation, which never blocks a guest.
 */
function InviteGate(props) {
  const [state, setState] = createSignal({ ready: false, invite: null });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 4000));
  Promise.race([fetchInvite(props.token), timeout]).then((invite) => setState({ ready: true, invite }));
  return (
    <Show when={state().ready}>
      <Switch fallback={<HomePage />}>
        <Match when={state().invite && state().invite.responded}>
          <AnsweredInvite invite={state().invite} token={props.token} />
        </Match>
      </Switch>
    </Show>
  );
}

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/admin')) return <AdminPanel />;
  if (path.startsWith('/confirmed')) return <Confirmed />;
  const token = readInviteToken();
  if (token) return <InviteGate token={token} />;
  return <HomePage />;
}

render(
  () => (
    <ErrorBoundary fallback={RootError}>
      <App />
    </ErrorBoundary>
  ),
  document.getElementById('root')
);
