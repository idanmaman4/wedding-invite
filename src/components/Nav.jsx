import { onMount, onCleanup } from 'solid-js';
import { gsap, ScrollTrigger } from '../animations/gsapSetup';

export default function Nav() {
  let navRef;

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  onMount(() => {
    if (!navRef) return;

    let lastScrollY = 0;
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;
          if (currentScrollY > lastScrollY && currentScrollY > 80) {
            // Scrolling down — hide nav
            gsap.to(navRef, { y: -80, duration: 0.35, ease: 'power2.inOut' });
          } else {
            // Scrolling up — show nav
            gsap.to(navRef, { y: 0, duration: 0.35, ease: 'power2.inOut' });
          }
          lastScrollY = currentScrollY;
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    onCleanup(() => {
      window.removeEventListener('scroll', handleScroll);
    });
  });

  return (
    <nav
      ref={navRef}
      class="fixed top-0 left-0 right-0 z-50 px-8 py-5 flex items-center justify-between"
      style="backdrop-filter: blur(12px); background: rgba(8,8,8,0.7); border-bottom: 1px solid rgba(201,169,110,0.08)"
    >
      {/* Monogram */}
      <a
        href="/"
        class="font-serif text-2xl font-light text-gold tracking-wider hover:text-gold-light transition-colors duration-300 cursor-pointer"
        style="text-decoration:none"
      >
        I &amp; V
      </a>

      {/* Navigation links */}
      <div class="hidden md:flex items-center gap-8">
        <button
          onClick={() => scrollTo('details')}
          class="font-sans text-xs tracking-[0.3em] text-cream/50 uppercase hover:text-gold transition-colors duration-300 cursor-pointer bg-transparent border-none"
        >
          Details
        </button>
        <button
          onClick={() => scrollTo('rsvp')}
          class="font-sans text-xs tracking-[0.3em] text-cream/50 uppercase hover:text-gold transition-colors duration-300 cursor-pointer bg-transparent border-none"
        >
          RSVP
        </button>
        <a
          href="/admin"
          class="font-sans text-xs tracking-[0.3em] text-cream/30 uppercase hover:text-gold transition-colors duration-300"
          style="text-decoration:none"
        >
          Admin
        </a>
      </div>

      {/* Mobile — RSVP button only */}
      <div class="md:hidden">
        <button
          onClick={() => scrollTo('rsvp')}
          class="font-sans text-xs tracking-[0.25em] text-gold border border-gold/30 px-4 py-2 uppercase hover:bg-gold/10 transition-all duration-300 bg-transparent cursor-pointer"
        >
          RSVP
        </button>
      </div>
    </nav>
  );
}
