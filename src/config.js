// Tunables for tracking, gestures, and the weapon roster.

export const ASSETS = {
  mediapipeVersion: '0.10.21',
  wasmLocal: './vendor/tasks-vision/wasm',
  wasmCdn: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
  // CommonJS build of the same library; the tracking worker fetches and runs it (no ES modules needed there).
  workerLibLocal: './vendor/tasks-vision/vision_bundle.cjs',
  workerLibCdn: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.cjs',
  modelLocal: './models/hand_landmarker.task',
  modelCdn:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
};

export const TRACKING = {
  numHands: 2,
  minDetect: 0.5,
  minPresence: 0.5,
  minTrack: 0.5,
  webcamHFov: 64, // degrees; typical laptop webcam. Only affects perspective strength.
  lostGrace: 0.28, // seconds a hand can vanish before its gun is holstered
};

// Gesture thresholds measured from real hand photos (see test/analyze2.py).
export const GESTURE = {
  extOn: 0.8, // finger extension ratio to count as extended
  extStay: 0.74,
  curl: 0.74, // ring+pinky average below this counts as curled
  gunMargin: 0.1, // index must beat ring/pinky average by this much
  palmMin: 0.84,
  fistMax: 0.7,
  // Thumb trigger. Heights are thumb tip above the index finger, in palm lengths. Both levels start
  // here and then adapt to each player; the trigger setting picks where between them the shot breaks.
  thumbCockedInit: 0.62,
  thumbDownInit: 0.08,
  cockFactor: 0.5, // fire line, as a share of the way from the fired level up to the cocked level
  snapFactor: 0.45, // a quick drop of this share of that range also fires
  pointUpY: -0.78, // world-space index direction y (down is +) to count as pointing at the ceiling
  pointUpHold: 0.22,
  palmHold: 0.6,
  palmRepeat: 1.1,
  fistHold: 0.85,
  steadySpeed: 140, // px/s
  steadyBreak: 520,
  steadyHold: 0.5,
};

export const AIM = {
  gain: 1.0, // sensitivity multiplier (settings slider)
  reach: 0.3, // meters of hand travel that move the crosshair from the center to the screen edge
  point: 0.32, // how much finger direction swings the aim, as a share of the screen's short side
  minCutoff: 1.4,
  beta: 0.006,
  preTrigger: 0.07, // seconds of aim history to rewind on a trigger pull
  lookAhead: 0.03, // seconds the crosshair and gun are carried forward between camera frames
  renderSmooth: 0.028, // seconds; light smoothing of the drawn crosshair at display rate
};

export const WEAPONS = [
  {
    id: 'pistol',
    name: 'P-9 Service',
    short: 'PISTOL',
    caliber: '9×19mm',
    mag: 15,
    rpm: 450,
    modes: ['SEMI'],
    damage: 34,
    spread: 0.006,
    bloom: 0.006,
    bloomMax: 0.02,
    pellets: 1,
    reload: 1.35,
    reloadEmpty: 1.65,
    kick: { back: 0.035, rise: 0.32, shake: 4 },
    shell: 'pistol',
    flash: 0.75,
    tracer: 0.5,
    loud: 0.85,
    switchKey: '1',
  },
  {
    id: 'rifle',
    name: 'AR-7 Carbine',
    short: 'RIFLE',
    caliber: '5.56×45mm',
    mag: 30,
    rpm: 720,
    modes: ['AUTO', 'BURST', 'SEMI'],
    burst: 3,
    damage: 26,
    spread: 0.007,
    bloom: 0.0035,
    bloomMax: 0.03,
    pellets: 1,
    reload: 1.9,
    reloadEmpty: 2.3,
    kick: { back: 0.022, rise: 0.12, shake: 3 },
    shell: 'rifle',
    flash: 1.0,
    tracer: 1,
    loud: 0.9,
    switchKey: '2',
  },
  {
    id: 'shotgun',
    name: 'M-870 Pump',
    short: 'SHOTGUN',
    caliber: '12 gauge',
    mag: 6,
    rpm: 110,
    pump: 0.5,
    modes: ['PUMP'],
    damage: 15,
    spread: 0.05,
    bloom: 0,
    bloomMax: 0,
    pellets: 9,
    reloadShell: 0.42,
    reloadStart: 0.25,
    kick: { back: 0.07, rise: 0.5, shake: 10 },
    shell: 'shotgun',
    flash: 1.5,
    tracer: 0.35,
    loud: 1.0,
    switchKey: '3',
  },
  {
    id: 'sniper',
    name: 'R-700 Long',
    short: 'SNIPER',
    caliber: '.308 Win',
    mag: 5,
    rpm: 50,
    bolt: 1.0,
    modes: ['BOLT'],
    damage: 220,
    spread: 0.0,
    hipSpread: 0.03,
    bloom: 0,
    bloomMax: 0,
    pellets: 1,
    pierce: true,
    reload: 2.4,
    reloadEmpty: 2.6,
    zoom: 3,
    kick: { back: 0.06, rise: 0.35, shake: 12 },
    shell: 'sniper',
    flash: 1.4,
    tracer: 1,
    loud: 1.0,
    switchKey: '4',
  },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

export const DRILL_SECONDS = 60;
