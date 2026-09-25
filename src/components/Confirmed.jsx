import { Show } from 'solid-js';
import Nav from './Nav';
import Details from './Details';
import CalendarButtons from './CalendarButtons';

// Post-RSVP confirmation page (/confirmed?name=…&attending=1|0).
// Reuses the Details section so guests land on the date, schedule and venue
// (with the Waze / Google Maps links) right after confirming.

export default function Confirmed() {
  const params = new URLSearchParams(window.location.search);
  const name = (params.get('name') || '').trim();
  const attending = params.get('attending') !== '0';

  const heading = () => {
    if (!attending) return 'תודה שעדכנתם';
    return name ? `תודה, ${name}!` : 'תודה!';
  };

  return (
    <>
      <Nav />
      <main>
        {/* Thank-you block */}
        <section class="pt-36 pb-4 px-6 text-center">
          <div class="max-w-2xl mx-auto">
            <div class="flex items-center justify-center gap-3 mb-6 max-w-xs mx-auto">
              <div class="h-px flex-1" style="background: linear-gradient(to left, transparent, rgba(201,169,110,0.5))" />
              <span class="text-base" style="color: #C9A96E">✦</span>
              <div class="h-px flex-1" style="background: linear-gradient(to right, transparent, rgba(201,169,110,0.5))" />
            </div>

            <p class="font-sans text-sm font-medium tracking-[0.12em] mb-4" style="color: #B22222">
              {attending ? 'אישור ההגעה התקבל' : 'תשובתכם נרשמה'}
            </p>

            <h1 class="font-serif text-5xl md:text-6xl font-light mb-5" style="color: #1A0A0A">
              {heading()}
            </h1>

            <Show
              when={attending}
              fallback={
                <p class="font-sans text-base mb-8" style="color: rgba(26,10,10,0.55)">
                  נתגעגע אליכם, ומקווים לחגוג יחד בהזדמנות אחרת.
                </p>
              }
            >
              <p class="font-serif text-2xl mb-8" style="color: #C9A96E">
                נתראה ביום ראשון, י״ד בחשוון תשפ״ז
                <span class="hidden sm:inline"> · </span>
                <span class="block sm:inline">25.10.2026</span>
              </p>

              <CalendarButtons />
            </Show>
          </div>
        </section>

        {/* Event details — same section as the invitation's middle block */}
        <Details />

        <footer class="pb-16 text-center" style="border-top: 1px solid rgba(201,169,110,0.2)">
          <a
            href="/"
            class="inline-block mt-8 font-sans text-sm font-normal tracking-[0.06em] transition-colors duration-300"
            style="color: rgba(26,10,10,0.45); text-decoration: none"
            onMouseEnter={(e) => { e.currentTarget.style.color = '#C9A96E'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(26,10,10,0.45)'; }}
          >
            חזרה להזמנה ←
          </a>
        </footer>
      </main>
    </>
  );
}
