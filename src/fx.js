// Particle pools, muzzle flashes, ejected brass and rigid debris.
import * as THREE from 'three';
import { rand } from './util.js';

const PARTICLE_VS = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aRot;
  varying vec4 vColor;
  varying float vRot;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  }
`;
const PARTICLE_FS = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  varying float vRot;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    vec4 t = texture2D(uMap, p);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

export class Particles {
  constructor(scene, { max = 800, map, additive = true, renderOrder = 10 }) {
    this.max = max;
    this.n = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      uniforms: { uMap: { value: map }, uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    scene.add(this.points);
    this.p = [];
  }

  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.pos.x, y: o.pos.y, z: o.pos.z,
      vx: o.vel?.x || 0, vy: o.vel?.y || 0, vz: o.vel?.z || 0,
      life: 0,
      max: o.life || 0.5,
      s0: o.size0 ?? 0.02,
      s1: o.size1 ?? o.size0 ?? 0.02,
      r: o.color?.r ?? 1, g: o.color?.g ?? 1, b: o.color?.b ?? 1,
      r1: o.color1?.r ?? o.color?.r ?? 1, g1: o.color1?.g ?? o.color?.g ?? 1, b1: o.color1?.b ?? o.color?.b ?? 1,
      a0: o.alpha ?? 1,
      drag: o.drag ?? 0,
      grav: o.gravity ?? 0,
      rot: o.rot ?? rand(0, 6.28),
      spin: o.spin ?? 0,
      fadeIn: o.fadeIn ?? 0,
    });
  }

  update(dt, scale) {
    this.mat.uniforms.uScale.value = scale;
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy = p.vy * k - p.grav * dt;
      p.vz *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.spin * dt;
      P[w++] = p;
    }
    P.length = w;
    for (let i = 0; i < this.max; i++) {
      if (i < w) {
        const p = P[i];
        const t = p.life / p.max;
        this.pos[i * 3] = p.x;
        this.pos[i * 3 + 1] = p.y;
        this.pos[i * 3 + 2] = p.z;
        this.col[i * 4] = p.r + (p.r1 - p.r) * t;
        this.col[i * 4 + 1] = p.g + (p.g1 - p.g) * t;
        this.col[i * 4 + 2] = p.b + (p.b1 - p.b) * t;
        const fin = p.fadeIn ? Math.min(1, p.life / p.fadeIn) : 1;
        this.col[i * 4 + 3] = p.a0 * (1 - t) * fin;
        this.size[i] = p.s0 + (p.s1 - p.s0) * t;
        this.rot[i] = p.rot;
      } else if (i < this.n) {
        this.size[i] = 0;
        this.col[i * 4 + 3] = 0;
      } else break;
    }
    this.n = w;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aRot.needsUpdate = true;
    g.setDrawRange(0, Math.max(w, 1));
  }
}

// Rigid bodies without collisions: brass, dropped magazines, shards, drone wreckage.
export class Debris {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }
  add(mesh, { vel, ang, life = 1.4, gravity = 9.8, fade = 0.3, onLand, landAt, drag = 0.3, dispose = false }) {
    this.scene.add(mesh);
    const mats = [];
    mesh.traverse((o) => {
      if (o.isMesh && fade > 0) {
        if (!o.userData.fadeClone) {
          o.material = o.material.clone();
          o.userData.fadeClone = true;
        }
        o.material.transparent = true;
        mats.push(o.material);
      }
    });
    this.items.push({ mesh, vel: vel.clone(), ang: ang.clone(), life: 0, max: life, gravity, fade, mats, onLand, landAt, landed: false, drag, dispose });
  }
  update(dt) {
    const keep = [];
    for (const d of this.items) {
      d.life += dt;
      if (d.life >= d.max) {
        this.scene.remove(d.mesh);
        if (d.dispose) d.mesh.traverse((o) => o.isMesh && o.geometry.dispose());
        d.mats.forEach((m) => m.dispose());
        continue;
      }
      const k = Math.exp(-d.drag * dt);
      d.vel.multiplyScalar(k);
      d.vel.y -= d.gravity * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.ang.x * dt;
      d.mesh.rotation.y += d.ang.y * dt;
      d.mesh.rotation.z += d.ang.z * dt;
      if (!d.landed && d.landAt != null && d.life >= d.landAt) {
        d.landed = true;
        d.onLand?.(d.mesh);
      }
      const remain = d.max - d.life;
      if (d.fade > 0 && remain < d.fade) for (const m of d.mats) m.opacity = remain / d.fade;
      keep.push(d);
    }
    this.items = keep;
  }
  clear() {
    for (const d of this.items) this.scene.remove(d.mesh);
    this.items = [];
  }
}

// Additive cross-plane flame + star sprite + point light, parented at the muzzle.
export class MuzzleFlash {
  constructor(tex) {
    this.group = new THREE.Group();
    const mk = (map) =>
      new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0.5, 0, 0);
    plane.rotateY(-Math.PI / 2); // extend along +Z
    this.planes = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(plane, mk(tex.flashSide));
      m.rotation.z = (i * Math.PI) / 2;
      m.renderOrder = 20;
      this.group.add(m);
      this.planes.push(m);
    }
    this.starMat = new THREE.SpriteMaterial({ map: tex.flashStar, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true });
    this.star = new THREE.Sprite(this.starMat);
    this.star.renderOrder = 21;
    this.group.add(this.star);
    this.light = new THREE.PointLight(0xffa04a, 0, 2.5, 2);
    this.group.add(this.light);
    this.t = 1;
    this.dur = 0.05;
    this.group.visible = false;
    this.scale = 1;
  }
  fire(scale = 1) {
    this.t = 0;
    this.scale = scale;
    this.group.visible = true;
    this.group.rotation.z = Math.random() * Math.PI;
    const len = 0.11 * scale * rand(0.75, 1.25),
      wid = 0.07 * scale * rand(0.8, 1.2);
    for (const p of this.planes) p.scale.set(wid, wid, len);
    this.starMat.rotation = Math.random() * Math.PI * 2;
    const s = 0.085 * scale * rand(0.8, 1.2);
    this.star.scale.set(s, s, 1);
    this.dur = 0.045 + 0.02 * scale;
  }
  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    const k = 1 - this.t / this.dur;
    if (k <= 0) {
      this.group.visible = false;
      this.light.intensity = 0;
      return;
    }
    for (const p of this.planes) p.material.opacity = k;
    this.starMat.opacity = k;
    this.light.intensity = 6 * this.scale * k;
  }
}
