// Outfit pipeline in a real browser: the segmenter worker starts on the first change, masks arrive,
// the outfit pass draws over the player, cycling and "off" work, and tracking keeps running.
// The single-mask person model in test/models stands in for the clothes model (no network here).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/ERR_TUNNEL|XNNPACK|Failed to load resource/.test(t)) errs.push(t);
});
await page.addInitScript(() => {
  window.__FAKE_BASE = 'http://localhost:8080';
  window.__FAKE_SCRIPT = [{ img: 'scene_L_boy', dur: 1000, scale: 1.75, x: 0.5, y: 0.52 }];
});
await page.addInitScript({ path: new URL('./fakecam.js', import.meta.url).pathname });
await page.goto('http://localhost:8080/public/index.html?autostart=free&skiptut=1&cpu=1&mute=1&segmodel=/test/models/selfie_segmentation.tflite');
await page.waitForFunction(() => window.__PR?.S.phase === 'free' && window.__PR.tracker.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__PR.wearOutfit('off', { quiet: true }));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'out/outfit_off.png' });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'out/outfit_off2.png' });

let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? '  ' : 'XX'} ${msg}`);
  if (!ok) fails++;
};
const state = () =>
  page.evaluate(() => {
    const P = window.__PR;
    return { seg: P.segmenter.state, err: P.segmenter.error, mix: P.outfitLayer.mat.uniforms.uMix.value, outfit: P.settings.outfit, ms: P.segmenter.ms, masks: P.segmenter.id, fps: P.tracker.fps, cover: P.outfitLayer.hasMask };
  });

await page.keyboard.press('o');
const t0 = Date.now();
await page.waitForFunction(() => ['ready', 'error'].includes(window.__PR.segmenter.state), null, { timeout: 120000 });
let st = await state();
check(st.seg === 'ready', `segmenter ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (${st.seg}${st.err ? ': ' + st.err : ''})`);
await page.waitForFunction(() => window.__PR.outfitLayer.mat.uniforms.uMix.value > 0.9, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
st = await state();
check(st.outfit === 'woodland' && st.mix > 0.9, `woodland worn, layer mix ${st.mix.toFixed(2)}, ${st.masks} frames sent, ${st.ms.toFixed(0)} ms per mask`);
await page.screenshot({ path: 'out/outfit_woodland.png' });
for (let i = 0; i < 3; i++) {
  await page.keyboard.press('o');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `out/outfit_${(await state()).outfit}.png` });
}
st = await state();
check(st.outfit === 'night', `cycled to ${st.outfit}`);
check(st.fps > 0, `tracking still running at ${st.fps.toFixed(1)} fps while the outfit is worn`);

// share of the screen that changed: no outfit against woodland, beside two no-outfit frames (targets move)
const changed = (x, y) =>
  +execFileSync('python3', ['-c', `
from PIL import Image, ImageChops
a = Image.open('out/${x}.png').convert('RGB'); b = Image.open('out/${y}.png').convert('RGB')
h = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 40 else 0).histogram()
print(h[255] / (a.size[0] * a.size[1]))
`]).toString().trim();
const base = changed('outfit_off', 'outfit_off2'),
  worn = changed('outfit_off', 'outfit_woodland');
check(worn > base + 0.05, `outfit changed ${(worn * 100).toFixed(1)}% of the screen (moving targets alone ${(base * 100).toFixed(1)}%)`);

await page.evaluate(() => window.__PR.wearOutfit('off'));
await page.waitForFunction(() => window.__PR.outfitLayer.mat.uniforms.uMix.value === 0, null, { timeout: 10000 }).catch(() => {});
st = await state();
check(st.mix === 0, `off: layer faded out (mix ${st.mix.toFixed(3)})`);
check(errs.length === 0, `no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
console.log('fails', fails);
await browser.close();
process.exit(fails ? 1 : 0);
