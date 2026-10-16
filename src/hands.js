// Hand tracks: identity across frames, smoothing, gesture recognition and the 3D pose a gun is attached to.
import { GESTURE, AIM, TRACKING } from './config.js';
import {
  OneEuro,
  OneEuro2,
  History2,
  clamp,
  vsub,
  vnorm,
  vdot,
  vscale,
  vcross,
  vdist,
  vlen,
} from './util.js';

const FINGERS = {
  i: [5, 6, 7, 8],
  m: [9, 10, 11, 12],
  r: [13, 14, 15, 16],
  p: [17, 18, 19, 20],
};
const PALM_IDS = [0, 5, 9, 13, 17];

function extension(W, ids) {
  const chain =
    vdist(W[ids[0]], W[0]) + vdist(W[ids[1]], W[ids[0]]) + vdist(W[ids[2]], W[ids[1]]) + vdist(W[ids[3]], W[ids[2]]);
  return vdist(W[ids[3]], W[0]) / (chain || 1);
}

// Mirror + flip MediaPipe world axes (x right, y down, z away) into three.js camera space (x right, y up, z toward viewer).
const T = (w) => ({ x: -w.x, y: -w.y, z: -w.z });

export function measure(W) {
  const ps = vdist(W[0], W[9]) || 0.08;
  const ext = {
    i: extension(W, FINGERS.i),
    m: extension(W, FINGERS.m),
    r: extension(W, FINGERS.r),
    p: extension(W, FINGERS.p),
  };
  const fwd = vnorm(vsub(W[8], W[5]));
  let dn = vsub(W[17], W[5]);
  dn = vnorm(vsub(dn, vscale(fwd, vdot(dn, fwd))));
  const up = vscale(dn, -1);
  const h = vdot(vsub(W[4], W[5]), up) / ps;
  return { ps, ext, fwd, up, h };
}

// Thumb height above the index knuckle measured in the camera image, in palm lengths.
// "Up" is the knuckle line from the little finger to the index finger, which stays visible when the
// finger gun points straight at the camera (where the 3D estimate of the index direction is weakest).
// r says how much the index finger's own image direction can be trusted (0 = pointing at the camera).
export function thumbHeight2D(P) {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const sc = Math.max(d(P[5], P[17]) / 0.8, d(P[0], P[9]), d(P[0], P[5]));
  let ux = P[5].x - P[17].x,
    uy = P[5].y - P[17].y;
  const ul = Math.hypot(ux, uy);
  if (sc < 8 || ul < 1) return null;
  ux /= ul;
  uy /= ul;
  let dx = P[8].x - P[5].x,
    dy = P[8].y - P[5].y;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl;
  dy /= dl;
  const r = clamp(dl / (sc * 0.6), 0, 1);
  const pr = ux * dx + uy * dy;
  const vx = ux - r * pr * dx,
    vy = uy - r * pr * dy;
  const vl = Math.hypot(vx, vy) || 1;
  return { h: ((P[4].x - P[5].x) * vx + (P[4].y - P[5].y) * vy) / vl / sc, r };
}

// Blend of the 3D and image thumb heights; leans on the image when the finger points at the camera.
export function thumbSignal(m, P) {
  const t2 = thumbHeight2D(P);
  if (!t2) return { u: m.h, h2: null };
  const w2 = 0.5 + 0.3 * (1 - t2.r);
  return { u: (1 - w2) * m.h + w2 * t2.h, h2: t2.h };
}

// Thumb hammer trigger, driven by the thumb height signal (palm lengths above the index finger).
// It fires on a quick drop measured from where the thumb just was and re-cocks as soon as the thumb
// comes back up part of the way. Both tests are relative to the thumb's own recent motion, so the
// trigger keeps working when a player's resting thumb height drifts during play; a fixed "cocked"
// level would leave the trigger stuck down once the thumb stopped rising that high. The two learned
// levels (fired and cocked) only scale the tests, they never gate them.
export class ThumbTrigger {
  constructor() {
    this.down = GESTURE.thumbDownInit; // how low this thumb goes when it fires
    this.top = GESTURE.thumbCockedInit; // where it has recently been held when cocked
    this.armed = false;
    this.fired = false;
    this.hist = [];
    this.trough = 0;
    this.peakAtFire = 0;
    this.pend = null;
    this.line = 0;
    this.pull = 0;
    this.lastT = 0;
    this.fireT = 0; // where the shot is aimed from (start of the drop)
    this.fireS = 0; // thumb height and time of the last shot
    this.fireAt = 0;
  }

