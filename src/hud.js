// 2D overlay: crosshairs, laser, trigger/reload meters, tracers, muzzle glow, popups, scope, debug skeleton.
import { clamp, rand } from './util.js';

const BLAZE = '255,91,31';
const BRASS = '217,173,85';
const DANGER = '255,65,65';
const PAPER = '238,243,246';
const INK = '8,11,14';

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export class HudCanvas {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.W = 1;
    this.H = 1;
    this.dpr = 1;
    this.tracers = [];
    this.glows = [];
    this.popups = [];
    this.markers = [];
    this.t = 0;
  }
  resize(W, H, dpr) {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.c.width = Math.round(W * dpr);
    this.c.height = Math.round(H * dpr);
    this.c.style.width = W + 'px';
    this.c.style.height = H + 'px';
  }
  addTracer(a, b, width = 2, dur = 0.07) {
    this.tracers.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, age: 0, dur, width });
  }
  addGlow(p, strength) {
    this.glows.push({ x: p.x, y: p.y, age: 0, dur: 0.07 + strength * 0.03, s: strength });
  }
  addPopup(x, y, text, kind = 'hit') {
    this.popups.push({ x, y, text, kind, age: 0, dur: 0.95 });
  }
  addMarker(x, y, kill) {
    this.markers.push({ x, y, kill, age: 0, dur: kill ? 0.3 : 0.18 });
  }

  update(dt) {
    this.t += dt;
    for (const arr of [this.tracers, this.glows, this.popups, this.markers]) {
      let w = 0;
      for (const o of arr) {
        o.age += dt;
        if (o.age < o.dur + 0.06) arr[w++] = o;
      }
      arr.length = w;
    }
  }

  draw(state) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    const S = Math.min(this.W, this.H);

    // muzzle light washing over the camera image
    g.globalCompositeOperation = 'lighter';
    for (const o of this.glows) {
      const k = 1 - o.age / o.dur;
      if (k <= 0) continue;
      const r = S * (0.18 + o.s * 0.14);
      const grd = g.createRadialGradient(o.x, o.y, 0, o.x, o.y, r);
      grd.addColorStop(0, `rgba(255,200,130,${0.42 * k * o.s})`);
      grd.addColorStop(0.35, `rgba(255,140,60,${0.16 * k * o.s})`);
      grd.addColorStop(1, 'rgba(255,100,30,0)');
      g.fillStyle = grd;
      g.fillRect(o.x - r, o.y - r, r * 2, r * 2);
      if (o.s > 1.2) {
        g.fillStyle = `rgba(255,170,90,${0.05 * k})`;
        g.fillRect(0, 0, this.W, this.H);
      }
    }
    // tracers
    for (const o of this.tracers) {
      const head = clamp(o.age / o.dur, 0, 1);
      const tail = clamp((o.age - 0.035) / o.dur, 0, 1);
      if (tail >= 1) continue;
      const hx = o.x0 + (o.x1 - o.x0) * head,
        hy = o.y0 + (o.y1 - o.y0) * head;
      const tx = o.x0 + (o.x1 - o.x0) * tail,
        ty = o.y0 + (o.y1 - o.y0) * tail;
      const grd = g.createLinearGradient(tx, ty, hx, hy);
      grd.addColorStop(0, 'rgba(255,170,80,0)');
      grd.addColorStop(1, 'rgba(255,240,200,0.95)');
      g.strokeStyle = grd;
      g.lineWidth = o.width;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(hx, hy);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';

    if (state.scope) this.drawScope(state.scope);

    // lasers
    if (state.laser && !state.scope) {
      for (const gun of state.guns) {
        if (!gun.muzzle || gun.hideLaser || gun.laserK < 0.02) continue;
        const { x: x0, y: y0 } = gun.muzzle;
        const { x: x1, y: y1 } = gun.aim;
        const k = gun.laserK;
        const grd = g.createLinearGradient(x0, y0, x1, y1);
        grd.addColorStop(0, `rgba(${BLAZE},0.0)`);
        grd.addColorStop(0.25, `rgba(${BLAZE},${0.16 * k})`);
        grd.addColorStop(1, `rgba(${BLAZE},${0.5 * k})`);
        g.strokeStyle = grd;
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
    }

    // gesture progress rings (switch weapon / fire mode)
    for (const r of state.rings) {
      g.lineWidth = 4;
      g.strokeStyle = `rgba(${INK},0.55)`;
      g.beginPath();
      g.arc(r.x, r.y, 46, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = `rgba(${BRASS},0.95)`;
      g.beginPath();
      g.arc(r.x, r.y, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(r.p, 0, 1));
      g.stroke();
      this.label(r.label, r.x, r.y + 66, `rgb(${PAPER})`, 13);
    }

    if (!state.scope) for (const gun of state.guns) this.drawCrosshair(gun, S);

    // hit markers
    for (const m of this.markers) {
      const k = 1 - m.age / m.dur;
      if (k <= 0) continue;
      const r0 = 9,
        r1 = 17 + (1 - k) * 6;
      g.strokeStyle = m.kill ? `rgba(${BLAZE},${k})` : `rgba(${PAPER},${k})`;
      g.lineWidth = m.kill ? 2.6 : 2;
      g.beginPath();
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        g.moveTo(m.x + sx * r0 * 0.707, m.y + sy * r0 * 0.707);
        g.lineTo(m.x + sx * r1 * 0.707, m.y + sy * r1 * 0.707);
      }
      g.stroke();
    }
    // score popups
    for (const p of this.popups) {
      const k = p.age / p.dur;
      if (k >= 1) continue;
      const a = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const y = p.y - 26 - k * 42;
      const size = p.kind === 'kill' ? 26 : 21;
      g.font = `${size}px "Saira Stencil One", Impact, "Arial Narrow", sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 4;
      g.strokeStyle = `rgba(${INK},${0.7 * a})`;
      g.strokeText(p.text, p.x, y);
      g.fillStyle = p.kind === 'kill' ? `rgba(${BLAZE},${a})` : `rgba(${BRASS},${a})`;
      g.fillText(p.text, p.x, y);
    }

    if (state.skeletons) for (const sk of state.skeletons) this.drawSkeleton(sk);
    if (state.calib) this.drawCalib(state.calib);
  }

  label(text, x, y, color, size = 12, align = 'center') {
    const g = this.g;
    g.font = `600 ${size}px "Saira Condensed", "Arial Narrow", sans-serif`;
    g.textAlign = align;
    g.lineWidth = 3;
    g.strokeStyle = `rgba(${INK},0.75)`;
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  drawCrosshair(gun, S) {
    const g = this.g;
    const { x, y } = gun.aim;
    const id = gun.def.id;
    const spread = gun.spread * S;
    const col = gun.empty ? `rgb(${DANGER})` : `rgb(${BLAZE})`;
    const stroke = (fn, w) => {
      g.lineCap = 'butt';
      g.strokeStyle = `rgba(${INK},0.7)`;
      g.lineWidth = w + 2.2;
      g.beginPath();
      fn();
      g.stroke();
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath();
      fn();
      g.stroke();
    };
    let ring = 22;
    if (id === 'shotgun') {
      const r = Math.max(14, spread);
      ring = r + 12;
      stroke(() => {
        g.arc(x, y, r, 0, Math.PI * 2);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          g.moveTo(x + dx * (r + 3), y + dy * (r + 3));
          g.lineTo(x + dx * (r + 9), y + dy * (r + 9));
        }
      }, 1.6);
    } else if (id === 'sniper') {
      const gap = 4 + spread * 0.3;
      ring = 26;
      stroke(() => {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          g.moveTo(x + dx * gap, y + dy * gap);
          g.lineTo(x + dx * (gap + 16), y + dy * (gap + 16));
        }
      }, 1.4);
    } else {
      const gap = (id === 'rifle' ? 5 : 6) + spread;
      const len = id === 'rifle' ? 11 : 9;
      ring = gap + len + 8;
      stroke(() => {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          g.moveTo(x + dx * gap, y + dy * gap);
          g.lineTo(x + dx * (gap + len), y + dy * (gap + len));
        }
      }, 2);
    }
    // center dot
    g.fillStyle = `rgba(${INK},0.7)`;
    g.beginPath();
    g.arc(x, y, 2.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, 1.6, 0, Math.PI * 2);
    g.fill();

    // trigger pull meter (thumb hammer)
    if (gun.pull != null && !gun.reload) {
      const p = gun.triggerDown ? 1 : clamp(gun.pull, 0, 1);
      if (p > 0.04) {
        g.lineWidth = 2.5;
        g.strokeStyle = gun.triggerDown ? `rgba(${PAPER},0.95)` : `rgba(${BRASS},${0.35 + p * 0.6})`;
        g.beginPath();
        g.arc(x, y, ring, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
        g.stroke();
      }
    }
    // reload progress
    if (gun.reload != null) {
      g.lineWidth = 3;
      g.strokeStyle = `rgba(${INK},0.5)`;
      g.beginPath();
      g.arc(x, y, ring + 4, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = `rgb(${BRASS})`;
      g.beginPath();
      g.arc(x, y, ring + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * gun.reload);
      g.stroke();
      this.label('RELOADING', x, y + ring + 24, `rgb(${BRASS})`, 13);
    } else if (gun.empty) {
      this.label('EMPTY · POINT UP TO RELOAD', x, y + ring + 22, `rgb(${DANGER})`, 13);
    } else if (gun.low) {
      this.label('LOW AMMO', x, y + ring + 22, `rgb(${BRASS})`, 12);
    }
    if (gun.steadyP > 0 && gun.def.id === 'sniper') {
      g.lineWidth = 2;
      g.strokeStyle = `rgba(${PAPER},${0.3 + gun.steadyP * 0.5})`;
      g.setLineDash([3, 5]);
      g.beginPath();
      g.arc(x, y, ring + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * gun.steadyP);
      g.stroke();
      g.setLineDash([]);
    }
  }

  drawScope(sc) {
    const g = this.g;
    const { cx, cy, r, k } = sc;
    // black-out everything outside the lens
    g.fillStyle = `rgba(4,6,8,${0.97 * k})`;
    g.beginPath();
    g.rect(0, 0, this.W, this.H);
    g.arc(cx, cy, r, 0, Math.PI * 2, true);
    g.fill('evenodd');
    // lens edge vignette
    const v = g.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.75 * k})`);
    g.fillStyle = v;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    // reticle: duplex with mil dots
    g.strokeStyle = `rgba(10,10,10,${0.95 * k})`;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx - r, cy);
    g.lineTo(cx - r * 0.3, cy);
    g.moveTo(cx + r * 0.3, cy);
    g.lineTo(cx + r, cy);
    g.moveTo(cx, cy + r * 0.3);
    g.lineTo(cx, cy + r);
    g.moveTo(cx, cy - r);
    g.lineTo(cx, cy - r * 0.3);
    g.stroke();
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(cx - r * 0.3, cy);
    g.lineTo(cx + r * 0.3, cy);
    g.moveTo(cx, cy - r * 0.3);
    g.lineTo(cx, cy + r * 0.3);
    g.stroke();
    g.fillStyle = `rgba(10,10,10,${k})`;
    for (let i = 1; i <= 4; i++) {
      const d = (r * 0.3 * i) / 4.5;
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
        g.beginPath();
        g.arc(cx + dx, cy + dy, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.fillStyle = `rgba(255,40,30,${k})`;
    g.beginPath();
    g.arc(cx, cy, 2.2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `rgba(30,32,36,${k})`;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(cx, cy, r + 4, 0, Math.PI * 2);
    g.stroke();
    this.label(`${sc.zoom.toFixed(0)}× · HOLD STEADY`, cx, cy + r + 30, `rgba(${PAPER},${0.85 * k})`, 13);
  }

  drawSkeleton(sk) {
    const g = this.g;
    const P = sk.P;
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(42,212,255,0.8)';
    g.beginPath();
    for (const [a, b] of BONES) {
      g.moveTo(P[a].x, P[a].y);
      g.lineTo(P[b].x, P[b].y);
    }
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const p of P) {
      g.beginPath();
      g.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    let y = P[0].y + 24;
    for (const line of sk.lines) {
      this.label(line, P[0].x, y, 'rgb(42,212,255)', 12);
      y += 15;
    }
  }

  drawCalib(c) {
    const g = this.g;
    const { x, y, p } = c;
    g.lineWidth = 3;
    g.strokeStyle = `rgba(${PAPER},0.35)`;
    g.beginPath();
    g.arc(x, y, 34, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = `rgb(${BRASS})`;
    g.beginPath();
    g.arc(x, y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    g.stroke();
  }
}

// Small landmark-skeleton pictograms for the gesture legend, drawn from real tracked poses.
export const POSE_ICONS = {};

export function drawPoseIcon(canvas, pts, { accent = '#ff5b1f', thumbAccent = false, arrow = null } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 44,
    h = canvas.clientHeight || 44;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const [x, y] of pts) {
    minx = Math.min(minx, x);
    maxx = Math.max(maxx, x);
    miny = Math.min(miny, y);
    maxy = Math.max(maxy, y);
  }
  const s = Math.min((w - 8) / (maxx - minx), (h - 8) / (maxy - miny));
  const ox = (w - (maxx - minx) * s) / 2 - minx * s,
    oy = (h - (maxy - miny) * s) / 2 - miny * s;
  const P = pts.map(([x, y]) => [x * s + ox, y * s + oy]);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const [a, b] of BONES) {
    const isIndex = a >= 5 && a <= 8 && b >= 5 && b <= 8 && !(a === 5 && b === 9);
    const isThumb = a <= 4 && b <= 4 && b > 0;
    g.strokeStyle = isIndex ? accent : isThumb && thumbAccent ? '#d9ad55' : 'rgba(238,243,246,0.85)';
    g.lineWidth = isIndex || (isThumb && thumbAccent) ? 2.2 : 1.6;
    g.beginPath();
    g.moveTo(P[a][0], P[a][1]);
    g.lineTo(P[b][0], P[b][1]);
    g.stroke();
  }
  g.fillStyle = 'rgba(238,243,246,0.95)';
  for (const [x, y] of P) {
    g.beginPath();
    g.arc(x, y, 1.3, 0, Math.PI * 2);
    g.fill();
  }
  if (arrow) {
    g.strokeStyle = '#d9ad55';
    g.lineWidth = 1.6;
    const [x0, y0, x1, y1] = arrow.map((v, i) => v * (i % 2 ? h : w));
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    const a = Math.atan2(y1 - y0, x1 - x0);
    g.lineTo(x1 - Math.cos(a - 0.5) * 5, y1 - Math.sin(a - 0.5) * 5);
    g.moveTo(x1, y1);
    g.lineTo(x1 - Math.cos(a + 0.5) * 5, y1 - Math.sin(a + 0.5) * 5);
    g.stroke();
  }
}
