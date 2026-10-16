import fs from 'node:fs';
import { measure, classify, reach2D } from '../src/hands.js';
const d = JSON.parse(fs.readFileSync('landmarks.json','utf8'));
const expect = { thumb_index:'gun', thumb_index_ccw:'gun', thumb_index_cw:'gun', gun:'gun', gun_ccw:'gun', gun_cw:'gun', one:'gun', one_ccw:'gun', one_cw:'gun', point:'gun', point_ccw:'gun', point_cw:'gun', palm:'palm', palm_ccw:'palm', palm_cw:'palm', four:'palm', stop:'palm', rock:'rock', call:'none', pinkie:'none', three3:'none', fist:'fist', fist_ccw:'fist', fist_cw:'fist', scene_L_boy:'gun', take_photo:'gun', thumb_index2:'gun' };
let fails = 0;
for (const [k,v] of Object.entries(d)) for (const h of v.hands) {
  const W = h.wl.map(p=>({x:p[0],y:p[1],z:p[2]}));
  const m = measure(W); m.reach = reach2D(h.lm.map(([x, y]) => ({ x: x * v.W, y: y * v.H }))); const c = classify(m, 'none');
  const exp = expect[k]; const ok = !exp || exp===c; if (!ok) fails++;
  console.log((ok?'  ':'XX'), k.padEnd(20), c.padEnd(5), 'h='+m.h.toFixed(2), 'fwdY='+m.fwd.y.toFixed(2), exp?('(expect '+exp+')'):'');
}
// Live session: a relaxed finger gun whose index the 3D estimate reads as bent (0.6 extension) while
// the image shows it still pointing well past the curled fingers. It must stay a gun, and never read
// as a fist (which once switched the fire mode by itself).
const relaxed = [
  { i: 0.65, m: 0.5, r: 0.51, p: 0.54, ri: 1.41, rm: 1.07, rr: 0.96 },
  { i: 0.61, m: 0.49, r: 0.51, p: 0.58, ri: 1.36, rm: 1.1, rr: 0.99 },
  { i: 0.62, m: 0.5, r: 0.5, p: 0.54, ri: 1.4, rm: 1.13, rr: 0.97 },
  { i: 0.65, m: 0.51, r: 0.52, p: 0.54, ri: 1.47, rm: 1.16, rr: 1.02 },
];
for (const f of relaxed) {
  const m = { ext: { i: f.i, m: f.m, r: f.r, p: f.p }, reach: { i: f.ri, m: f.rm, r: f.rr, p: f.rr - 0.05 } };
  const held = classify(m, 'gun'), fresh = classify(m, 'none');
  const ok = held === 'gun' && fresh !== 'fist';
  if (!ok) fails++;
  console.log(ok ? '  ' : 'XX', 'relaxed index (live)'.padEnd(20), `held ${held}, fresh ${fresh}`);
}
console.log('fails', fails);
