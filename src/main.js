// Phantom Range: webcam AR shooting range. Hand tracking puts a gun in your hand; gestures run it.
import * as THREE from 'three';
import { WEAPONS, WEAPON_BY_ID, AIM, GESTURE, DRILL_SECONDS } from './config.js';
import { Tracker, ViewModel } from './tracker.js';
import { HandManager } from './hands.js';
import { AudioEngine } from './audio.js';
import { makeMaterials, makeTargetMaterials, makeFxTextures, buildShellGeometries, makeEnvironment } from './models.js';
import { Particles, Debris } from './fx.js';
import { WeaponState, GunRig, tickWeapon, startReload } from './weapons.js';
import { Range } from './range.js';
import { HudCanvas, drawPoseIcon } from './hud.js';
import { POSES } from './poses.js';
import { startShowcase } from './showcase.js';
import { clamp, rand, storage } from './util.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const params = new URLSearchParams(location.search);
const TIME_SCALE = +(params.get('timescale') || 1); // test hook: slow motion

// ---------------------------------------------------------------- settings
const DEFAULTS = {
  gain: AIM.gain,
  point: AIM.point,
  trigger: 'normal',
  laser: true,
  twoGuns: true,
  autoReload: true,
  occlusion: true,
  skeleton: false,
  volume: 0.85,
  muted: false,
  camera: '',
  legend: true,
};
const settings = Object.assign({}, DEFAULTS, storage.get('pr.settings', {}));
if (params.has('debug')) settings.skeleton = true;
const saveSettings = () => storage.set('pr.settings', settings);
const TRIGGER_PRESETS = {
  light: { factor: 0.62, snap: 0.36 },
  normal: { factor: 0.5, snap: 0.45 },
  firm: { factor: 0.36, snap: 0.6 },
};
function applyTrigger() {
  const p = TRIGGER_PRESETS[settings.trigger] || TRIGGER_PRESETS.normal;
  GESTURE.cockFactor = p.factor;
  GESTURE.snapFactor = p.snap;
}
applyTrigger();

// ---------------------------------------------------------------- core objects
const video = $('#cam');
const glCanvas = $('#gl');
const stage = $('#stage');
const view = new ViewModel();
const tracker = new Tracker(video);
const hands = new HandManager(view, settings);
const audio = new AudioEngine();
audio.volume = settings.volume;
audio.muted = settings.muted || params.has('mute');
const hud = new HudCanvas($('#hud'));

let renderer, camera, gunCam, scopeCam, rangeScene, gunScene, scopeScene, scopeBg, videoTex;
let M, T, TEX, shellGeos, lights;
let rangeSparks, rangeDust, rangeDebris, gunSmoke, gunSparks, gunDebris;
let range;
const slots = [];
let W = innerWidth,
  H = innerHeight,
  DPR = 1;

const S = {
  phase: 'intro',
  mode: 'free',
  weaponIdx: 0,
  score: 0,
  streak: 0,
  bestStreak: 0,
  mult: 1,
  shots: 0,
  hits: 0,
  kills: { plate: 0, bottle: 0, clay: 0, drone: 0 },
  drillT: DRILL_SECONDS,
  countdown: 0,
  paused: false,
  shake: 0,
  scopeK: 0,
  t: 0,
  lastHandT: -10,
  tut: null,
  calibrated: false,
  calibPending: false,
  mouseOnly: false,
  mouse: { x: innerWidth / 2, y: innerHeight / 2, held: false, pressed: false, lastMove: -10, scope: false },
  key: { held: false, pressed: false, scope: false },
  light: 1,
  log: [],
};
const log = (type, data = {}) => {
  S.log.push({ t: +S.t.toFixed(3), type, ...data });
  if (S.log.length > 600) S.log.shift();
};

// ---------------------------------------------------------------- graphics
function initGraphics() {
  renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  camera = new THREE.PerspectiveCamera(40, 1, 0.03, 80);
  gunCam = new THREE.PerspectiveCamera(20, 1, 0.1, 200);
  scopeCam = camera.clone();
  rangeScene = new THREE.Scene();
  gunScene = new THREE.Scene();
  const env = makeEnvironment(renderer);
  rangeScene.environment = env;
  gunScene.environment = env;

  lights = {
    rHemi: new THREE.HemisphereLight(0xe9eff6, 0x3b342a, 1.1),
    rKey: new THREE.DirectionalLight(0xfff0dc, 2.0),
    gHemi: new THREE.HemisphereLight(0xe6edf5, 0x2c2620, 0.9),
    gKey: new THREE.DirectionalLight(0xfff3e4, 2.6),
    gRim: new THREE.DirectionalLight(0xa9c6ff, 1.3),
  };
  lights.rKey.position.set(2, 4, 3);
  lights.gKey.position.set(-1.2, 2.2, 2.4);
  lights.gRim.position.set(1.5, 0.6, -2.5);
  rangeScene.add(lights.rHemi, lights.rKey);
  gunScene.add(lights.gHemi, lights.gKey, lights.gRim);

  M = makeMaterials();
  T = makeTargetMaterials();
  TEX = makeFxTextures();
  shellGeos = buildShellGeometries();
  rangeSparks = new Particles(rangeScene, { max: 1600, map: TEX.glow, additive: true, renderOrder: 11 });
  rangeDust = new Particles(rangeScene, { max: 500, map: TEX.smoke, additive: false, renderOrder: 10 });
  rangeDebris = new Debris(rangeScene);
  gunSmoke = new Particles(gunScene, { max: 400, map: TEX.smoke, additive: false, renderOrder: 30 });
  gunSparks = new Particles(gunScene, { max: 300, map: TEX.glow, additive: true, renderOrder: 31 });
  gunDebris = new Debris(gunScene);

  range = new Range({ scene: rangeScene, view, T, tex: TEX, sparks: rangeSparks, dust: rangeDust, debris: rangeDebris, audio, panOf: panOfWorld });

  const onShellLand = (mesh) =>
    audio.play(mesh.userData.shell === 'shotgun' ? 'hull' : 'casing', { pan: panOfX(view.projectGun(mesh.position).x), gain: 0.32, wet: 0.25, priority: 0 });
  for (let i = 0; i < 2; i++) {
    const rig = new GunRig({ scene: gunScene, M, tex: TEX, debris: gunDebris, shellGeos, onShellLand });
    rig.setWeapon(WEAPONS[0].id, true);
    slots.push({ index: i, rig, states: {}, ctrl: null, pressed: false, held: false, swapT: 0, firstShot: false, aim: { x: W / 2, y: H / 2 }, muzzle2: null });
  }

  // scope: the camera image behind a zoomed render of the range
  videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  scopeScene = new THREE.Scene();
  scopeBg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: videoTex, toneMapped: false, depthWrite: false }));
  scopeScene.add(scopeBg);
}

function slotState(slot) {
  const id = WEAPONS[S.weaponIdx].id;
  return (slot.states[id] ||= new WeaponState(WEAPON_BY_ID[id]));
}

