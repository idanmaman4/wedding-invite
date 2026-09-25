# עידן & ורד — הזמנה לחתונה

Wedding invitation site for Idan & Vered, 25.10.2026 (י״ד בחשוון תשפ״ז), Tarin hall,
Rishon LeZion. Hebrew, right-to-left, with three 3D scenes and an RSVP flow that
feeds an admin panel, a Telegram bot and (optionally) WhatsApp.

Live: https://wedding-invite-sand-kappa.vercel.app

---

## What is in here

| Path | What it is |
|---|---|
| `src/` | Solid.js + Vite front end (Tailwind for layout, GSAP for motion) |
| `src/three/` | The three WebGL scenes: hero rings, page-edge vines, the procession |
| `public/media/` | Pre-rendered clips and vine strips (see “Pre-rendered art” below) |
| `api/` | FastAPI backend: RSVP, guest list, personal invites |
| `telegram-service/` | Telegram bot: the admin console and RSVP broadcasts |
| `whatsapp-service/` | WhatsApp sender — not wired into the site right now (see below) |
| `tests/` | pytest suites for the API, plus a Playwright end-to-end run |

## Running it locally

```bash
npm install
npm run dev                       # http://localhost:5173

python -m venv .venv && .venv\Scripts\activate
pip install -r requirements-dev.txt
DATABASE_URL=<a Postgres URL> python -m uvicorn api.main:app --reload --port 8000
```

Vite proxies `/api` to port 8000, so the front end talks to the local API with no
extra configuration. The admin panel is at `/admin` (password `wedding2027`, or
whatever `ADMIN_PASSWORD` is set to).

To open the site on your phone over the local network, start Vite with `--host`
and bind the API to every interface, otherwise submissions from the phone fail:

```bash
npm run dev -- --host
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000
```

## Deploying

```bash
npx vercel --prod
```

`vercel.json` builds the Vite app as static files and `api/main.py` as a Python
function, and rewrites unknown paths to `index.html` so `/admin` and `/confirmed`
work on a hard refresh.

### The database, and why it matters

**Supabase is the only database.** Every RSVP, personal invite, bot subscriber
and bot conversation step is a row there. There is no local fallback: without
`DATABASE_URL` the API still starts (so `/api/health` answers) but every request
that reads or writes data fails loudly. The old SQLite fallback wrote to `/tmp`
on Vercel, which is wiped whenever an instance recycles, so RSVPs silently
disappeared.

Production uses Supabase (project `wedding-invite`, us-east-1, next to the
Vercel functions in iad1). The app connects as its own role, `wedding_app`,
through the transaction pooler (`aws-0-us-east-1.pooler.supabase.com:6543`), and
its tables live in a private `wedding` schema (the role's `search_path`) that
Supabase's public Data API does not expose. `DATABASE_URL` is set for Production
only, so preview deployments never write to the real guest list. Tables are
created on the first request.

To point it at a different Supabase project, set its pooler connection string:

```bash
npx vercel env add DATABASE_URL production      # paste the postgres:// URL
npx vercel --prod                               # redeploy so it takes effect
```

The Telegram bot broadcasts every RSVP to its subscribers as it arrives, so the
couple keeps a durable record in chat even if the database is ever reset.

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel + local | Supabase pooler connection string (required) |
| `ADMIN_PASSWORD` | Vercel + local | Guards every admin endpoint (`X-Admin-Password`) |
| `SITE_URL` | Vercel | Base used when building personal invite links |
| `TELEGRAM_BOT_TOKEN` | `.env.local` | From BotFather; never commit it |
| `TELEGRAM_ADMIN_IDS` | `.env.local` | Comma-separated chat ids allowed to run admin commands |
| `NOTIFY_URL`, `NOTIFY_SECRET` | Vercel | The API pushes each RSVP to `/api/telegram/notify` with this secret |
| `TELEGRAM_WEBHOOK_SECRET` | Vercel | Telegram signs every webhook call with it |
| `CRON_SECRET` | Vercel | Vercel signs the daily cron call with it |
| `TELEGRAM_OPEN_ADMIN` | Vercel + local | `1` (default): every subscriber is an admin; `0`: only `TELEGRAM_ADMIN_IDS` |
| `WHATSAPP_SERVICE_URL` | local | Where the WhatsApp sender listens (default `http://localhost:3001`) |

`.env.local` is gitignored. Nothing secret belongs in the repo.

## Personal invite links

The admin panel creates one link per guest — name, phone and side (הורי ורד,
הורי עידן, ורד, עידן) — of the form `https://…/?i=<uuid>`. Opening it prefills the
RSVP form with that guest's details (still editable) and links their answer back to
the invitation, so the panel can show who has replied, who has not, and how many
people are coming per side. Re-opening a link edits the existing answer instead of
creating a duplicate.

## Telegram bot

`telegram-service/` is the bot. Everything is reachable from a menu of buttons —
`/menu` opens it — and the same actions have commands: `/stats`, `/rsvps`,
`/pending`, `/search`, `/invite`, `/export`, `/exportall`. Creating an
invitation walks three steps (name, then a phone or a shared contact, then the
side as buttons); the one-line form `/invite שם | טלפון | צד` still works.
Or just **share a contact** with the bot: it takes the name and number from the
card, asks only for the side, and sends back the personal link, the ready-to-send
invitation text, and a button that opens WhatsApp on that person's chat with the
invitation already written.

Every subscriber is broadcast each RSVP as it lands, and gets the XLSX export
once a day.

**Who may run admin commands.** By default anyone who sends `/start`. The bot is
publicly findable, so that means anyone who finds it can read the guest list and
phone numbers. Set `TELEGRAM_OPEN_ADMIN=0` to fall back to the `TELEGRAM_ADMIN_IDS`
allow-list.

### It runs on Vercel

The bot's handlers live in `telegram-service/bot.js` with nothing about how they
are run. `api/telegram/` wraps that bot as Vercel functions, so nothing needs a
machine that stays on:

| Function | Who calls it | What it does |
|---|---|---|
| `POST /api/telegram/webhook` | Telegram | every update, signed with `TELEGRAM_WEBHOOK_SECRET` |
| `POST /api/telegram/notify` | the Python API, after saving an RSVP | broadcasts it to every subscriber |
| `GET /api/telegram/daily` | Vercel cron, 06:00 UTC = 09:00 Israel | the XLSX to every subscriber |
| `POST /api/telegram/setup` | you, once per deploy | registers the webhook and the command list |
| `GET /api/telegram/health` | anyone | are the token, secrets and webhook in place |

Two things the bot used to keep on disk have nowhere to live in a function, so
they are rows in the database behind the admin API: the subscriber registry
(`bot_subscribers`) and the step a chat is on in a multi-step flow (`bot_state`).

**After every deploy that could change the URL**, point Telegram at it:

```bash
curl -X POST https://wedding-invite-sand-kappa.vercel.app/api/telegram/setup      -H "X-Admin-Password: $ADMIN_PASSWORD"
```

It is idempotent. `GET /api/telegram/health` should then show the webhook URL and
no `last_error`.

The full production check is `node tests/smoke/production.mjs` — it exercises the
site, every API surface, the bot's wiring, and the RSVP → Telegram path, and
deletes everything it creates.

### …or on a laptop

`node telegram-service/index.js` runs the same bot by long polling, with the
notify endpoint on port 8787 and the daily export from an in-process cron. It
clears any webhook first, so the two modes never fight. Subscribers and flow
state still live in the database — the laptop bot reaches them through the
deployed site's admin API, so it needs `ADMIN_PASSWORD` and an `API_BASE` (or
`SITE_URL`) pointing at that site. Nothing is kept on disk or in memory.

