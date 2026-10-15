// Intro-screen armory: the four guns, lit like a product shot, cycling with a test-fire each.
import * as THREE from 'three';
import { makeMaterials, buildGun, makeEnvironment, makeFxTextures } from './models.js';
import { MuzzleFlash } from './fx.js';
import { WEAPONS } from './config.js';
import { smoothstep } from './util.js';

export function startShowcase(canvas, caption) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return { stop() {} };
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.environment = makeEnvironment(renderer);
  const key = new THREE.DirectionalLight(0xfff1e0, 5.5);
  key.position.set(-1, 2, 2);
  const rim = new THREE.DirectionalLight(0xff6a2a, 3.5);
  rim.position.set(2, 1, -2);
  const fill = new THREE.HemisphereLight(0xb9cbe0, 0x1a1410, 1.4);
  const top = new THREE.DirectionalLight(0xdfe8ff, 2.2);
  top.position.set(0.5, 3, 0.5);
  scene.add(key, rim, fill, top);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.01, 20);
  cam.position.set(0, 0.06, 1.75);
  cam.lookAt(0, 0, 0);

  const M = makeMaterials();
  for (const m of Object.values(M)) if (m.isMeshStandardMaterial) m.envMapIntensity = 1.2;
  const tex = makeFxTextures();
  const guns = WEAPONS.map((w) => {
    const b = buildGun(w.id, M);
    const box = new THREE.Box3().setFromObject(b.root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.add(b.root);
    b.root.position.sub(center);
    holder.add(pivot);
    const fit = 1.2 / Math.max(size.z, 0.2);
    holder.scale.setScalar(Math.min(fit, 6));
    const flash = new MuzzleFlash(tex);
    b.root.add(flash.group);
    flash.group.position.copy(b.muzzle);
    return { def: w, b, holder, pivot, flash, fired: false };
  });

  let idx = 0,
    t = 0,
    last = 0,
    stopped = false;
  const PER = 4.2;
  scene.add(guns[0].holder);
  const setCaption = () => {
    if (!caption) return;
    const d = guns[idx].def;
    caption.innerHTML = `<b>${d.name}</b><span>${d.caliber} · ${d.mag} rounds · ${d.modes.join(' / ').toLowerCase()}</span><em>${idx + 1} / ${guns.length}</em>`;
  };
  setCaption();

  const resize = () => {
    const w = canvas.clientWidth || 480,
      h = canvas.clientHeight || 280;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(ms) {
    if (stopped) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ms - last) / 1000 || 0.016);
    last = ms;
    t += reduce ? 0 : dt;
    const g = guns[idx];
    const local = t % PER;
    const inK = smoothstep(0, 0.45, local),
      outK = 1 - smoothstep(PER - 0.4, PER, local);
    g.pivot.rotation.set(-0.12 + Math.sin(t * 0.7) * 0.04, Math.PI / 2 + Math.sin(t * 0.45) * 0.38 + (1 - inK) * 0.8, 0);
    g.pivot.scale.setScalar(Math.max(0.001, inK * outK));
    // test-fire once per turn: flash plus a small kick
    if (!g.fired && local > PER * 0.5) {
      g.fired = true;
      g.flash.fire(g.def.flash * 1.2);
      g.kick = 1;
    }
    g.kick = Math.max(0, (g.kick || 0) - dt * 6);
    g.b.root.rotation.x = -g.kick * 0.18;
    g.flash.update(dt);
    if (local + dt >= PER && !reduce) {
      scene.remove(g.holder);
      g.fired = false;
      idx = (idx + 1) % guns.length;
      scene.add(guns[idx].holder);
      setCaption();
    }
    renderer.render(scene, cam);
  }
  requestAnimationFrame(frame);
  return {
    stop() {
      stopped = true;
      removeEventListener('resize', resize);
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
