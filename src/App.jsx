import { ErrorBoundary } from 'solid-js';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Details from './components/Details';
import RSVPForm from './components/RSVPForm';

function ErrorFallback(err) {
  return (
    <div style="padding:40px;color:#1A3A6B;font-family:monospace;background:#FDFAF7;min-height:100vh">
      <p style="font-size:1.2rem;margin-bottom:1rem;color:#B22222">Something went wrong</p>
      <pre style="color:#8B6347;font-size:0.8rem">{String(err)}</pre>
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <ErrorBoundary fallback={ErrorFallback}>
          <Hero />
        </ErrorBoundary>
        <Details />
        <RSVPForm />

        <footer
          class="py-16 text-center"
          style="border-top: 1px solid rgba(201,169,110,0.2)"
        >
          {/* Decorative flourish */}
          <div class="flex items-center justify-center gap-3 mb-6">
            <div class="h-px w-16" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.4))" />
            <span style="color: #C9A96E; font-size: 1.1rem">✦</span>
            <div class="h-px w-16" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.4))" />
          </div>

          {/* Names */}
          <p
            class="font-serif text-3xl font-light mb-2"
            style="color: #1A3A6B"
          >
            <span style="color: #1A3A6B">Idan</span>
            <span style="color: #C9A96E; margin: 0 0.2em">&amp;</span>
            <span style="color: #B22222">Vered</span>
          </p>

          <p
            class="font-sans text-xs tracking-[0.3em] uppercase mb-6"
            style="color: rgba(26,10,10,0.35)"
          >
            June 14, 2027 · The Garden Palace, Tel Aviv
          </p>

          <div class="h-px w-16 mx-auto mb-6" style="background: rgba(201,169,110,0.25)" />

          <p class="font-sans text-xs" style="color: rgba(26,10,10,0.25)">
            Made with love
          </p>
        </footer>
      </main>
    </>
  );
}
