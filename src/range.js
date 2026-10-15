// The shooting range: steel plates, bottles on a shelf, thrown clays and a drone.
// Hit testing happens in screen space against each target's projected silhouette, nearest first.
import * as THREE from 'three';
import { buildPlate, buildBottle, buildClay, buildClayShard, buildDrone, buildShelf } from './models.js';
import { rand, randi, clamp, pick } from './util.js';

const C = (hex) => new THREE.Color(hex);
const SPARK = C(0xffc070),
  SPARK2 = C(0xff6a20),
  WHITE = C(0xffffff),
  DUST = C(0x8f8578),
  CLAYDUST = C(0xff7a3a),
  SMOKE = C(0x3a3a3a);

export class Range {
  constructor(ctx) {
    this.ctx = ctx; // { scene, view, T, sparks, dust, debris, audio, panOf }
    this.targets = [];
    this.mode = 'free';
    this.clayTimer = 3;
    this.droneTimer = 12;
    this.bottleTimer = 0;
    this.shelf = buildShelf(ctx.T);
    ctx.scene.add(this.shelf);
    this.shelf.visible = false;
    this._v = new THREE.Vector3();
  }

  frustum(depth) {
    const v = this.ctx.view;
    const hh = depth * Math.tan(((v.fovY / 2) * Math.PI) / 180);
    return { hh, hw: hh * (v.W / v.H) };
  }

  at(nx, ny, depth) {
    const f = this.frustum(depth);
    return new THREE.Vector3(nx * f.hw, ny * f.hh, -depth);
  }

  clear() {
    this.silence();
    for (const t of this.targets) this.ctx.scene.remove(t.group);
    this.targets = [];
  }

  // Stop looping sounds (drone rotors) without removing anything.
  silence() {
    for (const t of this.targets)
      if (t.loop) {
        t.loop.stop();
        t.loop = null;
      }
  }

  setMode(mode) {
    this.clear();
    this.mode = mode;
    this.shelf.visible = mode !== 'tutorial';
    if (mode === 'tutorial') {
      this.addPlate(0, 0.0, 4.2, 0.3, 10, true);
      return;
    }
    this.addPlate(-0.66, 0.46, 4.8, 0.24, 10);
    this.addPlate(0.7, 0.5, 5.6, 0.18, 15);
    this.addPlate(0.16, 0.76, 6.6, 0.13, 25);
    this.spawnBottles();
    this.clayTimer = mode === 'drill' ? 1.5 : 3;
    this.droneTimer = mode === 'drill' ? 8 : 10;
  }

  // ---------- spawners ----------
  addPlate(nx, ny, depth, radius, points, tutorial = false) {
    const p = buildPlate(radius, this.ctx.T);
    p.group.scale.setScalar(1);
    this.ctx.scene.add(p.group);
    const t = {
      kind: 'plate', group: p.group, swing: p.swing, face: p.face, faceY: p.faceCenterY,
      nx, ny, depth, radius, points, av: 0, ang: 0, tw: 0, avw: 0, chips: [], tutorial, alive: true,
      sound: radius > 0.2 ? 'ding0' : radius > 0.15 ? 'ding1' : 'ding2',
    };
    this.targets.push(t);
    return t;
  }

  spawnBottles() {
    const depth = 3.4;
    this.shelfPos = { nx: -0.56, ny: -0.04, depth };
    for (let i = 0; i < 4; i++) this.addBottle(i);
  }

  addBottle(i) {
    const b = buildBottle(this.ctx.T, i % 3);
    this.ctx.scene.add(b.group);
    const t = { kind: 'bottle', group: b.group, slotI: i, points: 25, alive: true, pop: 0, mat: b.mat };
    this.targets.push(t);
    return t;
  }

