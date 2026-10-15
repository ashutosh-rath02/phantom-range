// Close-up of the drawn gun over the camera hand, with and without the thumb/finger masks.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const seg = { dur: 100, img: process.argv[2] || 'thumb_index', rot: -90, scale: 1.0, x: 0.45, y: 0.55 };
await page.addInitScript(`window.__FAKE_SCRIPT = [${JSON.stringify(seg)}];`);
await page.addInitScript({ path: 'fakecam.js' });
await page.goto('http://localhost:8080/public/index.html?autostart=free&skiptut=1&cpu=1&mute&timescale=0.15');
await page.waitForFunction(() => window.__PR?.slots?.[0]?.ctrl && window.__PR.slots[0].ctrl !== 'mouse', null, { timeout: 150000 });
await page.addStyleTag({ content: '#legend,#weapon,#scorebox,#status,#toast,#officer,#hud{display:none!important}' });
for (const w of (process.argv[3] || '0,1').split(',').map(Number)) {
  await page.evaluate((i) => window.__PR.selectWeapon(i, true), w);
  for (const occ of [true, false]) {
    await page.evaluate((o) => (window.__PR.settings.occlusion = o), occ);
    await page.waitForTimeout(3500);
    const tr = await page.evaluate(() => { const t = window.__PR.hands.tracks[0]; return t && { x: t.P[4].x, y: t.P[4].y, cx: t.center.x, cy: t.center.y }; });
    await page.screenshot({ path: `out/thumb_${w}_${occ ? 'mask' : 'nomask'}.png` });
    console.log('shot', w, occ, JSON.stringify(tr));
  }
}
await browser.close();
