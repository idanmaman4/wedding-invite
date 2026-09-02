import { onMount } from 'solid-js';
import { revealOnScroll } from '../animations/gsapSetup';

const details = [
  {
    icon: '◇',
    label: 'The Date',
    value: 'June 14, 2027',
    sub: 'Sunday',
    description: 'Mark your calendars for this unforgettable evening',
  },
  {
    icon: '◈',
    label: 'The Time',
    value: '18:30',
    sub: 'Evening Ceremony',
    description: 'As the sun sets over Tel Aviv, we begin',
  },
  {
    icon: '◉',
    label: 'The Venue',
    value: 'The Garden Palace',
    sub: 'Tel Aviv, Israel',
    description: 'An enchanted garden in the heart of the city',
  },
];

export default function Details() {
  let sectionRef;
  let headingRef;
  let cardsRef = [];

  onMount(() => {
    revealOnScroll([headingRef], 0);
    revealOnScroll(cardsRef, 0.15);
  });

  return (
    <section
      ref={sectionRef}
      id="details"
      class="py-32 px-6 max-w-5xl mx-auto"
    >
      {/* Section heading */}
      <div ref={headingRef} class="text-center mb-16" style="opacity:0">
        <p class="font-sans text-xs tracking-[0.4em] text-gold uppercase mb-4">
          Save the date
        </p>
        <h2 class="font-serif text-5xl md:text-6xl font-light text-cream mb-6">
          Wedding Details
        </h2>
        <div class="gold-divider max-w-xs mx-auto" />
      </div>

      {/* Detail cards */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {details.map((d, i) => (
          <div
            ref={(el) => (cardsRef[i] = el)}
            class="opacity-0 p-8 text-center border border-gold/20 bg-white/[0.02] backdrop-blur-sm rounded-sm hover:border-gold/40 hover:bg-white/[0.04] transition-all duration-500 group"
          >
            {/* Icon */}
            <div class="text-3xl text-gold mb-6 transition-transform duration-300 group-hover:scale-110">
              {d.icon}
            </div>

            {/* Label */}
            <p class="font-sans text-xs tracking-widest text-gold uppercase mb-4">
              {d.label}
            </p>

            {/* Main value */}
            <p class="font-serif text-2xl md:text-3xl text-cream mb-2 font-light">
              {d.value}
            </p>

            {/* Sub-label */}
            <p class="font-sans text-sm text-gold-light/70 mb-4">{d.sub}</p>

            {/* Gold divider */}
            <div class="w-8 h-px bg-gold/30 mx-auto mb-4" />

            {/* Description */}
            <p class="font-sans text-xs text-cream/40 leading-relaxed italic">
              {d.description}
            </p>
          </div>
        ))}
      </div>

      {/* Dress code note */}
      <div class="mt-16 text-center">
        <div class="inline-block px-8 py-4 border border-gold/10 bg-white/[0.01]">
          <p class="font-sans text-xs tracking-[0.3em] text-cream/40 uppercase mb-1">
            Dress Code
          </p>
          <p class="font-serif text-lg text-gold-light/70 italic">
            Black Tie Optional
          </p>
        </div>
      </div>
    </section>
  );
}
