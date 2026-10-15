// Procedural 3D models: four firearms, brass, targets, and the textures used by effects.
// Units are meters. Gun space: +Z toward the muzzle, +Y up, +X to the gun's right.
// Gun origin = where the shooter's index-finger knuckle sits on the frame.
import * as THREE from 'three';

// ---------- materials ----------
function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#6a3d20';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 128;
    g.strokeStyle = `rgba(${30 + Math.random() * 40},${12 + Math.random() * 20},4,${0.15 + Math.random() * 0.25})`;
    g.lineWidth = 0.5 + Math.random() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 + (Math.random() - 0.5) * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function stippleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    const v = Math.random() > 0.5 ? 200 : 40;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

export function makeMaterials() {
  const stip = stippleTexture();
  const M = {
    gunmetal: new THREE.MeshStandardMaterial({ color: 0x2f3338, metalness: 0.7, roughness: 0.38 }),
    slide: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.75, roughness: 0.34 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x24272b, metalness: 0.8, roughness: 0.34 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.92, roughness: 0.24 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.1, roughness: 0.6 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.05, roughness: 0.9, bumpMap: stip, bumpScale: 0.6 }),
    fde: new THREE.MeshStandardMaterial({ color: 0x9a8262, metalness: 0.06, roughness: 0.72 }),
    od: new THREE.MeshStandardMaterial({ color: 0x4b533f, metalness: 0.08, roughness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), metalness: 0.0, roughness: 0.48 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd2a650, metalness: 1.0, roughness: 0.26 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb8683a, metalness: 1.0, roughness: 0.3 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0e0e0f, metalness: 0.0, roughness: 0.95 }),
    hole: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0c1a2a, metalness: 0.4, roughness: 0.05, emissive: 0x06121e }),
    lensAmber: new THREE.MeshStandardMaterial({ color: 0x3a2a10, metalness: 0.5, roughness: 0.05, emissive: 0x2a1600 }),
    redDot: new THREE.MeshBasicMaterial({ color: 0xff3020 }),
    tritium: new THREE.MeshBasicMaterial({ color: 0x7dff9a }),
    hull: new THREE.MeshStandardMaterial({ color: 0xb02a1e, metalness: 0.0, roughness: 0.45 }),
  };
  // keep reflections from washing dark finishes out to silver in bright rooms
  for (const m of Object.values(M)) if (m.isMeshStandardMaterial) m.envMapIntensity = m === M.brass ? 1.0 : 0.65;
  return M;
}

// ---------- geometry helpers ----------
// Side profile in (z, y) pairs, extruded across X and centered.
function profile(points, width, mat, { bevel = 0.0012, holes = [], curve = 6 } = {}) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
  const depth = Math.max(0.001, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 2,
    curveSegments: curve,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// Cylinder along +Z from z0 to z1.
function tube(r0, r1, z0, z1, mat, y = 0, x = 0, seg = 24) {
  const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1);
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, (z0 + z1) / 2);
  return m;
}

function sphere(r, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
  m.position.set(x, y, z);
  return m;
}

function railTeeth(group, mat, z0, z1, y, width = 0.017) {
  for (let z = z0; z <= z1; z += 0.0105) group.add(box(width, 0.003, 0.005, mat, 0, y, z));
}

function shadowless(obj) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return obj;
}

