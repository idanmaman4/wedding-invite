import { Show } from 'solid-js';
import Nav from './Nav';
import Details from './Details';

// Post-RSVP confirmation page (/confirmed?name=…&attending=1|0).
// Reuses the Details section so guests land on the date, schedule and venue
// (with the Waze / Google Maps links) right after confirming.

const ICS_FILENAME = 'idan-vered-wedding.ics';

// Times are Israel local (UTC+3 in October): 18:30 reception, ends ~midnight.
function buildIcs() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Idan & Vered//Wedding//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:idan-vered-wedding-20261025@wedding-invite',
    `DTSTAMP:${stamp}`,
    'DTSTART:20261025T163000Z',
    'DTEND:20261025T210000Z',
    'SUMMARY:החתונה של עידן וורד',
    'LOCATION:אולם האירועים תרין\\, אליעזר מזל 6\\, ראשון לציון',
    'DESCRIPTION:קבלת פנים ב-18:30\\, חופה וקידושין ב-19:30',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n') + '\r\n');
}

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

              <a
                href={buildIcs()}
                download={ICS_FILENAME}
                class="inline-block font-serif text-lg px-10 py-3 transition-colors duration-300"
                style="color: #B22222; border: 2px solid #B22222; background: white; text-decoration: none; letter-spacing: 0.02em"
                onMouseEnter={(e) => { e.currentTarget.style.background = '#B22222'; e.currentTarget.style.color = 'white'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#B22222'; }}
              >
                הוסיפו ליומן
              </a>
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
