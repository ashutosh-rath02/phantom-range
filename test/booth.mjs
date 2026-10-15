import { chromium } from 'playwright';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const seg = JSON.parse(arg('seg', '{"dur":100,"img":"thumb_index","rot":-90,"scale":1.0,"x":0.45,"y":0.55}'));
const W = +arg('w', 1280), H = +arg('h', 720);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.addInitScript(`window.__FAKE_SCRIPT = [${JSON.stringify(seg)}];`);
await page.addInitScript({ path: 'fakecam.js' });
await page.goto('http://localhost:8080/public/index.html?autostart=free&skiptut=1&cpu=1&mute&timescale=' + arg('ts', '0.15'));
await page.waitForFunction(() => window.__PR?.slots?.[0]?.ctrl && window.__PR.slots[0].ctrl !== 'mouse', null, { timeout: 120000 });
// drop the HUD panels for clean shots
await page.addStyleTag({ content: '#legend,#weapon,#scorebox,#status,#toast,#officer{display:none!important}' });
const ids = { pistol: 0, rifle: 1, shotgun: 2, sniper: 3 };
for (const w of arg('weapons', 'pistol,rifle,shotgun').split(',')) {
  await page.evaluate((i) => window.__PR.selectWeapon(i, true), ids[w]);
  await page.waitForTimeout(+arg('sw', 4000));
  await page.evaluate(() => { const s = window.__PR.slots[0]; s.pressed = true; s.firstShot = true; });
  await page.waitForTimeout(+arg('after', 900));
  await page.screenshot({ path: `out/booth_${w}.png` });
  await page.evaluate(() => { window.__PR.slots[0].held = false; });
  console.log('shot', w);
}
await browser.close();
