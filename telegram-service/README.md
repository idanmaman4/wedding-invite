# Telegram service

A small Node service that does two things for the wedding site:

1. **Admin console in Telegram** — `/stats`, `/rsvps`, `/pending`, `/search`,
   `/invite`, backed by the site's API.
2. **Live broadcast** — the site POSTs each new RSVP to this service, which
   pushes a Hebrew message to everyone who has sent the bot `/start`.
3. **Daily XLSX export** — once a day (09:00 Asia/Jerusalem by default) it
   builds a three-sheet workbook of everything and sends it to every subscriber
   as a Telegram document, with a Hebrew caption summarising the day.
   `/export` and `/exportall` do the same on demand.

No database: subscribers live in `subscribers.json` (gitignored) next to the code.

---

## Run it

```bash
cd telegram-service
npm i
node index.js          # or: npm start
```

You should see:

```
Telegram bot @your_bot_name (id 1234567890) authenticated ✓
Polling started ✓
Notify endpoint listening on http://localhost:8787/notify/rsvp
Daily export scheduled: "0 9 * * *" (Asia/Jerusalem) — next run 2026-09-05T06:00:00.000Z
```

`Ctrl+C` stops polling and the HTTP server cleanly.

Syntax check without starting anything: `npm run check`.
Unit tests (workbook builder + export scheduler, no network, no Telegram):
`npm test`.

## Environment variables

Copy `.env.example` to `.env` and fill it in — or put the values in the
repo-root `.env.local`, which this service also reads. A value set in
`telegram-service/.env` wins over the same key in `.env.local`.

| Variable | Required | Default | What it is |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | — | Token from [@BotFather](https://t.me/BotFather). Never commit it. |
| `TELEGRAM_ADMIN_IDS` | yes | *(empty)* | Comma-separated chat ids allowed to run admin commands. Everyone else gets `אין הרשאה`. |
| `ADMIN_PASSWORD` | yes | *(empty)* | Sent to the site as the `X-Admin-Password` header. |
| `API_BASE` | no | `https://wedding-invite-sand-kappa.vercel.app` | Base URL of the site API. |
| `NOTIFY_SECRET` | yes for broadcasts | *(empty)* | Shared secret for `POST /notify/rsvp`. Unset ⇒ the endpoint refuses every request with 503. |
| `PORT` | no | `8787` | Port for the notify HTTP server. |
| `API_TIMEOUT_MS` | no | `15000` | Timeout on calls to the site API. |
| `DAILY_EXPORT_ENABLED` | no | `true` | `0`/`false`/`no`/`off` turns the daily export off. `/export` and `/exportall` keep working. |
| `DAILY_EXPORT_CRON` | no | `0 9 * * *` | Standard 5-field cron expression for the daily export. Wins over `DAILY_EXPORT_HOUR`. |
| `DAILY_EXPORT_HOUR` | no | *(unset)* | Shorthand used **only** when `DAILY_EXPORT_CRON` is unset: an hour `0`–`23`, turned into `0 <hour> * * *`. |
| `DAILY_EXPORT_TZ` | no | `Asia/Jerusalem` | Timezone for the schedule, the file name and every date in the workbook. Falls back to `TZ`, then to `Asia/Jerusalem`. |

Generate a notify secret with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

## Getting your chat id

1. Start the service.
2. Open the bot in Telegram and send `/start` (or `/whoami` at any time).
3. The reply contains your chat id.
4. Add it to `TELEGRAM_ADMIN_IDS` (comma-separated for several people) and
   restart the service.

Until an id is listed there, that person can still subscribe to RSVP
notifications — they just cannot run the admin commands.

## Commands

| Command | Who | What |
| --- | --- | --- |
| `/start` | anyone | Subscribe to RSVP notifications; replies with your chat id. |
| `/stop` | anyone | Unsubscribe. |
| `/whoami` | anyone | Show your chat id and whether you are an admin. |
| `/help` | anyone | List the commands. |
| `/stats` | admin | Invites, answered, not answered, total people coming, and a per-side breakdown. |
| `/rsvps` | admin | Everyone who answered: name, yes/no, party size, phone. Split across messages, never truncated. |
| `/pending` | admin | Everyone who has not answered, with phone numbers for chasing. |
| `/search <text>` | admin | Match a name or phone across invites and RSVPs. |
| `/invite <name> \| <phone> \| <side>` | admin | Create a personal invite link and get a ready-to-send Hebrew invitation text back. |
| `/export` | admin | Build the XLSX right now and send it to you as a document. |
| `/exportall` | admin | Build the same XLSX and send it to **every** subscriber immediately. |

Sides are accepted in Hebrew or as keys: `הורי ורד` / `vered_parents`,
`הורי עידן` / `idan_parents`, `ורד` / `vered`, `עידן` / `idan`.

## The daily export

Every day at `DAILY_EXPORT_CRON` (default `0 9 * * *`) in `DAILY_EXPORT_TZ`
(default `Asia/Jerusalem`) the bot builds one workbook and sends it to every
subscriber via `sendDocument`, captioned with the day's numbers: total invites,
how many replied, how many people are coming, and how many replied in the last
24 hours.

The file is named `wedding-rsvp-YYYY-MM-DD.xlsx` and has three sheets, all
right-to-left with sensible column widths:

| Sheet | Rows | Columns |
| --- | --- | --- |
| `אישורי הגעה` | every RSVP | שם · טלפון · צד · מגיעים (כן/לא) · כמות · תזונה · ברכה · תאריך |
| `טרם השיבו` | invites with no answer yet | שם · טלפון · צד · קישור אישי |
| `סיכום` | one row per side + a total row | הזמנות · השיבו · מגיעים (אנשים) · לא מגיעים · טרם השיבו |

Data comes from `GET /api/invites`, `GET /api/guests` and `GET /api/stats`.
Those are still being migrated, so:

- one source missing ⇒ the report is still sent, with
  `ℹ️ חלק מהנתונים חסרים` appended to the caption;
- **both** invites and RSVPs missing ⇒ no file at all. Subscribers get a short
  Hebrew notice naming the reason instead, and the bot stays up.

The workbook is written to the OS temp directory (a private
`wedding-export-*` folder) and deleted as soon as the last send finishes —
nothing is ever written into the repo. Subscribers who blocked or deleted the
bot are dropped from `subscribers.json`, exactly as in the RSVP broadcast, and
the fan-out continues.

> **The schedule only runs while the service is running.** It is an in-process
> `node-cron` timer inside a long-lived Node process, not a serverless cron: if
> the machine is asleep, the container is suspended or `node index.js` is not
> running at 09:00, that day's export simply does not happen (it is not replayed
> later). Keep the process alive — see *Deploying* below — or run `/exportall`
> by hand.

