import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://localhost:8080/public/index.html?autostart=free&mouse&skiptut=1&mute');
await page.waitForFunction(() => window.__PR?.S.phase === 'free', null, { timeout: 30000 });
await page.waitForTimeout(500);
const r = await page.evaluate(async () => {
  const P = window.__PR; const out = [];
  for (let k = 0; k < 4; k++) {
    P.range.launchClay();
    const c = P.range.targets[P.range.targets.length - 1];
    // advance its flight to mid-air
    for (let i = 0; i < 60; i++) P.range.updateTarget(c, 1 / 60, 0);
    const s = P.view.project(c.group.position);
    const exact = P.range.pick(s.x, s.y, 10).some((h) => h.tg === c);
    const off = P.range.pick(s.x + 30, s.y, 10).some((h) => h.tg === c);
    const far = P.range.pick(s.x + 90, s.y, 10).some((h) => h.tg === c);
    out.push({ x: s.x | 0, y: s.y | 0, z: s.z.toFixed(1), exact, off30: off, off90: far });
  }
  // drone hit
  P.range.launchDrone();
  const d = P.range.targets.find((t) => t.kind === 'drone');
  for (let i = 0; i < 180; i++) P.range.updateTarget(d, 1 / 60, i / 60);
  const ds = P.view.project(d.group.position);
  const dh = P.range.pick(ds.x, ds.y, 10);
  let hp = d.hp; for (const h of dh) if (h.tg === d) P.range.hit(h, P.WEAPONS[0]);
  return { clays: out, drone: { x: ds.x | 0, y: ds.y | 0, hit: dh.length, hpBefore: hp, hpAfter: d.hp } };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