  // A fresh hold of the gun: armed straight away if the thumb is already up.
  begin(s, t) {
    this.fired = false;
    this.pend = null;
    this.hist = [{ t, s }];
    this.top = Math.max(this.down + 0.2, Math.min(this.top, s + 0.1));
    this.armed = s > this.down + 0.2;
    this.trough = s;
    this.lastT = t;
  }

  // The hand stopped reading as a finger gun: drop any shot and wait for the thumb to come up again.
  cancel(s, t) {
    const was = this.fired;
    this.fired = false;
    this.armed = false;
    this.pend = null;
    this.trough = s;
    this.hist = [{ t, s }];
    return was;
  }

  // Trigger tests are suspended for a moment (pointing at the ceiling, hand changing shape) without a
  // shot in progress: forget the recent motion so the gap cannot read as a drop when they resume.
  pause() {
    this.hist = [];
    this.pend = null;
  }

  // Feeds one detection. gap is the detection interval in seconds.
  // Returns 'fire', 'release', 'refire' (a second, deeper snap before the first was let go) or null.
  update(s, t, gap) {
    const dt = this.lastT ? clamp(t - this.lastT, 0.001, 0.5) : 1 / 30;
    this.lastT = t;
    const win = Math.max(0.35, 2.5 * gap);
    this.hist.push({ t, s });
    while (this.hist.length > 1 && t - this.hist[0].t > win) this.hist.shift();
    let peak = -Infinity;
    for (const h of this.hist) peak = Math.max(peak, h.s);
    const span = Math.max(0.2, peak - this.down);
    const need = Math.max(0.15, (GESTURE.snapFactor ?? 0.45) * span);
    const drop = peak - s;
    const snap = drop >= need;
    // One frame of drop is enough when it is deep, which matters at low camera rates where a snap
    // often shows on a single frame. A shallower drop must still be there on the next frame, so a
    // single bad landmark cannot fire the gun.
    const deep = drop >= Math.max(0.25, 0.6 * span) || (snap && s < this.down + 0.12);
    let ev = null;

    if (!this.fired) {
      // cocked level: follows a raised thumb quickly and a lowered one slowly
      this.top += (s - this.top) * (1 - Math.exp(-dt / (s > this.top ? 0.15 : 1.5)));
      this.top = Math.max(this.top, this.down + 0.2);
      this.trough = Math.min(this.trough, s);
      if (!this.armed && s - this.trough >= Math.max(0.12, 0.35 * (this.top - this.trough))) this.armed = true;
      this.line = this.down + (GESTURE.cockFactor ?? 0.5) * (this.top - this.down);
      // a slower press still counts once the thumb is well below where it was being held
      const press = s < this.line && this.top - s >= need;
      const want = this.armed && (snap || press);
      // the next frame confirms a shallower drop if the thumb is still clearly below where it started
      const held = this.pend && s <= this.pend.peak - 0.4 * this.pend.need;
      if ((want && deep) || (this.armed && held)) ev = this.shoot(s, t, peak, span, 'fire');
      else this.pend = want ? { peak, need } : null;
    } else {
      // A lazy snap can fire on a shallow dip and the real snap follow straight after, from a thumb
      // that never rose far enough to re-cock. A second drop that goes well below the first is a shot.
      if (snap && deep && s < this.trough - 0.1 && this.fireS > this.down + 0.12 && t - this.fireAt >= 0.18) {
        this.learn();
        ev = this.shoot(s, t, peak, span, 'refire');
      } else {
        this.trough = Math.min(this.trough, s);
        // Re-cock once the thumb has come back up by part of the snap, or as soon as it is clearly
        // above the fired level again (a shallow snap barely dips, so its way back up is short).
        const clear = this.down + Math.max(0.15, 0.4 * (this.top - this.down));
        if (s - this.trough >= Math.max(0.12, 0.35 * (this.peakAtFire - this.trough)) || (s > clear && s - this.trough > 0.02)) {
          this.learn();
          this.fired = false;
          this.armed = true;
          this.trough = s;
          this.hist = [{ t, s }];
          ev = 'release';
        }
      }
    }
    this.pull = this.fired ? 1 : clamp((this.top - s) / Math.max(0.05, this.top - this.line), 0, 1);
    return ev;
  }