// ---------- firearms ----------
function buildPistol(M) {
  const root = new THREE.Group();
  const slide = new THREE.Group();
  root.add(slide);
  slide.add(
    profile(
      [
        [-0.072, 0.004], [0.111, 0.004], [0.116, 0.009], [0.116, 0.03], [0.11, 0.036], [-0.066, 0.036], [-0.072, 0.03],
      ],
      0.026,
      M.slide,
      { bevel: 0.0016 },
    ),
  );
  // serrations
  for (let i = 0; i < 8; i++) {
    for (const s of [-1, 1]) slide.add(box(0.0012, 0.024, 0.0014, M.darkSteel, s * 0.0131, 0.02, -0.062 + i * 0.0036));
  }
  // ejection port
  slide.add(box(0.0012, 0.011, 0.032, M.hole, 0.0132, 0.027, 0.016));
  slide.add(box(0.0008, 0.008, 0.026, M.barrel, 0.0128, 0.027, 0.017));
  // sights with tritium dots
  slide.add(box(0.004, 0.006, 0.006, M.darkSteel, 0, 0.039, 0.104));
  slide.add(sphere(0.0011, M.tritium, 0, 0.0405, 0.1005));
  slide.add(box(0.008, 0.007, 0.008, M.darkSteel, -0.0072, 0.0395, -0.058));
  slide.add(box(0.008, 0.007, 0.008, M.darkSteel, 0.0072, 0.0395, -0.058));
  slide.add(sphere(0.0011, M.tritium, -0.0072, 0.041, -0.0535));
  slide.add(sphere(0.0011, M.tritium, 0.0072, 0.041, -0.0535));
  // frame: dust cover, trigger guard, grip
  root.add(
    profile(
      [
        [0.108, 0.004], [0.108, -0.009], [0.1, -0.013], [0.058, -0.013], [0.056, -0.02], [0.055, -0.038], [0.049, -0.045],
        [0.01, -0.045], [0.0, -0.036], [-0.004, -0.03], [-0.011, -0.058], [-0.016, -0.08], [-0.021, -0.098], [-0.023, -0.105],
        [-0.064, -0.108], [-0.068, -0.101], [-0.063, -0.08], [-0.059, -0.055], [-0.058, -0.03], [-0.062, -0.016],
        [-0.08, -0.006], [-0.08, -0.001], [-0.072, 0.004],
      ],
      0.026,
      M.polymer,
      {
        bevel: 0.0015,
        holes: [[[0.047, -0.016], [0.047, -0.036], [0.043, -0.039], [0.012, -0.039], [0.005, -0.032], [0.005, -0.016]]],
      },
    ),
  );
  // grip panels (stippled)
  for (const s of [-1, 1]) {
    const p = profile(
      [[-0.014, -0.04], [-0.02, -0.094], [-0.06, -0.097], [-0.058, -0.04]],
      0.002,
      M.grip,
      { bevel: 0.0006 },
    );
    p.position.x = s * 0.0135;
    root.add(p);
  }
  // accessory rail under dust cover
  for (let z = 0.066; z < 0.104; z += 0.009) root.add(box(0.02, 0.003, 0.004, M.polymer, 0, -0.0145, z));
  // trigger
  const trigger = profile(
    [[0.03, -0.016], [0.032, -0.024], [0.03, -0.032], [0.026, -0.034], [0.027, -0.026], [0.025, -0.016]],
    0.006,
    M.darkSteel,
    { bevel: 0.0008 },
  );
  root.add(trigger);
  // barrel crown + bore
  root.add(tube(0.0058, 0.0058, 0.11, 0.1175, M.barrel, 0.019));
  root.add(tube(0.0039, 0.0039, 0.112, 0.118, M.hole, 0.019));
  // hammer: pivots at its base so it can follow the player's thumb (cocked back, falls on the shot)
  const hammer = new THREE.Group();
  hammer.position.set(0, 0.021, -0.074);
  hammer.add(box(0.007, 0.014, 0.008, M.darkSteel, 0, 0.007, -0.003));
  hammer.add(box(0.006, 0.004, 0.009, M.darkSteel, 0, 0.0125, -0.009));
  root.add(hammer);
  // magazine (drops on reload)
  const mag = new THREE.Group();
  mag.position.set(0, -0.022, -0.036);
  mag.rotation.x = 0.21;
  mag.add(box(0.021, 0.084, 0.03, M.darkSteel, 0, -0.044, 0));
  mag.add(box(0.025, 0.007, 0.041, M.polymer, 0, -0.087, -0.003));
  mag.add(box(0.008, 0.006, 0.012, M.brass, 0, -0.0005, 0.006));
  root.add(mag);
  return {
    root,
    slide,
    mag,
    trigger,
    hammer,
    muzzle: new THREE.Vector3(0, 0.019, 0.121),
    eject: new THREE.Vector3(0.015, 0.029, 0.016),
    magDir: new THREE.Vector3(0, -Math.cos(0.21), -Math.sin(0.21)),
    slideTravel: 0.026,
  };
}

