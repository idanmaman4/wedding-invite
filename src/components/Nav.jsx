import { onMount, onCleanup } from 'solid-js';
import { gsap } from '../animations/gsapSetup';
import { scrollToRSVP } from '../scrollToRSVP';

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
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // On pages without the section (e.g. /confirmed) fall back to the invitation.
    else window.location.assign(`/#${id}`);
  };

  // RSVP click bursts the hero ring immediately, then smooth-scrolls down.
  const goToRSVP = () => {
    window.dispatchEvent(new Event('wedding:rsvp-nav-click'));
    // Scrolls so the whole RSVP block (title, stage, button) fits short viewports.
    if (document.getElementById('rsvp')) scrollToRSVP();
    else window.location.assign('/#rsvp');
  };

  // Hebrew has no uppercase and reads badly with wide Latin-style tracking,
  // so links use a modest 0.08em spacing instead of the old 0.3em/uppercase.
  const linkStyle = 'font-sans text-sm font-normal tracking-[0.1em] transition-colors duration-300 cursor-pointer bg-transparent border-none';

  return (
    <nav
      ref={navRef}
      class="fixed top-0 left-0 right-0 z-50 px-8 py-5 flex items-center justify-between"
      style="
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        background: rgba(253,250,247,0.5);
        border-bottom: 1px solid rgba(201,169,110,0.18);
        box-shadow: 0 1px 16px rgba(201,169,110,0.06);
      "
    >
      {/* Monogram */}
      <a
        href="/"
        class="flex items-center gap-2 font-serif text-2xl font-light tracking-wider transition-colors duration-300 cursor-pointer"
        style="color: #C9A96E; text-decoration:none"
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#8B6347';
          e.currentTarget.querySelectorAll('circle[stroke]').forEach((c) => c.setAttribute('stroke', '#8B6347'));
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#C9A96E';
          e.currentTarget.querySelectorAll('circle[stroke]').forEach((c) => c.setAttribute('stroke', '#C9A96E'));
        }}
      >
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="13" cy="16" r="8" fill="none" stroke="#C9A96E" stroke-width="2.5" />
          <circle cx="19" cy="16" r="8" fill="none" stroke="#C9A96E" stroke-width="2.5" />
          <circle cx="16" cy="16" r="1.5" fill="#B22222" />
        </svg>
        ע &amp; ו
      </a>

      {/* Desktop links */}
      <div class="hidden md:flex items-center gap-8">
        <button
          onClick={() => scrollTo('details')}
          class={linkStyle}
          style="color: #1A0A0A"
          onMouseEnter={(e) => e.target.style.color = '#C9A96E'}
          onMouseLeave={(e) => e.target.style.color = '#1A0A0A'}
        >
          פרטים
        </button>
        <button
          onClick={goToRSVP}
          class={linkStyle}
          style="color: #1A0A0A"
          onMouseEnter={(e) => e.target.style.color = '#C9A96E'}
          onMouseLeave={(e) => e.target.style.color = '#1A0A0A'}
        >
          אישור הגעה
        </button>
        <a
          href="/admin"
          class="font-sans text-sm font-normal tracking-[0.1em] transition-colors duration-300"
          style="color: rgba(26,58,107,0.4); text-decoration:none"
          onMouseEnter={(e) => e.target.style.color = '#B22222'}
          onMouseLeave={(e) => e.target.style.color = 'rgba(26,58,107,0.4)'}
        >
          ניהול
        </a>
      </div>

      {/* Mobile RSVP button */}
      <div class="md:hidden">
        <button
          onClick={goToRSVP}
          class="font-sans text-sm font-normal tracking-[0.1em] px-4 py-2 transition-all duration-300 bg-transparent cursor-pointer"
          style="color: #C9A96E; border: 1px solid rgba(201,169,110,0.4)"
          onMouseEnter={(e) => { e.target.style.background = 'rgba(201,169,110,0.1)'; }}
          onMouseLeave={(e) => { e.target.style.background = 'transparent'; }}
        >
          אישור הגעה
        </button>
      </div>
    </nav>
  );
}