function resize() {
  W = innerWidth;
  H = innerHeight;
  DPR = Math.min(devicePixelRatio || 1, perf.dprCap);
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
  glCanvas.style.width = W + 'px';
  glCanvas.style.height = H + 'px';
  view.update(W, H, video.videoWidth || 1280, video.videoHeight || 720);
  camera.fov = view.fovY;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  gunCam.fov = view.fovYGun;
  gunCam.aspect = W / H;
  gunCam.updateProjectionMatrix();
  hud.resize(W, H, DPR);
  // scope background plane: mirrored, cover-cropped camera image across the whole frustum at 40 m
  const D = 40;
  scopeBg.scale.set((W * D) / view.f, (H * D) / view.f, 1);
  scopeBg.position.set(0, 0, -D);
  const uv = scopeBg.geometry.attributes.uv;
  const uL = (W - view.ox) / (view.vw * view.k),
    uR = -view.ox / (view.vw * view.k);
  const vT = 1 + view.oy / (view.vh * view.k),
    vB = 1 - (H - view.oy) / (view.vh * view.k);
  // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0) for TL, TR, BL, BR
  uv.setXY(0, uL, vT);
  uv.setXY(1, uR, vT);
  uv.setXY(2, uL, vB);
  uv.setXY(3, uR, vB);
  uv.needsUpdate = true;
}

function panOfX(x) {
  return clamp((x / W) * 2 - 1, -1, 1) * 0.75;
}
function panOfWorld(p) {
  const s = view.project(p);
  return panOfX(s.x);
}

// ---------------------------------------------------------------- weapons
const hooks = {
  shot: (slot, st) => onShot(slot, st),
  eject: (slot, st) => {
    const m = slot.rig.ejectShell(st.def.shell);
    if (m) m.userData.shell = st.def.shell;
  },
  sound: (slot, name) => audio.play(name, { pan: slot.muzzle2 ? panOfX(slot.muzzle2.x) : 0, gain: 0.75, wet: 0.15 }),
  reloadStart: (st) => log('reloadStart', { w: st.def.id }),
  reloadEnd: (st) => {
    log('reloadEnd', { w: st.def.id, ammo: st.ammo });
    if (S.tut && TUT[S.tut.i]?.id === 'reload') advanceTutorial();
  },
};

function randDisk(r) {
  const a = Math.random() * Math.PI * 2;
  const d = r * Math.sqrt(Math.random()) * (0.6 + 0.4 * Math.random());
  return [Math.cos(a) * d, Math.sin(a) * d];
}

function onShot(slot, st) {
  const def = st.def;
  st.lastShotT = S.t;
  let aim = slot.aim;
  if (slot.firstShot && slot.ctrl && slot.ctrl !== 'mouse') aim = slot.ctrl.aimForShot();
  slot.firstShot = false;
  const scoped = slot.index === 0 && def.id === 'sniper' && S.scopeK > 0.6;
  const spreadFrac = def.id === 'sniper' ? (scoped ? 0 : def.hipSpread) : st.spread;
  const sp = spreadFrac * Math.min(W, H);

  // gun feedback
  const rig = slot.rig;
  rig.kickImpulse(def);
  rig.flash.fire(def.flash);
  const mw = rig.muzzleWorld();
  const fwd = rig.forwardWorld();
  const m2 = view.projectGun(mw);
  slot.muzzle2 = m2;
  for (let i = 0; i < 5 + def.flash * 4; i++)
    gunSmoke.spawn({
      pos: mw,
      vel: { x: fwd.x * rand(0.2, 0.8) + rand(-0.1, 0.1), y: fwd.y * rand(0.2, 0.8) + rand(0.05, 0.25), z: fwd.z * rand(0.2, 0.8) },
      life: rand(0.7, 1.3), size0: 0.025, size1: rand(0.12, 0.22) * def.flash, color: new THREE.Color(0xcfcfcf), alpha: 0.22, drag: 2.5, fadeIn: 0.05,
    });
  for (let i = 0; i < 6 * def.flash; i++)
    gunSparks.spawn({
      pos: mw,
      vel: { x: fwd.x * rand(2, 5) + rand(-0.6, 0.6), y: fwd.y * rand(2, 5) + rand(-0.6, 0.6), z: fwd.z * rand(2, 5) + rand(-0.6, 0.6) },
      life: rand(0.05, 0.14), size0: 0.012, size1: 0.003, color: new THREE.Color(0xffe2a0), color1: new THREE.Color(0xff6a20), gravity: 2,
    });
  if (!scoped) hud.addGlow(m2, def.flash);
  audio.play(def.id, { pan: panOfX(m2.x), gain: def.loud, wet: 0.3, jitter: 0.04 });
  S.shake = Math.min(20, S.shake + def.kick.shake * (scoped ? 1.6 : 1));
  if (def.id === 'pistol' || def.id === 'rifle') {
    const m = rig.ejectShell(def.shell);
    if (m) m.userData.shell = def.shell;
  }

  // ballistics (screen space against the range)
  let anyHit = false,
    pts = 0,
    kill = false;
  const scored = new Map(); // target -> best points this shot (shotgun pellets count once per target)
  for (let i = 0; i < def.pellets; i++) {
    const [ox, oy] = randDisk(sp);
    const x = clamp(aim.x + ox, 0, W),
      y = clamp(aim.y + oy, 0, H);
    const hits = range.pick(x, y, def.pellets > 1 ? 2 : 10);
    if (hits.length) {
      const list = def.pierce ? hits : [hits[0]];
      for (const h of list) {
        const r = range.hit(h, def);
        scored.set(h.tg, Math.max(scored.get(h.tg) || 0, r.points));
        anyHit = true;
        if (r.kill) {
          kill = true;
          S.kills[r.kind] = (S.kills[r.kind] || 0) + 1;
        }
        log('hit', { w: def.id, kind: r.kind, kill: r.kill, x: Math.round(x), y: Math.round(y) });
      }
      if (!scoped && (i === 0 || Math.random() < def.tracer * 0.5)) hud.addTracer(m2, { x, y }, def.id === 'sniper' ? 3 : 2);
    } else {
      if (i < 3) range.miss(x, y);
      if (!scoped && Math.random() < def.tracer) hud.addTracer(m2, { x, y }, def.id === 'sniper' ? 3 : def.pellets > 1 ? 1.2 : 2);
    }
  }
  for (const v of scored.values()) pts += v;
  log('shot', { w: def.id, slot: slot.index, ammo: st.ammo, x: Math.round(aim.x), y: Math.round(aim.y), hit: anyHit });

  const scoring = S.phase === 'free' || S.phase === 'drill' || S.phase === 'tutorial';
  if (scoring) {
    S.shots++;
    if (anyHit) {
      S.hits++;
      S.streak++;
      S.bestStreak = Math.max(S.bestStreak, S.streak);
      const mult = Math.min(4, 1 + Math.floor(S.streak / 5));
      if (mult > S.mult) {
        audio.play('combo', { gain: 0.4, wet: 0.1 });
        toast(`×${mult} multiplier`, 1200);
      }
      S.mult = mult;
      const gained = pts * S.mult;
      S.score += gained;
      hud.addPopup(aim.x, aim.y, `+${gained}`, kill ? 'kill' : 'hit');
      hud.addMarker(aim.x, aim.y, kill);
      audio.play(kill ? 'kill' : 'tick', { gain: kill ? 0.3 : 0.22, wet: 0 });
    } else {
      S.streak = 0;
      S.mult = 1;
    }
  }
  if (S.tut && TUT[S.tut.i]?.id === 'shoot' && anyHit) setTimeout(() => S.tut && TUT[S.tut.i]?.id === 'shoot' && advanceTutorial(), 700);
}

