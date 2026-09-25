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

// ── Which route actually reaches the calendar on this device ─────────────────
//
// - iPhone/iPad in Safari (incl. the Safari view other apps open): the https
//   .ics — Safari shows its native "Add to Calendar" sheet.
// - Other Apple contexts — Chrome/Firefox/Edge on iOS, in-app browsers
//   (Telegram, WhatsApp, Instagram…), and every Mac browser: they download
//   the file silently or do nothing, so hand it to the Calendar app with
//   webcal:// (the OS routes that scheme to Calendar from any browser).
// - Android: Google Calendar's add-event page; the Google Calendar app cannot
//   import an .ics file, and Chrome would only drop it in Downloads.
// - Anything else (Windows, Linux): the .ics, for Outlook and friends.
export function calendarTarget(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) {
  const icsAbs = typeof window === 'undefined' ? ICS_URL : new URL(ICS_URL, window.location.href).href;
  const webcal = icsAbs.replace(/^https?:/, 'webcal:');
  const isAndroid = /Android/i.test(ua);
  // iPadOS reports itself as a Mac; touch support tells them apart.
  const touchMac = /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || touchMac;
  const isMac = /Macintosh/.test(ua) && !touchMac;
  if (isAndroid) return { kind: 'google', href: GOOGLE_CALENDAR_URL };
  if (isIOS) {
    // Real Safari carries "Version/… Safari/…" and none of the other
    // browsers' or apps' markers; WKWebView in-app browsers lack "Safari/".
    const safari = /Version\/[\d.]+.*Safari\//.test(ua)
      && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\/|Telegram|WhatsApp/i.test(ua);
    return safari ? { kind: 'ics', href: ICS_URL } : { kind: 'webcal', href: webcal };
  }
  if (isMac) return { kind: 'webcal', href: webcal };
  return { kind: 'ics', href: ICS_URL };
}
