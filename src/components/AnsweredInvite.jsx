import { For, Show } from 'solid-js';
import { details } from './Details';
import CalendarButtons from './CalendarButtons';

/**
 * What a personal link shows once it has been answered: the invitation's
 * details and the answer given — nothing else. No loader, no rings, no vines,
 * no procession, no scroll animations or automatic scrolling: the guest came
 * back to look something up, so it is a calm, static page.
 */
export default function AnsweredInvite(props) {
  const invite = () => props.invite || {};
  const coming = () => invite().attending === true;
  const guests = () => Number(invite().guests) || 1;
  const name = () => String(invite().name || '').trim();

  const gold = '#C9A96E';
  const ink = '#1A0A0A';
  const red = '#B22222';
  const flourish = (
    <div class="flex items-center justify-center gap-3 max-w-xs mx-auto">
      <div class="h-px flex-1" style={`background: linear-gradient(to left, transparent, rgba(201,169,110,0.5))`} />
      <span style={`color: ${gold}`}>✦</span>
      <div class="h-px flex-1" style={`background: linear-gradient(to right, transparent, rgba(201,169,110,0.5))`} />
    </div>
  );

  return (
    <main class="min-h-screen px-5 py-14 sm:py-20" style="background: #FDFAF7">
      <div class="max-w-3xl mx-auto text-center">
        <p class="font-serif text-2xl mb-6" style={`color: ${gold}; letter-spacing: 0.15em`}>ע &amp; ו</p>
        {flourish}

        <h1 class="font-serif text-4xl sm:text-5xl font-light mt-6 mb-3" style={`color: ${ink}`}>
          תודה, קיבלנו את תשובתכם
        </h1>
        <Show when={name()}>
          <p class="font-sans text-lg mb-4" style={`color: ${red}`}>שלום {name()}!</p>
        </Show>
        <p class="font-serif text-xl sm:text-2xl mb-2" style={`color: ${red}`}>
          {coming()
            ? (guests() === 1 ? 'אישרתם הגעה — נתראה בחתונה!' : `אישרתם הגעה של ${guests()} אורחים — נתראה בחתונה!`)
            : 'עדכנתם שלא תוכלו להגיע — נתגעגע.'}
        </p>
        <p class="font-sans text-sm mb-10" style="color: rgba(26,10,10,0.55)">צריך לשנות משהו? דברו איתנו ישירות.</p>

        <Show when={coming()}>
          <div class="mb-12"><CalendarButtons /></div>
        </Show>

        {/* The invitation's details, static */}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-5 text-center">
          <For each={details}>
            {(d) => (
              <div class="p-7" style="border: 1px solid rgba(201,169,110,0.25); background: rgba(201,169,110,0.03)">
                <div class="text-2xl mb-4" style={`color: ${d.accentColor}`}>{d.icon}</div>
                <p class="font-sans text-sm font-medium tracking-[0.12em] mb-3" style={`color: ${d.accentColor}`}>{d.label}</p>
                <p class="font-serif text-xl font-light mb-2" style={`color: ${ink}; line-height: 1.4`}>
                  <For each={d.lines}>{(line) => <span class="block">{line}</span>}</For>
                </p>
                <Show when={d.sub}>
                  <p class="font-sans text-sm" style="color: rgba(26,10,10,0.55)">{d.sub}</p>
                </Show>
                <Show when={d.links}>
                  <div class="flex flex-wrap items-center justify-center gap-2 mt-4">
                    <For each={d.links}>
                      {(l) => (
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={l.aria}
                          class="font-sans text-xs tracking-[0.06em] px-3 py-1.5"
                          style="color: #8B6347; border: 1px solid rgba(201,169,110,0.5); text-decoration: none"
                        >
                          {l.label}
                        </a>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>

        <div class="mt-10 inline-block px-8 py-4" style="border: 1px solid rgba(201,169,110,0.2); background: rgba(201,169,110,0.03)">
          <p class="font-sans text-sm font-medium tracking-[0.12em] mb-1" style="color: rgba(26,10,10,0.45)">קוד לבוש</p>
          <p class="font-serif text-xl" style={`color: ${gold}`}>אלגנטי חגיגי</p>
        </div>

        <div class="mt-14">{flourish}</div>
        <p class="font-serif text-2xl font-light mt-5" style={`color: ${ink}`}>
          עידן <span style={`color: ${gold}`}>&amp;</span> ורד
        </p>
      </div>
    </main>
  );
}