function buildRifle(M) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.position.z = 0.028;
  root.add(g);
  const B = 0.03; // bore height
  // upper receiver
  g.add(profile([[-0.105, 0.012], [0.075, 0.012], [0.075, 0.048], [-0.1, 0.048], [-0.105, 0.042]], 0.026, M.gunmetal, { bevel: 0.0015 }));
  g.add(box(0.017, 0.006, 0.18, M.gunmetal, 0, 0.051, -0.015));
  railTeeth(g, M.darkSteel, -0.1, 0.07, 0.0555);
  // ejection port + forward assist
  g.add(box(0.0012, 0.013, 0.045, M.hole, 0.0133, 0.03, 0.03));
  g.add(tube(0.006, 0.006, -0.06, -0.03, M.darkSteel, 0.036, 0.016, 12));
  // charging handle
  g.add(box(0.03, 0.006, 0.012, M.darkSteel, 0, 0.044, -0.112));
  // lower receiver with magwell
  g.add(
    profile(
      [[-0.1, 0.012], [0.075, 0.012], [0.075, -0.008], [0.07, -0.03], [0.02, -0.03], [0.015, -0.012], [-0.04, -0.012], [-0.1, -0.002], [-0.106, 0.012]],
      0.024,
      M.gunmetal,
      { bevel: 0.0012 },
    ),
  );
  // trigger guard + trigger
  g.add(profile([[0.014, -0.012], [0.014, -0.034], [-0.036, -0.034], [-0.036, -0.012], [-0.032, -0.012], [-0.032, -0.03], [0.01, -0.03], [0.01, -0.012]], 0.008, M.gunmetal, { bevel: 0.0008 }));
  g.add(profile([[-0.004, -0.012], [-0.002, -0.02], [-0.004, -0.028], [-0.008, -0.029], [-0.007, -0.02], [-0.009, -0.012]], 0.005, M.darkSteel, { bevel: 0.0006 }));
  // pistol grip
  g.add(
    profile(
      [[-0.034, -0.012], [-0.044, -0.045], [-0.05, -0.07], [-0.056, -0.1], [-0.058, -0.11], [-0.09, -0.113], [-0.088, -0.1], [-0.078, -0.05], [-0.07, -0.012]],
      0.027,
      M.grip,
      { bevel: 0.002 },
    ),
  );
  // handguard (octagonal) with slots
  const hg = tube(0.024, 0.024, 0.075, 0.33, M.polymer, B, 0, 8);
  hg.rotation.z = Math.PI / 8;
  g.add(hg);
  g.add(box(0.017, 0.006, 0.25, M.polymer, 0, 0.055, 0.2));
  railTeeth(g, M.darkSteel, 0.085, 0.32, 0.0595);
  for (let z = 0.1; z < 0.31; z += 0.035) for (const s of [-1, 1]) g.add(box(0.0012, 0.007, 0.022, M.hole, s * 0.0222, B, z));
  // barrel, front sight, muzzle device
  g.add(tube(0.0078, 0.0078, 0.33, 0.405, M.barrel, B));
  g.add(tube(0.0112, 0.0112, 0.405, 0.45, M.darkSteel, B, 0, 16));
  for (let a = 0; a < 3; a++) {
    const s = box(0.0025, 0.024, 0.03, M.hole, 0, B, 0.432);
    s.rotation.z = (a * Math.PI) / 3;
    g.add(s);
  }
  g.add(tube(0.006, 0.006, 0.448, 0.451, M.hole, B, 0, 12));
  g.add(box(0.012, 0.016, 0.008, M.darkSteel, 0, 0.066, 0.31));
  // buffer tube + stock
  g.add(tube(0.0155, 0.0155, -0.27, -0.105, M.darkSteel, B));
  g.add(
    profile(
      [[-0.2, 0.048], [-0.33, 0.054], [-0.338, 0.042], [-0.338, -0.056], [-0.322, -0.062], [-0.24, -0.004], [-0.2, 0.012]],
      0.034,
      M.polymer,
      { bevel: 0.003 },
    ),
  );
  g.add(box(0.036, 0.11, 0.008, M.rubber, 0, -0.004, -0.343));
  // red dot optic
  g.add(box(0.02, 0.012, 0.04, M.darkSteel, 0, 0.064, 0.0));
  g.add(tube(0.0175, 0.0175, -0.025, 0.035, M.darkSteel, 0.088, 0, 24));
  g.add(tube(0.014, 0.014, 0.034, 0.0365, M.lensAmber, 0.088, 0, 24));
  g.add(tube(0.014, 0.014, -0.0265, -0.024, M.lens, 0.088, 0, 24));
  g.add(sphere(0.0016, M.redDot, 0, 0.088, 0.02));
  g.add(box(0.008, 0.008, 0.012, M.darkSteel, 0.019, 0.088, 0.005));
  // magazine
  const mag = new THREE.Group();
  mag.position.set(0.045, -0.006, 0);
  mag.add(
    (() => {
      const m = profile(
        [[0.023, -0.002], [0.025, -0.05], [0.033, -0.1], [0.047, -0.15], [0.055, -0.172], [0.1, -0.176], [0.093, -0.15], [0.079, -0.1], [0.071, -0.05], [0.069, -0.002]],
        0.022,
        M.polymer,
        { bevel: 0.0012 },
      );
      m.position.z = -0.045;
      return m;
    })(),
  );
  for (let i = 0; i < 5; i++) mag.add(box(0.023, 0.002, 0.03, M.rubber, 0, -0.06 - i * 0.02, 0.01 + i * 0.006));
  mag.add(box(0.007, 0.006, 0.014, M.brass, 0, 0.0, 0.0));
  g.add(mag);
  const charging = new THREE.Group();
  g.add(charging);
  return {
    root,
    slide: charging,
    mag,
    muzzle: new THREE.Vector3(0, B, 0.479),
    eject: new THREE.Vector3(0.015, 0.034, 0.058),
    magDir: new THREE.Vector3(0, -1, 0.15).normalize(),
    slideTravel: 0.0,
  };
}

