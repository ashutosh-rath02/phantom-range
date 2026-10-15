// Injected before page scripts: replaces the webcam with a canvas that plays a scripted sequence of real hand photos.
(() => {
  const SCRIPT = window.__FAKE_SCRIPT || [];
  const imgs = {};
  const load = (n) => imgs[n] ||= new Promise((res) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.src = (window.__FAKE_BASE || '') + '/test/img/' + n + '.png'; });
  const total = SCRIPT.reduce((a, s) => a + s.dur, 0);
  const W = 1280, H = 720;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  let start = 0, loaded = {};
  window.__fakeClock = () => (performance.now() - start) / 1000;
  // restart the script once tracking is running, so slow start-up does not eat into the scenario
  window.__fakeRestart = () => { start = performance.now(); };
  async function prep() { for (const s of SCRIPT) { if (s.img) loaded[s.img] = await load(s.img); if (s.img2) loaded[s.img2] = await load(s.img2); } }
  function draw() {
    const t = ((performance.now() - start) / 1000) % total;
    let acc = 0, seg = SCRIPT[0];
    for (const s of SCRIPT) { if (t < acc + s.dur) { seg = s; break; } acc += s.dur; }
    const local = t - acc;
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, '#cfcfcf'); grd.addColorStop(1, '#b4b4b4');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    if (seg && seg.img2 && loaded[seg.img2]) {
      const im = loaded[seg.img2]; const sc = seg.scale2 || seg.scale || 1.3;
      g.save(); g.translate((seg.x2 ?? 0.25) * W, (seg.y2 ?? 0.5) * H); g.rotate((seg.rot2 || 0) * Math.PI / 180); if (seg.flip2) g.scale(-1, 1);
      g.drawImage(im, -im.width * sc / 2, -im.height * sc / 2, im.width * sc, im.height * sc); g.restore();
    }
    if (seg && seg.img && loaded[seg.img]) {
      const im = loaded[seg.img];
      const sc = seg.scale || 1.3;
      const mx = (seg.x ?? 0.5) * W + (seg.wobble ? Math.sin(local * 2.1) * seg.wobble : 0) + (seg.dx || 0) * local;
      const my = (seg.y ?? 0.5) * H + (seg.wobble ? Math.cos(local * 1.7) * seg.wobble * 0.6 : 0) + (seg.dy || 0) * local;
      g.save(); g.translate(mx, my); g.rotate((seg.rot || 0) * Math.PI / 180); if (seg.flip) g.scale(-1, 1);
      g.drawImage(im, -im.width * sc / 2, -im.height * sc / 2, im.width * sc, im.height * sc); g.restore();
    }
    window.__fakeSeg = seg?.name || seg?.img || 'none';
    requestAnimationFrame(draw);
  }
  const md = navigator.mediaDevices || (navigator.mediaDevices = {});
  md.getUserMedia = async () => { await prep(); start = performance.now(); draw(); return cv.captureStream(30); };
  md.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'fake', label: 'Scripted test camera', groupId: 'x' }];
})();