  launchClay() {
    const depth = rand(4.6, 6.2);
    const { hh, hw } = this.frustum(depth);
    const side = Math.random() < 0.5 ? -1 : 1;
    const g = this.mode === 'drill' ? 3.6 : 3.0;
    const peakY = hh * rand(0.25, 0.75);
    const startY = -hh * 1.15;
    const vy = Math.sqrt(2 * g * (peakY - startY));
    const flight = (2 * vy) / g;
    const startX = side * hw * rand(0.55, 0.95);
    const endX = -side * hw * rand(0.1, 0.7);
    const grp = buildClay(this.ctx.T);
    grp.scale.setScalar(1.7);
    grp.position.set(startX, startY, -depth);
    grp.rotation.set(0.45, 0, side * 0.2);
    this.ctx.scene.add(grp);
    this.targets.push({
      kind: 'clay', group: grp, vel: new THREE.Vector3((endX - startX) / flight, vy, rand(-0.6, -0.1)), g,
      spin: rand(14, 22) * side, points: 50, alive: true, age: 0,
    });
    this.ctx.audio.play('holster', { pan: side * 0.8, gain: 0.35, rate: 1.6, wet: 0.3 });
  }

  launchDrone() {
    if (this.targets.some((t) => t.kind === 'drone' && t.alive)) return;
    const d = buildDrone(this.ctx.T);
    const depth = rand(3.6, 4.8);
    const side = Math.random() < 0.5 ? -1 : 1;
    const { hw } = this.frustum(depth);
    d.group.position.set(side * hw * 1.25, this.frustum(depth).hh * 0.5, -depth);
    d.group.scale.setScalar(1.25);
    this.ctx.scene.add(d.group);
    const loop = this.ctx.audio.loop('droneLoop', 0.0);
    const t = {
      kind: 'drone', group: d.group, rotors: d.rotors, hp: 100, points: 100, alive: true, age: 0, side, depth,
      seed: rand(0, 100), loop, falling: false, vel: new THREE.Vector3(), leaveAt: this.mode === 'drill' ? 14 : 22,
      flash: 0,
    };
    this.targets.push(t);
  }

  // ---------- simulation ----------
  update(dt, t) {
    const ctx = this.ctx;
    if (this.mode === 'free' || this.mode === 'drill') {
      this.clayTimer -= dt;
      if (this.clayTimer <= 0) {
        this.launchClay();
        if (this.mode === 'drill' && Math.random() < 0.35) setTimeout(() => this.mode === 'drill' && this.launchClay(), 450);
        this.clayTimer = this.mode === 'drill' ? rand(1.8, 3.2) : rand(3.2, 5.5);
      }
      this.droneTimer -= dt;
      if (this.droneTimer <= 0) {
        this.launchDrone();
        this.droneTimer = this.mode === 'drill' ? rand(10, 14) : rand(16, 24);
      }
    }
    // shelf placement follows the viewport
    if (this.shelfPos) {
      const s = this.shelfPos;
      this.shelf.position.copy(this.at(s.nx, s.ny, s.depth));
      this.shelf.position.y -= 0.02;
    }
    const keep = [];
    for (const tg of this.targets) {
      if (this.updateTarget(tg, dt, t) !== false) keep.push(tg);
      else ctx.scene.remove(tg.group);
    }
    this.targets = keep;
    // respawn bottles
    if (this.shelfPos && this.mode !== 'tutorial') {
      const alive = this.targets.filter((x) => x.kind === 'bottle');
      if (alive.length < 4) {
        this.bottleTimer += dt;
        if (this.bottleTimer > 2.2) {
          this.bottleTimer = 0;
          const used = new Set(alive.map((b) => b.slotI));
          for (let i = 0; i < 4; i++) if (!used.has(i)) {
            const b = this.addBottle(i);
            b.pop = 0;
            break;
          }
        }
      } else this.bottleTimer = 0;
    }
  }

