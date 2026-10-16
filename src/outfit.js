// Outfits: the player's clothes are found with MediaPipe's multiclass selfie segmenter (classes:
// background, hair, body skin, face skin, clothes, accessories) in a worker of their own, then
// redrawn on screen in a camouflage or uniform pattern that keeps the folds and shading of the real
// fabric. Hand tracking keeps its own worker, so outfits never slow the trigger down.
import * as THREE from 'three';

const clamp01 = (v, max) => Math.min(max, Math.max(0, v));

export const OUTFITS = [
  { id: 'off', name: 'Street clothes' },
  { id: 'woodland', name: 'Woodland camo', kind: 0, colors: ['#4a5a32', '#2f3b22', '#6b5a3a', '#181a14'] },
  { id: 'desert', name: 'Desert camo', kind: 1, colors: ['#c8b28a', '#a48a62', '#7d6a4a', '#4c3f2c'] },
  { id: 'urban', name: 'Urban digital', kind: 2, colors: ['#8a8f96', '#5d636b', '#3b4047', '#b8bcc1'] },
  { id: 'night', name: 'Night ops', kind: 3, colors: ['#17191c', '#24272b', '#0d0e10', '#33373c'] },
  { id: 'officer', name: 'Range officer', kind: 4, colors: ['#ff5b1f', '#d9dde2', '#2b2f33', '#ff8a4a'] },
  { id: 'arctic', name: 'Arctic camo', kind: 5, colors: ['#e9edf0', '#c3cad1', '#9aa5b0', '#ffffff'] },
];

