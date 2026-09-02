import { Route } from '@solidjs/router';
import Hero from './components/Hero';
import Details from './components/Details';
import RSVPForm from './components/RSVPForm';
import AdminPanel from './components/AdminPanel';
import Nav from './components/Nav';

function Home() {
  return (
    <main>
      <Hero />
      <Details />
      <RSVPForm />
      {/* Footer */}
      <footer class="py-16 text-center border-t border-gold/10">
        <p class="font-serif text-2xl text-gold mb-2">Idan &amp; Vered</p>
        <p class="font-sans text-xs tracking-widest text-cream/30 uppercase">June 14, 2027 · The Garden Palace, Tel Aviv</p>
        <div class="mt-6 gold-divider max-w-xs mx-auto" />
        <p class="mt-6 font-sans text-xs text-cream/20">Made with love</p>
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <Route path="/" component={Home} />
      <Route path="/admin" component={AdminPanel} />
    </>
  );
}
