// Procedural sound design. Every sound is synthesized once into an AudioBuffer with an
// OfflineAudioContext, then played through a stereo bus with a small indoor-range reverb.
import { clamp, rand, pick } from './util.js';

// ---------- offline synthesis helpers ----------
const noiseCache = new WeakMap();
function noiseBuffer(c) {
  let b = noiseCache.get(c);
  if (!b) {
    const n = Math.ceil(c.sampleRate * 2.5);
    b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}
function noise(c, t0, dur) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c);
  s.start(t0, Math.random() * 0.5);
  s.stop(t0 + dur);
  return s;
}
function env(c, t0, peak, attack, tau) {
  const g = c.createGain();
  g.gain.setValueAtTime(0, 0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + Math.max(0.0002, attack));
  g.gain.setTargetAtTime(0, t0 + Math.max(0.0002, attack), tau);
  return g;
}
function filt(c, type, freq, Q = 0.707) {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}
function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}
function tanhCurve(drive) {
  const n = 2048,
    curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}
function ping(c, out, t0, f, amp, tau, type = 'sine') {
  if (f > c.sampleRate * 0.45) return;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.start(t0);
  o.stop(t0 + tau * 8 + 0.01);
  chain(o, env(c, t0, amp, 0.0006, tau), out);
}
function sweepOsc(c, out, t0, f0, f1, sweep, amp, attack, tau, type = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + sweep);
  o.start(t0);
  o.stop(t0 + tau * 8 + sweep);
  chain(o, env(c, t0, amp, attack, tau), out);
}
function burst(c, out, t0, type, freq, Q, amp, attack, tau, dur = 0.4) {
  chain(noise(c, t0, dur), filt(c, type, freq, Q), env(c, t0, amp, attack, tau), out);
}
function sweepBurst(c, out, t0, f0, f1, sweep, Q, amp, attack, tau, dur = 0.5) {
  const f = filt(c, 'bandpass', f0, Q);
  f.frequency.setValueAtTime(f0, t0);
  f.frequency.exponentialRampToValueAtTime(f1, t0 + sweep);
  chain(noise(c, t0, dur), f, env(c, t0, amp, attack, tau), out);
}

async function render(sr, dur, build, normalize = 0.95) {
  const c = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
  const out = c.createGain();
  out.connect(c.destination);
  build(c, out);
  const buf = await c.startRendering();
  if (normalize) {
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    if (peak > 0) {
      const g = normalize / peak;
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) d[i] *= g;
      }
    }
  }
  return buf;
}

// ---------- gunshots ----------
const SHOTS = {
  pistol: {
    dur: 1.1,
    crack: 0.9, crackHP: 2400, crackTau: 0.006,
    blast: 1.0, blastF0: 6500, blastF1: 700, blastSweep: 0.1, blastTau: 0.045,
    thump: 0.8, thumpF0: 150, thumpF1: 58, thumpSweep: 0.08, thumpTau: 0.055, body: 0.75, bodyF: 1300, bodyTau: 0.045,
    tail: 0.22, tailF: 1100, tailTau: 0.17,
    drive: 2.2, mech: 0.22, mechT: 0.05, mechF: 3200,
  },
  rifle: {
    dur: 1.2,
    crack: 1.0, crackHP: 3000, crackTau: 0.005,
    blast: 1.0, blastF0: 8000, blastF1: 900, blastSweep: 0.08, blastTau: 0.034,
    thump: 0.65, thumpF0: 170, thumpF1: 62, thumpSweep: 0.06, thumpTau: 0.045, body: 0.7, bodyF: 1600, bodyTau: 0.035,
    tail: 0.26, tailF: 1400, tailTau: 0.2,
    drive: 2.6, mech: 0.16, mechT: 0.028, mechF: 2800,
  },
  shotgun: {
    dur: 1.6,
    crack: 0.7, crackHP: 1800, crackTau: 0.008,
    blast: 1.1, blastF0: 5000, blastF1: 380, blastSweep: 0.15, blastTau: 0.085,
    thump: 0.95, thumpF0: 110, thumpF1: 46, thumpSweep: 0.14, thumpTau: 0.11, body: 0.8, bodyF: 800, bodyTau: 0.07,
    tail: 0.36, tailF: 800, tailTau: 0.32,
    drive: 2.0, mech: 0,
  },
  sniper: {
    dur: 2.4,
    crack: 1.0, crackHP: 2500, crackTau: 0.007,
    blast: 1.2, blastF0: 7000, blastF1: 480, blastSweep: 0.14, blastTau: 0.07,
    thump: 0.95, thumpF0: 120, thumpF1: 44, thumpSweep: 0.16, thumpTau: 0.13, body: 0.75, bodyF: 1000, bodyTau: 0.06,
    tail: 0.42, tailF: 900, tailTau: 0.45,
    drive: 2.4, mech: 0, echo: 0.29, echoFb: 0.32, echoGain: 0.4,
  },
};

