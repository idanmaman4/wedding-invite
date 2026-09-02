import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Splits text into individual character spans and animates them in
 * with a stagger fade-up effect.
 * @param {HTMLElement} el - The element containing the text to animate
 */
export function animateHeroText(el) {
  if (!el) return;
  const text = el.textContent;
  el.innerHTML = text
    .split('')
    .map((c) =>
      c === ' '
        ? '<span style="display:inline-block;white-space:pre"> </span>'
        : `<span class="char" style="display:inline-block;opacity:0;transform:translateY(40px)">${c}</span>`
    )
    .join('');

  gsap.to(el.querySelectorAll('.char'), {
    opacity: 1,
    y: 0,
    duration: 1.0,
    ease: 'power3.out',
    stagger: 0.04,
    delay: 0.5,
  });
}

/**
 * Creates ScrollTrigger-based reveal animations for a list of elements.
 * @param {HTMLElement[]} elements - Elements to animate
 * @param {number} stagger - Delay between each element in seconds
 */
export function revealOnScroll(elements, stagger = 0) {
  elements.forEach((el, i) => {
    if (!el) return;
    gsap.fromTo(
      el,
      { y: 60, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 1.2,
        ease: 'power3.out',
        delay: i * stagger,
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
      }
    );
  });
}

/**
 * Hide nav on scroll down, show on scroll up.
 * @param {HTMLElement} navEl - The navigation element
 */
export function setupNavScroll(navEl) {
  if (!navEl) return;
  let lastScrollY = window.scrollY;

  ScrollTrigger.create({
    start: 'top top',
    end: 'max',
    onUpdate: (self) => {
      const currentScrollY = self.scroll();
      if (currentScrollY > lastScrollY && currentScrollY > 80) {
        // Scrolling down — hide nav
        gsap.to(navEl, {
          y: -80,
          duration: 0.4,
          ease: 'power2.inOut',
        });
      } else {
        // Scrolling up — show nav
        gsap.to(navEl, {
          y: 0,
          duration: 0.4,
          ease: 'power2.inOut',
        });
      }
      lastScrollY = currentScrollY;
    },
  });
}

export { gsap, ScrollTrigger };