function selectWeapon(idx, quiet = false) {
  idx = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
  if (idx === S.weaponIdx) return;
  const prev = WEAPONS[S.weaponIdx].id;
  for (const slot of slots) {
    const st = slot.states[prev];
    if (st) st.reloading = false;
    slot.held = false;
  }
  S.weaponIdx = idx;
  const def = WEAPONS[idx];
  for (const slot of slots) {
    slot.rig.setWeapon(def.id, !slot.ctrl);
    slot.swapT = slot.ctrl ? 0.34 : 0;
  }
  if (!quiet) {
    audio.play('holster', { gain: 0.5, wet: 0.1 });
    setTimeout(() => audio.play('draw', { gain: 0.55, wet: 0.1 }), 170);
    toast(`${def.name} · ${def.caliber}`, 1400);
  }
  log('switch', { w: def.id });
  if (S.tut && TUT[S.tut.i]?.id === 'switch') setTimeout(() => S.tut && advanceTutorial(), 900);
}

function toggleFireMode() {
  const def = WEAPONS[S.weaponIdx];
  if (def.modes.length < 2) {
    toast(`${def.short} has one fire mode`, 1000);
    return;
  }
  let mode;
  for (const slot of slots) {
    const st = slotState(slot);
    st.modeIdx = (st.modeIdx + 1) % def.modes.length;
    st.burstLeft = 0;
    mode = st.mode;
  }
  audio.play('mode', { gain: 0.6, wet: 0.05 });
  toast(`Fire mode: ${mode}`, 1100);
  log('mode', { mode });
}

function reloadSlot(slot) {
  const st = slotState(slot);
  const ok = startReload(st, hooks);
  if (!ok && !st.reloading) toast('Magazine is full', 900);
  log('reloadReq', { ok });
}

// ---------------------------------------------------------------- hands -> slots
function assignSlots() {
  const gunTracks = hands.tracks.filter((tr) => tr.pose === 'gun').sort((a, b) => a.firstSeen - b.firstSeen);
  for (const slot of slots) {
    if (slot.ctrl && slot.ctrl !== 'mouse' && !gunTracks.includes(slot.ctrl)) {
      slot.ctrl = null;
      slot.held = false;
    }
  }
  if (gunTracks.length && slots[0].ctrl === 'mouse') slots[0].ctrl = null;
  for (const tr of gunTracks) {
    if (slots.some((s) => s.ctrl === tr)) continue;
    const free = slots.find((s, i) => !s.ctrl && (i === 0 || settings.twoGuns));
    if (!free) break;
    free.ctrl = tr;
    free.held = false;
    free.pressed = false;
    free.aimLive = false;
    free.rig.hasPose = false;
    // A second gun gets its own zero so its crosshair starts beside the first one instead of off-screen.
    if (free.index === 1 && !tr.calib && tr.anchor2) {
      const other = slots[0].ctrl && slots[0].ctrl !== 'mouse' ? slots[0].ctrl.anchor2 : { x: W / 2 };
      const side = tr.anchor2.x >= other.x ? 1 : -1;
      tr.calib = { P0: { x: tr.anchor2.x - (side * 0.12 * W) / tr.pxGain(view, settings), y: tr.anchor2.y }, D0: { ...tr.dir2 } };
      tr.fAim.reset();
      tr.aimHist.clear();
    }
    free.rig.setWeapon(WEAPONS[S.weaponIdx].id, true);
    free.swapT = 0;
  }
  // mouse / keyboard fallback drives slot 0 when no hand holds a gun
  const s0 = slots[0];
  const mouseRecent = S.t - S.mouse.lastMove < 4 || S.mouse.held || S.mouseOnly;
  if (!s0.ctrl && mouseRecent && !gunTracks.length) {
    s0.ctrl = 'mouse';
    s0.rig.hasPose = false;
  } else if (s0.ctrl === 'mouse' && !mouseRecent) s0.ctrl = null;
}

function handleEvents(events) {
  for (const e of events) {
    const slot = slots.find((s) => s.ctrl === e.track);
    log('gesture', { g: e.type, hand: e.id });
    switch (e.type) {
      case 'fire':
        if (slot) {
          slot.pressed = true;
          slot.held = true;
          slot.firstShot = true;
        }
        break;
      case 'release':
        if (slot) slot.held = false;
        break;
      case 'reload':
        if (S.phase === 'results') break;
        reloadSlot(slot || slots[0]);
        break;
      case 'switch':
        if (S.phase === 'results') {
          startMode('drill');
          break;
        }
        if (isLive()) selectWeapon(S.weaponIdx + 1);
        break;
      case 'mode':
        if (isLive() && WEAPONS[S.weaponIdx].modes.length > 1) toggleFireMode();
        break;
      case 'draw':
        if (isLive()) audio.play('draw', { pan: panOfX(e.track.center.x), gain: 0.45, wet: 0.1 });
        break;
    }
  }
}

const isLive = () => ['tutorial', 'countdown', 'free', 'drill'].includes(S.phase) && !S.paused;