## WhatsApp

**Not wired into the site.** The admin panel no longer has a WhatsApp tab; it
offers a `wa.me` share link per guest instead, which opens WhatsApp with that
guest's personal invitation already written. That needs no service at all.

The sender itself is still here, and still works:

```bash
cd whatsapp-service && npm install && node index.js
```

It drives a real WhatsApp Web session in Chromium, which needs three things a
request-scoped platform cannot give it: a process that stays alive between sends,
a writable disk for the session keys, and ~300 MB of browser. That rules out
Vercel — including Vercel's container support, which is still scale-to-zero
functions with no persistent disk. `Dockerfile` and `fly.toml` are in the folder
for deploying it to Fly.io, which does have volumes:

```bash
cd whatsapp-service
fly launch --no-deploy            # once
fly volumes create wa_session --size 1
fly secrets set WA_KEY=$(openssl rand -hex 24)
fly deploy
```

It refuses to start in production without `WA_KEY` — deployed, it can send
messages as you, so it must not be open.

The official alternative is Meta's WhatsApp Cloud API, which does run on Vercel,
but it needs a Meta Business account, a phone number that is not already on normal
WhatsApp, and pre-approved templates for messaging anyone who has not written to
you first.

## Pre-rendered art

The heaviest 3D work is rendered ahead of time so phones do not pay for it:

- **The procession** (bride and groom walking to the chuppah) is captured from the
  live scene and encoded to `public/media/procession.mp4` / `.webm`. The live WebGL
  scene stays as a fallback if the clip cannot play.
- **The vines** are rendered per phone width into transparent WebP strips
  (`public/media/vine_<width>_*.webp`) listed in `src/vineSets.json`. Screens under
  768px use those; wider screens run the live scene.

After any change to the vine scene or the Blender models, regenerate the strips
(needs the dev server on port 5199 and a GPU-backed Chromium):

```bash
npm run dev -- --port 5199                       # in another terminal
node scripts/capture_vines.mjs /tmp/vines
.venv/bin/python scripts/stitch_vines.py /tmp/vines   # writes public/media + src/vineSets.json
```

Desktops whose WebGL runs in software (hardware acceleration off, blocklisted
GPU) also get the strips instead of the live scenes, which run at ~1fps there.
Append `?live=1` or `?vine=live` to the URL to force the live WebGL versions.

## Tests

```bash
python -m pytest                                     # API: 112 tests, incl. integration
cd telegram-service && npm test                      # bot: 172 tests
cd whatsapp-service && npm test                      # sender: 40 tests
node tests/e2e/run.mjs                               # browser end-to-end
```

The backend integration tests run the outbound bridges — the Telegram notify hook
and the WhatsApp proxy — against real local HTTP servers rather than mocks, so a
change to either contract fails a test.

`tests/e2e/run.mjs` builds the site, serves the real production bundle, starts the
API against a throwaway database, and drives Chromium through the journeys that
matter: the invitation page, the RSVP wizard on desktop and on a phone, a personal
invite link (including re-opening one to edit the answer), and the admin panel.
Nothing is stubbed. Add `--headed` to watch it.

It needs a browser once: `npx playwright install chromium`.
