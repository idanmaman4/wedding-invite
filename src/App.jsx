import { ErrorBoundary } from 'solid-js';
import Nav from './components/Nav';
import Hero from './components/Hero';
import Details from './components/Details';
import RSVPForm from './components/RSVPForm';

function ErrorFallback(err) {
  return (
    <div style="padding:40px;color:#C9A96E;font-family:monospace;background:#080808">
      <p style="font-size:1.2rem;margin-bottom:1rem">Something went wrong</p>
      <pre style="color:#888;font-size:0.8rem">{String(err)}</pre>
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
        <footer class="py-16 text-center border-t border-gold/10">
          <p class="font-serif text-2xl text-gold mb-2">Idan &amp; Vered</p>
          <p class="font-sans text-xs tracking-widest text-cream/30 uppercase">
            June 14, 2027 · The Garden Palace, Tel Aviv
          </p>
          <div class="h-px w-24 mx-auto bg-gold/20 mt-6 mb-6" />
          <p class="font-sans text-xs text-cream/20">Made with love</p>
        </footer>
      </main>
    </>
  );
}