  shoot(s, t, peak, span, ev) {
    this.fired = true;
    this.fireS = s;
    this.fireAt = t;
    this.armed = false;
    this.trough = s;
    this.peakAtFire = Math.max(peak, s);
    // the shot is aimed from just before the thumb started to drop
    let dropT = t;
    for (const h of this.hist) if (h.s >= peak - span * 0.15) dropT = h.t;
    this.fireT = dropT;
    this.hist = [{ t, s }];
    this.pend = null;
    return ev;
  }

  // Fired level: moves quickly toward deeper shots and slowly toward shallow ones.
  learn() {
    const k = this.trough < this.down ? 0.35 : 0.1;
    this.down = clamp(this.down + (this.trough - this.down) * k, -0.4, this.top - 0.2);
  }
}

// How far each fingertip reaches from the wrist in the camera image, in palm lengths. The 3D estimate
// sometimes reads a relaxed but clearly pointing index finger as bent; in the image its tip still
// reaches well past the curled fingers.
export function reach2D(P) {
  const d = (a, b) => Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y);
  const palm = Math.max(d(0, 9), d(5, 17) / 0.8);
  if (palm < 8) return null;
  return { i: d(0, 8) / palm, m: d(0, 12) / palm, r: d(0, 16) / palm, p: d(0, 20) / palm };
}

export function classify(m, prevPose) {
  const { ext } = m;
  const rp = (ext.r + ext.p) / 2;
  const stay = prevPose === 'gun';
  const iOn = ext.i > (stay ? GESTURE.extStay : GESTURE.extOn);
  const gun3 = iOn && rp < GESTURE.curl && ext.i - rp > GESTURE.gunMargin;
  const R = m.reach;
  const reachOut = !!R && R.i > GESTURE.reachMin && R.i - Math.max(R.m, R.r, R.p) > GESTURE.reachMargin;
  // a gun already in hand stays drawn while the image shows the index still pointing out
  const gun2 = stay && reachOut && rp < GESTURE.curl && ext.i > 0.5;
  const min4 = Math.min(ext.i, ext.m, ext.r, ext.p);
  const max4 = Math.max(ext.i, ext.m, ext.r, ext.p);
  if (min4 > GESTURE.palmMin) return 'palm';
  // rock sign: index and little finger out, middle and ring curled
  if (ext.i > GESTURE.extOn && ext.p > GESTURE.rockPinky && ext.m < GESTURE.rockCurl && ext.r < GESTURE.rockCurl) return 'rock';
  if (gun3 || gun2) return 'gun';
  if (max4 < GESTURE.fistMax && !reachOut) return 'fist';
  return 'none';
}

// Frames a raw class must persist before the debounced pose switches to it.
const ENTER_FRAMES = { gun: 2, palm: 3, fist: 4, rock: 4, none: 5 };
const LEAVE_GUN_FRAMES = { palm: 3, fist: 6, rock: 4, none: 7 };

export class HandTrack {
  constructor(id) {
    this.id = id;
    this.pose = 'none';
    this.rawPose = 'none';
    this.rawCount = 0;
    this.poseSince = 0;
    this.lastSeen = 0;
    this.firstSeen = 0;
    this.present = true;
    this.handed = '';
    this.obs = null;
    this.metrics = null;
    // trigger: thumb levels learned per player while playing (mirrored from this.trig for the HUD)
    this.trig = new ThumbTrigger();
    this.cockRef = this.trig.top;
    this.downRef = this.trig.down;
    this.armed = false;
    this.trigger = false;
    this.pull = 0;
    this.thrDown = 0.35;
    this.fireAimT = null;
    this.aimVel = { x: 0, y: 0 };
    this.qVel = { x: 0, y: 0, z: 0 };
    // timers
    this.upT = 0;
    this.upFired = false;
    this.palmT = 0;
    this.palmNext = GESTURE.palmHold;
    this.fistT = 0;
    this.fistFired = false;
    this.rockT = 0;
    this.rockFired = false;
    this.pointingUp = false;
    // smoothing
    this.fP = Array.from({ length: 21 }, () => new OneEuro2(1.6, 0.012, 1.0));
    this.fW = Array.from({ length: 21 }, () => [new OneEuro(1.4, 2.5), new OneEuro(1.4, 2.5), new OneEuro(1.4, 2.5)]);
    this.fZ = new OneEuro(0.9, 0.6);
    this.fAim = new OneEuro2(AIM.minCutoff, AIM.beta, 1.0);
    this.aimHist = new History2(30);
    this.P = null; // filtered screen landmarks
    this.Q = null; // filtered 3D landmarks (camera space, meters)
    this.basis = null; // { right, up, fwd } camera space
    this.aim = { x: 0, y: 0 };
    this.anchor2 = { x: 0, y: 0 };
    this.dir2 = { x: 0, y: 0 };
    this.speed = 0;
    this.steadyT = 0;
    this.steady = false;
    this.depth = 1;
  }