function buildShotgun(M) {
  const root = new THREE.Group();
  const B = 0.034;
  // receiver
  root.add(profile([[-0.065, 0.004], [0.12, 0.004], [0.12, 0.05], [-0.05, 0.05], [-0.066, 0.044], [-0.07, 0.012]], 0.03, M.gunmetal, { bevel: 0.002 }));
  root.add(box(0.0013, 0.016, 0.06, M.hole, 0.0152, 0.032, 0.05));
  // trigger guard + trigger
  root.add(profile([[0.062, 0.004], [0.06, -0.028], [0.0, -0.03], [-0.006, 0.004], [-0.001, 0.004], [0.004, -0.025], [0.056, -0.024], [0.057, 0.004]], 0.01, M.gunmetal, { bevel: 0.001 }));
  root.add(profile([[0.03, 0.004], [0.032, -0.006], [0.029, -0.016], [0.025, -0.017], [0.027, -0.007], [0.025, 0.004]], 0.006, M.darkSteel, { bevel: 0.0006 }));
  // barrel + vent rib + bead
  root.add(tube(0.0108, 0.0102, 0.12, 0.62, M.barrel, B));
  root.add(box(0.008, 0.004, 0.49, M.darkSteel, 0, B + 0.012, 0.37));
  root.add(sphere(0.0022, M.brass, 0, B + 0.016, 0.612));
  root.add(tube(0.0078, 0.0078, 0.618, 0.6215, M.hole, B, 0, 16));
  // magazine tube + cap
  root.add(tube(0.0115, 0.0115, 0.12, 0.54, M.gunmetal, 0.009));
  root.add(tube(0.0125, 0.0118, 0.54, 0.556, M.darkSteel, 0.009));
  // pump forend (wood) with grooves
  const pump = new THREE.Group();
  const fe = tube(0.021, 0.021, 0.2, 0.375, M.wood, 0.011, 0, 20);
  fe.scale.y = 1.15;
  pump.add(fe);
  for (let z = 0.215; z < 0.37; z += 0.016) {
    const r = tube(0.0215, 0.0215, z, z + 0.004, M.darkSteel, 0.011, 0, 20);
    r.scale.y = 1.15;
    pump.add(r);
  }
  pump.add(box(0.004, 0.004, 0.1, M.darkSteel, 0.016, 0.02, 0.15));
  pump.add(box(0.004, 0.004, 0.1, M.darkSteel, -0.016, 0.02, 0.15));
  root.add(pump);
  // wooden stock: wrist + butt
  root.add(
    profile(
      [[-0.06, 0.046], [-0.16, 0.032], [-0.4, 0.042], [-0.418, 0.038], [-0.42, -0.086], [-0.398, -0.09], [-0.18, -0.03], [-0.1, -0.032], [-0.066, 0.006]],
      0.036,
      M.wood,
      { bevel: 0.004, curve: 10 },
    ),
  );
  root.add(box(0.038, 0.13, 0.012, M.rubber, 0, -0.024, -0.425));
  // side saddle shells (left side)
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.036, 12), M.hull);
    s.position.set(-0.027, 0.03, 0.012 + i * 0.021);
    root.add(s);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0098, 0.0098, 0.01, 12), M.brass);
    b.position.set(-0.027, 0.007, 0.012 + i * 0.021);
    root.add(b);
  }
  root.add(box(0.004, 0.04, 0.09, M.polymer, -0.0168, 0.024, 0.043));
  return {
    root,
    slide: pump,
    mag: null,
    pump,
    muzzle: new THREE.Vector3(0, B, 0.625),
    eject: new THREE.Vector3(0.017, 0.034, 0.05),
    slideTravel: 0.07,
  };
}

