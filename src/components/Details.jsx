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
        <p class="font-sans text-xs tracking-[0.4em] uppercase mb-4" style="color: #B22222">
          Save the date
        </p>
        <h2 class="font-serif text-5xl md:text-6xl font-light mb-6" style="color: #1A0A0A">
          Wedding Details
        </h2>
        <div class="max-w-xs mx-auto h-px" style="background: linear-gradient(to right, transparent, #B22222, transparent)" />
      </div>

      {/* Detail cards */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {details.map((d, i) => (
          <div
            ref={(el) => (cardsRef[i] = el)}
            class="opacity-0 p-8 text-center rounded-sm transition-all duration-500 group"
            style="border: 1px solid rgba(178,34,34,0.2); background: rgba(178,34,34,0.02)"
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(178,34,34,0.4)';
              e.currentTarget.style.background = 'rgba(178,34,34,0.04)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(178,34,34,0.2)';
              e.currentTarget.style.background = 'rgba(178,34,34,0.02)';
            }}
          >
            {/* Icon */}
            <div class="text-3xl mb-6 transition-transform duration-300 group-hover:scale-110" style="color: #B22222">
              {d.icon}
            </div>

            {/* Label */}
            <p class="font-sans text-xs tracking-widest uppercase mb-4" style="color: #B22222">
              {d.label}
            </p>

            {/* Main value */}
            <p class="font-serif text-2xl md:text-3xl mb-2 font-light" style="color: #1A0A0A">
              {d.value}
            </p>

            {/* Sub-label */}
            <p class="font-sans text-sm mb-4" style="color: rgba(26,10,10,0.5)">{d.sub}</p>

            {/* Red divider */}
            <div class="w-8 h-px mx-auto mb-4" style="background: rgba(178,34,34,0.3)" />

            {/* Description */}
            <p class="font-sans text-xs leading-relaxed italic" style="color: rgba(26,10,10,0.45)">
              {d.description}
            </p>
          </div>
        ))}
      </div>

      {/* Dress code note */}
      <div class="mt-16 text-center">
        <div class="inline-block px-8 py-4" style="border: 1px solid rgba(178,34,34,0.1); background: rgba(178,34,34,0.01)">
          <p class="font-sans text-xs tracking-[0.3em] uppercase mb-1" style="color: rgba(26,10,10,0.45)">
            Dress Code
          </p>
          <p class="font-serif text-lg italic" style="color: rgba(139,99,71,0.8)">
            Black Tie Optional
          </p>
        </div>
      </div>
    </section>
  );
}
