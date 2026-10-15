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

export function classify(m, prevPose) {
  const { ext } = m;
  const rp = (ext.r + ext.p) / 2;
  const iOn = ext.i > (prevPose === 'gun' ? GESTURE.extStay : GESTURE.extOn);
  const gun = iOn && rp < GESTURE.curl && ext.i - rp > GESTURE.gunMargin;
  const min4 = Math.min(ext.i, ext.m, ext.r, ext.p);
  const max4 = Math.max(ext.i, ext.m, ext.r, ext.p);
  if (min4 > GESTURE.palmMin) return 'palm';
  if (gun) return 'gun';
  if (max4 < GESTURE.fistMax) return 'fist';
  return 'none';
}

// Frames a raw class must persist before the debounced pose switches to it.
const ENTER_FRAMES = { gun: 2, palm: 3, fist: 4, none: 5 };
const LEAVE_GUN_FRAMES = { palm: 3, fist: 6, none: 7 };

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
    // trigger: thumb levels learned per player while playing
    this.cockRef = GESTURE.thumbCockedInit; // where this thumb sits when cocked
    this.downRef = GESTURE.thumbDownInit; // how far it gets when it fires
    this.armed = false;
    this.trigger = false;
    this.pull = 0;
    this.thrDown = 0.35;
    this.thrUp = 0.45;
    this.fU = new OneEuro(4.0, 1.0);
    this.uHist = [];
    this.minSince = 0;
    this.troughU = 0;
    this.wantPrev = false;
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
        this.cockRef = lv.cockRef;
        this.downRef = lv.downRef;
      }
    }
    this.lastSeen = t;
    this.missed = 0;
    this.present = true;
    this.obs = obs;
    this.handed = obs.handed;
    const m = measure(obs.W);
    const sig = thumbSignal(m, obs.P);
    m.h2 = sig.h2;
    m.u = this.fU.filter(sig.u, t);
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
    // ---- thumb hammer trigger: thresholds sit between this player's cocked and fired thumb levels
    const range = Math.max(0.22, this.cockRef - this.downRef);
    const thrDown = this.downRef + range * (GESTURE.cockFactor ?? 0.5);
    const thrUp = thrDown + Math.max(0.07, range * 0.22);
    this.thrDown = thrDown;
    this.thrUp = thrUp;
    // recent peak: a snap is judged from where the thumb just was, not from its usual cocked height
    const win = Math.max(0.35, 2.5 * mgr.frameGap);
    this.uHist.push({ t, u });
    while (this.uHist.length > 1 && t - this.uHist[0].t > win) this.uHist.shift();
    let peak = -Infinity;
    for (const s of this.uHist) peak = Math.max(peak, s.u);
    let dropT = t;
    for (const s of this.uHist) if (s.u >= peak - range * 0.15) dropT = s.t;

    if (prevPose !== this.pose) {
      if (this.pose === 'gun') {
        mgr.emit('draw', this, t);
        this.armed = u > thrUp;
        this.minSince = u;
        this.wantPrev = false;
      }
      if (prevPose === 'gun') {
        if (this.trigger) mgr.emit('release', this, t);
        this.trigger = false;
        mgr.emit('holster', this, t);
      }
    }

    // Learn the cocked level from a raised thumb: quickly upward, slowly downward, never mid-shot.
    if (!this.trigger && u > thrDown + 0.04 && this.pose === 'gun') {
      const tau = peak > this.cockRef ? 0.4 : 2.5;
      this.cockRef = clamp(this.cockRef + (peak - this.cockRef) * (1 - Math.exp(-dt / tau)), this.downRef + 0.25, 1.1);
    }
    this.pull = clamp((this.cockRef - u) / Math.max(0.05, this.cockRef - thrDown), 0, 1);

    // The thumb trigger and the reload only count while the index finger still reads as extended;
    // while the hand is turning into a fist or palm, the thumb position means nothing.
    const gunNow = this.pose === 'gun' && (raw === 'gun' || raw === 'none');
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
      if (!this.trigger) {
        this.minSince = Math.min(this.minSince, u);
        if (!this.armed && (u > thrUp || (u - this.minSince > range * 0.4 && u > thrDown + 0.03))) this.armed = true;
      }
      // Fires when the thumb crosses the line, or on a quick drop from wherever it just was. A drop that
      // shows on a single frame only must be deep, so one bad landmark does not fire the gun.
      const snap = peak - u >= range * (GESTURE.snapFactor ?? 0.45) && peak > thrDown + 0.08;
      const want = u < thrDown || snap;
      if (this.armed && !this.trigger && want) {
        if (this.wantPrev || u < thrDown - 0.06 || peak - u >= range * 0.8) {
          this.trigger = true;
          this.armed = false;
          this.troughU = u;
          this.fireAimT = Math.max(t - 0.2, Math.min(t - AIM.preTrigger, dropT));
          mgr.emit('fire', this, t);
        }
      } else if (this.trigger) {
        this.troughU = Math.min(this.troughU, u);
        if (u > thrUp || (u - this.troughU > range * 0.45 && u > thrDown + 0.03)) {
          // thumb lifted: remember how deep this player's shots go, then re-cock
          this.downRef = clamp(this.downRef + (this.troughU - this.downRef) * 0.35, -0.4, this.cockRef - 0.25);
          mgr.levels[this.handed] = { cockRef: this.cockRef, downRef: this.downRef };
          this.trigger = false;
          this.armed = true;
          this.minSince = u;
          mgr.emit('release', this, t);
        }
      }
      this.wantPrev = want && !this.trigger;
    } else {
      this.wantPrev = false;
      if (this.trigger) {
        // forced release (hand changed shape): require the thumb to be lifted before the next shot
        this.trigger = false;
        this.armed = false;
        this.minSince = u;
        mgr.emit('release', this, t);
      }
    }

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
