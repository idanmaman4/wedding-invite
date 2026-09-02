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
      style="backdrop-filter: blur(12px); background: rgba(253,250,247,0.85); border-bottom: 1px solid rgba(178,34,34,0.12)"
    >
      {/* Monogram */}
      <a
        href="/"
        class="font-serif text-2xl font-light tracking-wider transition-colors duration-300 cursor-pointer"
        style="color: #8B6347; text-decoration:none"
      >
        I &amp; V
      </a>

      {/* Navigation links */}
      <div class="hidden md:flex items-center gap-8">
        <button
          onClick={() => scrollTo('details')}
          class="font-sans text-xs tracking-[0.3em] uppercase transition-colors duration-300 cursor-pointer bg-transparent border-none"
          style="color: rgba(26,10,10,0.6)"
          onMouseEnter={(e) => e.target.style.color = '#B22222'}
          onMouseLeave={(e) => e.target.style.color = 'rgba(26,10,10,0.6)'}
        >
          Details
        </button>
        <button
          onClick={() => scrollTo('rsvp')}
          class="font-sans text-xs tracking-[0.3em] uppercase transition-colors duration-300 cursor-pointer bg-transparent border-none"
          style="color: rgba(26,10,10,0.6)"
          onMouseEnter={(e) => e.target.style.color = '#B22222'}
          onMouseLeave={(e) => e.target.style.color = 'rgba(26,10,10,0.6)'}
        >
          RSVP
        </button>
        <a
          href="/admin"
          class="font-sans text-xs tracking-[0.3em] uppercase transition-colors duration-300"
          style="color: rgba(26,10,10,0.35); text-decoration:none"
          onMouseEnter={(e) => e.target.style.color = '#B22222'}
          onMouseLeave={(e) => e.target.style.color = 'rgba(26,10,10,0.35)'}
        >
          Admin
        </a>
      </div>

      {/* Mobile — RSVP button only */}
      <div class="md:hidden">
        <button
          onClick={() => scrollTo('rsvp')}
          class="font-sans text-xs tracking-[0.25em] uppercase px-4 py-2 transition-all duration-300 bg-transparent cursor-pointer"
          style="color: #B22222; border: 1px solid rgba(178,34,34,0.3)"
          onMouseEnter={(e) => e.target.style.background = 'rgba(178,34,34,0.08)'}
          onMouseLeave={(e) => e.target.style.background = 'transparent'}
        >
          RSVP
        </button>
      </div>
    </nav>
  );
}
