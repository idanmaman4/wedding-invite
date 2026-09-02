import { render } from 'solid-js/web';
import { ErrorBoundary, createSignal, Show } from 'solid-js';
import HomePage from './App';
import AdminPanel from './components/AdminPanel';
import './index.css';

function RootError(err) {
  return (
    <div style="padding:40px;color:#1A3A6B;font-family:monospace;background:#FDFAF7;min-height:100vh">
      <p style="font-size:1.2rem;margin-bottom:1rem;color:#B22222">Render error — check console</p>
      <pre style="color:#8B6347;font-size:0.75rem;white-space:pre-wrap">{String(err?.message || err)}</pre>
    </div>
  );
}

// Simple path-based routing — no external router package needed for 2 pages
function App() {
  const isAdmin = window.location.pathname.startsWith('/admin');
  return isAdmin ? <AdminPanel /> : <HomePage />;
}

render(
  () => (
    <ErrorBoundary fallback={RootError}>
      <App />
    </ErrorBoundary>
  ),
  document.getElementById('root')
);
