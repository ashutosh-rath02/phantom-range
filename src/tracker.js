// Webcam capture + MediaPipe hand landmarker, plus the mapping from camera pixels to screen space.
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { ASSETS, TRACKING } from './config.js';

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress?.(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Hand tracking worker. Runs MediaPipe off the main thread so inference never stalls rendering.
// Kept self-contained: it is stringified into a blob URL, so every build (hosted, single file,
// offline) gets it without shipping a separate file.
function workerMain() {
  let lm = null,
    cv = null,
    cg = null,
    useCanvas = true;
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') {
      try {
        // Fetched and evaluated rather than importScripts()-ed: simple static servers (python -m http.server)
        // label .cjs files with a non-script MIME type, which importScripts refuses.
        const t0 = performance.now();
        const res = await fetch(m.lib);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${m.lib}`);
        const lib = {};
        new Function('exports', await res.text())(lib);
        const { FilesetResolver, HandLandmarker } = lib;
        const t1 = performance.now();
        const fileset = await FilesetResolver.forVisionTasks(m.wasmBase);
        const opts = (delegate) => ({
          baseOptions: { modelAssetBuffer: m.model, delegate },
          runningMode: 'VIDEO',
          numHands: m.numHands,
          minHandDetectionConfidence: m.minDetect,
          minHandPresenceConfidence: m.minPresence,
          minTrackingConfidence: m.minTrack,
        });
        let delegate = 'CPU';
        if (!m.forceCpu) {
          try {
            lm = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
            delegate = 'GPU';
          } catch {
            lm = null;
          }
        }
        if (!lm) lm = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
        useCanvas = m.useCanvas && typeof OffscreenCanvas !== 'undefined';
        self.postMessage({ type: 'ready', delegate, ms: { lib: t1 - t0, engine: performance.now() - t1 } });
      } catch (err) {
        self.postMessage({ type: 'error', message: String((err && err.message) || err) });
      }
      return;
    }
    if (m.type === 'frame') {
      const bm = m.bitmap;
      const t0 = performance.now();
      let res = null,
        error = null;
      try {
        let input = bm;
        // Same reason as the main-thread path: a 2D canvas copy is the input every GPU driver reads correctly.
        if (useCanvas) {
          if (!cv || cv.width !== bm.width || cv.height !== bm.height) {
            cv = new OffscreenCanvas(bm.width, bm.height);
            cg = cv.getContext('2d', { alpha: false });
          }
          cg.drawImage(bm, 0, 0);
          input = cv;
        }
        const r = lm.detectForVideo(input, m.ts);
        res = { landmarks: r.landmarks, worldLandmarks: r.worldLandmarks, handedness: r.handedness };
      } catch (err) {
        error = String((err && err.message) || err);
      }
      bm.close();
      self.postMessage({ type: 'result', id: m.id, ts: m.ts, ms: performance.now() - t0, res, error });
    }
  };
}

const abs = (u) => new URL(u, location.href).href;

export class Tracker {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.landmarker = null;
    this.worker = null;
    this.mode = null; // 'worker' | 'main'
    this.delegate = null;
    this.lastVideoTime = -1;
    this.lastTs = 0;
    this.fps = 0;
    this._fpsT = 0;
    this._fpsN = 0;
    this.inferMs = 0;
    this.useCanvas = !/[?&]videoinput\b/.test(location.search);
    this.results = [];
    this.inFlight = false;
    this.sentAt = 0;
    this.frameReady = false;
    this.workerErrors = 0;
  }

  get ready() {
    return !!this.mode;
  }

  async listCameras() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  async startCamera(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error('This browser does not expose a camera API. Open the page in Chrome, Edge or Firefox.');
      e.code = 'nocamapi';
      throw e;
    }
    this.stopCamera();
    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60, max: 60 },
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = 'user';
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
    }
    const track = this.stream.getVideoTracks()[0];
    this.deviceId = track?.getSettings?.().deviceId || deviceId || '';
    this.label = track?.label || 'Camera';
    this.watchFrames();
    return this.stream;
  }

  // Hands each new camera frame to the worker the moment it arrives instead of waiting for the next repaint.
  watchFrames() {
    const v = this.video;
    if (!v.requestVideoFrameCallback || this._rvfc) return;
    this._rvfc = true;
    const onFrame = () => {
      this.frameReady = true;
      this.pump();
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }

  stopCamera() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
  }

  async init(onProgress) {
    onProgress?.('engine', 0);
    onProgress?.('model', 0);
    // Builds that ship without local copies (single file, hosted) set window.PR_ASSETS = 'cdn'.
    const isFile = location.protocol === 'file:' || window.PR_ASSETS === 'cdn';
    const local = !isFile && (await urlExists(ASSETS.wasmLocal + '/vision_wasm_internal.js'));
    const base = local ? ASSETS.wasmLocal : ASSETS.wasmCdn;
    const workerLib = local && (await urlExists(ASSETS.workerLibLocal)) ? ASSETS.workerLibLocal : ASSETS.workerLibCdn;
    const fileset = await FilesetResolver.forVisionTasks(base);
    // Warm the HTTP cache for the 9 MB engine binary so its download shows progress;
    // MediaPipe's own request then comes from cache.
    const wasmP = fetchWithProgress(fileset.wasmBinaryPath, (p) => onProgress?.('engine', p * 0.9)).catch(() => null);
    const modelP = (async () => {
      try {
        if (isFile) throw new Error('local copies not shipped');
        return await fetchWithProgress(ASSETS.modelLocal, (p) => onProgress?.('model', p));
      } catch {
        return await fetchWithProgress(ASSETS.modelCdn, (p) => onProgress?.('model', p));
      }
    })();
    const [, model] = await Promise.all([wasmP, modelP]);
    const opts = (delegate) => ({
      baseOptions: { modelAssetBuffer: model, delegate },
      runningMode: 'VIDEO',
      numHands: TRACKING.numHands,
      minHandDetectionConfidence: TRACKING.minDetect,
      minHandPresenceConfidence: TRACKING.minPresence,
      minTrackingConfidence: TRACKING.minTrack,
    });
    const forceCpu = /[?&]cpu\b/.test(location.search);
    const canWorker = typeof Worker !== 'undefined' && typeof createImageBitmap === 'function' && !/[?&]noworker\b/.test(location.search);
    if (canWorker) {
      try {
        await this.startWorker({
          lib: abs(workerLib),
          wasmBase: abs(base),
          model,
          forceCpu,
          numHands: TRACKING.numHands,
          minDetect: TRACKING.minDetect,
          minPresence: TRACKING.minPresence,
          minTrack: TRACKING.minTrack,
          useCanvas: this.useCanvas,
        });
        this.mode = 'worker';
      } catch (e) {
        console.warn('Tracking worker unavailable, tracking on the main thread instead', e);
        this.stopWorker();
      }
    }
    if (!this.mode) {
      if (!forceCpu) {
        try {
          this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU'));
          this.delegate = 'GPU';
        } catch (e) {
          console.warn('GPU delegate unavailable, using CPU', e);
        }
      }
      if (!this.landmarker) {
        this.landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU'));
        this.delegate = 'CPU';
      }
      this.mode = 'main';
    }
    onProgress?.('engine', 1);
    onProgress?.('ready', 1);
  }

  startWorker(init) {
    const t0 = performance.now();
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([`(${workerMain.toString()})();`], { type: 'text/javascript' }));
      let w;
      try {
        w = new Worker(url);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
        return;
      }
      this.worker = w;
      const done = (err) => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => done(new Error('tracking worker did not start in time')), 45000);
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') {
          this.delegate = m.delegate;
          this.initMs = { ...m.ms, total: performance.now() - t0 };
          w.onmessage = (ev) => this.onWorkerMessage(ev.data);
          w.onerror = (ev) => console.warn('tracking worker error', ev.message);
          done();
        } else if (m.type === 'error') done(new Error(m.message));
      };
      w.onerror = (e) => {
        e.preventDefault?.();
        done(new Error(e.message || 'tracking worker failed to load'));
      };
      w.postMessage({ type: 'init', ...init });
    });
  }

  stopWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = false;
  }

  onWorkerMessage(m) {
    if (m.type !== 'result') return;
    // only the reply to the newest frame frees the pipeline (an older one arrives after a watchdog resend)
    if (m.id === this.frameId) this.inFlight = false;
    this.inferMs = this.inferMs * 0.9 + m.ms * 0.1;
    if (m.res) {
      this.workerErrors = 0;
      this.results.push({ res: m.res, t: m.ts / 1000 });
      this.countFrame(m.ts);
    } else if (m.error && ++this.workerErrors === 30) console.warn('tracking keeps failing in the worker:', m.error);
    this.pump();
  }

  // Sends the newest camera frame to the worker if it is idle.
  pump() {
    if (this.mode !== 'worker' || !this.worker) return;
    const v = this.video;
    const now = performance.now();
    if (this.inFlight) {
      // A lost reply must not stall tracking for good, but a slow one must not be doubled up either:
      // a second frame queued behind a busy worker only makes every later result older.
      if (now - this.sentAt < Math.max(4000, 6 * this.inferMs)) return;
      this.inFlight = false;
    }
    if (v.readyState < 2 || !v.videoWidth) return;
    if (!this.frameReady && v.currentTime === this.lastVideoTime) return;
    this.frameReady = false;
    this.lastVideoTime = v.currentTime;
    let ts = now;
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    this.inFlight = true;
    this.sentAt = now;
    const id = (this.frameId = (this.frameId || 0) + 1);
    createImageBitmap(v).then(
      (bm) => {
        if (!this.worker) return bm.close();
        this.worker.postMessage({ type: 'frame', bitmap: bm, ts, id }, [bm]);
      },
      () => {
        this.inFlight = false;
      },
    );
  }

  // New detections since the last call, oldest first: [{ res, t }].
  poll() {
    if (this.mode === 'worker') {
      this.pump();
      const out = this.results;
      this.results = [];
      return out;
    }
    const d = this.detect();
    return d ? [d] : [];
  }

  countFrame(ts) {
    this._fpsN++;
    if (ts - this._fpsT > 1000) {
      this.fps = (this._fpsN * 1000) / (ts - this._fpsT);
      this._fpsN = 0;
      this._fpsT = ts;
    }
  }

  // Main-thread fallback: runs detection if the camera produced a new frame. Returns null when there is nothing new.
  detect() {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || !v.videoWidth) return null;
    if (v.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = v.currentTime;
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    const t0 = performance.now();
    let res;
    try {
      // Feed a 2D-canvas copy of the frame: some GPU/driver combinations hand MediaPipe a black
      // texture when it samples a camera <video> directly, while canvas input works everywhere.
      let input = v;
      if (this.useCanvas) {
        const c = (this._cv ||= document.createElement('canvas'));
        if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          this._cg = c.getContext('2d', { alpha: false, desynchronized: true });
        }
        this._cg.drawImage(v, 0, 0);
        input = c;
      }
      res = this.landmarker.detectForVideo(input, ts);
    } catch (e) {
      console.warn('detect failed', e);
      return null;
    }
    this.inferMs = this.inferMs * 0.9 + (performance.now() - t0) * 0.1;
    this.countFrame(ts);
    return { res, t: ts / 1000 };
  }
}

// Describes how the mirrored, cover-fitted video maps onto the screen, and the matching pinhole camera.
export class ViewModel {
  constructor() {
    this.W = 1;
    this.H = 1;
    this.vw = 1280;
    this.vh = 720;
    this.k = 1;
    this.ox = 0;
    this.oy = 0;
    this.f = 1000; // focal length in screen px
    // The gun pass uses a longer lens: same apparent size and position, gentler perspective, so a
    // barrel pointed at the camera does not balloon when the depth estimate is a little off.
    this.gk = 2.5;
    this.fg = 2500;
  }
  update(W, H, vw, vh) {
    this.W = W;
    this.H = H;
    if (vw && vh) {
      this.vw = vw;
      this.vh = vh;
    }
    this.k = Math.max(W / this.vw, H / this.vh);
    this.ox = (W - this.vw * this.k) / 2;
    this.oy = (H - this.vh * this.k) / 2;
    const fImg = this.vw / 2 / Math.tan(((TRACKING.webcamHFov / 2) * Math.PI) / 180);
    this.f = fImg * this.k;
    this.fovY = (2 * Math.atan(H / 2 / this.f) * 180) / Math.PI;
    this.fg = this.f * this.gk;
    this.fovYGun = (2 * Math.atan(H / 2 / this.fg) * 180) / Math.PI;
  }
  // normalized image coords -> mirrored screen px
  toScreen(nx, ny) {
    return { x: this.W - (this.ox + nx * this.vw * this.k), y: this.oy + ny * this.vh * this.k };
  }
  // screen px + distance (m) -> camera-space point (three.js convention, camera looks down -Z)
  unproject(x, y, z) {
    return { x: ((x - this.W / 2) * z) / this.f, y: (-(y - this.H / 2) * z) / this.f, z: -z };
  }
  project(p) {
    const z = -p.z;
    return { x: this.W / 2 + (p.x * this.f) / z, y: this.H / 2 - (p.y * this.f) / z, z };
  }
  unprojectGun(x, y, z) {
    return { x: ((x - this.W / 2) * z) / this.fg, y: (-(y - this.H / 2) * z) / this.fg, z: -z };
  }
  projectGun(p) {
    const z = -p.z;
    return { x: this.W / 2 + (p.x * this.fg) / z, y: this.H / 2 - (p.y * this.fg) / z, z };
  }
}