function buildSniper(M) {
  const root = new THREE.Group();
  const B = 0.035;
  // round receiver
  root.add(tube(0.017, 0.017, -0.105, 0.115, M.darkSteel, B));
  root.add(box(0.0012, 0.012, 0.06, M.hole, 0.0168, B + 0.004, 0.0));
  // bolt (rotates up and pulls back)
  const bolt = new THREE.Group();
  bolt.position.set(0, B, -0.1);
  bolt.add(tube(0.009, 0.009, -0.055, 0.0, M.barrel, 0));
  const handle = tube(0.0035, 0.0035, 0, 0.045, M.barrel, 0, 0, 10);
  handle.rotation.set(0, Math.PI / 2, -0.5);
  handle.position.set(0.02, -0.011, 0.012);
  bolt.add(handle);
  bolt.add(sphere(0.0085, M.darkSteel, 0.041, -0.022, 0.012));
  root.add(bolt);
  // fluted barrel + brake
  root.add(tube(0.0125, 0.0092, 0.115, 0.7, M.darkSteel, B, 0, 20));
  for (let a = 0; a < 6; a++) {
    const f = box(0.0012, 0.003, 0.3, M.hole, Math.cos((a * Math.PI) / 3) * 0.0112, B + Math.sin((a * Math.PI) / 3) * 0.0112, 0.3);
    f.rotation.z = (a * Math.PI) / 3;
    root.add(f);
  }
  root.add(tube(0.0145, 0.0145, 0.7, 0.768, M.darkSteel, B, 0, 16));
  for (const z of [0.716, 0.735, 0.754]) for (const s of [-1, 1]) root.add(box(0.002, 0.012, 0.008, M.hole, s * 0.0142, B, z));
  root.add(tube(0.0064, 0.0064, 0.766, 0.7695, M.hole, B, 0, 12));
  // chassis: forend + action bed + grip + stock with thumbhole
  root.add(
    profile(
      [[-0.105, 0.022], [0.43, 0.022], [0.44, 0.004], [0.43, -0.024], [0.06, -0.03], [0.044, -0.038], [0.0, -0.038], [-0.03, -0.022], [-0.105, -0.016]],
      0.04,
      M.od,
      { bevel: 0.003 },
    ),
  );
  for (let z = 0.08; z < 0.42; z += 0.04) for (const s of [-1, 1]) root.add(box(0.0012, 0.01, 0.024, M.hole, s * 0.0202, 0.0, z));
  root.add(profile([[0.042, -0.03], [0.04, -0.06], [-0.004, -0.06], [-0.004, -0.038]], 0.024, M.darkSteel, { bevel: 0.0012 }));
  root.add(profile([[-0.006, -0.03], [-0.016, -0.055], [-0.024, -0.09], [-0.03, -0.112], [-0.064, -0.116], [-0.058, -0.08], [-0.046, -0.04], [-0.04, -0.018]], 0.028, M.grip, { bevel: 0.002 }));
  root.add(profile([[0.034, -0.038], [0.034, -0.052], [-0.008, -0.05], [-0.01, -0.038], [-0.006, -0.038], [-0.004, -0.046], [0.03, -0.048], [0.03, -0.038]], 0.008, M.darkSteel, { bevel: 0.0008 }));
  root.add(
    profile(
      [[-0.1, 0.03], [-0.36, 0.05], [-0.372, 0.046], [-0.372, -0.078], [-0.352, -0.084], [-0.2, -0.036], [-0.105, -0.016]],
      0.038,
      M.od,
      { bevel: 0.003, holes: [[[-0.27, 0.012], [-0.17, 0.006], [-0.18, -0.018], [-0.27, -0.034]]] },
    ),
  );
  root.add(box(0.04, 0.13, 0.012, M.rubber, 0, -0.017, -0.378));
  root.add(box(0.03, 0.012, 0.11, M.darkSteel, 0, 0.056, -0.29));
  // bipod (folded)
  for (const s of [-1, 1]) {
    const leg = tube(0.004, 0.004, 0.26, 0.41, M.darkSteel, -0.034, s * 0.012, 8);
    root.add(leg);
  }
  root.add(box(0.03, 0.012, 0.02, M.darkSteel, 0, -0.03, 0.415));
  // scope with rings and turrets
  const S = 0.088;
  for (const z of [-0.06, 0.07]) {
    root.add(box(0.026, 0.03, 0.014, M.darkSteel, 0, 0.068, z));
    root.add(tube(0.0185, 0.0185, z - 0.007, z + 0.007, M.darkSteel, S, 0, 20));
  }
  root.add(tube(0.0152, 0.0152, -0.12, 0.15, M.polymer, S));
  root.add(tube(0.0152, 0.027, 0.15, 0.19, M.polymer, S));
  root.add(tube(0.027, 0.027, 0.19, 0.255, M.polymer, S));
  root.add(tube(0.023, 0.023, 0.254, 0.257, M.lens, S));
  root.add(tube(0.0152, 0.02, -0.15, -0.12, M.polymer, S));
  root.add(tube(0.02, 0.02, -0.205, -0.15, M.polymer, S));
  root.add(tube(0.017, 0.017, -0.207, -0.204, M.lens, S));
  const tu = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.024, 20), M.darkSteel);
  tu.position.set(0, S + 0.026, 0.01);
  root.add(tu);
  const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.02, 20), M.darkSteel);
  tw.rotation.z = Math.PI / 2;
  tw.position.set(0.024, S, 0.01);
  root.add(tw);
  // magazine
  const mag = new THREE.Group();
  mag.position.set(0, -0.038, 0.02);
  mag.add(box(0.024, 0.045, 0.06, M.darkSteel, 0, -0.022, 0));
  mag.add(box(0.026, 0.006, 0.064, M.polymer, 0, -0.046, 0));
  root.add(mag);
  return {
    root,
    slide: null,
    bolt,
    mag,
    muzzle: new THREE.Vector3(0, B, 0.772),
    eject: new THREE.Vector3(0.02, 0.045, -0.01),
    magDir: new THREE.Vector3(0, -1, 0),
    slideTravel: 0,
  };
}