const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
function updateSlots(dt) {
  const live = isLive();
  for (const slot of slots) {
    const st = slotState(slot);
    const ctrl = slot.ctrl;
    let pressed = slot.pressed,
      held = slot.held;
    if (ctrl === 'mouse') {
      pressed = S.mouse.pressed;
      held = S.mouse.held;
    }
    if (slot.index === 0) {
      pressed = pressed || S.key.pressed;
      held = held || S.key.held;
    }
    slot.pressed = false;
    if (ctrl && ctrl !== 'mouse') {
      // Camera frames arrive at 30 fps or less; carry the crosshair forward and ease it at display rate
      // so it glides instead of stepping.
      const p = ctrl.predictAim(S.t);
      // a longer glide when the camera delivers few frames, so the crosshair never jumps
      const tau = clamp(0.6 * hands.frameGap, AIM.renderSmooth, 0.1);
      const k = slot.aimLive ? 1 - Math.exp(-dt / tau) : 1;
      slot.aim = { x: slot.aim.x + (p.x - slot.aim.x) * k, y: slot.aim.y + (p.y - slot.aim.y) * k };
      slot.aimLive = true;
    } else {
      slot.aimLive = false;
      if (ctrl === 'mouse') slot.aim = { x: S.mouse.x, y: S.mouse.y };
    }
    slot.swapT = Math.max(0, slot.swapT - dt);
    const input = live && ctrl ? { pressed, held } : { pressed: false, held: false };
    if (ctrl || st.reloading || st.cycleT > 0) tickWeapon(slot, st, dt, input, hooks, settings);

    // pose
    const rig = slot.rig;
    if (ctrl && ctrl !== 'mouse' && ctrl.Qg) {
      const o = ctrl.predictOffset(S.t);
      const Q = ctrl.Qg.map((q) => ({ x: q.x + o.x, y: q.y + o.y, z: q.z + o.z }));
      rig.setPose(Q[5], ctrl.basis);
      rig.occluder.update(Q, settings.occlusion && rig.shown);
    } else {
      if (ctrl === 'mouse') {
        const p = view.unprojectGun(W * 0.6, H * 0.97, 0.5 * view.gk);
        const target = view.unprojectGun(slot.aim.x, slot.aim.y, 8 * view.gk);
        const f = new THREE.Vector3(target.x - p.x, target.y - p.y, target.z - p.z).normalize();
        const up0 = new THREE.Vector3(0, 1, 0);
        const r = new THREE.Vector3().crossVectors(up0, f).normalize();
        const u = new THREE.Vector3().crossVectors(f, r).normalize();
        rig.setPose(p, { right: r, up: u, fwd: f });
      }
      rig.occluder.update(null, false);
    }
    const hideForScope = slot.index === 0 && S.scopeK > 0.85;
    const hammer = ctrl && ctrl !== 'mouse' ? (ctrl.trigger ? 1 : ctrl.pull) : slot.index === 0 && (S.mouse.held || S.key.held) ? 1 : 0;
    rig.update(dt, st, !!ctrl && !hideForScope && S.phase !== 'intro' && S.phase !== 'results', hammer);
    slot.muzzle2 = rig.shown ? view.projectGun(rig.muzzleWorld(_pos)) : null;
    if (slot.muzzle2) {
      // how visibly the barrel points toward the crosshair on screen (0 = away or straight at the camera)
      const back = view.projectGun(_pos.addScaledVector(rig.forwardWorld(_fwd), -0.12));
      const bx = slot.muzzle2.x - back.x,
        by = slot.muzzle2.y - back.y;
      const ax = slot.aim.x - slot.muzzle2.x,
        ay = slot.aim.y - slot.muzzle2.y;
      const bl = Math.hypot(bx, by),
        al = Math.hypot(ax, ay) || 1;
      slot.laserK = bl < 4 ? 0 : clamp(((bx * ax + by * ay) / (bl * al) - 0.2) / 0.6, 0, 1) * clamp(bl / 40, 0, 1);
    }
  }
  S.key.pressed = false;
  S.mouse.pressed = false;
}

function updateScope(dt) {
  const s0 = slots[0];
  const st = slotState(s0);
  let want = false;
  if (st.def.id === 'sniper' && s0.ctrl && isLive() && !st.reloading) {
    if (s0.ctrl === 'mouse') want = S.mouse.scope || S.key.scope;
    else want = s0.ctrl.steady || S.key.scope;
  }
  const prev = S.scopeK;
  S.scopeK = clamp(S.scopeK + (want ? dt / 0.16 : -dt / 0.12), 0, 1);
  if (prev === 0 && S.scopeK > 0) audio.play('scope', { gain: 0.5, wet: 0.05 });
}

// ---------------------------------------------------------------- tutorial + modes
const TUT = [
  { id: 'draw', title: 'Make a finger gun', sub: 'Index finger out, thumb up, other fingers curled. Hold it in front of the camera and keep it still for a second to lock your aim.' },
  { id: 'shoot', title: 'Aim at the plate. Drop your thumb to fire.', sub: 'Move your hand to steer the crosshair. Snap your thumb down onto your index finger, then lift it to cock the hammer again.' },
  { id: 'reload', title: 'Point at the ceiling to reload', sub: 'Tip your finger gun straight up for a moment. An empty magazine also reloads by itself.' },
  { id: 'switch', title: 'Open your palm to switch weapons', sub: 'Hold a flat open hand until the ring fills. Keep holding to cycle through pistol, carbine, shotgun and sniper.' },
];

function startTutorial() {
  S.phase = 'tutorial';
  S.tut = { i: 0, t: 0 };
  resetScore();
  selectWeapon(0, true);
  for (const s of slots) s.states = {};
  range.setMode('tutorial');
  showOfficer();
  log('tutorial', { step: 'draw' });
}

function advanceTutorial() {
  if (!S.tut) return;
  S.tut.i++;
  S.tut.t = 0;
  audio.play('ui', { gain: 0.5, wet: 0 });
  if (S.tut.i >= TUT.length) {
    S.tut = null;
    storage.set('pr.tutorialDone', true);
    $('#officer').hidden = true;
    toast('Range is hot', 1600);
    startMode(S.mode);
    return;
  }
  const step = TUT[S.tut.i];
  if (step.id === 'reload') {
    for (const s of slots) {
      const st = slotState(s);
      st.ammo = Math.min(st.ammo, 3);
    }
  }
  log('tutorial', { step: step.id });
  showOfficer();
}

function showOfficer() {
  const step = TUT[S.tut.i];
  $('#officer').hidden = false;
  $('#tut-step').textContent = `Step ${S.tut.i + 1} of ${TUT.length}`;
  $('#tut-title').textContent = step.title;
  $('#tut-sub').textContent = step.sub;
}

function updateTutorial(dt) {
  if (!S.tut) return;
  S.tut.t += dt;
  const step = TUT[S.tut.i];
  const c = slots[0].ctrl;
  if (step.id === 'draw') {
    if (c === 'mouse') advanceTutorial();
    else if (c && c.steadyT > 0.55) {
      hands.calibrate(c);
      S.calibrated = true;
      S.calibPending = false;
      toast('Aim locked to the center', 1400);
      log('calibrated');
      advanceTutorial();
    }
  }
}

function resetScore() {
  Object.assign(S, { score: 0, streak: 0, bestStreak: 0, mult: 1, shots: 0, hits: 0, kills: { plate: 0, bottle: 0, clay: 0, drone: 0 } });
}

function startMode(mode) {
  S.mode = mode;
  $('#results').hidden = true;
  $('#officer').hidden = true;
  S.tut = null;
  resetScore();
  for (const s of slots) s.states = {};
  range.setMode(mode);
  if (!S.calibrated && !S.mouseOnly) S.calibPending = true;
  if (mode === 'drill') {
    S.phase = 'countdown';
    S.countdown = 3;
    S.drillT = DRILL_SECONDS;
    S.lastBeep = 4;
  } else {
    S.phase = 'free';
  }
  log('mode', { mode });
  updateHudStatic();
}

function endDrill() {
  S.phase = 'results';
  range.silence();
  audio.play('horn', { gain: 0.7, wet: 0.3 });
  const best = storage.get('pr.bestDrill', 0);
  const isBest = S.score > best;
  if (isBest) storage.set('pr.bestDrill', S.score);
  const acc = S.shots ? Math.round((S.hits / S.shots) * 100) : 0;
  const rank = S.score >= 2400 ? 'Expert' : S.score >= 1400 ? 'Sharpshooter' : S.score >= 600 ? 'Marksman' : 'Plinker';
  $('#res-rank').textContent = rank;
  $('#res-score').textContent = S.score.toLocaleString();
  $('#res-best').textContent = isBest ? 'New personal best' : `Best ${Math.max(best, S.score).toLocaleString()}`;
  $('#res-acc').textContent = `${acc}%`;
  $('#res-hits').textContent = `${S.hits} / ${S.shots}`;
  $('#res-streak').textContent = S.bestStreak;
  $('#res-clays').textContent = S.kills.clay || 0;
  $('#res-drones').textContent = S.kills.drone || 0;
  $('#res-bottles').textContent = S.kills.bottle || 0;
  $('#results').hidden = false;
  log('drillEnd', { score: S.score, acc });
}

