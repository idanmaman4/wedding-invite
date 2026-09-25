import { chromium } from 'playwright';
// Usage: npm run dev -- --port 5199  (in another terminal), then
//   node scripts/capture_vines.mjs <tmp-dir> && .venv/bin/python scripts/stitch_vines.py <tmp-dir>
// Renders the live VineScene at each phone width in vineSets.json, fully grown
// and with the wind frozen, and saves transparent viewport slices down the page.
const out = process.argv[2];
const BASE = process.env.VINE_BASE_URL || 'http://localhost:5199';
// Supersampling: render at SS× and let stitch_vines.py scale down to 3×, so
// every screen pixel of the strip averages SS/3 × SS/3 rendered ones —
// smoother cane edges, finer leaf veins and petals than a straight 3× render.
const SS = Number(process.env.VINE_SS || 6);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const meta = [];
for (const W of [360, 390, 430]) {
  const H = 800;
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SS, isMobile: true, hasTouch: true });
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(`${BASE}/?vine=live&vinedpr=${SS}&vinehq=1`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__vine?.built, null, { timeout: 60000 });
  const px = await p.evaluate(() => __vine.renderer.getPixelRatio());
  if (px !== SS) throw new Error(`vine rendered at ${px}x, expected ${SS}x — the strips would be soft`);
  await p.waitForTimeout(1500);
  await p.evaluate(() => { __vine._growthTarget = 1; });
  await p.waitForFunction(() => __vine.growth >= 0.999 && __vine.vineRoses.every(r => r.revealed), null, { timeout: 60000 });
  await p.waitForTimeout(3000); // bloom-open tweens
  await p.evaluate(() => {
    __vine.uWind.value = 0;
    const st = document.createElement('style');
    st.textContent = `html,body{background:transparent!important} nav,main{visibility:hidden!important} canvas{-webkit-mask-image:none!important;mask-image:none!important}`;
    document.head.appendChild(st);
  });
  const docH = await p.evaluate(() => document.documentElement.scrollHeight);
  const navH = await p.evaluate(() => document.querySelector('nav').offsetHeight);
  const slices = [];
  for (let y = 0; ; y += H) {
    const target = Math.min(y, docH - H);
    await p.evaluate(yy => window.scrollTo(0, yy), target);
    await p.waitForFunction(() => __vine.lag === 0 && __vine.sway === 0, null, { timeout: 20000 });
    await p.waitForTimeout(400);
    const sy = await p.evaluate(() => scrollY);
    const f = `${out}/s_${W}_${slices.length}.png`;
    await p.screenshot({ path: f, omitBackground: true });
    slices.push({ f, y: sy });
    if (target >= docH - H) break;
  }
  const count = await p.evaluate(() => __vine.vineRoses.length);
  meta.push({ W, docH, navH, slices, roses: count, ss: SS });
  console.log(W, 'docH', docH, 'slices', slices.length, 'roses', count);
  await p.close();
}
await b.close();
import('fs').then(fs => fs.writeFileSync(`${out}/meta.json`, JSON.stringify(meta)));
