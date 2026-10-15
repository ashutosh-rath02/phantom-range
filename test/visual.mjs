import { chromium } from 'playwright';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const seg = JSON.parse(arg('seg', '{"dur":100,"img":"scene_scrubs_gun","scale":1.9}'));
const tag = arg('tag', 'vis');
const debug = process.argv.includes('--debug');
const weapons = arg('weapons', 'pistol,rifle,shotgun,sniper').split(',');
const W = +arg('w', 960), H = +arg('h', 540);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(`window.__FAKE_SCRIPT = [${JSON.stringify(seg)}];`);
await page.addInitScript({ path: 'fakecam.js' });
await page.goto(`http://localhost:8080/public/index.html?autostart=free&skiptut=1&cpu=1${debug ? '&debug' : ''}&mute`);
await page.waitForFunction(() => window.__PR?.slots?.[0]?.ctrl && window.__PR.slots[0].ctrl !== 'mouse', null, { timeout: +arg('wait', 90000) }).catch(() => console.log('no gun drawn; continuing'));
const ids = { pistol: 0, rifle: 1, shotgun: 2, sniper: 3 };
for (const w of weapons) {
  await page.evaluate((i) => window.__PR.selectWeapon(i, true), ids[w]);
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => { const P = window.__PR; const tr = P.slots[0].ctrl; return tr && tr !== 'mouse' ? { depth: tr.depth.toFixed(2), basis: tr.basis, pose: tr.pose, h: tr.metrics.h.toFixed(2) } : null; });
  console.log(w, JSON.stringify(info));
  await page.screenshot({ path: `out/${tag}_${w}.png` });
}
console.log('errors', errs);
await browser.close();
