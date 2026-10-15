// Weapon state machines (ammo, fire modes, reload, pump/bolt cycling) and the 3D rig that
// holds a gun in a tracked hand, animates recoil/reload/switching and hides the grip inside the fist.
import * as THREE from 'three';
import { WEAPON_BY_ID } from './config.js';
import { buildGun, buildShellMesh } from './models.js';
import { MuzzleFlash } from './fx.js';
import { clamp, smoothstep, rand } from './util.js';

export class WeaponState {
  constructor(def) {
    this.def = def;
    this.ammo = def.mag;
    this.modeIdx = 0;
    this.cooldown = 0;
    this.cycleT = 0;
    this.reloading = false;
    this.reloadT = 0;
    this.reloadDur = 1;
    this.reloadEmpty = false;
    this.reloadId = 0;
    this.burstLeft = 0;
    this.bloom = 0;
    this.emptyT = 0;
    this.nextShellT = 0;
    this.pumpedAfterReload = false;
    this.lastShotT = -1;
  }
  get mode() {
    return this.def.modes[this.modeIdx];
  }
  get spread() {
    return this.def.spread + this.bloom;
  }
}

const crossed = (p0, p1, x) => p0 < x && p1 >= x;

export function startReload(st, hooks) {
  const def = st.def;
  if (st.reloading || st.ammo >= def.mag) return false;
  st.reloading = true;
  st.reloadT = 0;
  st.reloadEmpty = st.ammo === 0;
  st.reloadId++;
  st.burstLeft = 0;
  st.emptyT = 0;
  st.pumpedAfterReload = false;
  if (def.id === 'shotgun') {
    st.nextShellT = def.reloadStart;
    st.reloadDur = def.reloadStart + (def.mag - st.ammo) * def.reloadShell + (st.reloadEmpty ? def.pump + 0.05 : 0.1);
  } else {
    st.reloadDur = st.reloadEmpty ? def.reloadEmpty : def.reload;
  }
  hooks.reloadStart?.(st);
  return true;
}

// Advances one weapon by dt. input = { pressed, held }.
export function tickWeapon(slot, st, dt, input, hooks, settings) {
  const def = st.def;
  st.cooldown = Math.max(0, st.cooldown - dt);
  if (def.bloomMax) st.bloom = Math.max(0, st.bloom - dt * def.bloomMax * (input.held ? 1.2 : 3.5));

  if (st.cycleT > 0) {
    const total = def.pump || def.bolt;
    const p0 = 1 - st.cycleT / total;
    st.cycleT = Math.max(0, st.cycleT - dt);
    const p1 = 1 - st.cycleT / total;
    if (def.pump) {
      if (crossed(p0, p1, 0.04)) hooks.sound(slot, 'pump');
      if (crossed(p0, p1, 0.4) && !st.skipEject) hooks.eject(slot, st);
    } else if (def.bolt) {
      if (crossed(p0, p1, 0.06)) hooks.sound(slot, 'boltOpen');
      if (crossed(p0, p1, 0.36) && !st.skipEject) hooks.eject(slot, st);
      if (crossed(p0, p1, 0.58)) hooks.sound(slot, 'boltClose');
    }
    if (st.cycleT === 0) st.skipEject = false;
  }

  if (st.reloading) {
    const p0 = st.reloadT / st.reloadDur;
    st.reloadT += dt;
    const p1 = st.reloadT / st.reloadDur;
    if (def.id === 'shotgun') {
      while (st.reloadT >= st.nextShellT && st.ammo < def.mag) {
        st.ammo++;
        st.nextShellT += def.reloadShell;
        hooks.sound(slot, 'shellIn');
      }
      if (st.ammo >= def.mag && st.reloadEmpty && !st.pumpedAfterReload && st.reloadT >= st.nextShellT - def.reloadShell + 0.12) {
        st.pumpedAfterReload = true;
        st.skipEject = true;
        st.cycleT = def.pump;
      }
      if (input.pressed && st.ammo > 0) {
        // interrupt the reload to shoot
        st.reloading = false;
        if (st.reloadEmpty && !st.pumpedAfterReload) {
          st.skipEject = true;
          st.cycleT = def.pump;
          st.pumpedAfterReload = true;
        }
        hooks.reloadEnd?.(st);
        return;
      }
    } else {
      if (crossed(p0, p1, 0.06)) hooks.sound(slot, 'magOut');
      if (crossed(p0, p1, 0.6)) hooks.sound(slot, 'magIn');
      if (st.reloadEmpty && crossed(p0, p1, 0.8)) hooks.sound(slot, def.id === 'sniper' ? 'boltClose' : 'slide');
    }
    if (st.reloadT >= st.reloadDur) {
      st.reloading = false;
      st.ammo = def.mag;
      hooks.reloadEnd?.(st);
    }
    return;
  }

  if (slot.swapT > 0) return;
  const mode = st.mode;
  let want = false;
  if (input.pressed) {
    if (st.ammo <= 0) {
      if (st.cycleT <= 0) hooks.sound(slot, 'dry');
      if (settings.autoReload && st.cycleT <= 0) startReload(st, hooks);
      return;
    }
    if (mode === 'BURST') st.burstLeft = def.burst;
    want = true;
  }
  if (mode === 'AUTO' && input.held) want = true;
  if (mode === 'BURST' && st.burstLeft > 0) want = true;
  if (want && st.cooldown <= 0 && st.cycleT <= 0 && st.ammo > 0) {
    st.ammo--;
    st.cooldown = 60 / def.rpm;
    if (mode === 'BURST') st.burstLeft = Math.max(0, st.burstLeft - 1);
    if (def.pump) st.cycleT = def.pump;
    if (def.bolt) st.cycleT = def.bolt;
    hooks.shot(slot, st);
    st.bloom = Math.min(def.bloomMax || 0, st.bloom + (def.bloom || 0));
    st.emptyT = 0;
    if (st.ammo === 0) st.burstLeft = 0;
  }
  if (st.ammo === 0 && settings.autoReload && st.cycleT <= 0) {
    st.emptyT += dt;
    if (st.emptyT > 0.5) startReload(st, hooks);
  }
}

