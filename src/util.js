// Small math + filtering helpers shared across the app.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const dist2 = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const now = () => performance.now() / 1000;

// Vector helpers on plain {x,y,z} objects (used where THREE is overkill).
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vlen = (a) => Math.hypot(a.x, a.y, a.z);
export const vnorm = (a) => {
  const l = vlen(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const vcross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vdist = (a, b) => vlen(vsub(a, b));

// Distance from point p to segment ab.
export function segDist(p, a, b) {
  const ab = vsub(b, a);
  const t = clamp(vdot(vsub(p, a), ab) / (vdot(ab, ab) || 1), 0, 1);
  return vdist(p, vadd(a, vscale(ab, t)));
}

// One Euro filter (Casiez et al.) for jittery tracking signals.
export class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
  filter(x, t) {
    if (this.x === null) {
      this.x = x;
      this.t = t;
      return x;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const dxRaw = (x - this.x) / dt;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.dx = this.dx + ad * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = OneEuro.alpha(cutoff, dt);
    this.x = this.x + a * (x - this.x);
    return this.x;
  }
}

export class OneEuro2 {
  constructor(minCutoff, beta, dCutoff) {
    this.fx = new OneEuro(minCutoff, beta, dCutoff);
    this.fy = new OneEuro(minCutoff, beta, dCutoff);
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
  filter(x, y, t) {
    return { x: this.fx.filter(x, t), y: this.fy.filter(y, t) };
  }
}

// Ring buffer of timestamped 2D samples (used to fetch the aim from just before a trigger pull).
export class History2 {
  constructor(n = 24) {
    this.buf = [];
    this.n = n;
  }
  push(t, x, y) {
    this.buf.push({ t, x, y });
    if (this.buf.length > this.n) this.buf.shift();
  }
  at(t) {
    if (!this.buf.length) return null;
    for (let i = this.buf.length - 1; i >= 0; i--) if (this.buf[i].t <= t) return this.buf[i];
    return this.buf[0];
  }
  clear() {
    this.buf.length = 0;
  }
}

export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: settings just won't persist */
    }
  },
};
