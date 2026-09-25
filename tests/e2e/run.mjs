/**
 * Front-end end-to-end suite.
 *
 * Boots the real production build (`vite preview`) and the real FastAPI backend
 * against a throwaway local Postgres (tests/e2e/pg_server.py — the same engine
 * as production's Supabase), then drives Chromium through the journeys a
 * guest and the couple actually take: the invitation page, the whole RSVP
 * wizard on desktop and on a phone, a personal invite link, the confirmation
 * page, and the admin panel. Nothing is stubbed — an RSVP made here really does
 * land in the database and show up in the admin list.
 *
 *   node tests/e2e/run.mjs            # headless
 *   node tests/e2e/run.mjs --headed   # watch it
 */

import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HEADED = process.argv.includes('--headed');
// `--no-build` reuses whatever is in dist/, which matters on a machine that is
// short on memory: the Vite build alone peaks around half a gigabyte.
const SKIP_BUILD = process.argv.includes('--no-build');
// `--filter <text>` runs only the tests whose name contains <text>. Every test
// seeds whatever it needs, so any subset is a valid run.
const FILTER = (() => {
  const i = process.argv.indexOf('--filter');
  return i > -1 ? process.argv[i + 1] : null;
})();
const ADMIN_PASSWORD = 'e2e-password';

// ─── Tiny test harness ───────────────────────────────────────────────────────

const results = [];
const SHOTS = path.join(os.tmpdir(), 'wedding-e2e-shots');

/** The page the current test is driving, so a failure can be photographed. */
let lastPage = null;

async function test(name, fn) {
  if (FILTER && !name.includes(FILTER)) return;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ok  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, err });
    console.log(`  FAIL ${name}\n       ${err.message.split('\n')[0]}`);
    if (err.diagnostic) console.log(err.diagnostic);
  }
}

/**
 * A failed click says nothing about which step it stalled on. Attach the card's
 * own text and a screenshot to the error, while the page is still open.
 */