export function buildGun(id, M) {
  const b = { pistol: buildPistol, rifle: buildRifle, shotgun: buildShotgun, sniper: buildSniper }[id](M);
  shadowless(b.root);
  // Guns are drawn a little under real size (long guns more) so they stay on screen when held close to the camera.
  b.root.scale.setScalar(id === 'pistol' ? 0.94 : 0.82); // muzzle/eject points stay in model units; localToWorld applies the scale
  return b;
}

// ---------- brass ----------
export function buildShellGeometries() {
  const lathe = (pts) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 14);
  return {
    pistol: lathe([[0, 0], [0.0049, 0], [0.0049, 0.0012], [0.0044, 0.0016], [0.0048, 0.002], [0.0048, 0.019], [0, 0.019]]),
    rifle: lathe([[0, 0], [0.0048, 0], [0.0048, 0.001], [0.0041, 0.0016], [0.0048, 0.0022], [0.0048, 0.034], [0.0032, 0.038], [0.0031, 0.045], [0, 0.045]]),
    sniper: lathe([[0, 0], [0.006, 0], [0.006, 0.0012], [0.0052, 0.002], [0.006, 0.0028], [0.006, 0.052], [0.0042, 0.057], [0.0041, 0.069], [0, 0.069]]),
    shotgun: lathe([[0, 0], [0.0109, 0], [0.0109, 0.016], [0.0104, 0.0165], [0.0104, 0.07], [0.0085, 0.071], [0, 0.071]]),
  };
}

export function buildShellMesh(type, geos, M) {
  if (type === 'shotgun') {
    const g = new THREE.Group();
    const hullMesh = new THREE.Mesh(geos.shotgun, M.hull);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.016, 14), M.brass);
    base.position.y = 0.008;
    g.add(hullMesh, base);
    return g;
  }
  return new THREE.Mesh(geos[type], M.brass);
}