function updatePhase(dt) {
  if (S.phase === 'countdown') {
    S.countdown -= dt;
    const n = Math.ceil(S.countdown);
    if (n < S.lastBeep && n >= 1) {
      S.lastBeep = n;
      audio.play('beep', { gain: 0.6, wet: 0.05 });
    }
    $('#countdown').hidden = false;
    $('#countdown').textContent = n >= 1 ? n : 'GO';
    if (S.countdown <= 0) {
      audio.play('beepHi', { gain: 0.6, wet: 0.05 });
      S.phase = 'drill';
      setTimeout(() => ($('#countdown').hidden = true), 450);
      resetScore();
    }
  } else if (S.phase === 'drill') {
    S.drillT -= dt;
    if (S.drillT <= 0) {
      S.drillT = 0;
      endDrill();
    }
  }
  // first-time aim lock for players who skipped the tutorial
  const c = slots[0].ctrl;
  if (S.calibPending && c && c !== 'mouse' && isLive()) {
    if (c.steadyT > 0.6) {
      hands.calibrate(c);
      S.calibrated = true;
      S.calibPending = false;
      toast('Aim locked to the center', 1300);
      audio.play('ui', { gain: 0.5, wet: 0 });
      log('calibrated');
    }
  }
}

// ---------------------------------------------------------------- render
function render(dt) {
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  renderer.clear();
  renderer.render(rangeScene, camera);
  if (S.scopeK < 0.85) {
    renderer.clearDepth();
    renderer.render(gunScene, gunCam);
  }
  if (S.scopeK > 0) renderScope();
}

function renderScope() {
  const st = slotState(slots[0]);
  const zoom = st.def.zoom || 3;
  const R = Math.min(W, H) * 0.42;
  const cx = W / 2,
    cy = H / 2;
  const aim = slots[0].aim;
  scopeCam.copy(camera);
  scopeCam.setViewOffset(W, H, aim.x - R / zoom, aim.y - R / zoom, (2 * R) / zoom, (2 * R) / zoom);
  scopeCam.aspect = 1;
  scopeCam.updateProjectionMatrix();
  renderer.setScissorTest(true);
  renderer.setScissor(cx - R, H - cy - R, 2 * R, 2 * R);
  renderer.setViewport(cx - R, H - cy - R, 2 * R, 2 * R);
  renderer.clear();
  renderer.render(scopeScene, scopeCam);
  renderer.clearDepth();
  const base = rangeSparks.mat.uniforms.uScale.value;
  rangeSparks.mat.uniforms.uScale.value = base * zoom;
  rangeDust.mat.uniforms.uScale.value = base * zoom;
  renderer.render(rangeScene, scopeCam);
  rangeSparks.mat.uniforms.uScale.value = base;
  rangeDust.mat.uniforms.uScale.value = base;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
}

// Match virtual lighting to how bright the room is.
const lumCanvas = document.createElement('canvas');
lumCanvas.width = 24;
lumCanvas.height = 14;
const lumCtx = lumCanvas.getContext('2d', { willReadFrequently: true });
let lumT = 0;
function updateLighting(dt) {
  lumT -= dt;
  if (lumT <= 0 && video.readyState >= 2) {
    lumT = 0.5;
    try {
      lumCtx.drawImage(video, 0, 0, 24, 14);
      const d = lumCtx.getImageData(0, 0, 24, 14).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const lum = s / (d.length / 4) / 255;
      S.lum = lum;
      S.lightTarget = clamp(0.72 + lum * 0.55, 0.75, 1.2);
    } catch {
      S.lightTarget = 1;
    }
  }
  S.light += ((S.lightTarget || 1) - S.light) * (1 - Math.exp(-dt * 2));
  const k = S.light;
  lights.rHemi.intensity = 1.1 * k;
  lights.rKey.intensity = 2.0 * k;
  lights.gHemi.intensity = 0.9 * k;
  lights.gKey.intensity = 2.6 * k;
  lights.gRim.intensity = 1.3 * k;
}

