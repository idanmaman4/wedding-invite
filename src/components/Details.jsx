import { onMount } from 'solid-js';
import { gsap } from '../animations/gsapSetup';

// `lines` renders the card's main value as stacked lines (same .detail-value
// element, so the reveal animation is unchanged). `links` adds small gold
// outline link-buttons under the description (venue navigation).
export const details = [
  {
    icon: '◇',
    label: 'התאריך',
    lines: ['יום ראשון', 'י״ד בחשוון תשפ״ז'],
    sub: '25.10.2026',
    description: 'סמנו ביומן — ערב בלתי נשכח',
    accentColor: '#1A3A6B',
  },
  {
    icon: '✦',
    label: 'לוח הערב',
    lines: ['18:30 — קבלת פנים', '19:30 — חופה וקידושין'],
    sub: '',
    description: 'עם רדת הערב נתחיל',
    accentColor: '#C9A96E',
  },
  {
    icon: '◉',
    label: 'המקום',
    lines: ['אולם האירועים תרין'],
    sub: 'רח׳ אליעזר מזל 6, ראשון לציון',
    description: 'נשמח לחגוג איתכם',
    accentColor: '#B22222',
    links: [
      {
        label: 'נווטו עם Waze',
        aria: 'ניווט לאולם תרין באפליקציית Waze (נפתח בחלון חדש)',
        href: 'https://waze.com/ul?q=%D7%90%D7%9C%D7%99%D7%A2%D7%96%D7%A8%20%D7%9E%D7%96%D7%9C%206%20%D7%A8%D7%90%D7%A9%D7%95%D7%9F%20%D7%9C%D7%A6%D7%99%D7%95%D7%9F&navigate=yes',
      },
      {
        label: 'Google Maps',
        aria: 'פתיחת אולם תרין ב-Google Maps (נפתח בחלון חדש)',
        href: 'https://www.google.com/maps/search/?api=1&query=%D7%90%D7%9C%D7%99%D7%A2%D7%96%D7%A8+%D7%9E%D7%96%D7%9C+6+%D7%A8%D7%90%D7%A9%D7%95%D7%9F+%D7%9C%D7%A6%D7%99%D7%95%D7%9F',
      },
    ],
  },
];