// Depth-only spheres and cylinders along the tracked fingers so the real fist appears to wrap the grip.
const JOINT_R = {
  0: 0.02, 1: 0.013, 2: 0.012, 3: 0.0105, 4: 0.0095,
  5: 0.0095, 9: 0.0095, 10: 0.009, 11: 0.0085, 12: 0.008,
  13: 0.009, 14: 0.0085, 15: 0.008, 16: 0.0075,
  17: 0.0085, 18: 0.008, 19: 0.0075, 20: 0.007,
};
const OCC_JOINTS = [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const OCC_BONES = [
  [1, 2], [2, 3], [3, 4], [9, 10], [10, 11], [11, 12], [13, 14], [14, 15], [15, 16], [17, 18], [18, 19], [19, 20],
  [0, 1], [0, 17], [9, 13], [13, 17], [0, 9], [0, 13],
];
const PALM_FILL = [
  [[0, 9, 13, 17], 0.024],
  [[0, 5, 9], 0.02],
  [[9, 13, 17, 13], 0.018],
];

// The thumb is the trigger finger here, so it always stays visible: these shapes write the nearest
// possible depth, and the gun can never draw over the camera image of the thumb.
const THUMB_JOINTS = [2, 3, 4];
const THUMB_BONES = [
  [2, 3],
  [3, 4],
];
const THUMB_SCALE = 1.25;
const thumbMaskMat = () =>
  new THREE.ShaderMaterial({
    vertexShader: `void main() {
      vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * p;
    }`,
    fragmentShader: `void main() {
      gl_FragColor = vec4(0.0);
      gl_FragDepth = 0.0;
    }`,
    colorWrite: false,
    depthTest: false,
    depthWrite: true,
  });

export class HandOccluder {
  constructor(scene) {
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.debugMat = new THREE.MeshBasicMaterial({ color: 0x2ad4ff, transparent: true, opacity: 0.28, depthWrite: true });
    this.thumbMat = thumbMaskMat();
    this.thumbDebugMat = new THREE.MeshBasicMaterial({ color: 0xffb02a, transparent: true, opacity: 0.35, depthTest: false });
    const n = OCC_JOINTS.length + PALM_FILL.length;
    this.spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), this.depthMat, n);
    this.cyls = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), this.depthMat, OCC_BONES.length);
    this.tSpheres = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), this.thumbMat, THUMB_JOINTS.length);
    this.tCyls = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), this.thumbMat, THUMB_BONES.length);
    for (const m of [this.spheres, this.cyls, this.tSpheres, this.tCyls]) {
      m.renderOrder = m === this.tSpheres || m === this.tCyls ? -11 : -10;
      m.frustumCulled = false;
      m.visible = false;
      scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }
  setDebug(on) {
    this.spheres.material = this.cyls.material = on ? this.debugMat : this.depthMat;
    this.tSpheres.material = this.tCyls.material = on ? this.thumbDebugMat : this.thumbMat;
  }
  update(Q, visible) {
    this.spheres.visible = this.cyls.visible = this.tSpheres.visible = this.tCyls.visible = !!(visible && Q);
    if (!this.spheres.visible) return;
    THUMB_JOINTS.forEach((j, i) => {
      const r = JOINT_R[j] * THUMB_SCALE;
      this._m.makeScale(r, r, r).setPosition(Q[j].x, Q[j].y, Q[j].z);
      this.tSpheres.setMatrixAt(i, this._m);
    });
    this.tSpheres.instanceMatrix.needsUpdate = true;
    THUMB_BONES.forEach(([a, b], i) => this.bone(this.tCyls, i, Q[a], Q[b], ((JOINT_R[a] + JOINT_R[b]) / 2) * THUMB_SCALE));
    this.tCyls.instanceMatrix.needsUpdate = true;
    let k = 0;
    for (const j of OCC_JOINTS) {
      const r = JOINT_R[j];
      this._m.makeScale(r, r, r).setPosition(Q[j].x, Q[j].y, Q[j].z);
      this.spheres.setMatrixAt(k++, this._m);
    }
    for (const [ids, r] of PALM_FILL) {
      let x = 0, y = 0, z = 0;
      for (const i of ids) {
        x += Q[i].x;
        y += Q[i].y;
        z += Q[i].z;
      }
      const n = ids.length;
      this._m.makeScale(r, r, r).setPosition(x / n, y / n, z / n);
      this.spheres.setMatrixAt(k++, this._m);
    }
    this.spheres.instanceMatrix.needsUpdate = true;
    OCC_BONES.forEach(([a, b], i) => this.bone(this.cyls, i, Q[a], Q[b], (JOINT_R[a] + JOINT_R[b]) / 2));
    this.cyls.instanceMatrix.needsUpdate = true;
  }
  bone(mesh, i, A, B, r) {
    this._v.set(B.x - A.x, B.y - A.y, B.z - A.z);
    const len = this._v.length() || 1e-4;
    this._v.divideScalar(len);
    this._q.setFromUnitVectors(this._up, this._v);
    this._s.set(r, len, r);
    this._p.set((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
    this._m.compose(this._p, this._q, this._s);
    mesh.setMatrixAt(i, this._m);
  }
}

const _m4 = new THREE.Matrix4();
const _v1 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

export class GunRig {
  constructor(ctx) {
    this.ctx = ctx; // { scene, M, tex, debris, shellGeos }
    this.group = new THREE.Group();
    this.kick = new THREE.Group();
    this.holder = new THREE.Group();
    this.group.add(this.kick);
    this.kick.add(this.holder);
    ctx.scene.add(this.group);
    this.models = {};
    this.current = null;
    this.currentId = null;
    this.targetId = null;
    this.swapT = 0;
    this.flash = new MuzzleFlash(ctx.tex);
    this.rec = { z: 0, vz: 0, r: 0, vr: 0, y: 0, vy: 0 };
    this.appear = 0;
    this.shown = false;
    this.slideAnim = 0;
    this.lastReloadId = -1;
    this.magState = 'in';
    this.targetPos = new THREE.Vector3();
    this.targetQuat = new THREE.Quaternion();
    this.hasPose = false;
    this.occluder = new HandOccluder(ctx.scene);
    this.group.visible = false;
  }

  model(id) {
    if (!this.models[id]) {
      const b = buildGun(id, this.ctx.M);
      if (b.mag) b.magBase = b.mag.position.clone();
      if (b.slide) b.slideBase = b.slide.position.clone();
      if (b.bolt) {
        b.boltBase = b.bolt.position.clone();
        b.boltRot = b.bolt.rotation.z;
      }
      this.models[id] = b;
    }
    return this.models[id];
  }

  attach(id) {
    if (this.current) this.holder.remove(this.current.root);
    this.current = this.model(id);
    this.currentId = id;
    this.holder.add(this.current.root);
    this.current.root.add(this.flash.group);
    this.flash.group.position.copy(this.current.muzzle);
    if (this.current.mag) {
      this.current.mag.visible = true;
      this.current.mag.position.copy(this.current.magBase);
    }
    this.magState = 'in';
  }

  setWeapon(id, instant = false) {
    if (id === this.targetId) return;
    this.targetId = id;
    if (!this.current || instant || !this.shown) {
      this.attach(id);
      this.swapT = 0;
    } else {
      this.swapT = 0.34;
    }
  }

  setPose(pos, basis) {
    _m4.makeBasis(
      _v1.set(basis.right.x, basis.right.y, basis.right.z),
      new THREE.Vector3(basis.up.x, basis.up.y, basis.up.z),
      new THREE.Vector3(basis.fwd.x, basis.fwd.y, basis.fwd.z),
    );
    this.targetQuat.setFromRotationMatrix(_m4);
    this.targetPos.set(pos.x, pos.y, pos.z);
    if (!this.hasPose) {
      this.group.position.copy(this.targetPos);
      this.group.quaternion.copy(this.targetQuat);
      this.hasPose = true;
    }
  }

  kickImpulse(def) {
    const k = def.kick;
    this.rec.vz += k.back * rand(26, 34);
    this.rec.vr += k.rise * rand(24, 34);
    this.rec.vy += k.back * rand(-4, 4);
    if (this.current?.slide && def.id === 'pistol') this.slideAnim = 1;
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (!this.current) return out.copy(this.group.position);
    this.group.updateMatrixWorld(true);
    return this.current.root.localToWorld(out.copy(this.current.muzzle));
  }

  forwardWorld(out = new THREE.Vector3()) {
    this.group.updateMatrixWorld(true);
    return out.set(0, 0, 1).applyQuaternion(this.holder.getWorldQuaternion(_q1)).normalize();
  }

  ejectShell(type) {
    if (!this.current) return null;
    const c = this.ctx;
    const mesh = buildShellMesh(type, c.shellGeos, c.M);
    this.group.updateMatrixWorld(true);
    const p = this.current.root.localToWorld(this.current.eject.clone());
    mesh.position.copy(p);
    mesh.quaternion.copy(this.holder.getWorldQuaternion(new THREE.Quaternion()));
    mesh.rotateZ(Math.PI / 2);
    const q = this.holder.getWorldQuaternion(new THREE.Quaternion());
    const speed = type === 'shotgun' ? rand(1.4, 2.0) : rand(1.7, 2.6);
    const vel = new THREE.Vector3(1, rand(0.6, 1.1), rand(-0.4, 0.0)).normalize().multiplyScalar(speed).applyQuaternion(q);
    const ang = new THREE.Vector3(rand(-25, 25), rand(-25, 25), rand(-25, 25));
    c.debris.add(mesh, { vel, ang, life: 1.25, gravity: 9.8, fade: 0.35, landAt: rand(0.45, 0.6), onLand: c.onShellLand, drag: 0.2 });
    return mesh;
  }

  dropMag() {
    const cur = this.current;
    if (!cur?.mag) return;
    this.group.updateMatrixWorld(true);
    const clone = cur.mag.clone(true);
    cur.mag.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    const dir = cur.magDir.clone().applyQuaternion(this.holder.getWorldQuaternion(new THREE.Quaternion()));
    this.ctx.debris.add(clone, {
      vel: dir.multiplyScalar(0.9),
      ang: new THREE.Vector3(rand(-3, 3), rand(-2, 2), rand(-4, 4)),
      life: 1.0,
      gravity: 9.8,
      fade: 0.3,
    });
    cur.mag.visible = false;
    this.magState = 'out';
  }

  // st: WeaponState of the active weapon (or null). show: the hand/viewmodel wants the gun visible.
  update(dt, st, show, hammer = 0) {
    const c = this.ctx;
    // hammer follows the thumb while cocking and falls at once on the shot
    this.hammerK = hammer >= 1 ? 1 : (this.hammerK ?? 0) + (hammer - (this.hammerK ?? 0)) * (1 - Math.exp(-dt * 25));
    if (this.current?.hammer) this.current.hammer.rotation.x = -0.95 * (1 - this.hammerK);
    // render-rate smoothing toward the latest tracked pose
    const a = 1 - Math.exp(-dt * 30);
    this.group.position.lerp(this.targetPos, a);
    this.group.quaternion.slerp(this.targetQuat, a);

    // appear / holster scale
    this.appear = clamp(this.appear + (show ? dt / 0.16 : -dt / 0.12), 0, 1);
    this.shown = this.appear > 0;
    this.group.visible = this.shown;
    let s = smoothstep(0, 1, this.appear);

    // weapon swap: shrink out, attach, grow in
    if (this.swapT > 0) {
      const prev = this.swapT;
      this.swapT = Math.max(0, this.swapT - dt);
      if (prev > 0.17 && this.swapT <= 0.17) this.attach(this.targetId);
      const k = this.swapT > 0.17 ? (this.swapT - 0.17) / 0.17 : 1 - this.swapT / 0.17;
      s *= 0.15 + 0.85 * smoothstep(0, 1, k);
      this.holder.rotation.y = (1 - k) * 0.9;
    } else {
      this.holder.rotation.y = 0;
    }
    this.holder.scale.setScalar(Math.max(0.001, s));

    // recoil spring
    // recoil spring, sub-stepped so a long frame (tab switch, GC pause) cannot make it blow up
    const R = this.rec;
    const K = 520,
      C = 34;
    const steps = Math.ceil(dt / (1 / 240));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      R.vz += (-K * R.z - C * R.vz) * h;
      R.z += R.vz * h;
      R.vr += (-K * R.r - C * R.vr) * h;
      R.r += R.vr * h;
      R.vy += (-K * R.y - C * R.vy) * h;
      R.y += R.vy * h;
    }
    R.r = clamp(R.r, -0.6, 1.2);
    R.z = clamp(R.z, -0.1, 0.2);

    let roll = 0,
      pitch = 0;
    const cur = this.current;
    if (st && cur) {
      const def = st.def;
      // reload choreography
      if (st.reloading) {
        const p = clamp(st.reloadT / st.reloadDur, 0, 1);
        const env = smoothstep(0, 0.15, p) * (1 - smoothstep(0.85, 1, p));
        roll = env * 0.5;
        pitch = env * 0.22;
        if (cur.mag) {
          if (this.lastReloadId !== st.reloadId) {
            this.lastReloadId = st.reloadId;
            this.magState = 'in';
          }
          if (p >= 0.1 && this.magState === 'in') this.dropMag();
          if (p >= 0.42 && this.magState === 'out') {
            this.magState = 'inserting';
            cur.mag.visible = true;
          }
          if (this.magState === 'inserting') {
            const k = smoothstep(0.42, 0.6, p);
            cur.mag.position.copy(cur.magBase).addScaledVector(cur.magDir, (1 - k) * 0.14);
            if (k >= 1) this.magState = 'in';
          }
        }
      } else if (cur.mag && this.magState !== 'in') {
        cur.mag.visible = true;
        cur.mag.position.copy(cur.magBase);
        this.magState = 'in';
      }
      // pistol slide: cycles on each shot, locks back on empty
      if (def.id === 'pistol' && cur.slide) {
        this.slideAnim = Math.max(0, this.slideAnim - dt / 0.07);
        let back = this.slideAnim;
        if (st.ammo === 0 && !(st.reloading && st.reloadT / st.reloadDur > 0.8)) back = Math.max(back, st.ammo === 0 && st.lastShotT >= 0 ? 1 : 0);
        cur.slide.position.z = cur.slideBase.z - back * cur.slideTravel;
      }
      // pump
      if (cur.pump) {
        const total = def.pump;
        const phase = st.cycleT > 0 ? 1 - st.cycleT / total : 0;
        cur.pump.position.z = -Math.sin(Math.PI * clamp(phase / 0.8, 0, 1)) * cur.slideTravel;
      }
      // bolt
      if (cur.bolt) {
        let lift = 0,
          pull = 0;
        let phase = -1;
        if (st.cycleT > 0) phase = 1 - st.cycleT / def.bolt;
        else if (st.reloading && st.reloadEmpty) {
          const p = st.reloadT / st.reloadDur;
          if (p > 0.08 && p < 0.92) phase = p < 0.5 ? 0.25 + (p - 0.08) * 0.6 : 0.5 + (p - 0.5) * 0.6;
        }
        if (phase >= 0) {
          lift = smoothstep(0, 0.15, phase) * (1 - smoothstep(0.7, 0.85, phase));
          pull = smoothstep(0.15, 0.35, phase) * (1 - smoothstep(0.45, 0.65, phase));
        }
        cur.bolt.rotation.z = cur.boltRot - lift * 1.1;
        cur.bolt.position.z = cur.boltBase.z - pull * 0.075;
      }
      // pump-action shotgun kicks the whole gun a touch while racking
      if (def.id === 'shotgun' && st.cycleT > 0) pitch += Math.sin(Math.PI * (1 - st.cycleT / def.pump)) * 0.06;
    }

    this.kick.position.set(0, R.y, -R.z);
    this.kick.rotation.set(-R.r - pitch, 0, roll);
    this.flash.update(dt);
  }

  dispose() {
    this.ctx.scene.remove(this.group);
  }
}
