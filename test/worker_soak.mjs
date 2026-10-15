// Tracking worker soak: steady detection rate, no backlog, stable page memory over a couple of minutes.
import { chromium } from 'playwright';
import fs from 'node:fs';
const scenario = JSON.parse(fs.readFileSync('scenario_small.json', 'utf8'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(`window.__FAKE_SCRIPT = ${JSON.stringify(scenario)};`);
await page.addInitScript({ path: 'fakecam.js' });
await page.goto('http://localhost:8080/public/index.html?autostart=free&skiptut=1&cpu=1&mute');
await page.waitForFunction(() => window.__PR?.tracker?.fps > 0, null, { timeout: 180000 });
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(15000);
  const s = await page.evaluate(() => {
    const T = window.__PR.tracker;
    return { mode: T.mode, fps: +T.fps.toFixed(2), lagMs: Math.round(window.__PR.hands.latency * 1000), queued: T.results.length, inFlight: T.inFlight, shots: window.__PR.S.shots, heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) };
  });
  console.log(JSON.stringify(s));
}
console.log('errors', errs.length, errs.slice(0, 3));
await browser.close();