  get center() {
    const P = this.obs.P;
    let x = 0,
      y = 0;
    for (const i of PALM_IDS) {
      x += P[i].x;
      y += P[i].y;
    }
    return { x: x / 5, y: y / 5 };
  }

  update(obs, t, view, mgr) {
    // Time since this hand's previous detection. Capped so a long gap cannot jump the hold timers, but
    // never below the detection interval, so hold gestures still take real time on slow machines.
    const dt = this.lastSeen ? clamp(t - this.lastSeen, 0.001, Math.max(0.2, 1.5 * mgr.frameGap)) : 1 / 30;
    if (!this.firstSeen) {
      this.firstSeen = t;
      // a hand coming back into view keeps the thumb levels learned earlier in the session
      const lv = mgr.levels[obs.handed];
      if (lv) {
        this.trig.top = lv.top;
        this.trig.down = lv.down;
      }
    }
    this.lastSeen = t;
    this.missed = 0;
    this.present = true;
    this.obs = obs;
    this.handed = obs.handed;
    const m = measure(obs.W);
    m.reach = reach2D(obs.P);
    const sig = thumbSignal(m, obs.P);
    m.h2 = sig.h2;
    // unfiltered: at low camera rates any smoothing turns a quick snap into a shallow, late one
    m.u = sig.u;
    const u = m.u;
    this.metrics = m;

    // ---- debounced pose classification
    const raw = classify(m, this.pose);
    if (raw === this.rawPose) this.rawCount++;
    else {
      this.rawPose = raw;
      this.rawCount = 1;
    }
    if (this.rawCount === 1) this.rawSince = t;
    const prevPose = this.pose;
    if (raw !== this.pose) {
      const need = this.pose === 'gun' ? LEAVE_GUN_FRAMES[raw] : ENTER_FRAMES[raw];
      // frame count at 30 fps, but never slower than that in wall-clock time on slow machines
      if (this.rawCount >= need || (this.rawCount >= 2 && t - this.rawSince >= need / 30)) {
        this.pose = raw;
        this.poseSince = t;
      }
    }
    // ---- thumb hammer trigger (see ThumbTrigger)
    const trg = this.trig;
    if (prevPose !== this.pose) {
      if (this.pose === 'gun') {
        mgr.emit('draw', this, t);
        trg.begin(u, t);
      }
      if (prevPose === 'gun') {
        if (trg.cancel(u, t)) mgr.emit('release', this, t);
        mgr.emit('holster', this, t);
      }
    }

    // The thumb trigger and the reload only count while the index finger still reads as extended;
    // while the hand is turning into a fist or palm, the thumb position means nothing (a thumb
    // wrapping over curling fingers must not fire a shot on the way to the fire-mode fist).
    // The same goes for a frame where the index extension suddenly drops: the hand is closing. In
    // recorded snaps the index stays put (or straightens a little) while the thumb comes down.
    const closing = this.extIPrev != null && this.extIPrev - m.ext.i > 0.15;
    this.extIPrev = m.ext.i;
    const gunNow = this.pose === 'gun' && !closing && (raw === 'gun' || (raw === 'none' && m.ext.i > 0.62));
    this.rawPoseNow = raw;

    // ---- pointing at the ceiling = reload
    this.pointingUp = this.pose === 'gun' && raw === 'gun' && m.fwd.y < GESTURE.pointUpY;
    if (this.pointingUp) {
      this.upT += dt;
      if (this.upT >= GESTURE.pointUpHold && !this.upFired) {
        this.upFired = true;
        mgr.emit('reload', this, t);
      }
    } else if (m.fwd.y > GESTURE.pointUpY + 0.15) {
      this.upT = 0;
      this.upFired = false;
    }

    if (gunNow && !this.pointingUp) {
      const ev = trg.update(u, t, mgr.frameGap);
      if (ev === 'refire') mgr.emit('release', this, t);
      if (ev === 'fire' || ev === 'refire') {
        this.fireAimT = Math.max(t - 0.2, Math.min(t - AIM.preTrigger, trg.fireT));
        mgr.emit('fire', this, t);
      } else if (ev === 'release') {
        // remember this player's thumb for the next time the hand comes into view
        mgr.levels[this.handed] = { top: trg.top, down: trg.down };
        mgr.emit('release', this, t);
      }
    } else if (this.pose === 'gun') {
      // forced release (hand changed shape): the thumb has to come up again before the next shot
      if (trg.fired) {
        trg.cancel(u, t);
        mgr.emit('release', this, t);
      } else trg.pause();
    }
    this.trigger = trg.fired;
    this.armed = trg.armed;
    this.pull = this.pose === 'gun' ? trg.pull : 0;
    this.thrDown = trg.line;
    this.cockRef = trg.top;
    this.downRef = trg.down;

    // ---- open palm = switch weapon (repeats while held)
    if (this.pose === 'palm') {
      this.palmT += dt;
      if (this.palmT >= this.palmNext) {
        this.palmNext += GESTURE.palmRepeat;
        mgr.emit('switch', this, t);
      }
    } else {
      this.palmT = 0;
      this.palmNext = GESTURE.palmHold;
    }

    // ---- rock sign = change outfit (once per hold)
    if (this.pose === 'rock') {
      this.rockT += dt;
      if (this.rockT >= GESTURE.rockHold && !this.rockFired) {
        this.rockFired = true;
        mgr.emit('outfit', this, t);
      }
    } else {
      this.rockT = 0;
      this.rockFired = false;
    }

    // ---- fist = fire mode
    if (this.pose === 'fist') {
      this.fistT += dt;
      if (this.fistT >= GESTURE.fistHold && !this.fistFired) {
        this.fistFired = true;
        mgr.emit('mode', this, t);
      }
    } else {
      this.fistT = 0;
      this.fistFired = false;
    }

    // ---- smoothed geometry for rendering and aim
    const P = obs.P.map((p, i) => this.fP[i].filter(p.x, p.y, t));
    const Wf = obs.W.map((w, i) => ({
      x: this.fW[i][0].filter(w.x, t),
      y: this.fW[i][1].filter(w.y, t),
      z: this.fW[i][2].filter(w.z, t),
    }));
    const zc = this.fZ.filter(obs.Zc, t);
    this.depth = zc;
    let mz = 0;
    for (const w of Wf) mz += w.z;
    mz /= 21;
    this.P = P;
    this.Q = P.map((p, i) => view.unproject(p.x, p.y, Math.max(0.15, zc + (Wf[i].z - mz))));
    const zg = Math.max(0.15, zc) * view.gk;
    const prevQ5 = this.Qg?.[5];
    this.Qg = P.map((p, i) => view.unprojectGun(p.x, p.y, zg + (Wf[i].z - mz)));
    // velocity of the gun anchor, used to carry the gun smoothly between camera frames
    const kv = 1 - Math.exp(-dt / 0.06);
    if (prevQ5) {
      const q = this.Qg[5];
      this.qVel.x += ((q.x - prevQ5.x) / dt - this.qVel.x) * kv;
      this.qVel.y += ((q.y - prevQ5.y) / dt - this.qVel.y) * kv;
      this.qVel.z += ((q.z - prevQ5.z) / dt - this.qVel.z) * kv;
    }

    const fwd = vnorm(T(vsub(Wf[8], Wf[5])));
    let dn = T(vsub(Wf[17], Wf[5]));
    dn = vnorm(vsub(dn, vscale(fwd, vdot(dn, fwd))));
    const up = vscale(dn, -1);
    const right = vnorm(vcross(up, fwd));
    this.basis = { right, up, fwd };

    // aim: palm position (gain) + finger direction (swing)
    let ax = 0,
      ay = 0;
    for (const i of PALM_IDS) {
      ax += P[i].x;
      ay += P[i].y;
    }
    this.anchor2 = { x: ax / 5, y: ay / 5 };
    this.dir2 = { x: fwd.x, y: -fwd.y };
    const cal = this.calib || mgr.calib;
    const S = Math.min(view.W, view.H);
    const P0 = cal.P0 || { x: view.W / 2, y: view.H * 0.56 };
    const D0 = cal.D0 || { x: 0, y: 0 };
    // Hand travel is measured in meters (pixels x depth), so aiming feels the same whether you
    // stand half a meter or two meters from the camera.
    const g = this.pxGain(view, mgr.settings);
    const rawX = view.W / 2 + g * (this.anchor2.x - P0.x) + mgr.settings.point * S * (this.dir2.x - D0.x);
    const rawY = view.H / 2 + g * (this.anchor2.y - P0.y) + mgr.settings.point * S * (this.dir2.y - D0.y);
    const prev = this.aim;
    const a = this.fAim.filter(rawX, rawY, t);
    this.aim = { x: clamp(a.x, 4, view.W - 4), y: clamp(a.y, 4, view.H - 4) };
    this.aimHist.push(t, this.aim.x, this.aim.y);
    if (this.hasAim) {
      this.aimVel.x += ((this.aim.x - prev.x) / dt - this.aimVel.x) * kv;
      this.aimVel.y += ((this.aim.y - prev.y) / dt - this.aimVel.y) * kv;
      const sp = Math.hypot(this.aim.x - prev.x, this.aim.y - prev.y) / dt;
      const k = 1 - Math.exp(-dt / 0.09); // time-based smoothing, independent of detection rate
      this.speed += (sp - this.speed) * k;
    }
    this.hasAim = true;
    if (this.speed < GESTURE.steadySpeed) this.steadyT += dt;
    else if (this.speed > GESTURE.steadyBreak) this.steadyT = 0;
    else this.steadyT = Math.max(0, this.steadyT - dt * 0.5);
    this.steady = this.steadyT > GESTURE.steadyHold;
  }