  updateTarget(tg, dt, t) {
    const view = this.ctx.view;
    if (tg.kind === 'plate') {
      const p = this.at(tg.nx, tg.ny, tg.depth);
      tg.group.position.set(p.x, p.y - tg.faceY, p.z);
      // pendulum (semi-implicit, sub-stepped)
      const n = Math.ceil(dt / (1 / 120)),
        h = dt / n;
      for (let i = 0; i < n; i++) {
        tg.av += (-28 * tg.ang - 1.6 * tg.av) * h;
        tg.ang += tg.av * h;
        tg.avw += (-18 * tg.tw - 1.2 * tg.avw) * h;
        tg.tw += tg.avw * h;
      }
      tg.ang = clamp(tg.ang, -1.2, 1.2);
      tg.swing.rotation.set(tg.ang, tg.tw, 0);
      return true;
    }
    if (tg.kind === 'bottle') {
      if (!this.shelfPos) return false;
      const s = this.shelfPos;
      const base = this.at(s.nx, s.ny, s.depth);
      tg.pop = Math.min(1, tg.pop + dt * 4);
      tg.group.position.set(base.x - 0.27 + tg.slotI * 0.18, base.y + 0.0, base.z + (tg.slotI % 2) * 0.03);
      const k = tg.pop < 1 ? 1 - Math.pow(1 - tg.pop, 3) : 1;
      tg.group.scale.setScalar(Math.max(0.001, k));
      return true;
    }
    if (tg.kind === 'clay') {
      tg.age += dt;
      tg.vel.y -= tg.g * dt;
      tg.group.position.addScaledVector(tg.vel, dt);
      tg.group.rotateY(tg.spin * dt);
      const { hh } = this.frustum(-tg.group.position.z);
      if (tg.vel.y < 0 && tg.group.position.y < -hh * 1.25) return false;
      return true;
    }
    if (tg.kind === 'drone') {
      tg.age += dt;
      const g = tg.group;
      for (const r of tg.rotors) r.rotation.y += dt * (tg.falling ? 20 : 60);
      if (tg.falling) {
        tg.vel.y -= 9.8 * dt;
        g.position.addScaledVector(tg.vel, dt);
        g.rotation.z += dt * 6;
        g.rotation.x += dt * 3;
        if (Math.random() < 0.6)
          this.ctx.dust.spawn({ pos: g.position, vel: { x: rand(-0.2, 0.2), y: 0.4, z: 0 }, life: 1.2, size0: 0.12, size1: 0.5, color: SMOKE, alpha: 0.55, drag: 1 });
        if (Math.random() < 0.3) this.ctx.sparks.spawn({ pos: g.position, vel: { x: rand(-1, 1), y: rand(0, 2), z: rand(-1, 1) }, life: 0.4, size0: 0.025, color: SPARK, color1: SPARK2, gravity: 6 });
        tg.loop?.set(this.ctx.panOf(g.position), 0, 0.6);
        if (g.position.y < -this.frustum(-g.position.z).hh * 1.3) {
          tg.loop?.stop();
          return false;
        }
        return true;
      }
      const { hh, hw } = this.frustum(tg.depth);
      const s = tg.seed,
        a = tg.age;
      let tx = Math.sin(a * 0.45 + s) * 0.62 + Math.sin(a * 1.1 + s * 2) * 0.18;
      let ty = 0.38 + Math.sin(a * 0.7 + s * 3) * 0.25 + Math.sin(a * 1.9 + s) * 0.06;
      const enter = clamp(a / 2.2, 0, 1);
      const leaving = a > tg.leaveAt;
      if (leaving) tx = tg.side * (1.3 + (a - tg.leaveAt) * 0.6);
      const goal = new THREE.Vector3((tx * (leaving ? 1 : enter) + (1 - enter) * tg.side * 1.25) * hw, ty * hh, -tg.depth + Math.sin(a * 0.5 + s) * 0.6);
      const prev = g.position.clone();
      g.position.lerp(goal, 1 - Math.exp(-dt * 1.6));
      const vx = (g.position.x - prev.x) / dt;
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, -vx * 0.12, 1 - Math.exp(-dt * 4));
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, 0.35, 1 - Math.exp(-dt * 4));
      tg.flash = Math.max(0, tg.flash - dt * 6);
      this.ctx.T.droneBody.emissive?.setRGB(tg.flash * 0.8, tg.flash * 0.15, 0);
      tg.loop?.set(this.ctx.panOf(g.position), 0.16 * clamp(4 / tg.depth, 0.5, 1.2), 1 + Math.abs(vx) * 0.04);
      if (leaving && Math.abs(g.position.x) > hw * 1.25) {
        tg.loop?.stop();
        return false;
      }
      return true;
    }
    return true;
  }

  // ---------- hit testing ----------
  // Returns target hits under screen point (x, y), nearest first.
  pick(x, y, assist = 0) {
    const view = this.ctx.view;
    const hits = [];
    const v = this._v;
    for (const tg of this.targets) {
      if (!tg.alive) continue;
      let depth = 0,
        ok = false;
      if (tg.kind === 'plate') {
        tg.face.getWorldPosition(v);
        const s = view.project(v);
        const r = (tg.radius * view.f) / s.z;
        ok = Math.hypot(x - s.x, y - s.y) < r + assist * 0.5;
        depth = s.z;
      } else if (tg.kind === 'bottle') {
        const a = view.project(tg.group.localToWorld(v.set(0, 0.03, 0)));
        const b = view.project(tg.group.localToWorld(v.set(0, 0.23, 0)));
        const rr = (0.042 * tg.group.scale.x * view.f) / a.z;
        ok = segDist2(x, y, a.x, a.y, b.x, b.y) < rr + 3 + assist * 0.5;
        depth = a.z;
      } else if (tg.kind === 'clay') {
        const s = view.project(tg.group.position);
        const r = (0.11 * view.f) / s.z;
        ok = Math.hypot(x - s.x, y - s.y) < r + 16 + assist;
        depth = s.z;
      } else if (tg.kind === 'drone') {
        if (tg.falling) continue;
        const s = view.project(tg.group.position);
        const r = (0.22 * view.f) / s.z;
        ok = Math.hypot(x - s.x, y - s.y) < r + 4 + assist * 0.5;
        depth = s.z;
      }
      if (ok) hits.push({ tg, depth, point: new THREE.Vector3().copy(view.unproject(x, y, depth)) });
    }
    hits.sort((a, b) => a.depth - b.depth);
    return hits;
  }

  // Applies damage and effects. Returns { points, kill, kind }.
  hit(h, def, dir) {
    const { tg, point } = h;
    const ctx = this.ctx;
    const pan = ctx.panOf(point);
    const delay = Math.min(0.12, h.depth / 343);
    if (tg.kind === 'plate') {
      tg.av += rand(5, 9) * (def.damage / 30) * (Math.random() < 0.5 ? 1 : 0.8);
      tg.avw += rand(-3, 3);
      ctx.audio.play(tg.sound, { pan, gain: 0.75, delay, wet: 0.35 });
      this.burstSparks(point, 14, 1.6);
      this.addChip(tg, point);
      return { points: tg.points, kill: false, kind: 'plate' };
    }
    if (tg.kind === 'bottle') {
      tg.alive = false;
      this.ctx.scene.remove(tg.group);
      this.targets = this.targets.filter((x) => x !== tg);
      ctx.audio.play('glass', { pan, gain: 0.8, delay, wet: 0.3 });
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(shardGeo(), tg.mat);
        m.position.copy(tg.group.position).add(new THREE.Vector3(rand(-0.03, 0.03), rand(0.02, 0.22), rand(-0.03, 0.03)));
        ctx.debris.add(m, {
          vel: new THREE.Vector3(rand(-1.8, 1.8), rand(0.5, 3.2), rand(-1, 1.5)),
          ang: new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)),
          life: rand(0.7, 1.1), gravity: 9.8, fade: 0.3,
        });
      }
      for (let i = 0; i < 18; i++) ctx.sparks.spawn({ pos: point, vel: { x: rand(-2, 2), y: rand(-0.5, 2.5), z: rand(-1, 1) }, life: rand(0.2, 0.45), size0: 0.02, size1: 0.005, color: WHITE, color1: C(0x9fd8ff), gravity: 7, alpha: 0.9 });
      return { points: tg.points, kill: true, kind: 'bottle' };
    }
    if (tg.kind === 'clay') {
      tg.alive = false;
      this.ctx.scene.remove(tg.group);
      this.targets = this.targets.filter((x) => x !== tg);
      ctx.audio.play('clay', { pan, gain: 0.85, delay: delay * 2, wet: 0.35 });
      for (let i = 0; i < 6; i++) {
        const m = buildClayShard(ctx.T);
        m.position.copy(tg.group.position);
        m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
        const a = (i / 6) * Math.PI * 2;
        ctx.debris.add(m, {
          vel: new THREE.Vector3(Math.cos(a) * rand(1, 2.5) + tg.vel.x * 0.5, Math.sin(a) * rand(1, 2.5) + tg.vel.y * 0.4, rand(-1, 1)),
          ang: new THREE.Vector3(rand(-15, 15), rand(-15, 15), rand(-15, 15)),
          life: 1.1, gravity: 7, fade: 0.3, dispose: true,
        });
      }
      for (let i = 0; i < 10; i++) ctx.dust.spawn({ pos: tg.group.position, vel: { x: rand(-1.2, 1.2), y: rand(-0.6, 1.2), z: rand(-0.5, 0.5) }, life: rand(0.6, 1.1), size0: 0.12, size1: 0.6, color: CLAYDUST, alpha: 0.7, drag: 2.5 });
      this.burstSparks(tg.group.position, 8, 1.2);
      return { points: tg.points, kill: true, kind: 'clay' };
    }
    if (tg.kind === 'drone') {
      tg.hp -= def.damage;
      tg.flash = 1;
      this.burstSparks(point, 12, 2);
      if (tg.hp <= 0) {
        tg.falling = true;
        tg.alive = false;
        tg.vel.set(rand(-0.5, 0.5), 1.2, 0);
        ctx.audio.play('droneBoom', { pan, gain: 0.9, delay, wet: 0.4 });
        this.burstSparks(tg.group.position, 40, 3.5);
        for (let i = 0; i < 12; i++) ctx.dust.spawn({ pos: tg.group.position, vel: { x: rand(-1, 1), y: rand(-0.2, 1.5), z: rand(-0.5, 0.5) }, life: rand(1, 1.8), size0: 0.2, size1: 0.9, color: SMOKE, alpha: 0.7, drag: 1.5 });
        for (let i = 0; i < 6; i++) ctx.dust.spawn({ pos: tg.group.position, vel: { x: rand(-0.6, 0.6), y: rand(0, 1), z: 0 }, life: 0.35, size0: 0.3, size1: 0.6, color: C(0xffa040), alpha: 0.9, drag: 2 });
        return { points: tg.points, kill: true, kind: 'drone' };
      }
      ctx.audio.play('droneHit', { pan, gain: 0.7, delay, wet: 0.3 });
      return { points: 20, kill: false, kind: 'drone' };
    }
    return { points: 0, kill: false };
  }

  // A miss lands on the back wall: dust and a few sparks.
  miss(x, y) {
    const ctx = this.ctx;
    const depth = 7.5;
    const p = new THREE.Vector3().copy(ctx.view.unproject(x, y, depth));
    for (let i = 0; i < 6; i++) ctx.dust.spawn({ pos: p, vel: { x: rand(-0.4, 0.4), y: rand(0, 0.8), z: rand(0, 0.6) }, life: rand(0.6, 1.0), size0: 0.08, size1: 0.45, color: DUST, alpha: 0.55, drag: 2.2 });
    this.burstSparks(p, 5, 1.4);
    if (Math.random() < 0.22) ctx.audio.play('ricochet', { pan: ctx.panOf(p), gain: 0.35, delay: 0.05, wet: 0.45 });
    else ctx.audio.play('thud', { pan: ctx.panOf(p), gain: 0.3, delay: 0.03, wet: 0.4 });
  }

  burstSparks(p, n, speed) {
    for (let i = 0; i < n; i++)
      this.ctx.sparks.spawn({
        pos: p,
        vel: { x: rand(-1, 1) * speed, y: rand(-0.3, 1.2) * speed, z: rand(-0.2, 1) * speed },
        life: rand(0.18, 0.42), size0: 0.028, size1: 0.006, color: WHITE, color1: SPARK2, gravity: 6, drag: 1.5,
      });
  }

  addChip(tg, point) {
    const T = this.ctx.T;
    T.chipMat ||= new THREE.MeshBasicMaterial({ map: this.ctx.tex.chip, transparent: true, depthWrite: false });
    const local = tg.swing.worldToLocal(point.clone());
    const dy = local.y - tg.faceY,
      dx = local.x;
    const r = Math.hypot(dx, dy);
    const k = r > tg.radius * 0.92 ? (tg.radius * 0.92) / r : 1;
    const chip = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.045), T.chipMat);
    chip.position.set(dx * k, tg.faceY + dy * k, 0.0079);
    chip.rotation.z = rand(0, 6.28);
    tg.swing.add(chip);
    tg.chips.push(chip);
    if (tg.chips.length > 24) {
      const old = tg.chips.shift();
      tg.swing.remove(old);
      old.geometry.dispose();
    }
  }
}

function segDist2(px, py, ax, ay, bx, by) {
  const abx = bx - ax,
    aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

let _shard;
function shardGeo() {
  if (!_shard) {
    _shard = new THREE.TetrahedronGeometry(0.022);
    _shard.scale(1, 0.35, 0.7);
  }
  return _shard;
}
