import { onMount, onCleanup } from 'solid-js';
import { gsap } from '../animations/gsapSetup';

export default function Nav() {
  let navRef;

  onMount(() => {
    if (!navRef) return;

    let lastScrollY = 0;
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const currentScrollY = window.scrollY;
          if (currentScrollY > lastScrollY && currentScrollY > 80) {
            gsap.to(navRef, { y: -80, duration: 0.35, ease: 'power2.inOut' });
          } else {
            gsap.to(navRef, { y: 0, duration: 0.35, ease: 'power2.inOut' });
          }
          lastScrollY = currentScrollY;
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', handleScroll));
  });

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const linkStyle = 'font-sans text-xs tracking-[0.3em] uppercase transition-colors duration-300 cursor-pointer bg-transparent border-none';

  return (
    <nav
      ref={navRef}
      class="fixed top-0 left-0 right-0 z-50 px-8 py-5 flex items-center justify-between"
      style="
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        background: rgba(253,250,247,0.88);
        border-bottom: 1px solid rgba(201,169,110,0.18);
        box-shadow: 0 1px 16px rgba(201,169,110,0.06);
      "
    >
      {/* Monogram */}
      <a
        href="/"
        class="font-serif text-2xl font-light tracking-wider transition-colors duration-300 cursor-pointer"
        style="color: #C9A96E; text-decoration:none"
        onMouseEnter={(e) => e.target.style.color = '#8B6347'}
        onMouseLeave={(e) => e.target.style.color = '#C9A96E'}
      >
        I &amp; V
      </a>

      {/* Desktop links */}
      <div class="hidden md:flex items-center gap-8">
        <button
          onClick={() => scrollTo('details')}
          class={linkStyle}
          style="color: #1A3A6B"
          onMouseEnter={(e) => e.target.style.color = '#C9A96E'}
          onMouseLeave={(e) => e.target.style.color = '#1A3A6B'}
        >
          Details
        </button>
        <button
          onClick={() => scrollTo('rsvp')}
          class={linkStyle}
          style="color: #1A3A6B"
          onMouseEnter={(e) => e.target.style.color = '#C9A96E'}
          onMouseLeave={(e) => e.target.style.color = '#1A3A6B'}
        >
          RSVP
        </button>
        <a
          href="/admin"
          class="font-sans text-xs tracking-[0.3em] uppercase transition-colors duration-300"
          style="color: rgba(26,58,107,0.4); text-decoration:none"
          onMouseEnter={(e) => e.target.style.color = '#B22222'}
          onMouseLeave={(e) => e.target.style.color = 'rgba(26,58,107,0.4)'}
        >
          Admin
        </a>
      </div>

      {/* Mobile RSVP button */}
      <div class="md:hidden">
        <button
          onClick={() => scrollTo('rsvp')}
          class="font-sans text-xs tracking-[0.25em] uppercase px-4 py-2 transition-all duration-300 bg-transparent cursor-pointer"
          style="color: #C9A96E; border: 1px solid rgba(201,169,110,0.4)"
          onMouseEnter={(e) => { e.target.style.background = 'rgba(201,169,110,0.1)'; }}
          onMouseLeave={(e) => { e.target.style.background = 'transparent'; }}
        >
          RSVP
        </button>
      </div>
    </nav>
  );
}