function gunshot(c, out, base) {
  const v = (x, s = 0.07) => x * rand(1 - s, 1 + s);
  const p = { ...base };
  const t0 = 0.004;
  const pre = c.createGain();
  const shaper = c.createWaveShaper();
  shaper.curve = tanhCurve(p.drive);
  shaper.oversample = '2x';
  const post = c.createGain();
  chain(pre, shaper, post, out);
  // supersonic crack / muzzle report brightness
  chain(noise(c, t0, 0.1), filt(c, 'highpass', v(p.crackHP)), env(c, t0, p.crack, 0.0003, v(p.crackTau)), pre);
  // main blast, a lowpass that closes quickly
  const lp = filt(c, 'lowpass', p.blastF0, 0.9);
  lp.frequency.setValueAtTime(v(p.blastF0), t0);
  lp.frequency.exponentialRampToValueAtTime(v(p.blastF1), t0 + v(p.blastSweep));
  chain(noise(c, t0, 0.7), lp, filt(c, 'highpass', 55), env(c, t0, p.blast, 0.0007, v(p.blastTau)), pre);
  // mid-range body: the part of a real report you hear on small headphones
  chain(noise(c, t0, 0.5), filt(c, 'bandpass', v(p.bodyF || 1100), 0.8), env(c, t0, p.body ?? 0.7, 0.001, v(p.bodyTau || 0.05)), pre);
  // chest thump
  sweepOsc(c, pre, t0, v(p.thumpF0), v(p.thumpF1), p.thumpSweep, p.thump, 0.0015, v(p.thumpTau));
  // decorrelated stereo tail (room)
  for (const pan of [-0.75, 0.75]) {
    const sp = c.createStereoPanner();
    sp.pan.value = pan;
    chain(noise(c, t0, p.dur), filt(c, 'lowpass', v(p.tailF), 0.5), env(c, t0 + 0.008, p.tail, 0.02, v(p.tailTau)), sp, out);
  }
  // action cycling
  if (p.mech) {
    const tm = t0 + v(p.mechT);
    burst(c, out, tm, 'bandpass', p.mechF, 4, p.mech, 0.0004, 0.006, 0.05);
    ping(c, out, tm, p.mechF * 0.8, p.mech * 0.35, 0.014);
    ping(c, out, tm + 0.002, p.mechF * 1.37, p.mech * 0.22, 0.01);
  }
  if (p.echo) {
    const d = c.createDelay(2);
    d.delayTime.value = p.echo;
    const fb = c.createGain();
    fb.gain.value = p.echoFb;
    const lpE = filt(c, 'lowpass', 1300);
    post.connect(d);
    chain(d, lpE, fb, d);
    const eg = c.createGain();
    eg.gain.value = p.echoGain;
    chain(lpE, eg, out);
  }
}

// ---------- foley + impacts ----------
const clack = (c, out, t, f = 1500, amp = 0.9, body = 200) => {
  burst(c, out, t, 'bandpass', f, 2, amp, 0.0004, 0.012, 0.08);
  ping(c, out, t, f * 0.75, amp * 0.4, 0.03);
  ping(c, out, t + 0.001, f * 1.9, amp * 0.25, 0.015);
  sweepOsc(c, out, t, body, body * 0.7, 0.03, amp * 0.35, 0.001, 0.03);
};

