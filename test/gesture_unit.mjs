import fs from 'node:fs';
import { measure, classify } from '../src/hands.js';
const d = JSON.parse(fs.readFileSync('landmarks.json','utf8'));
const expect = { thumb_index:'gun', thumb_index_ccw:'gun', thumb_index_cw:'gun', gun:'gun', gun_ccw:'gun', gun_cw:'gun', one:'gun', one_ccw:'gun', one_cw:'gun', point:'gun', point_ccw:'gun', point_cw:'gun', palm:'palm', palm_ccw:'palm', palm_cw:'palm', four:'palm', stop:'palm', fist:'fist', fist_ccw:'fist', fist_cw:'fist', scene_L_boy:'gun', take_photo:'gun', thumb_index2:'gun' };
let fails = 0;
for (const [k,v] of Object.entries(d)) for (const h of v.hands) {
  const W = h.wl.map(p=>({x:p[0],y:p[1],z:p[2]}));
  const m = measure(W); const c = classify(m, 'none');
  const exp = expect[k]; const ok = !exp || exp===c; if (!ok) fails++;
  console.log((ok?'  ':'XX'), k.padEnd(20), c.padEnd(5), 'h='+m.h.toFixed(2), 'fwdY='+m.fwd.y.toFixed(2), exp?('(expect '+exp+')'):'');
}
console.log('fails', fails);