  // Screen pixels of crosshair travel per pixel of hand travel at the current distance.
  pxGain(view, settings) {
    const depth = clamp(this.depth || 1, 0.35, 3);
    return ((depth / view.f) * (view.W / 2) * settings.gain) / AIM.reach;
  }

  // Aim from just before the thumb started to drop, so the snap does not drag the shot.
  // Times are on the detection clock, so late-arriving results rewind to the right moment.
  aimForShot() {
    const h = this.aimHist.at(this.fireAimT ?? this.lastSeen - AIM.preTrigger);
    return h ? { x: h.x, y: h.y } : { ...this.aim };
  }

  // Where the tracked point will be a moment after the latest camera frame, for drawing between frames.
  // The look-ahead is short and capped so a hand that stops does not visibly overshoot.
  lookAhead(now) {
    return clamp(now - this.lastSeen, 0, AIM.lookAhead);
  }
  predictAim(now) {
    const h = this.lookAhead(now) * 0.85;
    return { x: this.aim.x + this.aimVel.x * h, y: this.aim.y + this.aimVel.y * h };
  }
  predictOffset(now) {
    const h = this.lookAhead(now) * 0.85;
    return { x: this.qVel.x * h, y: this.qVel.y * h, z: this.qVel.z * h };
  }
}