const FOLEY = {
  dry: [0.18, (c, o) => {
    burst(c, o, 0.002, 'bandpass', 4000, 3, 0.8, 0.0003, 0.003, 0.03);
    ping(c, o, 0.002, 2300, 0.3, 0.01);
    ping(c, o, 0.003, 5200, 0.2, 0.006);
  }],
  magOut: [0.32, (c, o) => {
    burst(c, o, 0.002, 'bandpass', 3200, 3, 0.4, 0.0004, 0.004, 0.03);
    burst(c, o, 0.04, 'bandpass', 1500, 1, 0.35, 0.01, 0.04, 0.2);
    clack(c, o, 0.12, 700, 0.5, 150);
  }],
  magIn: [0.36, (c, o) => {
    burst(c, o, 0.002, 'bandpass', 1800, 1, 0.3, 0.01, 0.03, 0.1);
    clack(c, o, 0.075, 1200, 1.0, 180);
  }],
  slide: [0.36, (c, o) => {
    sweepBurst(c, o, 0.002, 900, 2600, 0.07, 1.2, 0.35, 0.01, 0.05, 0.2);
    clack(c, o, 0.1, 2200, 1.0, 220);
  }],
  pump: [0.52, (c, o) => {
    clack(c, o, 0.004, 1300, 0.9, 160);
    sweepBurst(c, o, 0.02, 700, 1100, 0.15, 1, 0.25, 0.03, 0.06, 0.25);
    clack(c, o, 0.21, 1600, 1.0, 190);
  }],
  shellIn: [0.22, (c, o) => {
    burst(c, o, 0.002, 'bandpass', 3000, 2, 0.5, 0.0004, 0.004, 0.03);
    burst(c, o, 0.05, 'bandpass', 1200, 1, 0.35, 0.002, 0.03, 0.1);
    sweepOsc(c, o, 0.05, 200, 150, 0.03, 0.2, 0.001, 0.02);
  }],
  boltOpen: [0.32, (c, o) => {
    burst(c, o, 0.002, 'bandpass', 2500, 2, 0.6, 0.0004, 0.006, 0.04);
    ping(c, o, 0.002, 1900, 0.3, 0.02);
    sweepBurst(c, o, 0.09, 1400, 1900, 0.06, 1.2, 0.4, 0.02, 0.05, 0.15);
    clack(c, o, 0.17, 1100, 0.6, 170);
  }],
  boltClose: [0.32, (c, o) => {
    sweepBurst(c, o, 0.002, 1900, 1400, 0.06, 1.2, 0.4, 0.02, 0.05, 0.15);
    clack(c, o, 0.08, 1300, 0.8, 180);
    burst(c, o, 0.16, 'bandpass', 2800, 2, 0.6, 0.0004, 0.006, 0.04);
    ping(c, o, 0.16, 2100, 0.3, 0.02);
  }],
  draw: [0.42, (c, o) => {
    sweepBurst(c, o, 0.002, 500, 2200, 0.2, 0.9, 0.35, 0.08, 0.08, 0.35);
    clack(c, o, 0.2, 2000, 0.5, 200);
  }],
  holster: [0.36, (c, o) => {
    sweepBurst(c, o, 0.002, 1800, 500, 0.22, 0.9, 0.3, 0.05, 0.08, 0.3);
  }],
  casing: [0.7, (c, o) => {
    const f0 = rand(2600, 4200);
    const ratios = [1, 2.32, 4.25, 6.63],
      amps = [1, 0.6, 0.35, 0.2],
      taus = [0.09, 0.05, 0.03, 0.02];
    let t = 0.004,
      a = 1;
    for (let b = 0; b < 4; b++) {
      for (let k = 0; k < 4; k++) ping(c, o, t, f0 * ratios[k] * rand(0.99, 1.01), amps[k] * a * 0.5, taus[k] * rand(0.8, 1.2));
      burst(c, o, t, 'bandpass', 6000, 2, 0.3 * a, 0.0002, 0.002, 0.02);
      t += rand(0.05, 0.11) * (1 - b * 0.2);
      a *= rand(0.4, 0.6);
    }
  }],
  hull: [0.45, (c, o) => {
    for (const [t, a] of [[0.004, 1], [0.13, 0.45]]) {
      burst(c, o, t, 'bandpass', 700, 1.5, 0.7 * a, 0.0005, 0.02, 0.1);
      sweepOsc(c, o, t, 260, 200, 0.03, 0.4 * a, 0.001, 0.03);
    }
  }],
  glass: [1.0, (c, o) => {
    burst(c, o, 0.003, 'highpass', 2500, 0.7, 0.8, 0.0003, 0.02, 0.2);
    burst(c, o, 0.003, 'bandpass', 3500, 0.7, 0.45, 0.001, 0.12, 0.6);
    burst(c, o, 0.003, 'lowpass', 400, 0.7, 0.4, 0.001, 0.03, 0.15);
    for (let i = 0; i < 40; i++) {
      const t = 0.004 + Math.pow(Math.random(), 2) * 0.55;
      ping(c, o, t, rand(2500, 9000), 0.22 * (1 - t / 0.65), rand(0.01, 0.05));
    }
  }],
  clay: [0.5, (c, o) => {
    burst(c, o, 0.003, 'bandpass', 1500, 0.8, 0.9, 0.0004, 0.025, 0.15);
    burst(c, o, 0.003, 'highpass', 3000, 0.7, 0.5, 0.0003, 0.01, 0.06);
    for (let i = 0; i < 9; i++) burst(c, o, 0.01 + Math.random() * 0.15, 'bandpass', rand(900, 2500), 2, 0.2, 0.0005, 0.008, 0.05);
    sweepOsc(c, o, 0.003, 140, 90, 0.04, 0.3, 0.001, 0.03);
  }],
  droneHit: [0.5, (c, o) => {
    const fr = [750, 1180, 1960, 2900].map((f) => f * rand(0.9, 1.1));
    [0.6, 0.4, 0.3, 0.2].forEach((a, i) => ping(c, o, 0.003, fr[i], a, [0.12, 0.08, 0.05, 0.03][i]));
    burst(c, o, 0.003, 'bandpass', 2000, 1, 0.7, 0.0003, 0.015, 0.08);
  }],
  droneBoom: [2.0, (c, o) => {
    const pre = c.createGain();
    const sh = c.createWaveShaper();
    sh.curve = tanhCurve(2);
    chain(pre, sh, o);
    sweepOsc(c, pre, 0.004, 90, 30, 0.3, 1, 0.002, 0.35);
    const lp = filt(c, 'lowpass', 1200, 0.7);
    lp.frequency.setValueAtTime(1200, 0.004);
    lp.frequency.exponentialRampToValueAtTime(200, 0.5);
    chain(noise(c, 0.004, 1.6), lp, env(c, 0.004, 1, 0.002, 0.3), pre);
    for (let i = 0; i < 30; i++) {
      const t = 0.05 + Math.random() * 1.0;
      burst(c, o, t, 'highpass', 2000, 0.7, 0.3 * (1 - t), 0.0002, 0.003, 0.02);
    }
  }],
  ricochet: [0.65, (c, o) => {
    burst(c, o, 0.002, 'highpass', 3000, 0.7, 0.5, 0.0003, 0.004, 0.03);
    const osc = c.createOscillator();
    osc.type = 'sine';
    const f0 = rand(3200, 4500),
      f1 = rand(1300, 2000);
    osc.frequency.setValueAtTime(f0, 0.01);
    osc.frequency.exponentialRampToValueAtTime(f1, 0.45);
    const lfo = c.createOscillator();
    lfo.frequency.value = rand(25, 38);
    const lg = c.createGain();
    lg.gain.value = 70;
    chain(lfo, lg, osc.frequency);
    lfo.start(0.01);
    osc.start(0.01);
    osc.stop(0.65);
    lfo.stop(0.65);
    chain(osc, env(c, 0.01, 0.35, 0.01, 0.15), o);
  }],
  thud: [0.42, (c, o) => {
    burst(c, o, 0.003, 'lowpass', 900, 0.7, 0.6, 0.0005, 0.03, 0.15);
    sweepOsc(c, o, 0.003, 120, 80, 0.04, 0.4, 0.001, 0.04);
    burst(c, o, 0.01, 'highpass', 2000, 0.7, 0.15, 0.01, 0.08, 0.3);
  }],
  tick: [0.1, (c, o) => {
    ping(c, o, 0.002, 2400, 0.5, 0.015);
    ping(c, o, 0.002, 3600, 0.3, 0.01);
  }],
  kill: [0.25, (c, o) => {
    ping(c, o, 0.002, 1600, 0.5, 0.03);
    ping(c, o, 0.06, 2400, 0.5, 0.04);
  }],
  ui: [0.1, (c, o) => {
    ping(c, o, 0.002, 1400, 0.4, 0.02);
    burst(c, o, 0.002, 'bandpass', 3000, 2, 0.3, 0.0003, 0.003, 0.02);
  }],
  mode: [0.16, (c, o) => {
    burst(c, o, 0.002, 'bandpass', 3200, 2, 0.6, 0.0003, 0.004, 0.03);
    ping(c, o, 0.002, 2400, 0.3, 0.02);
    burst(c, o, 0.07, 'bandpass', 2600, 2, 0.4, 0.0003, 0.004, 0.03);
  }],
  scope: [0.3, (c, o) => {
    burst(c, o, 0.002, 'bandpass', 600, 1, 0.3, 0.05, 0.08, 0.3);
    burst(c, o, 0.12, 'bandpass', 2500, 2, 0.4, 0.0003, 0.005, 0.03);
  }],
  beep: [0.18, (c, o) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 880;
    osc.start(0.002);
    osc.stop(0.15);
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.6, 0.008);
    g.gain.setValueAtTime(0.6, 0.12);
    g.gain.linearRampToValueAtTime(0, 0.15);
    chain(osc, g, o);
  }],
  beepHi: [0.35, (c, o) => {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1320;
    osc.start(0.002);
    osc.stop(0.32);
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.6, 0.008);
    g.gain.setValueAtTime(0.6, 0.27);
    g.gain.linearRampToValueAtTime(0, 0.32);
    chain(osc, g, o);
  }],
  horn: [1.1, (c, o) => {
    const g = c.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(0.5, 0.03);
    g.gain.setValueAtTime(0.5, 0.75);
    g.gain.linearRampToValueAtTime(0, 0.95);
    const lp = filt(c, 'lowpass', 1600, 0.8);
    chain(lp, g, o);
    for (const f of [220, 277.2, 330]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.start(0);
      osc.stop(1);
      osc.connect(lp);
    }
  }],
  combo: [0.5, (c, o) => {
    [880, 1320, 1760].forEach((f, i) => ping(c, o, 0.004 + i * 0.06, f, 0.35, 0.09, 'triangle'));
  }],
};

