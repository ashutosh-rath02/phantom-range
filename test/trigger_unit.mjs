// Trigger simulation: drives HandManager with a real tracked finger-gun hand (from a photo) whose thumb
// is animated between cocked and fired, with landmark noise, at several camera rates.
// Checks full snaps, shallow snaps (thumb never seen all the way down), slow drift, noise and rapid fire.
import fs from 'node:fs';
import { HandManager } from '../src/hands.js';
import { GESTURE } from '../src/config.js';

const L = JSON.parse(fs.readFileSync(new URL('./landmarks.json', import.meta.url), 'utf8'));
const src = L.thumb_index.hands[0];
// The photo's finger points at the ceiling (the reload gesture); turn it 90 degrees to aim across the screen.
const rot = (p, c) => ({ x: c.x - (p.y - c.y), y: c.y + (p.x - c.x), z: p.z });
const W0 = src.wl.map(([x, y, z]) => rot({ x, y, z }, { x: 0, y: 0 }));
const N0 = src.lm.map(([x, y, z]) => rot({ x, y, z }, { x: 0.5, y: 0.5 }));

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const lerp = (a, b, k) => add(a, mul(sub(b, a), k));

// fired thumb: tip resting on top of the index finger near its middle joint
const fwd = norm(sub(W0[8], W0[5]));
let dn = sub(W0[17], W0[5]);
dn = norm(sub(dn, mul(fwd, dot(dn, fwd))));
const up = mul(dn, -1);
const tipF = add(lerp(W0[5], W0[6], 0.85), mul(up, 0.012));
const firedW = W0.map((p) => ({ ...p }));
firedW[4] = tipF;
firedW[3] = add(lerp(W0[2], tipF, 0.55), mul(up, 0.01));

// world -> normalized image, fitted on the unmodified pose (weak perspective)
const mean = (A) => A.reduce((s, p) => add(s, p), { x: 0, y: 0, z: 0 });
const mW = mul(mean(W0), 1 / 21),
  mN = mul(mean(N0), 1 / 21);
let num = 0,
  den = 0;
for (let i = 0; i < 21; i++) {
  const w = sub(W0[i], mW),
    n = sub(N0[i], mN);
  num += w.x * n.x + w.y * n.y;
  den += w.x * w.x + w.y * w.y;
}
const s = num / den;
const toN = (w, i) => (i <= 4 ? add(mN, mul(sub(w, mW), s)) : N0[i]);

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const gauss = () => (rnd() + rnd() + rnd()) / 1.7;

// k: how far the thumb is down in the image; k3: in the 3D estimate (defaults to the same)
function frame(k, noise, k3 = k) {
  const W = W0.map((p, i) => (i >= 1 && i <= 4 ? lerp(p, firedW[i], k3) : { ...p }));
  const Wimg = W0.map((p, i) => (i >= 1 && i <= 4 ? lerp(p, firedW[i], k) : { ...p }));
  const lm = Wimg.map((w, i) => {
    const n = toN(w, i);
    return { x: n.x + gauss() * noise, y: n.y + gauss() * noise, z: 0 };
  });
  const wl = W.map((w) => ({ x: w.x + gauss() * noise * 0.4, y: w.y + gauss() * noise * 0.4, z: w.z + gauss() * noise * 0.8 }));
  return { landmarks: [lm], worldLandmarks: [wl], handedness: [[{ categoryName: 'Right', score: 0.98 }]] };
}

// minimal camera model (same maths as ViewModel in tracker.js)
const view = {
  W: 1280, H: 720, vw: 1280, vh: 720, k: 1, ox: 0, oy: 0, f: 1024, gk: 2.5, fg: 2560,
  // the source photo is square, so map it into a square 720 px region of the frame
  toScreen(nx, ny) { return { x: this.W - (280 + nx * 720), y: ny * 720 }; },
  unproject(x, y, z) { return { x: ((x - this.W / 2) * z) / this.f, y: (-(y - this.H / 2) * z) / this.f, z: -z }; },
  unprojectGun(x, y, z) { return { x: ((x - this.W / 2) * z) / this.fg, y: (-(y - this.H / 2) * z) / this.fg, z: -z }; },
};
const settings = { gain: 1, point: 0.32 };

// timeline: list of [seconds, thumbAmount(t)] segments; returns fire count
function run(name, fps, segments, { noise = 0.0015, depth3 = 1, expect }) {
  const mgr = new HandManager(view, settings);
  let t = 1000,
    fires = 0,
    lows = [];
  for (const [dur, f] of segments) {
    const n = Math.round(dur * fps);
    for (let i = 0; i < n; i++) {
      const k = f(i / n);
      mgr.ingest(frame(k, noise, k * depth3), t);
      for (const e of mgr.drain()) if (e.type === 'fire') fires++;
      t += 1 / fps;
    }
  }
  const tr = mgr.tracks[0];
  const ok = expect(fires);
  console.log(`${ok ? '  ' : 'XX'} ${name.padEnd(46)} fps ${String(fps).padStart(2)}  fires ${fires}  levels cocked ${tr.cockRef.toFixed(2)} fired ${tr.downRef.toFixed(2)} line ${tr.thrDown.toFixed(2)}`);
  return ok;
}

const hold = (k) => () => k;
const ramp = (a, b) => (x) => a + (b - a) * x;
const draw = [1.2, hold(0)];
const snaps = (n, depth, down = 0.25, upT = 0.45) => {
  const out = [draw];
  for (let i = 0; i < n; i++) out.push([0.08, ramp(0, depth)], [down, hold(depth)], [0.12, ramp(depth, 0)], [upT, hold(0)]);
  return out;
};

let fails = 0;
const check = (...a) => { if (!run(...a)) fails++; };
for (const fps of [30, 15]) {
  check('full snaps', fps, snaps(6, 1), { expect: (n) => n === 6 });
  check('shallow snaps (thumb seen 55% of the way down)', fps, snaps(6, 0.55), { expect: (n) => n >= 5 });
  check('rapid fire (4 snaps in 2 s)', fps, snaps(4, 1, 0.12, 0.18), { expect: (n) => n === 4 });
  check('slow drift to 45%, held', fps, [draw, [3, ramp(0, 0.45)], [2, hold(0.45)]], { expect: (n) => n === 0 });
  check('holding cocked with noisy tracking', fps, [draw, [8, hold(0)]], { noise: 0.004, expect: (n) => n === 0 });
  check('small twitches (20%)', fps, snaps(5, 0.2), { expect: (n) => n === 0 });
  check('pointing at camera: 3D sees only 30% of the drop', fps, snaps(6, 1), { depth3: 0.3, expect: (n) => n >= 5 });
  const glitches = [draw];
  for (let i = 0; i < 8; i++) glitches.push([1 / fps, hold(0.5)], [0.5, hold(0)]);
  check('one-frame tracking glitches (50%)', fps, glitches, { expect: (n) => n === 0 });
}
check('full snaps, slow machine', 6, snaps(5, 1, 0.4, 0.6), { expect: (n) => n === 5 });
GESTURE.cockFactor = 0.36;
GESTURE.snapFactor = 0.6;
check('firm setting, full snaps', 30, snaps(5, 1), { expect: (n) => n === 5 });
check('firm setting, small twitches (30%)', 30, snaps(5, 0.3), { expect: (n) => n === 0 });
console.log('fails', fails);