## The notify endpoint

```
POST /notify/rsvp
X-Notify-Secret: <NOTIFY_SECRET>
Content-Type: application/json

{"name": "דני כהן", "attending": true, "guests": 2,
 "phone": "0501234567", "side": "vered", "message": "מזל טוב!"}
```

Responses: `200 {"ok":true,...}` on success, `401` on a bad or missing secret,
`503` when `NOTIFY_SECRET` is not configured, `400` without a `name`.
The broadcast happens after the response is sent, so the caller never waits on
Telegram. Subscribers who blocked or deleted the bot are dropped from
`subscribers.json` automatically.

`GET /health` returns `{status, subscribers, api_base}`.

### Wiring the site to it

`api/notify.py` (in this repo) is the FastAPI-side helper. Set `NOTIFY_URL`
and `NOTIFY_SECRET` in the API's environment, then in `api/main.py`:

```python
from .notify import notify_rsvp   # top of the file

# …inside submit_rsvp, after the commit, before the return:
notify_rsvp({"name": data.name, "attending": data.attending,
             "guests": data.guests, "phone": data.phone,
             "message": data.message, "side": ""})
```

It swallows every exception and returns immediately, so a bot that is offline
can never break an RSVP.

## Deploying

The bot uses **long polling**, which needs a process that stays alive. Vercel
serverless functions are killed between requests, so the site's host cannot run
this — pick one of:

- **The couple's own machine.** Simplest. `npm start` in a terminal, or a
  Windows Task Scheduler task / `pm2 start index.js --name wedding-telegram`
  so it comes back after a reboot. The site then needs `NOTIFY_URL` pointing at
  a reachable address (a tunnel such as `cloudflared` or `ngrok` if the site is
  on Vercel and the bot is at home).
- **Fly.io free allowance.** `fly launch` in this directory, then
  `fly secrets set TELEGRAM_BOT_TOKEN=… ADMIN_PASSWORD=… NOTIFY_SECRET=…`.
  Keep one machine always on (`min_machines_running = 1`) — a suspended machine
  stops polling. Mount a small volume at `/app` if you want `subscribers.json`
  to survive a redeploy.
- **Railway / Render.** Deploy as a *worker*/*background* service (not a web
  service) with the start command `node index.js`, and set the same variables.
  Both wipe the filesystem on redeploy, so attach a volume for
  `subscribers.json` if the subscriber list matters.

Only ever run **one** instance: Telegram allows a single long-polling consumer
per token, and a second one makes both drop updates.

The daily export rides on the same process: whichever host you pick has to stay
up at export time, otherwise that day's workbook is never built.

## Notes

- The invites API (`GET /api/invites`, `POST /api/invites`, `GET /api/stats`)
  is newer than this service. If an endpoint is not deployed yet, the bot
  replies "ה-API עדיין לא חושף…" and stays up — `/stats` in particular falls
  back to deriving what it can from `/api/guests`.
- The bot token is read from the environment only and is never written to the
  logs.
- The export is built with [SheetJS](https://sheetjs.com) (`xlsx`, pinned to
  the official 0.20.3 tarball from `cdn.sheetjs.com` — the npm-registry copy is
  stuck at 0.18.5 and carries open advisories) and scheduled with `node-cron`
  (pinned to 4.6.0).
- The workbook lives in the OS temp directory for a few seconds only. Nothing
  under `telegram-service/` is written at export time except `subscribers.json`
  when a dead chat is pruned.
- `subscribers.json` holds real chat ids and is gitignored. It is written via a
  temp file + rename, so an interrupted write cannot corrupt it.