// ---------------------------------------------------------------- HUD (DOM)
const el = {};
function cacheEls() {
  for (const id of [
    'score', 'mult', 'streak', 'acc', 'best-line', 'timer', 'time', 'timebar', 'wpn-name', 'wpn-cal', 'wpn-mode', 'ammo', 'ammo-max',
    'pips', 'ammo2', 'track-text', 'track-chip', 'toast', 'hint', 'legend', 'countdown', 'slots',
  ])
    el[id] = document.getElementById(id);
}
const setText = (e, v) => {
  if (e && e._v !== v) {
    e._v = v;
    e.textContent = v;
  }
};
let toastTimer = 0;
function toast(msg, ms = 1500) {
  const t = el.toast;
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function updateHudStatic() {
  const best = storage.get('pr.bestDrill', 0);
  setText(el['best-line'], S.mode === 'drill' ? `BEST ${best.toLocaleString()}` : 'FREE RANGE');
  el.timer.hidden = S.mode !== 'drill';
}

let lastPipKey = '';
function updateHud() {
  setText(el.score, S.score.toLocaleString());
  setText(el.mult, `×${S.mult}`);
  el.mult.classList.toggle('hot', S.mult > 1);
  setText(el.streak, `STREAK ${S.streak}`);
  setText(el.acc, S.shots ? `ACC ${Math.round((S.hits / S.shots) * 100)}%` : 'ACC —');
  if (S.mode === 'drill') {
    const t = S.phase === 'countdown' ? DRILL_SECONDS : S.drillT;
    setText(el.time, t.toFixed(1));
    el.timebar.style.transform = `scaleX(${t / DRILL_SECONDS})`;
    el.timer.classList.toggle('low', t < 10 && S.phase === 'drill');
  }
  const def = WEAPONS[S.weaponIdx];
  const st0 = slotState(slots[0]);
  setText(el['wpn-name'], def.name);
  setText(el['wpn-cal'], def.caliber);
  setText(el['wpn-mode'], st0.mode);
  setText(el.ammo, String(st0.ammo));
  setText(el['ammo-max'], String(def.mag));
  el.ammo.classList.toggle('empty', st0.ammo === 0);
  const pipKey = def.id + ':' + st0.ammo + ':' + st0.reloading;
  if (pipKey !== lastPipKey) {
    lastPipKey = pipKey;
    let html = '';
    for (let i = 0; i < def.mag; i++) html += `<i class="${i < st0.ammo ? '' : 'spent'}"></i>`;
    el.pips.innerHTML = html;
    el.pips.dataset.w = def.id;
    for (const s of el.slots.children) s.classList.toggle('on', s.dataset.w === def.id);
  }
  const s1 = slots[1];
  if (s1.ctrl) {
    el.ammo2.hidden = false;
    setText(el.ammo2, `Second gun ${slotState(s1).ammo} / ${def.mag}`);
  } else el.ammo2.hidden = true;

  // tracking chip
  const n = hands.tracks.length;
  let txt,
    cls = 'ok';
  if (S.mouseOnly) {
    txt = 'MOUSE MODE';
    cls = 'idle';
  } else if (!tracker.ready) {
    txt = 'STARTING';
    cls = 'idle';
  } else if (n === 0) {
    txt = 'NO HAND IN VIEW';
    cls = S.t - S.lastHandT > 1.2 ? 'warn' : 'ok';
  } else {
    txt = `${n} HAND${n > 1 ? 'S' : ''} · ${Math.round(tracker.fps)} FPS${tracker.delegate === 'CPU' ? ' · CPU' : ''}`;
  }
  setText(el['track-text'], txt);
  el['track-chip'].dataset.state = cls;
  const showHint = isLive() && !S.mouseOnly && tracker.ready && S.t - S.lastHandT > 2.5 && !slots[0].ctrl;
  el.hint.hidden = !showHint;
  if (showHint)
    setText(
      el.hint,
      S.lum != null && S.lum < 0.13
        ? 'The room is too dark for hand tracking. Face a lamp or window and try again.'
        : "Raise your hand into the camera's view and make a finger gun",
    );

  // legend highlight
  const tr = hands.tracks[0];
  let active = '';
  if (tr) {
    if (tr.pose === 'palm') active = 'switch';
    else if (tr.pose === 'fist') active = 'mode';
    else if (tr.pose === 'gun') {
      if (tr.pointingUp) active = 'reload';
      else if (tr.trigger) active = 'fire';
      else if (def.id === 'sniper' && S.scopeK > 0.5) active = 'scope';
      else active = 'aim';
    }
  }
  if (active !== el.legend._active) {
    el.legend._active = active;
    for (const li of el.legend.querySelectorAll('li')) li.classList.toggle('on', li.dataset.g === active);
  }
}

function hudState() {
  const guns = [];
  const def = WEAPONS[S.weaponIdx];
  for (const slot of slots) {
    if (!slot.ctrl || !slot.rig.shown) continue;
    const st = slotState(slot);
    const tr = slot.ctrl !== 'mouse' ? slot.ctrl : null;
    guns.push({
      aim: slot.aim,
      muzzle: slot.muzzle2,
      def,
      spread: def.id === 'sniper' ? def.hipSpread * 0.4 : st.spread,
      pull: tr ? tr.pull : null,
      triggerDown: tr ? tr.trigger : slot.index === 0 && (S.mouse.held || S.key.held),
      reload: st.reloading ? clamp(st.reloadT / st.reloadDur, 0, 1) : null,
      empty: st.ammo === 0 && !st.reloading,
      low: st.ammo > 0 && st.ammo <= Math.max(1, Math.floor(def.mag * 0.2)) && !st.reloading,
      steadyP: tr && def.id === 'sniper' && S.scopeK === 0 ? clamp(tr.steadyT / GESTURE.steadyHold, 0, 1) : 0,
      hideLaser: !tr,
      laserK: slot.laserK ?? 1,
    });
  }
  const rings = [];
  for (const tr of hands.tracks) {
    if (!tr.obs) continue;
    if (tr.pose === 'palm' && isLive()) {
      const p = tr.palmT < GESTURE.palmHold ? tr.palmT / GESTURE.palmHold : (tr.palmT - (tr.palmNext - GESTURE.palmRepeat)) / GESTURE.palmRepeat;
      rings.push({ x: tr.center.x, y: tr.center.y, p, label: `SWITCH → ${WEAPONS[(S.weaponIdx + 1) % WEAPONS.length].short}` });
    } else if (tr.pose === 'palm' && S.phase === 'results') {
      rings.push({ x: tr.center.x, y: tr.center.y, p: tr.palmT / GESTURE.palmHold, label: 'RUN IT AGAIN' });
    } else if (tr.pose === 'fist' && isLive() && def.modes.length > 1 && !tr.fistFired) {
      const st = slotState(slots[0]);
      rings.push({ x: tr.center.x, y: tr.center.y, p: tr.fistT / GESTURE.fistHold, label: `MODE → ${def.modes[(st.modeIdx + 1) % def.modes.length]}` });
    }
  }
  let scope = null;
  if (S.scopeK > 0) scope = { cx: W / 2, cy: H / 2, r: Math.min(W, H) * 0.42, k: S.scopeK, zoom: def.zoom || 3 };
  let calib = null;
  const c = slots[0].ctrl;
  if ((S.calibPending || (S.tut && TUT[S.tut.i]?.id === 'draw')) && c && c !== 'mouse') {
    calib = { x: c.aim.x, y: c.aim.y, p: clamp(c.steadyT / 0.6, 0, 1) };
  }
  let skeletons = null;
  if (settings.skeleton)
    skeletons = hands.tracks
      .filter((t) => t.P)
      .map((t) => ({
        P: t.P,
        lines: [
          `${t.pose.toUpperCase()}${t.trigger ? ' · TRIGGER' : ''}${t.pointingUp ? ' · UP' : ''}`,
          `thumb ${t.metrics.u.toFixed(2)} / fire < ${t.thrDown.toFixed(2)} (cocked ${t.cockRef.toFixed(2)}, fired ${t.downRef.toFixed(2)})`,
          `ext i${t.metrics.ext.i.toFixed(2)} m${t.metrics.ext.m.toFixed(2)} r${t.metrics.ext.r.toFixed(2)} p${t.metrics.ext.p.toFixed(2)}`,
          `depth ${t.depth.toFixed(2)} m`,
        ],
      }));
  return { guns, rings, scope, calib, skeletons, laser: settings.laser };
}

// ---------------------------------------------------------------- main loop
let lastMs = 0;
// Resolution steps down if the machine cannot hold a steady frame rate, so motion stays fluid.
const perf = { dprCap: 1.75, ema: 1 / 60, slowT: 0 };
function watchFrameRate(realDt) {
  if (realDt <= 0 || realDt > 0.25 || !isLive()) return;
  perf.ema += (realDt - perf.ema) * 0.05;
  perf.slowT = perf.ema > 1 / 42 ? perf.slowT + realDt : 0;
  if (perf.slowT > 2.5 && perf.dprCap > 1 && (devicePixelRatio || 1) > 1) {
    perf.dprCap = Math.max(1, Math.min(perf.dprCap, devicePixelRatio || 1) - 0.25);
    perf.slowT = 0;
    perf.ema = 1 / 60;
    resize();
    log('quality', { dpr: perf.dprCap });
  }
}

function frame(ms) {
  requestAnimationFrame(frame);
  const realDt = (ms - lastMs) / 1000;
  const dt = Math.min(0.1, Math.max(0, realDt)) * TIME_SCALE;
  lastMs = ms;
  watchFrameRate(realDt);
  if (!dt) return;
  S.t = ms / 1000;
  if (S.phase !== 'intro' && S.phase !== 'loading' && tracker.ready && !S.mouseOnly) {
    for (const det of tracker.poll()) hands.ingest(det.res, det.t);
    hands.prune(performance.now() / 1000);
    if (hands.tracks.length) S.lastHandT = S.t;
  }
  assignSlots();
  handleEvents(hands.drain());
  updateScope(dt);
  updateSlots(dt);
  if (!S.paused && S.phase !== 'results' && S.phase !== 'intro') {
    range.update(dt, S.t);
    updateTutorial(dt);
    updatePhase(dt);
  }
  const bh = renderer.getDrawingBufferSize(_v2).y;
  const scale = bh / (2 * Math.tan(((camera.fov / 2) * Math.PI) / 180));
  const gscale = bh / (2 * Math.tan(((gunCam.fov / 2) * Math.PI) / 180));
  rangeSparks.update(dt, scale);
  rangeDust.update(dt, scale);
  gunSmoke.update(dt, gscale);
  gunSparks.update(dt, gscale);
  rangeDebris.update(dt);
  gunDebris.update(dt);
  updateLighting(dt);

  S.shake *= Math.exp(-dt * 14);
  if (S.shake > 0.3) stage.style.transform = `translate3d(${((Math.random() - 0.5) * S.shake).toFixed(1)}px,${((Math.random() - 0.5) * S.shake).toFixed(1)}px,0)`;
  else if (stage.style.transform) stage.style.transform = '';

  // Nothing in the 3D scene is visible behind the menu or the loading card; skipping it leaves the
  // CPU and GPU to the tracker while it compiles and to the intro's own preview.
  if (S.phase === 'intro' || S.phase === 'loading') {
    if (!S.idleCleared) {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, W, H);
      renderer.clear();
      hud.draw({ guns: [], rings: [], scope: null, calib: null, skeletons: null, laser: false });
      S.idleCleared = true;
    }
    return;
  }
  S.idleCleared = false;
  render(dt);
  hud.update(dt);
  hud.draw(hudState());
  updateHud();
}
const _v2 = new THREE.Vector2();