function droneLoop(c, o) {
  // 2 s seamless loop: every frequency is a multiple of 0.5 Hz
  const lp = filt(c, 'lowpass', 2400, 0.7);
  const am = c.createGain();
  am.gain.value = 0.5;
  const lfo = c.createOscillator();
  lfo.frequency.value = 28;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.35;
  chain(lfo, lfoG, am.gain);
  lfo.start(0);
  chain(am, lp, o);
  for (const [f, a, type] of [[190, 0.35, 'sawtooth'], [380, 0.18, 'sawtooth'], [571, 0.08, 'square']]) {
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    const g = c.createGain();
    g.gain.value = a;
    osc.start(0);
    chain(osc, g, am);
  }
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c);
  n.start(0);
  chain(n, filt(c, 'bandpass', 1200, 0.8), (() => { const g = c.createGain(); g.gain.value = 0.25; return g; })(), am);
}

// ---------- plates ----------
function ding(c, o, f0, size) {
  const ratios = [1, 1.59, 2.14, 2.83, 3.6, 4.65],
    amps = [1, 0.7, 0.5, 0.4, 0.3, 0.2],
    taus = [1.4, 0.9, 0.7, 0.5, 0.35, 0.25];
  for (let k = 0; k < ratios.length; k++) {
    ping(c, o, 0.004, f0 * ratios[k], amps[k] * 0.3, taus[k] * size);
    ping(c, o, 0.004, f0 * ratios[k] * 1.004, amps[k] * 0.15, taus[k] * size * 0.8);
  }
  burst(c, o, 0.003, 'highpass', 3000, 0.7, 0.8, 0.0003, 0.004, 0.03);
  ping(c, o, 0.003, f0 * 7.1, 0.2, 0.03);
}

