import { ICS_URL, GOOGLE_CALENDAR_URL, calendarTarget } from '../calendar';

/**
 * "Add to calendar" routed per device (see calendarTarget), plus the other
 * obvious option: Google Calendar — or, on Android where the main button
 * already is Google Calendar, the calendar file (Samsung Calendar & co.).
 */
export default function CalendarButtons() {
  const main = calendarTarget();
  const second = main.kind === 'google'
    ? { href: ICS_URL, label: 'קובץ יומן (.ics)', newTab: false }
    : { href: GOOGLE_CALENDAR_URL, label: 'Google Calendar', newTab: true };
  return (
    <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
      <a
        href={main.href}
        target={main.kind === 'google' ? '_blank' : undefined}
        rel={main.kind === 'google' ? 'noopener noreferrer' : undefined}
        class="inline-block font-serif text-lg px-10 py-3 transition-colors duration-300"
        style="color: #B22222; border: 2px solid #B22222; background: white; text-decoration: none; letter-spacing: 0.02em"
        onMouseEnter={(e) => { e.currentTarget.style.background = '#B22222'; e.currentTarget.style.color = 'white'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#B22222'; }}
      >
        הוסיפו ליומן
      </a>
      <a
        href={second.href}
        target={second.newTab ? '_blank' : undefined}
        rel={second.newTab ? 'noopener noreferrer' : undefined}
        class="inline-block font-sans text-sm px-6 py-3 transition-colors duration-300"
        style="color: #8B6347; border: 1px solid rgba(201,169,110,0.5); text-decoration: none; letter-spacing: 0.04em"
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(201,169,110,0.12)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {second.label}
      </a>
    </div>
  );
}