async function capture(page, err) {
  if (err.diagnostic || !page || page.isClosed()) return;
  try {
    fs.mkdirSync(SHOTS, { recursive: true });
    const file = path.join(SHOTS, `fail-${Date.now()}.png`);
    await page.screenshot({ path: file });
    const card = await page.locator('#rsvp').innerText().catch(() => '(no #rsvp)');
    err.diagnostic = `       card: ${card.replace(/\s+/g, ' ').slice(0, 150)}
       shot: ${file}`;
  } catch { /* the page may already be gone */ }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── Servers ─────────────────────────────────────────────────────────────────

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${url}`);
}

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: ROOT,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  // Kept, not printed: if a server fails to come up, this is the only clue.
  child.log = '';
  const keep = (buf) => { child.log = (child.log + buf.toString()).slice(-4000); };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  // On Windows these run under a shell, so `child.kill()` reaches the wrapper
  // and leaves the real server behind. Orphaned preview servers pile up across
  // runs until the machine runs out of memory — take the whole tree.
  child.killTree = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch { /* already gone */ }
    try { child.kill(); } catch { /* already gone */ }
  };
  return child;
}

// ─── The suite ───────────────────────────────────────────────────────────────

const SITE_TEXT = {
  couple: 'Idan',
  date: '25.10.2026',
  venue: 'תרין',
  reception: '18:30',
  chuppah: '19:30',
  deadline: '15',
};

async function main() {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wedding-e2e-'));
  const apiPort = await freePort();
  const webPort = await freePort();
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const siteBase = `http://127.0.0.1:${webPort}`;

  if (SKIP_BUILD) {
    console.log('reusing the existing dist/ (--no-build)');
  } else {
    console.log('building the site…');
    await new Promise((resolve, reject) => {
      const b = run('npx', ['vite', 'build']);
      b.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`))));
    });
  }

  console.log('starting a throwaway Postgres…');
  const pg = run('python', [path.join('tests', 'e2e', 'pg_server.py'), dbDir]);
  const databaseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Postgres did not start:\n${pg.log}`)), 60000);
    pg.stdout.on('data', () => {
      const line = pg.log.split('\n').find((l) => l.startsWith('postgres'));
      if (line) { clearTimeout(timer); resolve(line.trim()); }
    });
  });

  console.log(`starting the API on ${apiPort} and the site on ${webPort}…`);
  const api = run('python', ['-m', 'uvicorn', 'api.main:app', '--port', String(apiPort), '--host', '127.0.0.1'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      ADMIN_PASSWORD,
      SITE_URL: siteBase,
      NOTIFY_URL: '',
    },
  });
  // `vite preview` serves the built files as the browser will really get them.
  // It has no dev proxy, so /api calls are routed to uvicorn by Playwright below.
  const web = run('npx', ['vite', 'preview', '--port', String(webPort), '--strictPort', '--host', '127.0.0.1']);

  const cleanup = () => {
    for (const p of [api, web, pg]) { try { p.killTree(); } catch {} }
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);

  try {
    await waitForHttp(`${apiBase}/api/health`);
    await waitForHttp(siteBase);
  } catch (err) {
    console.error(['', 'api output:', api.log, '', 'web output:', web.log].join('\n'));
    cleanup();
    throw err;
  }

  const admin = { 'X-Admin-Password': ADMIN_PASSWORD };
  const apiJson = async (path, init = {}) => {
    const res = await fetch(apiBase + path, init);
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // Software rendering makes the three WebGL scenes take ~500ms a frame, which
  // starves Playwright's own injected script and turns every click into a
  // timeout. Ask for the real GPU, as the offline capture scripts do.
  const browser = await chromium.launch({
    headless: !HEADED,
    args: [
      '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
      // This suite runs beside whatever else is open; keep its footprint small.
      '--renderer-process-limit=2',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      '--js-flags=--max-old-space-size=512',
    ],
  });

  // The built site calls /api on its own origin, so route those to uvicorn.
  const buildContext = async (opts = {}) => {
    // `scroll-behavior: smooth` and Playwright's scroll-into-view deadlock each
    // other: every actionability re-check restarts the animation, so an element
    // below the fold never reads as stable. Visitors keep the smooth scrolling;
    // the tests ask for reduced motion, which the stylesheet turns off.
    const ctx = await browser.newContext({ reducedMotion: 'reduce', ...opts });
    await ctx.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const target = apiBase + url.pathname + url.search;
      const res = await route.fetch({ url: target });
      await route.fulfill({ response: res });
    });
    return ctx;
  };

  // One context per device profile, created on first use and reused after. A
  // fresh context per test exhausts the browser's live WebGL context limit
  // after about a dozen; keeping both alive from the start wastes memory on a
  // run that may never open a phone page.
  const contexts = {};
  async function contextFor(phone) {
    const key = phone ? 'phone' : 'desktop';
    if (!contexts[key]) {
      contexts[key] = await buildContext(phone ? devices['iPhone 13'] : {});
      // The first page to open the RSVP card pays for compiling the procession
      // scene's shaders, which can stall the main thread well past Playwright's
      // 30s default. Later pages hit warm caches.
      contexts[key].setDefaultTimeout(60000);
    }
    return contexts[key];
  }
  const desktopCtx = await contextFor(false);

  /**
   * Open a page, wait for the invitation to actually be interactive (rather
   * than for the network to fall quiet — the 3D assets keep it busy), and hand
   * it to `fn`. The page is always closed, so GPU contexts are released.
   */
  async function withPage(fn, { phone = false, url = siteBase, ready = true } = {}) {
    const page = await (await contextFor(phone)).newPage();
    lastPage = page;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (ready) {
        // The loading overlay covers everything until the vine scene reports in
        // (or its 8s hard timeout fires). Nothing is clickable before then.
        await page.waitForFunction(() => window.__weddingReady === true, null, { timeout: 45000 });
        await page.locator('#rsvp').waitFor({ state: 'attached', timeout: 30000 });
      }
      return await fn(page);
    } catch (err) {
      // Photograph the page while it is still open — the reporter runs after
      // the finally below has closed it.
      await capture(page, err);
      throw err;
    } finally {
      await page.close();
    }
  }

  /**
   * Buttons scoped to the RSVP card. The nav has its own "אישור הגעה" button,
   * so an unscoped lookup finds the wrong one.
   */
  const card = (page) => page.locator('#rsvp');
  const cardButton = (page, name) => card(page).getByRole('button', { name }).first();

  console.log('\nthe invitation page');

  await test('the page loads in Hebrew, right to left, with no console errors', async () => {
    const page = await desktopCtx.newPage();
    lastPage = page;
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(siteBase, { waitUntil: 'domcontentloaded' });
      await page.locator('#rsvp').waitFor({ state: 'attached' });
      assertEqual(await page.getAttribute('html', 'lang'), 'he', 'lang');
      assertEqual(await page.getAttribute('html', 'dir'), 'rtl', 'dir');
      assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
    } finally {
      await page.close();
    }
  });

  await test('every confirmed wedding detail is on the page', async () => {
    await withPage(async (page) => {
      const body = await page.textContent('body');
      for (const [key, needle] of Object.entries(SITE_TEXT)) {
        assert(body.includes(needle), `the page is missing the ${key} ("${needle}")`);
      }
    });
  });

  await test('the page never scrolls sideways on a phone', async () => {
    await withPage(async (page) => {
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 1, `horizontal overflow of ${overflow}px`);
    }, { phone: true });
  });

  console.log('\nthe RSVP wizard');

  /** Walk the wizard from the welcome card through to the confirmation page. */
  async function fillRsvp(page, { name, attending = true, guests = null, phone = '', message = '' }) {
    // The welcome card carries the 3D procession, so wait for the button itself
    // rather than for the scene to settle.
    const startBtn = cardButton(page, /אישור הגעה|עדכון התשובה/);
    await startBtn.waitFor({ state: 'visible', timeout: 30000 });
    await startBtn.click();

    if (name) {
      // The wizard slides between steps, so a one-shot isVisible() can catch the
      // name step mid-transition, skip the fill, and leave "המשך" disabled for
      // ever. Wait for the field instead.
      const nameInput = page.locator('#rsvp input[type="text"]').first();
      await nameInput.waitFor({ state: 'visible' });
      await nameInput.fill(name);
      // Solid only enables "המשך" once the signal has the typed name.
      await cardButton(page, /המשך/).click();
    }

    const answer = cardButton(page, attending ? /כן, נגיע/ : /לא נוכל/);
    await answer.waitFor({ state: 'visible' });
    await answer.click();

    // Declining skips the party size, the phone and the dietary steps and lands
    // straight on the message; only an acceptance walks all of them.
    if (attending) {
      if (guests !== null) {
        const pill = cardButton(page, new RegExp(`^${guests}$`));
        await pill.waitFor({ state: 'visible' });
        await pill.click();
      }
      await cardButton(page, /המשך/).click();    // guests → phone

      const tel = page.locator('#rsvp input[type="tel"]');
      await tel.waitFor({ state: 'visible' });
      if (phone) await tel.fill(phone);
      await cardButton(page, /המשך|דילוג/).click(); // phone → dietary
      await cardButton(page, /המשך|דילוג/).click(); // dietary → message
    }

    const note = page.locator('#rsvp textarea');
    await note.waitFor({ state: 'visible' });
    if (message) await note.fill(message);
    await cardButton(page, /^שליחה$|עדכון התשובה/).click();
    await page.waitForURL(/\/confirmed/, { timeout: 20000 });
  }

  await test('a guest can accept for three people and it reaches the database', async () => {
    await withPage(async (page) => {
      await fillRsvp(page, { name: 'אורח בדיקה', attending: true, guests: 3, phone: '0501234567', message: 'מזל טוב' });
    });

    const { body } = await apiJson('/api/guests', { headers: admin });
    const row = body.find((g) => g.name === 'אורח בדיקה');
    assert(row, 'the RSVP never reached the database');
    assertEqual(row.guests, 3, 'party size');
    assertEqual(row.attending, true, 'attending');
    assertEqual(row.phone, '0501234567', 'phone');
    assertEqual(row.message, 'מזל טוב', 'message');
  });

  await test('the confirmation page shows the date, the venue and the times', async () => {
    await withPage(async (page) => {
      const body = await page.textContent('body');
      for (const needle of [SITE_TEXT.date, SITE_TEXT.venue, SITE_TEXT.reception, SITE_TEXT.chuppah]) {
        assert(body.includes(needle), `the confirmation page is missing "${needle}"`);
      }
    }, { url: `${siteBase}/confirmed`, ready: false });
  });

  await test('a guest can decline, and no seats are counted', async () => {
    await withPage(async (page) => {
      await fillRsvp(page, { name: 'מסרב בדיקה', attending: false });
    });

    const { body } = await apiJson('/api/guests', { headers: admin });
    const row = body.find((g) => g.name === 'מסרב בדיקה');
    assert(row, 'the decline never reached the database');
    assertEqual(row.attending, false, 'attending');
  });

  await test('the whole wizard works on a phone, and the card never overflows it', async () => {
    await withPage(async (page) => {
      const box = await page.locator('#rsvp').boundingBox();
      const viewport = page.viewportSize();
      assert(box, 'the RSVP section has no box');
      assert(box.width <= viewport.width + 1, `the card is wider than the phone (${box.width} > ${viewport.width})`);

      await fillRsvp(page, { name: 'נייד בדיקה', attending: true, guests: 2 });
    }, { phone: true });

    const { body } = await apiJson('/api/guests', { headers: admin });
    assert(body.some((g) => g.name === 'נייד בדיקה' && g.guests === 2), 'the phone RSVP is missing or wrong');
  });

  console.log('\npersonal invite links');

  const createInvite = async (name, phone, side) => {
    const res = await apiJson('/api/invites', {
      method: 'POST',
      headers: { ...admin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, side }),
    });
    assertEqual(res.status, 200, `creating the invite for ${name}`);
    return res.body.token;
  };

  await test('a personal link prefills the name and skips the name step', async () => {
    const token = await createInvite('מוזמן אישי', '0509998887', 'vered');

    await withPage(async (page) => {
      assert((await page.textContent('body')).includes('מוזמן אישי'), 'the guest is not greeted by name');

      const startBtn = cardButton(page, /אישור הגעה/);
      await startBtn.waitFor({ state: 'visible', timeout: 30000 });
      await startBtn.click();
      // A personal link already knows the name, so the wizard opens on the answer
      // (after the 0.4s slide-out, so wait for it rather than read at once).
      const skipped = await page.getByText('האם תגיעו').first()
        .waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
      assert(skipped, 'the name step was not skipped');

      const yes = cardButton(page, /כן, נגיע/);
      await yes.waitFor({ state: 'visible' });
      await yes.click();
      const four = cardButton(page, /^4$/);
      await four.waitFor({ state: 'visible' });
      await four.click();
      await cardButton(page, /המשך/).click();
      await cardButton(page, /המשך|דילוג/).click();
      await cardButton(page, /המשך|דילוג/).click();
      await cardButton(page, /^שליחה$/).click();
      await page.waitForURL(/\/confirmed/, { timeout: 20000 });
    }, { url: `${siteBase}/?i=${token}` });

    const invites = await apiJson('/api/invites', { headers: admin });
    const inv = invites.body.find((i) => i.token === token);
    assertEqual(inv.responded, true, 'the invite should be marked answered');
    assertEqual(inv.guests, 4, 'party size on the invite');
  });

  await test('a personal link answers once; re-opening it shows only the details and the answer, no form or animation', async () => {
    const token = await createInvite('עונה פעם אחת', '0507776665', 'idan');

    await withPage(async (page) => {
      const startBtn = cardButton(page, /אישור הגעה/);
      await startBtn.waitFor({ state: 'visible', timeout: 30000 });
      await startBtn.click();
      const yes = cardButton(page, /כן, נגיע/);
      await yes.waitFor({ state: 'visible' });
      await yes.click();
      const pill = cardButton(page, /^2$/);
      await pill.waitFor({ state: 'visible' });
      await pill.click();
      await cardButton(page, /המשך/).click();
      await cardButton(page, /המשך|דילוג/).click();
      await cardButton(page, /המשך|דילוג/).click();
      await cardButton(page, /^שליחה$/).click();
      await page.waitForURL(/\/confirmed/, { timeout: 20000 });
    }, { url: `${siteBase}/?i=${token}` });

    await withPage(async (page) => {
      await page.getByText('תודה, קיבלנו את תשובתכם').first().waitFor({ state: 'visible', timeout: 30000 });
      const body = await page.textContent('body');
      assert(body.includes('אישרתם הגעה של 2 אורחים'), 'the stored answer is not shown');
      for (const detail of ['י״ד בחשוון תשפ״ז', '19:30', 'אולם האירועים תרין', 'אלגנטי חגיגי']) {
        assert(body.includes(detail), `the invitation detail "${detail}" is missing`);
      }
      assertEqual(await page.locator('button').count(), 0, 'the form (or any button) is still offered');
      const ics = page.locator('a[href$=".ics"]').first();
      assert(await ics.isVisible(), 'an attending guest should get the calendar button');
      // Just the details: no rings, vines or procession, and no automatic
      // scroll (the invitation page nudges to the RSVP card after ~5s).
      await page.waitForTimeout(7000);
      const still = await page.evaluate(() => ({
        canvases: document.querySelectorAll('canvas').length,
        videos: document.querySelectorAll('video').length,
        vines: document.querySelectorAll('.vine-strips').length,
        scrollY: window.scrollY,
      }));
      assertEqual(still.canvases, 0, 'a 3D scene was started');
      assertEqual(still.videos + still.vines, 0, 'the procession or the vines were loaded');
      assertEqual(still.scrollY, 0, 'the page scrolled by itself');
    }, { url: `${siteBase}/?i=${token}`, ready: false });

    // A second answer straight at the API (another tab) is refused too.
    const again = await apiJson('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'עונה פעם אחת', attending: true, guests: 5, invite_token: token }),
    });
    assertEqual(again.status, 409, 'a second answer should be refused');

    const guests = await apiJson('/api/guests', { headers: admin });
    const matching = guests.body.filter((g) => g.name === 'עונה פעם אחת');
    assertEqual(matching.length, 1, 'the guest was duplicated');
    assertEqual(matching[0].guests, 2, 'the first answer must stand');
  });

  console.log('\nthe admin panel');

  /** Type the password and submit. */
  async function openAdmin(page, password = ADMIN_PASSWORD) {
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button').first().click();
  }

  await test('the admin panel refuses a wrong password and accepts the right one', async () => {
    await withPage(async (page) => {
      await openAdmin(page, 'wrong-password');
      await page.waitForTimeout(800);
      assert(await page.locator('input[type="password"]').isVisible(),
        'a wrong password should not let anybody in');

      await openAdmin(page);
      await page.locator('input[type="password"]').waitFor({ state: 'detached', timeout: 15000 });
    }, { url: `${siteBase}/admin`, ready: false });
  });

  /** Put a guest in the database directly, so the admin tests stand alone. */
  const seedGuest = async (name, guests = 2) => {
    const res = await apiJson('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, attending: true, guests }),
    });
    assertEqual(res.status, 200, `seeding ${name}`);
    return name;
  };

  /** Unlock the panel and wait for `name` to appear in the guest list. */
  async function adminShowing(page, name) {
    await openAdmin(page);
    await page.getByText(name).first().waitFor({ state: 'visible', timeout: 30000 });
  }

  await test('the admin panel shows the real totals and the guest list', async () => {
    const name = await seedGuest('אורח לוח', 3);
    const stats = (await apiJson('/api/stats', { headers: admin })).body;
    assert(stats.responses > 0, 'the seeded guest never reached the database');

    await withPage(async (page) => {
      await adminShowing(page, name);
      const body = await page.textContent('body');
      assert(body.includes(String(stats.responses)) || body.includes(String(stats.total_people)),
        'the panel is not showing the totals the API reports');
    }, { url: `${siteBase}/admin`, ready: false });
  });

  await test('guests with no personal link appear under "other"', async () => {
    const name = await seedGuest('אורח ללא הזמנה', 2);
    // The API must file them under "other" before the panel can show it.
    const stats = (await apiJson('/api/stats', { headers: admin })).body;
    assert(stats.by_side.other.responded > 0, 'the API did not file the walk-in under "other"');

    await withPage(async (page) => {
      await adminShowing(page, name);
      const body = await page.textContent('body');
      assert(body.includes('אחר'), 'guests with no personal link have nowhere to appear');
    }, { url: `${siteBase}/admin`, ready: false });
  });

  await test('the WhatsApp tab is gone', async () => {
    const name = await seedGuest('אורח טאב', 1);
    await withPage(async (page) => {
      await adminShowing(page, name);
      const tabs = await page.locator('button').allTextContents();
      assert(!tabs.some((t) => t.trim() === 'וואטסאפ'), 'the WhatsApp tab is still there');
    }, { url: `${siteBase}/admin`, ready: false });
  });

  await browser.close();
  cleanup();

  // ─── Report ────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nfailures:');
    for (const f of failed) console.log(`\n  ${f.name}\n${f.err.stack}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
