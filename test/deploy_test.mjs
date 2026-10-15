import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const root = '/home/claude/phantom-range';
const scenario = JSON.parse(fs.readFileSync('scenario_small.json', 'utf8'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const hits = {};
const serve = (prefix, dir) => ctx.route(prefix + '**', (route) => {
  const rel = decodeURIComponent(route.request().url().slice(prefix.length).split('?')[0]);
  const f = path.join(dir, rel);
  hits[prefix] = (hits[prefix] || 0) + 1;
  if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
  const ext = path.extname(f);
  const type = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm' }[ext] || 'application/octet-stream';
  route.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
});
await serve('https://cdn.jsdelivr.net/npm/three@0.160.0/', root + '/node_modules/three/');
await serve('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/', root + '/node_modules/@mediapipe/tasks-vision/');
await ctx.route('https://storage.googleapis.com/mediapipe-models/**', (route) => {
  hits.gcs = (hits.gcs || 0) + 1;
  route.fulfill({ status: 200, body: fs.readFileSync(root + '/public/models/hand_landmarker.task'), headers: { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' } });
});
await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
// 1) real getUserMedia on file:// with Chrome's fake device
await page.goto('http://localhost:8080/deploy/index.html');
const gum = await page.evaluate(async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true });
    return 'ok ' + s.getVideoTracks()[0].label + ' secure=' + window.isSecureContext;
  } catch (e) {
    return 'fail ' + e.name;
  }
});
console.log('getUserMedia on file://:', gum);
// 2) full app from the single file, scripted hands
await page.addInitScript(`window.__FAKE_SCRIPT = ${JSON.stringify(scenario)}; window.__FAKE_BASE = 'http://localhost:8080';`);
await page.addInitScript({ path: 'fakecam.js' });
await page.goto('http://localhost:8080/deploy/index.html?autostart=free&skiptut=1&cpu=1');
await page.waitForFunction(() => window.__PR?.slots?.[0]?.ctrl && window.__PR.slots[0].ctrl !== 'mouse', null, { timeout: 120000 }).catch(() => console.log('no gun'));
await page.waitForTimeout(12000);
const st = await page.evaluate(() => ({ phase: window.__PR.S.phase, mode: window.__PR.tracker.mode, delegate: window.__PR.tracker.delegate, shots: window.__PR.S.log.filter((l) => l.type === 'shot').length }));
console.log('state', JSON.stringify(st), 'cdn hits', JSON.stringify(hits));
await page.screenshot({ path: 'out/cdn_file.png' });
console.log('errors', errs.filter((e) => !e.includes('fonts')).slice(0, 8));
await browser.close();
