/**
 * Scroll so the whole RSVP block (title + stage + button) is in view.
 * Aligns the section top under the fixed nav, but if the viewport is too
 * short for that to reach the button, scrolls further so the button's bottom
 * edge lands with a small margin above the fold instead.
 */
export function scrollToRSVP(behavior = 'smooth') {
  const section = document.getElementById('rsvp');
  if (!section) return;
  const navH = document.querySelector('nav')?.offsetHeight || 72;
  const rect = section.getBoundingClientRect();
  const sectionTop = window.scrollY + rect.top - navH - 4;
  // Last button in the section = "RSVP now" on the welcome card (or the
  // current step's action) — keep it fully visible.
  const buttons = section.querySelectorAll('button');
  const btn = buttons[buttons.length - 1];
  let target = sectionTop;
  if (btn) {
    const b = btn.getBoundingClientRect();
    const btnBottom = window.scrollY + b.bottom + 28;
    target = Math.max(sectionTop, btnBottom - window.innerHeight);
  }
  window.scrollTo({ top: Math.max(0, Math.round(target)), behavior });
}