export class HandManager {
  constructor(view, settings) {
    this.view = view;
    this.settings = settings;
    this.tracks = [];
    this.nextId = 1;
    this.events = [];
    this.calib = { P0: null, D0: null };
    this.lastFrameT = 0;
    this.frameGap = 1 / 30;
    this.latency = 0.03;
    this.levels = {}; // learned thumb levels per hand ('Left' / 'Right')
  }

  emit(type, track, t) {
    this.events.push({ type, id: track.id, track, t });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }

  calibrate(track) {
    if (!track) return false;
    this.calib = { P0: { ...track.anchor2 }, D0: { ...track.dir2 } };
    track.fAim.reset();
    track.aimHist.clear();
    return true;
  }

  ingest(res, t) {
    const view = this.view;
    const now = performance.now() / 1000;
    // detection rate and how far results trail the camera (worker inference is asynchronous)
    if (this.lastFrameT && t > this.lastFrameT) this.frameGap += (Math.min(1, t - this.lastFrameT) - this.frameGap) * 0.2;
    this.latency += (clamp(now - t, 0, 2) - this.latency) * 0.2;
    this.lastFrameT = t;
    const obsList = [];
    for (let i = 0; i < res.landmarks.length; i++) {
      const lm = res.landmarks[i];
      const wl = res.worldLandmarks?.[i];
      if (!lm || !wl || lm.length < 21) continue;
      const P = lm.map((p) => view.toScreen(p.x, p.y));
      const W = wl.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      // weak-perspective scale fit: screen offsets ~= s * mirrored world offsets
      let mpx = 0,
        mpy = 0,
        mwx = 0,
        mwy = 0;
      for (let j = 0; j < 21; j++) {
        mpx += P[j].x;
        mpy += P[j].y;
        mwx += W[j].x;
        mwy += W[j].y;
      }
      mpx /= 21;
      mpy /= 21;
      mwx /= 21;
      mwy /= 21;
      let num = 0,
        den = 0;
      for (let j = 0; j < 21; j++) {
        const ax = -(W[j].x - mwx),
          ay = W[j].y - mwy;
        num += (P[j].x - mpx) * ax + (P[j].y - mpy) * ay;
        den += ax * ax + ay * ay;
      }
      const s = Math.max(50, num / (den || 1));
      const cx = (P[0].x + P[5].x + P[9].x + P[13].x + P[17].x) / 5;
      const cy = (P[0].y + P[5].y + P[9].y + P[13].y + P[17].y) / 5;
      obsList.push({
        P,
        W,
        s,
        Zc: view.f / s,
        cx,
        cy,
        handed: res.handedness?.[i]?.[0]?.categoryName || '',
        score: res.handedness?.[i]?.[0]?.score || 0,
      });
    }

    // greedy nearest matching of observations to existing tracks
    const S = Math.min(view.W, view.H);
    const pairs = [];
    for (const tr of this.tracks) {
      if (!tr.obs) continue;
      const c = tr.center;
      obsList.forEach((o, oi) => {
        let d = Math.hypot(o.cx - c.x, o.cy - c.y);
        if (o.handed && tr.handed && o.handed !== tr.handed) d += S * 0.15;
        pairs.push({ tr, oi, d });
      });
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedT = new Set(),
      usedO = new Set();
    for (const p of pairs) {
      if (usedT.has(p.tr) || usedO.has(p.oi) || p.d > S * 0.45) continue;
      usedT.add(p.tr);
      usedO.add(p.oi);
      p.tr.update(obsList[p.oi], t, view, this);
    }
    obsList.forEach((o, oi) => {
      if (usedO.has(oi)) return;
      const tr = new HandTrack(this.nextId++);
      this.tracks.push(tr);
      tr.update(o, t, view, this);
    });
    for (const tr of this.tracks)
      if (!usedT.has(tr) && tr.lastSeen !== t) {
        tr.present = false;
        tr.missed = (tr.missed || 0) + 1;
      }
  }

  // Remove tracks that have been missing for longer than the grace period.
  // A hand is dropped once it has been missing from at least two detection frames and the grace
  // period has passed on the detection clock, so slow machines (few detections per second, results
  // arriving late) do not lose it between frames. The wall-clock limit only catches a stalled camera.
  prune(now) {
    const stall = Math.max(1.5, 3 * this.frameGap + this.latency);
    this.tracks = this.tracks.filter((tr) => {
      const gone = ((tr.missed || 0) >= 2 && this.lastFrameT - tr.lastSeen > TRACKING.lostGrace) || now - tr.lastSeen > stall;
      if (!gone) return true;
      if (tr.trigger) this.emit('release', tr, now);
      if (tr.pose === 'gun') this.emit('holster', tr, now);
      tr.pose = 'none';
      return false;
    });
  }

  gunTracks() {
    return this.tracks.filter((t) => t.pose === 'gun');
  }
}