export default function Details() {
  let headingRef;
  let eyebrowRef;
  let titleRef;
  let dividerLeftRef;
  let dividerRightRef;
  let starRef;
  let cardsRef = [];

  onMount(() => {
    // Heading: the eyebrow fades up first, then the title wipes in with
    // the same clip-path language as the cards below (visual consistency),
    // then the gold divider draws in from the center outward, with the
    // star settling in last as a small flourish. One ScrollTrigger, plays
    // once.
    if (headingRef) {
      gsap
        .timeline({
          scrollTrigger: {
            trigger: headingRef,
            start: 'top 85%',
            toggleActions: 'play none none none',
          },
        })
        .fromTo(
          eyebrowRef,
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out' },
          0
        )
        .fromTo(
          titleRef,
          { opacity: 0, y: 20, clipPath: 'inset(100% 0 0 0)' },
          { opacity: 1, y: 0, clipPath: 'inset(0% 0 0 0)', duration: 0.9, ease: 'power3.out' },
          0.2
        )
        .fromTo(
          [dividerLeftRef, dividerRightRef],
          { scaleX: 0 },
          { scaleX: 1, duration: 0.7, ease: 'power2.inOut' },
          0.75
        )
        .fromTo(
          starRef,
          { opacity: 0, scale: 0.3, rotate: -45 },
          { opacity: 1, scale: 1, rotate: 0, duration: 0.5, ease: 'back.out(2)' },
          1.05
        );
    }

    // Detail cards: clip-path wipe for the shell (bottom-to-top) combined
    // with a very subtle scale-up (0.96 -> 1) for a "settling into place"
    // feel rather than a flat wipe. The internal content then reveals in
    // its own short sequence (icon -> label -> value -> divider/sub ->
    // description) instead of popping in all at once, so the card reads
    // as composed, not just uncovered. Everything lives on the same
    // per-card timeline/ScrollTrigger, so it still only plays once.
    cardsRef.forEach((el, i) => {
      if (!el) return;
      const icon = el.querySelector('.detail-icon');
      const label = el.querySelector('.detail-label');
      const value = el.querySelector('.detail-value');
      const sub = el.querySelector('.detail-sub');
      const divider = el.querySelector('.detail-divider');
      const desc = el.querySelector('.detail-desc');

      const tl = gsap.timeline({
        delay: i * 0.15,
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          toggleActions: 'play none none none',
        },
      });

      tl.fromTo(
        el,
        { clipPath: 'inset(100% 0 0 0)', y: 20, scale: 0.96 },
        { clipPath: 'inset(0% 0 0 0)', y: 0, scale: 1, duration: 1.2, ease: 'power3.out' },
        0
      );

      if (icon) {
        tl.fromTo(
          icon,
          { opacity: 0, scale: 0.5 },
          { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.7)' },
          0.45
        );
      }
      if (label) {
        tl.fromTo(label, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0.55);
      }
      if (value) {
        // The value (e.g. the date) is the most important line in the
        // card, so it gets its own small top-down wipe instead of a plain
        // fade, echoing the card's own reveal language at a smaller scale.
        tl.fromTo(
          value,
          { opacity: 0, y: 12, clipPath: 'inset(0 0 100% 0)' },
          { opacity: 1, y: 0, clipPath: 'inset(0 0 0% 0)', duration: 0.55, ease: 'power3.out' },
          0.63
        );
      }
      if (sub) {
        tl.fromTo(sub, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.73);
      }
      if (divider) {
        tl.fromTo(divider, { scaleX: 0 }, { scaleX: 1, duration: 0.4, ease: 'power2.out' }, 0.78);
      }
      if (desc) {
        tl.fromTo(desc, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0.85);
      }
    });
  });

  return (
    <section
      id="details"
      class="py-32 px-6 max-w-5xl mx-auto"
    >
      {/* Section heading */}
      <div ref={headingRef} class="text-center mb-16">
        <p
          ref={eyebrowRef}
          class="font-sans text-sm font-medium tracking-[0.12em] mb-4"
          style="color: #C9A96E; opacity: 0"
        >
          שמרו את התאריך
        </p>
        <h2
          ref={titleRef}
          class="font-serif text-5xl md:text-6xl font-light mb-6"
          style="color: #1A0A0A; opacity: 0; clip-path: inset(100% 0 0 0)"
        >
          פרטי החתונה
        </h2>
        {/* Gold divider — draws in from the center outward. In RTL the first
            line is on the right, so it scales out from its left (center) edge. */}
        <div class="flex items-center justify-center gap-1 max-w-xs mx-auto">
          <div
            ref={dividerLeftRef}
            class="h-px flex-1"
            style="background: #C9A96E; opacity: 0.4; transform: scaleX(0); transform-origin: left center"
          />
          <span
            ref={starRef}
            style="color: #C9A96E; font-size: 0.7rem; display: inline-block; opacity: 0"
          >
            ✦
          </span>
          <div
            ref={dividerRightRef}
            class="h-px flex-1"
            style="background: #C9A96E; opacity: 0.4; transform: scaleX(0); transform-origin: right center"
          />
        </div>
      </div>

      {/* Detail cards */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {details.map((d, i) => (
          <div
            ref={(el) => (cardsRef[i] = el)}
            class="p-8 text-center transition-[background-color,border-color,box-shadow] duration-500"
            style="border: 1px solid rgba(201,169,110,0.2); background: rgba(201,169,110,0.02)"
            onMouseEnter={(e) => {
              const card = e.currentTarget;
              card.style.borderColor = 'rgba(201,169,110,0.5)';
              card.style.background = 'rgba(201,169,110,0.05)';
              card.style.boxShadow = '0 8px 32px rgba(201,169,110,0.1)';
              gsap.to(card, { y: -6, duration: 0.4, ease: 'power2.out' });
            }}
            onMouseLeave={(e) => {
              const card = e.currentTarget;
              card.style.borderColor = 'rgba(201,169,110,0.2)';
              card.style.background = 'rgba(201,169,110,0.02)';
              card.style.boxShadow = 'none';
              gsap.to(card, { y: 0, duration: 0.4, ease: 'power2.out' });
            }}
          >
            <div
              class="detail-icon text-3xl mb-6 transition-transform duration-300"
              style={`color: ${d.accentColor}`}
            >
              {d.icon}
            </div>

            <p class="detail-label font-sans text-sm font-medium tracking-[0.12em] mb-4" style={`color: ${d.accentColor}`}>
              {d.label}
            </p>

            <p class="detail-value font-serif text-2xl mb-2 font-light" style="color: #1A0A0A; line-height: 1.35">
              {d.lines.map((line) => (
                <span class="block whitespace-nowrap">{line}</span>
              ))}
            </p>

            <p class="detail-sub font-sans text-sm mb-4" style="color: rgba(26,10,10,0.5)">{d.sub || '\u00A0'}</p>

            <div class="detail-divider w-8 h-px mx-auto mb-4" style={`background: ${d.accentColor}; opacity: 0.4`} />

            <p class="detail-desc font-sans text-sm leading-relaxed" style="color: rgba(26,10,10,0.45)">
              {d.description}
            </p>

            {d.links && (
              <div class="flex flex-wrap items-center justify-center gap-2 mt-5">
                {d.links.map((l) => (
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={l.aria}
                    class="font-sans text-xs font-normal tracking-[0.06em] px-3 py-1.5 transition-colors duration-300"
                    style="color: #8B6347; border: 1px solid rgba(201,169,110,0.5); text-decoration: none; background: transparent"
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(201,169,110,0.12)'; e.currentTarget.style.borderColor = '#C9A96E'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(201,169,110,0.5)'; }}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Dress code */}
      <div class="mt-16 text-center">
        <div
          class="inline-block px-8 py-4"
          style="border: 1px solid rgba(201,169,110,0.2); background: rgba(201,169,110,0.03)"
        >
          <p class="font-sans text-sm font-medium tracking-[0.12em] mb-1" style="color: rgba(26,10,10,0.4)">
            קוד לבוש
          </p>
          <p class="font-serif text-xl" style="color: #C9A96E">
            אלגנטי חגיגי
          </p>
        </div>
      </div>
    </section>
  );
}