// ---------- effect textures ----------
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeFxTextures() {
  const flashStar = canvasTex(256, (g, s) => {
    const c = s / 2;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random() * 0.3;
      const len = c * (0.55 + Math.random() * 0.45);
      const w = 0.12 + Math.random() * 0.1;
      const grad = g.createLinearGradient(c, c, c + Math.cos(a) * len, c + Math.sin(a) * len);
      grad.addColorStop(0, 'rgba(255,240,200,0.95)');
      grad.addColorStop(0.4, 'rgba(255,170,60,0.6)');
      grad.addColorStop(1, 'rgba(255,90,10,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.cos(a - w) * len * 0.35, c + Math.sin(a - w) * len * 0.35);
      g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      g.lineTo(c + Math.cos(a + w) * len * 0.35, c + Math.sin(a + w) * len * 0.35);
      g.closePath();
      g.fill();
    }
    const r = g.createRadialGradient(c, c, 0, c, c, c * 0.45);
    r.addColorStop(0, 'rgba(255,255,240,1)');
    r.addColorStop(0.3, 'rgba(255,210,120,0.8)');
    r.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
  const flashSide = canvasTex(256, (g, s) => {
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) {
      const grad = g.createLinearGradient(0, s / 2, s, s / 2);
      grad.addColorStop(0, 'rgba(255,250,220,1)');
      grad.addColorStop(0.25, 'rgba(255,190,90,0.85)');
      grad.addColorStop(0.7, 'rgba(255,110,20,0.35)');
      grad.addColorStop(1, 'rgba(255,60,0,0)');
      g.fillStyle = grad;
      const h = s * (0.12 + Math.random() * 0.1);
      g.beginPath();
      g.moveTo(0, s / 2 - h * 0.25);
      g.quadraticCurveTo(s * 0.4, s / 2 - h * (1 + Math.random() * 0.4), s * (0.75 + Math.random() * 0.25), s / 2 + (Math.random() - 0.5) * h * 0.4);
      g.quadraticCurveTo(s * 0.4, s / 2 + h * (1 + Math.random() * 0.4), 0, s / 2 + h * 0.25);
      g.fill();
    }
  });
  const glow = canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });
  const smoke = canvasTex(128, (g, s) => {
    for (let i = 0; i < 14; i++) {
      const x = s / 2 + (Math.random() - 0.5) * s * 0.35,
        y = s / 2 + (Math.random() - 0.5) * s * 0.35;
      const rr = s * (0.15 + Math.random() * 0.2);
      const r = g.createRadialGradient(x, y, 0, x, y, rr);
      r.addColorStop(0, 'rgba(255,255,255,0.35)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    }
  });
  const chip = canvasTex(64, (g, s) => {
    g.fillStyle = 'rgba(0,0,0,0)';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#9aa3aa';
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r = s * (0.28 + Math.random() * 0.18);
      g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r);
    }
    g.fill();
    g.fillStyle = '#d7dde2';
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.14, 0, Math.PI * 2);
    g.fill();
  });
  return { flashStar, flashSide, glow, smoke, chip };
}

// ---------- targets ----------
export function makeTargetMaterials() {
  return {
    paint: new THREE.MeshStandardMaterial({ color: 0xff6324, metalness: 0.15, roughness: 0.55 }),
    paintWhite: new THREE.MeshStandardMaterial({ color: 0xf1ede4, metalness: 0.1, roughness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8c949b, metalness: 0.9, roughness: 0.35 }),
    chain: new THREE.MeshStandardMaterial({ color: 0x6d747a, metalness: 0.9, roughness: 0.4 }),
    beam: new THREE.MeshStandardMaterial({ color: 0x2b2f33, metalness: 0.7, roughness: 0.5 }),
    clayTop: new THREE.MeshStandardMaterial({ color: 0xff5a14, metalness: 0.0, roughness: 0.7 }),
    clayBot: new THREE.MeshStandardMaterial({ color: 0x1d1a17, metalness: 0.0, roughness: 0.85 }),
    glassGreen: new THREE.MeshStandardMaterial({ color: 0x2d7a43, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.78, envMapIntensity: 1.8 }),
    glassBrown: new THREE.MeshStandardMaterial({ color: 0x7a3c10, metalness: 0.1, roughness: 0.06, transparent: true, opacity: 0.82, envMapIntensity: 1.8 }),
    glassClear: new THREE.MeshStandardMaterial({ color: 0xbfe0e4, metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.55, envMapIntensity: 2.0 }),
    label: new THREE.MeshStandardMaterial({ color: 0xe9dcc0, metalness: 0, roughness: 0.8 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 }),
    droneBody: new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.35, roughness: 0.45 }),
    droneAccent: new THREE.MeshStandardMaterial({ color: 0xff6324, metalness: 0.2, roughness: 0.5 }),
    rotor: new THREE.MeshBasicMaterial({ color: 0xb8c0c8, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    ledRed: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    ledGreen: new THREE.MeshBasicMaterial({ color: 0x3dff7a }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0b1420, metalness: 0.6, roughness: 0.1 }),
  };
}

export function buildPlate(radius, T) {
  const g = new THREE.Group();
  const swing = new THREE.Group(); // pivots at the hanger
  g.add(swing);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.014, 40), [T.steel, T.paint, T.paint]);
  disc.rotation.x = Math.PI / 2;
  disc.position.y = -radius - 0.06;
  swing.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.32, radius * 0.4, 40), T.paintWhite);
  ring.position.set(0, -radius - 0.06, 0.0075);
  swing.add(ring);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.12, 30), T.paintWhite);
  dot.position.set(0, -radius - 0.06, 0.0076);
  swing.add(dot);
  const tab = new THREE.Mesh(new THREE.BoxGeometry(radius * 0.5, 0.07, 0.012), T.steel);
  tab.position.y = -0.04;
  swing.add(tab);
  for (const s of [-1, 1]) {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.6, 6), T.chain);
    ch.position.set(s * radius * 0.18, 0.8, 0);
    g.add(ch);
  }
  return { group: g, swing, face: disc, faceCenterY: -radius - 0.06 };
}

