// A real file served as text/calendar (public/idan-vered-wedding.ics, see
// vercel.json): iPhone Safari offers "Add to Calendar" only for that — it
// ignores `download` on a data: URL, so the old inline calendar did nothing.
// Times: 25.10.2026 is the night Israel leaves daylight time, so 18:30 local
// is UTC+2 = 16:30Z; ends 23:00 (21:00Z).
export const ICS_URL = '/idan-vered-wedding.ics';

// Google Calendar's own "add event" page — for Android and in-app browsers
// that cannot open a calendar file.
export const GOOGLE_CALENDAR_URL =
  'https://calendar.google.com/calendar/render?action=TEMPLATE' +
  `&text=${encodeURIComponent('החתונה של עידן וורד 💍')}` +
  '&dates=20261025T163000Z/20261025T210000Z' +
  `&details=${encodeURIComponent('קבלת פנים ב-18:30, חופה וקידושין ב-19:30')}` +
  `&location=${encodeURIComponent('אולם האירועים תרין, רח׳ אליעזר מזל 6, ראשון לציון')}` +
  '&ctz=Asia/Jerusalem';
