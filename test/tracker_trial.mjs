// Delegate trial (Tracker.tune) with mocked workers: a GPU delegate that is slow under game load is
// swapped for the CPU one when the CPU tracks faster, kept when it does not, and the choice is
// remembered. Runs in Node with stand-ins for Worker, the camera video and createImageBitmap.
import { TRACKING } from '../src/config.js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
globalThis.location = { href: 'http://localhost/', search: '' };
globalThis.URL.createObjectURL = () => 'blob:mock';
globalThis.URL.revokeObjectURL = () => {};
globalThis.createImageBitmap = async () => ({ width: 1280, height: 720, close() {} });

let speeds = { GPU: 100, CPU: 35 }; // ms per frame in the mocked workers
const live = new Set();
globalThis.Worker = class {
  constructor() {
    this.onmessage = null;
    this.dead = false;
    live.add(this);
  }
  postMessage(m) {
    if (this.dead) return;
    if (m.type === 'init') {
      this.delegate = m.forceCpu ? 'CPU' : 'GPU';
      setTimeout(() => this.onmessage?.({ data: { type: 'ready', delegate: this.delegate, ms: { lib: 1, engine: 1 } } }), 20);
    } else if (m.type === 'frame') {
      const ms = speeds[this.delegate];
      setTimeout(() => {
        if (!this.dead) this.onmessage?.({ data: { type: 'result', id: m.id, ts: m.ts, ms, res: { landmarks: [], worldLandmarks: [], handedness: [] } } });
      }, ms);
    }
  }
  terminate() {
    this.dead = true;
    live.delete(this);
  }
};

const { Tracker } = await import('../src/tracker.js');
TRACKING.trial = { warm: 0.3, measure: 0.8, minFps: 22, gain: 1.15 };

async function run(name, sp, expectDelegate) {
  speeds = sp;
  mem.clear();
  for (const w of live) w.terminate();
  const video = { readyState: 4, videoWidth: 1280, videoHeight: 720, currentTime: 0 };
  const tr = new Tracker(video);
  tr.initArgs = {};
  tr.attach(await tr.spawnWorker({ forceCpu: false }));
  tr.mode = 'worker';
  // camera at 30 fps, game loop at 60 fps
  const cam = setInterval(() => {
    video.currentTime += 1 / 30;
    tr.frameReady = true;
    tr.pump();
  }, 33);
  let last = performance.now();
  const t0 = last;
  await new Promise((resolve) => {
    const loop = setInterval(() => {
      const now = performance.now();
      tr.poll();
      tr.tune((now - last) / 1000, true);
      last = now;
      if (tr.trial.state === 'done' || now - t0 > 6000) {
        clearInterval(loop);
        resolve();
      }
    }, 16);
  });
  // a little longer on the chosen worker, to check frames keep flowing
  const n0 = tr.resultCount;
  await new Promise((r) => setTimeout(r, 500));
  clearInterval(cam);
  const flowing = tr.resultCount - n0 >= 3;
  const pref = JSON.parse(mem.get('pr.trackPref') || 'null');
  const ok = tr.trial.state === 'done' && tr.delegate === expectDelegate && flowing && live.size === 1 && (!pref || pref.delegate === expectDelegate);
  console.log(
    `${ok ? '  ' : 'XX'} ${name.padEnd(36)} using ${tr.delegate}  gpu ${tr.trial.gpuFps.toFixed(1)} fps  cpu ${tr.trial.cpuFps.toFixed(1)} fps  workers ${live.size}  frames flowing ${flowing}`,
  );
  tr.stopWorker();
  return ok;
}

let fails = 0;
if (!(await run('slow GPU, faster CPU: switch', { GPU: 100, CPU: 35 }, 'CPU'))) fails++;
if (!(await run('slow GPU, slower CPU: keep GPU', { GPU: 70, CPU: 120 }, 'GPU'))) fails++;
if (!(await run('fast GPU: no trial', { GPU: 20, CPU: 35 }, 'GPU'))) fails++;
console.log('fails', fails);
process.exit(fails ? 1 : 0);