// Worker body. Stringified into a blob URL like the tracking worker, so every build ships it.
function segWorkerMain() {
  let seg = null,
    cv = null,
    cg = null,
    channel = null;
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'init') {
      try {
        const res = await fetch(m.lib);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${m.lib}`);
        const lib = {};
        new Function('exports', await res.text())(lib);
        const fileset = await lib.FilesetResolver.forVisionTasks(m.wasmBase);
        seg = await lib.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: m.model, delegate: 'CPU' },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
        const labels = (seg.getLabels?.() || []).map((l) => String(l).toLowerCase());
        const ci = labels.findIndex((l) => l.includes('cloth'));
        // Without labels, a six-mask model is taken to be the multiclass one (clothes is its fifth
        // mask); a single-mask person model (used by the tests) uses its only mask.
        channel = ci >= 0 ? ci : null;
        self.postMessage({ type: 'ready', labels, channel });
      } catch (err) {
        self.postMessage({ type: 'error', message: String((err && err.message) || err) });
      }
      return;
    }
    if (m.type === 'frame') {
      const bm = m.bitmap;
      const t0 = performance.now();
      let out = null,
        error = null;
      try {
        const w = bm.width,
          h = bm.height;
        if (!cv || cv.width !== w || cv.height !== h) {
          cv = new OffscreenCanvas(w, h);
          cg = cv.getContext('2d', { alpha: false, willReadFrequently: true });
        }
        cg.drawImage(bm, 0, 0);
        const r = seg.segment(cv);
        const masks = r.confidenceMasks || [];
        const mk = masks[channel ?? (masks.length >= 5 ? 4 : masks.length - 1)];
        const f = mk.getAsFloat32Array();
        const mw = mk.width,
          mh = mk.height;
        const px = mw === w && mh === h ? cg.getImageData(0, 0, w, h).data : null;
        const mask = new Uint8Array(mw * mh);
        let n = 0,
          lum = 0,
          sx = 0,
          sy = 0,
          top = mh,
          bottom = 0;
        for (let y = 0; y < mh; y++)
          for (let x = 0; x < mw; x++) {
            const i = y * mw + x;
            const v = f[i];
            mask[i] = v * 255;
            if (v > 0.5) {
              n++;
              sx += x;
              sy += y;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
              if (px) lum += (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
            }
          }
        for (const k of masks) k.close?.();
        r.close?.();
        out = {
          mask,
          w: mw,
          h: mh,
          cover: n / (mw * mh),
          lum: n && px ? lum / n : 0.45,
          cx: n ? sx / n / mw : 0.5,
          cy: n ? sy / n / mh : 0.6,
          span: n ? Math.max(0.15, (bottom - top + 1) / mh) : 0.5,
        };
      } catch (err) {
        error = String((err && err.message) || err);
      }
      bm.close();
      self.postMessage({ type: 'mask', id: m.id, ms: performance.now() - t0, ...out, error }, out ? [out.mask.buffer] : []);
    }
  };
}

// Runs the segmenter worker and keeps the latest clothes mask. Frames are sent at a modest rate,
// downscaled; clothes move slowly next to a snapping thumb.
export class OutfitSegmenter {
  constructor(video) {
    this.video = video;
    this.worker = null;
    this.state = 'off'; // off | loading | ready | error
    this.busy = false;
    this.sentAt = 0;
    this.id = 0;
    this.latest = null;
    this.ms = 0;
    this.interval = 0.12;
    this.onState = null;
  }

  start({ lib, wasmBase, model }) {
    if (this.state === 'loading' || this.state === 'ready') return;
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
      this.setState('error', 'Outfits need a browser with OffscreenCanvas (Chrome, Edge, Firefox or Safari 17).');
      return;
    }
    this.setState('loading');
    const url = URL.createObjectURL(new Blob([`(${segWorkerMain.toString()})();`], { type: 'text/javascript' }));
    const w = new Worker(url);
    this.worker = w;
    const timer = setTimeout(() => this.fail('The outfit model took too long to load.'), 60000);
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        this.channel = m.channel;
        this.setState('ready');
      } else if (m.type === 'error') {
        clearTimeout(timer);
        this.fail(m.message);
      } else if (m.type === 'mask') {
        this.busy = false;
        this.ms = this.ms ? this.ms * 0.8 + m.ms * 0.2 : m.ms;
        if (m.mask) this.latest = m;
      }
    };
    w.onerror = (e) => {
      e.preventDefault?.();
      clearTimeout(timer);
      this.fail(e.message || 'The outfit worker failed to load.');
    };
    w.postMessage({ type: 'init', lib, wasmBase, model });
  }

  fail(msg) {
    this.worker?.terminate();
    this.worker = null;
    this.setState('error', msg);
  }

  setState(s, msg) {
    this.state = s;
    this.error = msg || '';
    this.onState?.(s, msg);
  }

  // Called every frame while an outfit is worn.
  pump(now) {
    const v = this.video;
    if (this.state !== 'ready' || v.readyState < 2 || !v.videoWidth) return;
    // a lost reply must not stop the outfit for good
    if (this.busy && now - this.sentAt < 3) return;
    // the segmenter works at most half the time, so a slow machine keeps CPU for hand tracking
    if (now - this.sentAt < Math.max(this.interval, (this.ms / 1000) * 2)) return;
    this.busy = true;
    this.sentAt = now;
    const id = ++this.id;
    const h = 144,
      w = Math.round((h * v.videoWidth) / v.videoHeight);
    createImageBitmap(v, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' }).then(
      (bm) => (this.worker ? this.worker.postMessage({ type: 'frame', bitmap: bm, id }, [bm]) : bm.close()),
      () => (this.busy = false),
    );
  }

  take() {
    const m = this.latest;
    this.latest = null;
    return m;
  }
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform vec4 uMap;      // screen uv -> camera image coords: (a + b * u, c + d * v)
uniform vec3 uAnchor;   // clothes centroid (x, y) and height, in image coords
uniform float uAspect;  // camera image width / height
uniform float uLum;     // mean brightness of the real clothes
uniform float uMix;
uniform float uKind;
uniform vec3 uC0, uC1, uC2, uC3;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

vec3 pattern(vec2 p) {
  if (uKind < 0.5) { // woodland: large organic blotches in four colors
    vec3 c = uC0;
    c = mix(c, uC1, step(0.5, fbm(p * 2.6)));
    c = mix(c, uC2, step(0.57, fbm(p * 2.6 + 23.0)));
    return mix(c, uC3, step(0.63, fbm(p * 4.2 + 51.0)));
  }
  if (uKind < 1.5) { // desert: soft blotches with small dark specks
    vec3 c = uC0;
    c = mix(c, uC1, smoothstep(0.47, 0.51, fbm(p * 2.2)));
    c = mix(c, uC2, smoothstep(0.57, 0.61, fbm(p * 3.1 + 7.0)));
    return mix(c, uC3, step(0.93, hash(floor(p * 34.0))) * step(0.5, fbm(p * 6.0 + 3.0)));
  }
  if (uKind < 2.5) { // urban digital: the woodland idea drawn in square pixels
    vec2 q = floor(p * 26.0) / 26.0;
    vec3 c = uC0;
    c = mix(c, uC1, step(0.5, fbm(q * 3.0)));
    c = mix(c, uC2, step(0.57, fbm(q * 3.0 + 31.0)));
    return mix(c, uC3, step(0.64, fbm(q * 4.0 + 77.0)));
  }
  if (uKind < 3.5) { // night ops: matte black with a faint weave
    float w = fbm(p * 9.0);
    return mix(uC0, uC1, smoothstep(0.35, 0.75, w)) * (0.92 + 0.16 * noise(p * 80.0));
  }
  if (uKind < 4.5) { // range officer: blaze orange with reflective bands
    float y = fract(p.y * 2.4 + 0.15);
    float band = step(0.42, y) * step(y, 0.52);
    return mix(uC0, uC1, band);
  }
  vec3 c = uC0; // arctic: pale blotches
  c = mix(c, uC1, step(0.52, fbm(p * 2.4)));
  return mix(c, uC2, step(0.62, fbm(p * 3.4 + 19.0)));
}

void main() {
  vec2 n = vec2(uMap.x + uMap.y * vUv.x, uMap.z + uMap.w * vUv.y);
  if (n.x < 0.0 || n.x > 1.0 || n.y < 0.0 || n.y > 1.0) discard;
  float m = texture2D(uMask, n).r;
  float a = smoothstep(0.32, 0.72, m) * uMix;
  if (a < 0.01) discard;
  // three.js keeps video textures sRGB encoded and decodes them in its own shaders; do the same here
  vec3 vs = texture2D(uVideo, vec2(n.x, 1.0 - n.y)).rgb;
  vec3 v = pow(vs, vec3(2.2));
  float lum = dot(vs, vec3(0.299, 0.587, 0.114));
  // body-relative pattern coordinates, so the print moves and scales with the player
  vec2 p = vec2((n.x - uAnchor.x) * uAspect, n.y - uAnchor.y) / max(uAnchor.z, 0.15);
  vec3 base = pattern(p * 1.9);
  // keep the folds and shadows of the real fabric
  float shade = clamp(1.0 + 1.35 * (lum - uLum), 0.42, 1.6);
  vec3 col = base * pow(shade, 2.2);
  col = mix(col, v, 0.06);
  gl_FragColor = vec4(col, a * 0.97);
  #include <colorspace_fragment>
}`;

// Full-screen pass drawn over the camera image and under the range and the guns.
export class OutfitLayer {
  constructor(videoTex) {
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.maskData = new Uint8Array(4);
    this.maskTex = new THREE.DataTexture(this.maskData, 2, 2, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTex.magFilter = THREE.LinearFilter;
    this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.needsUpdate = true;
    this.smooth = null;
    this.anchor = new THREE.Vector3(0.5, 0.6, 0.5);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uVideo: { value: videoTex },
        uMask: { value: this.maskTex },
        uMap: { value: new THREE.Vector4(1, -1, 1, -1) },
        uAnchor: { value: this.anchor },
        uAspect: { value: 16 / 9 },
        uLum: { value: 0.45 },
        uMix: { value: 0 },
        uKind: { value: 0 },
        uC0: { value: new THREE.Color() },
        uC1: { value: new THREE.Color() },
        uC2: { value: new THREE.Color() },
        uC3: { value: new THREE.Color() },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.outfit = OUTFITS[0];
    this.target = 0;
    this.hasMask = false;
    this.lastMaskT = 0;
  }

  setOutfit(o) {
    if (o.id !== 'off') {
      this.outfit = o;
      const u = this.mat.uniforms;
      u.uKind.value = o.kind;
      ['uC0', 'uC1', 'uC2', 'uC3'].forEach((k, i) => u[k].value.set(o.colors[i]));
    }
    this.target = o.id === 'off' ? 0 : 1;
  }

  // Same mapping as the mirrored, cover-fitted <video> under the canvas (ViewModel.toScreen).
  layout(view) {
    const kx = view.vw * view.k,
      ky = view.vh * view.k;
    this.mat.uniforms.uMap.value.set((view.W - view.ox) / kx, -view.W / kx, (view.H - view.oy) / ky, -view.H / ky);
    this.mat.uniforms.uAspect.value = view.vw / view.vh;
  }

  // New mask from the segmenter: blended with the previous one so edges do not flicker.
  setMask(m, now) {
    const N = m.w * m.h;
    if (!this.smooth || this.smooth.length !== N) {
      this.smooth = new Float32Array(N);
      this.maskData = new Uint8Array(N);
      for (let i = 0; i < N; i++) this.smooth[i] = m.mask[i];
      this.maskTex.dispose();
      this.maskTex = new THREE.DataTexture(this.maskData, m.w, m.h, THREE.RedFormat, THREE.UnsignedByteType);
      this.maskTex.magFilter = THREE.LinearFilter;
      this.maskTex.minFilter = THREE.LinearFilter;
      this.mat.uniforms.uMask.value = this.maskTex;
    }
    const k = 0.65;
    for (let i = 0; i < N; i++) {
      this.smooth[i] += (m.mask[i] - this.smooth[i]) * k;
      this.maskData[i] = this.smooth[i];
    }
    this.maskTex.needsUpdate = true;
    const a = this.hasMask ? 0.5 : 1;
    this.anchor.x += (m.cx - this.anchor.x) * a;
    this.anchor.y += (m.cy - this.anchor.y) * a;
    this.anchor.z += (m.span - this.anchor.z) * a;
    this.mat.uniforms.uLum.value += (m.lum - this.mat.uniforms.uLum.value) * a;
    this.hasMask = true;
    this.lastMaskT = now;
  }

  // now is wall-clock seconds; maskMs is how long the segmenter takes per mask.
  update(now, maskMs = 0) {
    const dt = this.lastNow ? clamp01(now - this.lastNow, 0.5) : 0;
    this.lastNow = now;
    const u = this.mat.uniforms.uMix;
    // a mask that is much older than usual means the segmenter stalled: fade out rather than freeze
    const stale = Math.max(1, (4 * maskMs) / 1000 + 0.5);
    const want = this.hasMask && now - this.lastMaskT < stale ? this.target : 0;
    u.value += (want - u.value) * (1 - Math.exp(-dt / 0.25));
    if (u.value < 0.004) u.value = 0;
    if (u.value > 0.996) u.value = 1;
  }

  get visible() {
    return this.mat.uniforms.uMix.value > 0;
  }

  render(renderer) {
    if (this.visible) renderer.render(this.scene, this.cam);
  }
}
