import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errs.push(m.text()); });
await page.goto('http://localhost:8080/public/index.html');
await page.waitForTimeout(800);
await page.screenshot({ path: 'out/game_intro.png' });
await page.click('#go-mouse');
await page.waitForFunction(() => window.__PR.S.phase === 'free', null, { timeout: 30000 }); await page.waitForTimeout(700);
const targets = () => page.evaluate(() => {
  const P = window.__PR; const out = [];
  for (const t of P.range.targets) {
    if (!t.alive) continue;
    let p;
    if (t.kind === 'plate') { const v = t.face.getWorldPosition(new t.face.position.constructor()); p = P.view.project(v); }
    else if (t.kind === 'bottle') { const v = t.group.localToWorld(new t.group.position.constructor(0, 0.1, 0)); p = P.view.project(v); }
    else p = P.view.project(t.group.position);
    out.push({ kind: t.kind, x: p.x, y: p.y });
  }
  return out;
});
const state = () => page.evaluate(() => { const P = window.__PR; const st = P.slotState(P.slots[0]); return { score: P.S.score, shots: P.S.shots, hits: P.S.hits, ammo: st.ammo, w: st.def.id, mode: st.mode, reloading: st.reloading, ctrl: P.slots[0].ctrl, scope: P.S.scopeK }; });
const shootAt = async (x, y, hold = 60) => { await page.mouse.move(x, y, { steps: 3 }); await page.waitForTimeout(120); await page.mouse.down(); await page.waitForTimeout(hold); await page.mouse.up(); await page.waitForTimeout(250); };
let ts = await targets();
console.log('targets', ts.map((t) => `${t.kind}@${t.x | 0},${t.y | 0}`).join(' '));
// pistol: shoot each plate and bottle
for (const t of ts.filter((t) => t.kind === 'plate' || t.kind === 'bottle')) await shootAt(t.x, t.y);
console.log('after pistol', JSON.stringify(await state()));
await page.screenshot({ path: 'out/game_pistol.png' });
// miss shots to drain mag and check auto reload
for (let i = 0; i < 12; i++) await shootAt(480, 300, 40);
console.log('drained', JSON.stringify(await state()));
await page.waitForTimeout(2500);
console.log('after autoreload', JSON.stringify(await state()));
// rifle auto
await page.keyboard.press('2'); await page.waitForTimeout(600);
ts = await targets(); const plate = ts.find((t) => t.kind === 'plate');
await page.mouse.move(plate.x, plate.y); await page.waitForTimeout(150);
await page.mouse.down(); await page.waitForTimeout(900); await page.mouse.up();
console.log('rifle auto burst', JSON.stringify(await state()));
await page.screenshot({ path: 'out/game_rifle.png' });
await page.keyboard.press('b'); await page.waitForTimeout(200);
console.log('mode ->', (await state()).mode);
await page.mouse.down(); await page.waitForTimeout(500); await page.mouse.up(); await page.waitForTimeout(300);
console.log('burst', JSON.stringify(await state()));
await page.keyboard.press('r'); await page.waitForTimeout(2600);
console.log('reloaded', JSON.stringify(await state()));
// shotgun
await page.keyboard.press('3'); await page.waitForTimeout(600);
ts = await targets();
for (const t of ts.filter((t) => t.kind !== 'drone').slice(0, 3)) await shootAt(t.x, t.y, 50), await page.waitForTimeout(450);
console.log('shotgun', JSON.stringify(await state()));
await page.screenshot({ path: 'out/game_shotgun.png' });
await page.keyboard.press('r'); await page.waitForTimeout(1500);
console.log('shotgun reload partial', JSON.stringify(await state()));
await page.waitForTimeout(1500);
// sniper scope
await page.keyboard.press('4'); await page.waitForTimeout(600);
ts = await targets(); const pl = ts.filter((t) => t.kind === 'plate').pop();
await page.mouse.move(pl.x, pl.y); await page.mouse.click(pl.x, pl.y, { button: 'right' }); await page.waitForTimeout(500);
console.log('scoped', JSON.stringify(await state()));
await page.screenshot({ path: 'out/game_scope.png' });
await shootAt(pl.x, pl.y); await page.waitForTimeout(1200);
console.log('sniper shot', JSON.stringify(await state()));
await page.mouse.click(pl.x, pl.y, { button: 'right' });
// wait for a clay / drone and try to shoot them
let clayHit = false, droneSeen = false;
await page.keyboard.press('2'); await page.waitForTimeout(400);
// Clays fly fast and this test machine renders slowly, so aim from inside the page on the same frame
// as the click (the game's own mouse path), instead of chasing a position read a few frames earlier.
for (let i = 0; i < 60 && !clayHit; i++) {
  const r = await page.evaluate(async () => {
    const P = window.__PR;
    const drone = P.range.targets.some((t) => t.kind === 'drone');
    const c = P.range.targets.find((t) => t.kind === 'clay' && t.alive);
    const p = c && P.view.project(c.group.position);
    if (!p || p.x < 30 || p.x > 930 || p.y < 30 || p.y > 510) return { drone, hit: false };
    const before = P.S.kills.clay;
    Object.assign(P.S.mouse, { x: p.x, y: p.y, lastMove: P.S.t, pressed: true, held: true });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    P.S.mouse.held = false;
    return { drone, hit: P.S.kills.clay > before };
  });
  if (r.drone) droneSeen = true;
  if (r.hit) clayHit = true;
  else await page.waitForTimeout(300);
}
console.log('clay hit', clayHit, 'drone seen', droneSeen, JSON.stringify(await state()));
await page.screenshot({ path: 'out/game_late.png' });
// drill mode quickly
await page.evaluate(() => window.__PR.startMode('drill'));
await page.waitForTimeout(800);
await page.screenshot({ path: 'out/game_countdown.png' });
await page.waitForFunction(() => window.__PR.S.phase === 'drill', null, { timeout: 10000 });
await page.evaluate(() => (window.__PR.S.drillT = 2));
await page.waitForFunction(() => window.__PR.S.phase === 'results', null, { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'out/game_results.png' });
console.log('results visible', await page.isVisible('#results'));
await page.click('#again'); await page.waitForTimeout(500);
console.log('phase after again', await page.evaluate(() => window.__PR.S.phase));
// settings drawer
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.screenshot({ path: 'out/game_settings.png' });
console.log('settings open', await page.isVisible('#settings'), 'paused', await page.evaluate(() => window.__PR.S.paused));
await page.keyboard.press('Escape');
const counts = await page.evaluate(() => { const P = window.__PR; return { targets: P.range.targets.length, log: P.S.log.length }; });
console.log('counts', JSON.stringify(counts));
console.log('ERRORS', errs.length, errs.slice(0, 10));
await browser.close();
