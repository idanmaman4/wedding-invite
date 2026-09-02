import { onMount } from 'solid-js';
import { revealOnScroll } from '../animations/gsapSetup';

const details = [
  {
    icon: '◇',
    label: 'The Date',
    value: 'June 14, 2027',
    sub: 'Sunday',
    description: 'Mark your calendars for this unforgettable evening',
    accentColor: '#1A3A6B',
  },
  {
    icon: '✦',
    label: 'The Time',
    value: '18:30',
    sub: 'Evening Ceremony',
    description: 'As the sun sets over Tel Aviv, we begin',
    accentColor: '#C9A96E',
  },
  {
    icon: '◉',
    label: 'The Venue',
    value: 'The Garden Palace',
    sub: 'Tel Aviv, Israel',
    description: 'An enchanted garden in the heart of the city',
    accentColor: '#B22222',
  },
];

export default function Details() {
  let headingRef;
  let cardsRef = [];

  onMount(() => {
    revealOnScroll([headingRef], 0);
    revealOnScroll(cardsRef, 0.15);
  });

  return (
    <section
      id="details"
      class="py-32 px-6 max-w-5xl mx-auto"
    >
      {/* Section heading */}
      <div ref={headingRef} class="text-center mb-16" style="opacity:0">
        <p class="font-sans text-xs tracking-[0.45em] uppercase mb-4" style="color: #C9A96E">
          Save the date
        </p>
        <h2 class="font-serif text-5xl md:text-6xl font-light mb-6" style="color: #1A0A0A">
          Wedding Details
        </h2>
        {/* Tri-color divider */}
        <div class="flex items-center justify-center gap-1 max-w-xs mx-auto">
          <div class="h-px flex-1" style="background: #1A3A6B; opacity: 0.4" />
          <span style="color: #C9A96E; font-size: 0.7rem">✦</span>
          <div class="h-px flex-1" style="background: #B22222; opacity: 0.4" />
        </div>
      </div>

      {/* Detail cards */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {details.map((d, i) => (
          <div
            ref={(el) => (cardsRef[i] = el)}
            class="opacity-0 p-8 text-center transition-all duration-500"
            style={`border: 1px solid rgba(201,169,110,0.2); background: rgba(201,169,110,0.02); border-top: 3px solid ${d.accentColor}`}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(201,169,110,0.5)';
              e.currentTarget.style.background = 'rgba(201,169,110,0.05)';
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(201,169,110,0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(201,169,110,0.2)';
              e.currentTarget.style.background = 'rgba(201,169,110,0.02)';
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div class="text-3xl mb-6 transition-transform duration-300" style={`color: ${d.accentColor}`}>
              {d.icon}
            </div>

            <p class="font-sans text-xs tracking-widest uppercase mb-4" style={`color: ${d.accentColor}`}>
              {d.label}
            </p>

            <p class="font-serif text-2xl md:text-3xl mb-2 font-light" style="color: #1A0A0A">
              {d.value}
            </p>

            <p class="font-sans text-sm mb-4" style="color: rgba(26,10,10,0.5)">{d.sub}</p>

            <div class="w-8 h-px mx-auto mb-4" style={`background: ${d.accentColor}; opacity: 0.4`} />

            <p class="font-sans text-xs leading-relaxed italic" style="color: rgba(26,10,10,0.45)">
              {d.description}
            </p>
          </div>
        ))}
      </div>

      {/* Dress code */}
      <div class="mt-16 text-center">
        <div
          class="inline-block px-8 py-4"
          style="border: 1px solid rgba(201,169,110,0.2); background: rgba(201,169,110,0.03)"
        >
          <p class="font-sans text-xs tracking-[0.35em] uppercase mb-1" style="color: rgba(26,10,10,0.4)">
            Dress Code
          </p>
          <p class="font-serif text-lg italic" style="color: #C9A96E">
            Black Tie Optional
          </p>
        </div>
      </div>
    </section>
  );
}