// ---------------------------------------------------------------- boot + UI
function setLoadStep(id, state, pct) {
  const li = document.querySelector(`#load-steps [data-step="${id}"]`);
  if (!li) return;
  li.dataset.state = state;
  if (pct != null) li.querySelector('i').style.transform = `scaleX(${pct})`;
}

function cameraError(e) {
  const name = e?.name || '';
  if (e?.code === 'nocamapi' || !window.isSecureContext)
    return {
      title: 'Camera needs a secure page',
      body: 'Browsers only allow webcam access on https:// pages or on localhost. Open the hosted link, or serve this file with a local server (for example: npx serve).',
    };
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return { title: 'Camera access is blocked', body: 'Click the camera icon in the address bar, choose Allow, then press Try again.' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return { title: 'No camera found', body: 'Plug in or enable a webcam, then press Try again. You can also play with the mouse.' };
  if (name === 'NotReadableError' || name === 'AbortError')
    return { title: 'The camera is busy', body: 'Another app (Zoom, Teams, Meet, OBS) is using the webcam. Close it, then press Try again.' };
  return { title: 'Could not start the camera', body: String(e?.message || e) };
}

function showError(info, canRetry = true) {
  $('#loading').hidden = true;
  $('#err-title').textContent = info.title;
  $('#err-body').textContent = info.body;
  $('#err-retry').hidden = !canRetry;
  $('#error').hidden = false;
  log('error', { title: info.title });
}

let booting = false;
let showcase = null;
async function boot(mode, { mouseOnly = false } = {}) {
  if (booting) return;
  booting = true;
  audio.unlock();
  S.mode = mode;
  S.mouseOnly = mouseOnly;
  $('#intro').hidden = true;
  showcase?.stop();
  showcase = null;
  $('#error').hidden = true;
  $('#loading').hidden = false;
  S.phase = 'loading';
  document.body.classList.add('playing');
  requestAnimationFrame(drawIcons);
  const soundP = audio.load((p) => setLoadStep('sound', p < 1 ? 'busy' : 'done', p));
  try {
    if (!mouseOnly) {
      setLoadStep('camera', 'busy');
      if (!tracker.stream || !tracker.stream.active) await tracker.startCamera(settings.camera);
      setLoadStep('camera', 'done', 1);
      resize();
      populateCameras();
      setLoadStep('engine', 'busy');
      if (!tracker.ready)
        await tracker.init((stage2, p) => {
          if (stage2 === 'engine') setLoadStep('engine', p < 1 ? 'busy' : 'done', p);
          if (stage2 === 'model') setLoadStep('model', p < 1 ? 'busy' : 'done', p);
        });
      setLoadStep('engine', 'done', 1);
      setLoadStep('model', 'done', 1);
    } else {
      for (const s of ['camera', 'engine', 'model']) setLoadStep(s, 'skip', 1);
    }
  } catch (e) {
    booting = false;
    console.error(e);
    if (!tracker.stream && !mouseOnly) showError(cameraError(e));
    else showError({ title: 'Hand tracking failed to load', body: `${e?.message || e}. Check your connection and try again, or play with the mouse.` });
    return;
  }
  await soundP;
  setLoadStep('sound', 'done', 1);
  $('#loading').hidden = true;
  booting = false;
  document.body.classList.toggle('mouse-only', mouseOnly);
  if (!storage.get('pr.tutorialDone', false) && !mouseOnly && !params.has('skiptut')) startTutorial();
  else startMode(mode);
}

async function populateCameras() {
  const cams = await tracker.listCameras();
  const sel = $('#s-cam');
  sel.innerHTML = '';
  cams.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = c.deviceId;
    o.textContent = c.label || `Camera ${i + 1}`;
    if (c.deviceId === tracker.deviceId) o.selected = true;
    sel.appendChild(o);
  });
}

function openSettings(open) {
  $('#settings').hidden = !open;
  S.paused = open && S.phase !== 'intro';
  if (open) syncSettingsUI();
}

function syncSettingsUI() {
  $('#s-gain').value = settings.gain;
  $('#s-point').value = settings.point;
  $('#s-vol').value = settings.volume;
  $('#s-laser').checked = settings.laser;
  $('#s-two').checked = settings.twoGuns;
  $('#s-auto').checked = settings.autoReload;
  $('#s-occ').checked = settings.occlusion;
  $('#s-skel').checked = settings.skeleton;
  for (const r of $$('input[name="s-trig"]')) r.checked = r.value === settings.trigger;
  $('#o-gain').textContent = (+settings.gain).toFixed(2) + '×';
  $('#o-point').textContent = Math.round(settings.point * 100) + '%';
  $('#o-vol').textContent = Math.round(settings.volume * 100) + '%';
}

