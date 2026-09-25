# WhatsApp service (עידן & ורד)

Sends the wedding invitations from the couple's own WhatsApp accounts, using
[whatsapp-web.js](https://wwebjs.dev/) — which drives a real, logged-in WhatsApp
Web session in a headless Chrome.

**This can only run on a computer that stays on.** It cannot run on Vercel (or
any serverless host): it keeps a browser and a live WhatsApp socket open. The
admin panel therefore talks to it **directly from the browser**, at whatever URL
you type into the "כתובת השירות" field in the וואטסאפ tab.

---

## Run it

```bash
cd whatsapp-service
npm install     # first time only (downloads a Chromium — a few minutes)
node index.js
```

You should see:

```
WhatsApp service listening on http://localhost:3001
```

Leave that terminal window open for as long as you are sending.

## Connect the phones (QR)

1. Open the admin panel → tab **וואטסאפ**.
2. Press **בדיקת חיבור** — both clients should report *לא זמין* at first.
3. Press **התחברות** under עידן (or ורד). A QR code appears within ~10 seconds.
4. On that phone: WhatsApp → ⋮ / Settings → **מכשירים מקושרים** → **קישור מכשיר**
   → scan the QR on screen.
5. The card flips to **מחובר**. The login is cached in `.wwebjs_auth/`, so the
   next `node index.js` reconnects without a new scan.

Repeat for the second phone. Both can be connected at the same time.

To force a fresh login, stop the service and delete the `.wwebjs_auth/` folder.

## Environment variables

Copy `.env.example` to `.env` and edit as needed.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Port the HTTP service listens on. |
| `WA_KEY` | *(unset)* | Optional shared secret. When set, every request except `/health` must carry an `X-Wa-Key: <value>` header — paste the same value into the "מפתח" field in the admin panel. Leave it unset for local-only use. |
| `SITE_URL` | the Vercel URL | Fallback link used by `/send-invitation` when no URL is supplied. |
| `WA_MIN_DELAY_MS` | `3000` | Lower bound of the random pause between bulk messages. |
| `WA_MAX_DELAY_MS` | `7000` | Upper bound. Do not lower these much — WhatsApp bans accounts that blast. |

## HTTP API

All routes answer JSON and allow any origin (CORS), including `OPTIONS`
preflights.

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ ok: true, authRequired, clients: { idan: 'ready'\|'qr'\|'offline', vered: … } }` |
| `GET /status` | Raw internal statuses (`connected`, `awaiting_scan`, …) |
| `GET /qr/:sender` | `{ status, qr }` — `qr` is a PNG data-URL while awaiting a scan |
| `POST /connect/:sender` | Start (or restart) a session |
| `POST /disconnect/:sender` | Tear a session down |
| `GET /contacts?sender=idan&q=…` | Saved contacts: `{ total, truncated, contacts: [{ id, name, number, isMyContact, isGroup }] }`. Groups, status broadcasts and non-contacts are excluded; sorted by name; capped at 2000. |
| `POST /send` | `{ sender, to, message }` |
| `POST /send-invitation` | `{ sender, guestName, phone, websiteUrl?, message? }` |
| `POST /send-bulk` | `{ sender, messages: [{ phone, text }], delayMs?, minDelayMs?, maxDelayMs?, stream? }` → per-message `{ phone, ok, error? }`. With `stream: true` it answers NDJSON: one `{type:'progress',…}` line per message, then a `{type:'done', sent, failed, results}` line. |

`:sender` / `sender` is always `idan` or `vered`.

Phone numbers are normalised for you: spaces, dashes and parentheses are
stripped, a leading `0` is dropped and `+972` / `972` / `05x` all end up as
`972XXXXXXXXX@c.us`.

When a client is not logged in, the send/contacts routes answer **409** with a
JSON body — they never crash the process.

## The https ↔ localhost caveat

The deployed site is served over **https**. Browsers block a page on https from
calling a plain **http://localhost** service ("mixed content"), and no error
worth reading reaches the page — the fetch just fails.

Two ways around it, in order of ease:

1. **Run the admin panel locally too.** `npm run dev` in the project root, then
   open <http://localhost:5173/admin>. Same-scheme http → http, everything works.
2. Expose this service over https (e.g. `ngrok http 3001`) and paste that
   `https://…` URL into the "כתובת השירות" field on the deployed site. Set
   `WA_KEY` before doing that — an ngrok tunnel is public.

## Safety notes

- Nothing about the WhatsApp session (QR payload, tokens, message bodies) is
  logged. Bulk progress logs a masked number only.
- Send in batches and keep the default 3–7 s pacing. WhatsApp treats fast bulk
  sending to non-contacts as spam and will ban the number.
