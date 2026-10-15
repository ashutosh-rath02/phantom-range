import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8080/public/index.html?autostart=free&mouse&skiptut=1');
await page.waitForFunction(() => window.__PR?.S.phase === 'free', null, { timeout: 30000 });
const sample = () => page.evaluate(() => {
  const P = window.__PR;
  const count = (o) => { let n = 0; o.traverse(() => n++); return n; };
  const r = P.range;
  return { t: P.S.t.toFixed(0), shots: P.S.shots, rangeObjs: count(r.ctx.scene), gunObjs: count(P.slots[0].rig.ctx.scene), targets: r.targets.length, voices: P.audio.active, heapMB: (performance.memory?.usedJSHeapSize / 1e6).toFixed(1) };
});
console.log(JSON.stringify(await sample()));
const weapons = ['1', '2', '3', '4'];
for (let round = 0; round < 8; round++) {
  await page.keyboard.press(weapons[round % 4]);
  await page.waitForTimeout(500);
  await page.mouse.move(200 + round * 50, 150);
  for (let i = 0; i < 10; i++) { await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up(); await page.waitForTimeout(150); }
  if (round % 2) await page.keyboard.press('r');
  console.log(JSON.stringify(await sample()));
}
console.log('errors', errs);
await browser.close();