function makeIR(ctx, seconds = 1.4, decay = 2.6) {
  const sr = ctx.sampleRate,
    n = Math.floor(sr * seconds);
  const ir = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const white = Math.random() * 2 - 1;
      lp += (white - lp) * (0.35 - t * 0.25); // darker as it decays
      d[i] = lp * Math.pow(1 - t, decay);
    }
    // a few early reflections off the range walls
    for (const [ms, a] of [[11, 0.5], [19, 0.35], [31, 0.3], [47, 0.22], [63, 0.16]]) {
      const i = Math.floor((ms + (ch ? 3 : 0)) * sr * 0.001);
      if (i < n) d[i] += a * (Math.random() > 0.5 ? 1 : -1);
    }
  }
  return ir;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.ready = false;
    this.volume = 0.85;
    this.muted = false;
    this.active = 0;
  }

  // Must be called from a user gesture.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -12;
      this.comp.knee.value = 6;
      this.comp.ratio.value = 8;
      this.comp.attack.value = 0.002;
      this.comp.release.value = 0.15;
      this.master.connect(this.comp).connect(c.destination);
      this.dry = c.createGain();
      this.dry.connect(this.master);
      this.reverb = c.createConvolver();
      this.reverb.buffer = makeIR(c);
      this.reverbOut = c.createGain();
      this.reverbOut.gain.value = 0.55;
      this.reverb.connect(this.reverbOut).connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  async load(onProgress) {
    if (this.ready || this._loading) return this._loading;
    const sr = this.ctx ? this.ctx.sampleRate : 48000;
    const jobs = [];
    const add = (name, p) => jobs.push(p.then((b) => {
      (this.buffers[name] ||= []).push(b);
    }));
    for (const [name, base] of Object.entries(SHOTS)) {
      const n = name === 'sniper' ? 2 : 4;
      for (let i = 0; i < n; i++) add(name, render(sr, base.dur, (c, o) => gunshot(c, o, base)));
    }
    for (const [name, [dur, fn]] of Object.entries(FOLEY)) {
      const n = ['casing', 'glass', 'clay', 'ricochet'].includes(name) ? 4 : name === 'droneHit' || name === 'thud' || name === 'hull' ? 2 : 1;
      for (let i = 0; i < n; i++) add(name, render(sr, dur, fn, name === 'beep' || name === 'beepHi' || name === 'horn' ? 0.6 : 0.95));
    }
    add('ding0', render(sr, 2.2, (c, o) => ding(c, o, 380, 1.3)));
    add('ding1', render(sr, 1.8, (c, o) => ding(c, o, 560, 1.0)));
    add('ding2', render(sr, 1.4, (c, o) => ding(c, o, 820, 0.75)));
    add('droneLoop', render(sr, 2.0, droneLoop, 0.7));
    let done = 0;
    jobs.forEach((j) => j.then(() => onProgress?.(++done / jobs.length)));
    this._loading = Promise.all(jobs).then(() => {
      this.ready = true;
    });
    return this._loading;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.02);
  }
  setMuted(m) {
    this.muted = m;
    this.setVolume(this.volume);
  }

  play(name, { pan = 0, gain = 1, rate = 1, delay = 0, wet = 0.22, jitter = 0.03, priority = 1 } = {}) {
    if (!this.ctx || !this.ready) return;
    const list = this.buffers[name];
    if (!list) return;
    if (this.active > 40 && priority < 1) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = pick(list);
    src.playbackRate.value = rate * (1 + rand(-jitter, jitter));
    const g = c.createGain();
    g.gain.value = gain;
    const p = c.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    src.connect(g).connect(p);
    p.connect(this.dry);
    if (wet > 0) {
      const s = c.createGain();
      s.gain.value = wet;
      p.connect(s).connect(this.reverb);
    }
    this.active++;
    src.onended = () => {
      this.active--;
      p.disconnect();
    };
    src.start(c.currentTime + delay);
  }

  loop(name, gain = 0.3) {
    if (!this.ctx || !this.ready || !this.buffers[name]) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.buffers[name][0];
    src.loop = true;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(gain, c.currentTime, 0.2);
    const p = c.createStereoPanner();
    src.connect(g).connect(p).connect(this.dry);
    src.start();
    return {
      set: (pan, gain2, rate = 1) => {
        p.pan.setTargetAtTime(clamp(pan, -1, 1), c.currentTime, 0.05);
        g.gain.setTargetAtTime(gain2, c.currentTime, 0.08);
        src.playbackRate.setTargetAtTime(rate, c.currentTime, 0.1);
      },
      stop: () => {
        g.gain.setTargetAtTime(0, c.currentTime, 0.1);
        setTimeout(() => {
          try {
            src.stop();
          } catch {}
          p.disconnect();
        }, 600);
      },
    };
  }

  suspend() {
    this.ctx?.suspend();
  }
  resume() {
    this.ctx?.resume();
  }
}