function bindUI() {
  cacheEls();
  drawIcons();
  const best = storage.get('pr.bestDrill', 0);
  $('#best-drill').textContent = best ? `Best ${best.toLocaleString()}` : 'No score yet';
  $('#go-free').onclick = () => boot('free');
  $('#go-drill').onclick = () => boot('drill');
  $('#go-mouse').onclick = () => boot('free', { mouseOnly: true });
  $('#err-retry').onclick = () => boot(S.mode);
  $('#err-mouse').onclick = () => boot(S.mode, { mouseOnly: true });
  $('#tut-skip').onclick = () => advanceTutorial();
  $('#again').onclick = () => startMode('drill');
  $('#to-free').onclick = () => startMode('free');
  $('#btn-settings').onclick = () => openSettings($('#settings').hidden);
  $('#settings-close').onclick = () => openSettings(false);
  $('#btn-sound').onclick = () => {
    settings.muted = !settings.muted;
    audio.setMuted(settings.muted);
    $('#btn-sound').classList.toggle('off', settings.muted);
    saveSettings();
  };
  $('#btn-sound').classList.toggle('off', settings.muted);
  $('#btn-full').onclick = toggleFullscreen;
  $('#legend-toggle').onclick = () => {
    settings.legend = !settings.legend;
    el.legend.classList.toggle('collapsed', !settings.legend);
    $('#legend-toggle').textContent = settings.legend ? 'Hide · H' : 'Show · H';
    requestAnimationFrame(drawIcons);
    saveSettings();
  };
  el.legend.classList.toggle('collapsed', !settings.legend);

  const bindRange = (id, key, out, fmt) =>
    ($(id).oninput = (e) => {
      settings[key] = +e.target.value;
      $(out).textContent = fmt(settings[key]);
      if (key === 'volume') audio.setVolume(settings.volume);
      saveSettings();
    });
  bindRange('#s-gain', 'gain', '#o-gain', (v) => v.toFixed(2) + '×');
  bindRange('#s-point', 'point', '#o-point', (v) => Math.round(v * 100) + '%');
  bindRange('#s-vol', 'volume', '#o-vol', (v) => Math.round(v * 100) + '%');
  const bindCheck = (id, key, fn) =>
    ($(id).onchange = (e) => {
      settings[key] = e.target.checked;
      fn?.();
      saveSettings();
    });
  bindCheck('#s-laser', 'laser');
  bindCheck('#s-two', 'twoGuns');
  bindCheck('#s-auto', 'autoReload');
  bindCheck('#s-occ', 'occlusion');
  bindCheck('#s-skel', 'skeleton', () => slots.forEach((s) => s.rig.occluder.setDebug(settings.skeleton)));
  for (const r of $$('input[name="s-trig"]'))
    r.onchange = () => {
      settings.trigger = r.value;
      applyTrigger();
      saveSettings();
    };
  $('#s-cam').onchange = async (e) => {
    settings.camera = e.target.value;
    saveSettings();
    try {
      await tracker.startCamera(settings.camera);
      resize();
    } catch (err) {
      showError(cameraError(err));
    }
  };
  $('#s-calib').onclick = () => {
    S.calibPending = true;
    S.calibrated = false;
    openSettings(false);
    toast('Point at the screen center and hold still', 2200);
  };
  $('#s-tut').onclick = () => {
    openSettings(false);
    if (S.phase !== 'intro' && S.phase !== 'loading') startTutorial();
  };
  $('#s-menu').onclick = () => {
    openSettings(false);
    S.phase = 'intro';
    range.clear();
    $('#results').hidden = true;
    $('#officer').hidden = true;
    $('#countdown').hidden = true;
    $('#intro').hidden = false;
    document.body.classList.remove('playing');
    showcase ||= startShowcase($('#hero-gun'), $('#hero-cap'));
    $('#best-drill').textContent = storage.get('pr.bestDrill', 0) ? `Best ${storage.get('pr.bestDrill', 0).toLocaleString()}` : 'No score yet';
  };

  // mouse
  addEventListener('mousemove', (e) => {
    S.mouse.x = e.clientX;
    S.mouse.y = e.clientY;
    if (S.phase !== 'intro') S.mouse.lastMove = S.t;
  });
  stage.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      S.mouse.pressed = true;
      S.mouse.held = true;
      S.mouse.lastMove = S.t;
    } else if (e.button === 2) S.mouse.scope = !S.mouse.scope;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) S.mouse.held = false;
  });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  // keyboard
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input,select,textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      if (!e.repeat) {
        S.key.pressed = true;
        S.key.held = true;
      }
      return;
    }
    if (e.repeat) return;
    if (k === 'escape') return openSettings($('#settings').hidden && S.phase !== 'intro');
    if (S.phase === 'intro' || S.phase === 'loading') return;
    if (k === 'r') reloadSlot(slots[0]);
    else if (k === 'q' || k === 'tab') {
      e.preventDefault();
      selectWeapon(S.weaponIdx + 1);
    } else if (k >= '1' && k <= '4') selectWeapon(+k - 1);
    else if (k === 'b') toggleFireMode();
    else if (k === 'e') S.key.scope = !S.key.scope;
    else if (k === 'c') $('#s-calib').onclick();
    else if (k === 'h') $('#legend-toggle').onclick();
    else if (k === 'd') {
      settings.skeleton = !settings.skeleton;
      slots.forEach((s) => s.rig.occluder.setDebug(settings.skeleton));
    } else if (k === 'm') $('#btn-sound').onclick();
    else if (k === 'f') toggleFullscreen();
    else if (k === 'enter' && S.tut) advanceTutorial();
  });
  addEventListener('keyup', (e) => {
    if (e.key === ' ') S.key.held = false;
  });
  addEventListener('resize', () => {
    resize();
    drawIcons();
  });
  video.addEventListener('loadedmetadata', resize);
  document.addEventListener('visibilitychange', () => (document.hidden ? audio.suspend() : audio.resume()));
}

// Legend + intro pictograms, drawn from real tracked hands. Redrawn when their size can change.
function drawIcons() {
  for (const c of $$('canvas[data-icon]')) {
    if (!c.clientWidth) continue;
    const k = c.dataset.icon;
    drawPoseIcon(c, POSES[k], {
      thumbAccent: k === 'fire' || k === 'aim',
      arrow: k === 'reload' ? [0.12, 0.85, 0.12, 0.2] : null,
    });
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

// ---------------------------------------------------------------- start
try {
  initGraphics();
} catch (e) {
  console.error(e);
  document.getElementById('err-title').textContent = 'WebGL is not available';
  document.getElementById('err-body').textContent = 'Phantom Range needs WebGL. Turn on hardware acceleration in your browser settings and reload.';
  document.getElementById('err-retry').hidden = true;
  document.getElementById('error').hidden = false;
}
if (renderer) {
  bindUI();
  resize();
  requestAnimationFrame(frame);
  window.__PR = { S, slots, hands, tracker, range, view, settings, audio, selectWeapon, startMode, startTutorial, boot, WEAPONS, slotState, toggleFireMode, reloadSlot };
  if (!params.get('autostart')) showcase = startShowcase($('#hero-gun'), $('#hero-cap'));
  const auto = params.get('autostart');
  if (auto) {
    if (params.has('skiptut')) storage.set('pr.tutorialDone', true);
    setTimeout(() => boot(auto === 'tutorial' ? 'free' : auto, { mouseOnly: params.has('mouse') }), 50);
    if (auto === 'tutorial') storage.set('pr.tutorialDone', false);
  }
}