export function buildBottle(T, kind) {
  const prof = [
    [0, 0], [0.032, 0], [0.036, 0.006], [0.036, 0.15], [0.03, 0.18], [0.016, 0.205], [0.013, 0.24], [0.015, 0.245], [0.015, 0.255], [0, 0.255],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const mat = kind === 0 ? T.glassGreen : kind === 1 ? T.glassBrown : T.glassClear;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), mat);
  g.add(body);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0368, 0.0368, 0.06, 24, 1, true, -1.2, 2.4), T.label);
  label.position.y = 0.075;
  g.add(label);
  return { group: g, mat };
}

export function buildClay(T) {
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.LatheGeometry(
      [[0, 0.016], [0.02, 0.0155], [0.04, 0.013], [0.052, 0.008], [0.056, 0.003], [0.055, 0]].map(([r, y]) => new THREE.Vector2(r, y)),
      28,
    ),
    T.clayTop,
  );
  const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.006, 28), T.clayBot);
  bot.position.y = -0.002;
  g.add(top, bot);
  // concentric rings on top
  for (const r of [0.025, 0.04]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0016, 4, 28), T.clayBot);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.0155 - (r / 0.056) * 0.008;
    g.add(ring);
  }
  return g;
}

export function buildClayShard(T) {
  const geo = new THREE.CylinderGeometry(0.055, 0.05, 0.012, 4, 1, false, 0, Math.PI / 3);
  return new THREE.Mesh(geo, T.clayTop);
}

export function buildDrone(T) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.16), T.droneBody);
  g.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.008, 0.12), T.droneAccent);
  stripe.position.y = 0.018;
  g.add(stripe);
  const rotors = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.19), T.droneBody);
    arm.position.set(sx * 0.07, 0.005, sz * 0.07);
    arm.rotation.y = sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4;
    g.add(arm);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.028, 14), T.droneBody);
    motor.position.set(sx * 0.13, 0.016, sz * 0.13);
    g.add(motor);
    const rotor = new THREE.Mesh(new THREE.CircleGeometry(0.085, 28), T.rotor);
    rotor.rotation.x = -Math.PI / 2;
    rotor.position.set(sx * 0.13, 0.034, sz * 0.13);
    g.add(rotor);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.002, 0.012), T.droneBody);
    blade.position.set(sx * 0.13, 0.035, sz * 0.13);
    g.add(blade);
    rotors.push(blade);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), sz > 0 ? T.ledGreen : T.ledRed);
    led.position.set(sx * 0.13, 0.0, sz * 0.13);
    g.add(led);
  }
  const cam = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), T.droneBody);
  cam.position.set(0, -0.03, 0.06);
  g.add(cam);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.011, 16), T.lens);
  lens.position.set(0, -0.03, 0.0825);
  g.add(lens);
  return { group: g, rotors };
}

export function buildShelf(T) {
  const g = new THREE.Group();
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.22), T.wood);
  g.add(plank);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 0.06), T.wood);
    leg.position.set(s * 0.36, -0.62, 0);
    g.add(leg);
  }
  return g;
}

// Studio-ish environment so metal has something to reflect.
export function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(12, 6, 12),
    new THREE.MeshBasicMaterial({ color: 0x5d636b, side: THREE.BackSide }),
  );
  scene.add(room);
  const panel = (w, h, color, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    scene.add(m);
  };
  const L = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
  panel(8, 1.2, L(0xffffff, 1), 0, 2.95, 0, 0, Math.PI / 2);
  panel(8, 0.8, L(0xdfe8ff, 1), 0, 2.95, -3.5, 0, Math.PI / 2);
  panel(8, 0.8, L(0xdfe8ff, 1), 0, 2.95, 3.5, 0, Math.PI / 2);
  panel(4, 3, 0xffe2bd, -5.95, 1, 0, Math.PI / 2);
  panel(3, 2.4, 0xbcd2ff, 5.95, 1.2, -2, -Math.PI / 2);
  panel(5, 2.5, 0xf2f2f2, 0, 1, -5.95, 0);
  panel(5, 2.5, 0xd9dde3, 0, 1, 5.95, Math.PI);
  panel(12, 12, 0x24272b, 0, -2.95, 0, 0, Math.PI / 2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.03).texture;
  pmrem.dispose();
  return env;
}
