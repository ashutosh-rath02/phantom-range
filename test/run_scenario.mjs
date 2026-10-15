import { chromium } from 'playwright';
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const scenario = JSON.parse(fs.readFileSync(arg('script', 'scenario_basic.json'), 'utf8'));
const url = arg('url', 'http://localhost:8080/public/index.html?autostart=free&skiptut=1&cpu=1');
const secs = +arg('secs', scenario.reduce((a, s) => a + s.dur, 0) + 6);
const shots = (arg('shots', '') || '').split(',').filter(Boolean).map(Number);
const tag = arg('tag', 'run');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: +arg('w', 1280), height: +arg('h', 720) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(`window.__FAKE_SCRIPT = ${JSON.stringify(scenario)};`);
await page.addInitScript({ path: 'fakecam.js' });
await page.goto(url);
// The scenario clock starts once the tracker has produced its first result (start-up time varies a lot
// on this test machine), unless --fromload is given.
if (!process.argv.includes('--fromload')) {
  await page.waitForFunction(() => window.__PR?.tracker?.fps > 0 || window.__PR?.S?.mouseOnly, null, { timeout: 180000 }).catch(() => console.log('tracker never started'));
  await page.evaluate(() => window.__fakeRestart?.());
}
const t0 = Date.now();
let si = 0;
const samples = [];
while ((Date.now() - t0) / 1000 < secs) {
  await page.waitForTimeout(250);
  const el = (Date.now() - t0) / 1000;
  const s = await page.evaluate(() => {
    const P = window.__PR; if (!P) return null;
    const tr = P.hands.tracks[0];
    return { phase: P.S.phase, seg: window.__fakeSeg, fake: window.__fakeClock?.() ?? 0, fps: P.tracker.fps, infer: P.tracker.inferMs, mode: P.tracker.mode, dlg: P.tracker.delegate, w: P.WEAPONS[P.S.weaponIdx].id,
      ammo: P.slotState(P.slots[0]).ammo, pose: tr?.pose, steadyT: tr?.steadyT, speed: tr?.speed, aim: tr?.aim, tut: P.S.tut?.i, h: tr?.metrics?.h, trig: tr?.trigger, ctrl: P.slots[0].ctrl ? (P.slots[0].ctrl === 'mouse' ? 'mouse' : 'hand') : null };
  });
  if (s) samples.push({ el: +el.toFixed(2), ...s });
  if (si < shots.length && el >= shots[si]) { await page.screenshot({ path: `out/${tag}_${shots[si]}.png` }); si++; }
}
const logs = await page.evaluate(() => window.__PR?.S.log || []);
fs.writeFileSync(`out/${tag}_log.json`, JSON.stringify({ samples, logs, errors }, null, 1));
const count = (type, f = () => true) => logs.filter((l) => l.type === type && f(l)).length;
console.log('gesture fire', count('gesture', (l) => l.g === 'fire'), '| reload', count('gesture', (l) => l.g === 'reload'), '| switch', count('gesture', (l) => l.g === 'switch'), '| mode', count('gesture', (l) => l.g === 'mode'), '| draw', count('gesture', (l) => l.g === 'draw'), '| holster', count('gesture', (l) => l.g === 'holster'));
console.log('shots', count('shot'), '| hits', count('hit'), '| reloadEnd', count('reloadEnd'), '| switches', count('switch'), '| calibrated', count('calibrated'));
console.log('errors:', errors.length); errors.slice(0, 15).forEach((e) => console.log('  ', e.slice(0, 300)));
const last = samples[samples.length - 1]; console.log('last sample', JSON.stringify(last));
await browser.close();
