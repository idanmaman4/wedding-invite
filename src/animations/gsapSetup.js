import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Tweens follow the wall clock, not the frame count. GSAP's default lag
// smoothing credits a slow frame (>500ms) with only 33ms, so on a machine
// rendering WebGL in software (~1fps) every reveal crawled at a tenth of its
// speed and the invitation stayed blank for minutes. Content must appear on
// time however slow the frames are.
gsap.ticker.lagSmoothing(0);

/**
 * True when the visitor has asked their system for less motion. Checked at the
 * moment of animating rather than cached, so toggling the setting takes effect
 * on the next navigation.
 */
export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Splits text into individual character spans and animates them in
 * with a stagger fade-up effect.
 * @param {HTMLElement} el - The element containing the text to animate
 */
export function animateHeroText(el) {
  if (!el) return;
  // Reduced motion: the words simply appear. Nothing is animated, so nothing
  // can be left half-faded if the tween is starved of frames.
  if (prefersReducedMotion()) return;

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
  // Reduced motion: show everything where it belongs and register no trigger.
  // Without this the section stays at its `from` opacity until a tween it never
  // asked for finishes.
  if (prefersReducedMotion()) {
    elements.forEach((el) => { if (el) gsap.set(el, { y: 0, opacity: 1, clearProps: 'transform' }); });
    return;
  }

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
export { gsap, ScrollTrigger };
