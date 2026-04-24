import * as THREE from 'three';
import { ISLAND_DATA } from './islands_data.js';

// Deterministic PRNG so the palms / rocks stay put between reloads.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The original arranges islands on a 32 x 24 character grid.  We map that
// directly into the 3D world so the relative layout matches the 1985 ROM.
const GRID_W = 32, GRID_H = 24;
export const WORLD_SIZE = 600;

export function createWorld({ seed = 1 } = {}) {
  const group = new THREE.Group();
  const rand = mulberry32(seed);

  // -------- Sky dome with gradient -----------------------------------
  const skyGeo = new THREE.SphereGeometry(WORLD_SIZE * 1.4, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top:    { value: new THREE.Color(0x5aa7e6) },
      bottom: { value: new THREE.Color(0xe3f4ff) },
    },
    vertexShader: `
      varying vec3 vP;
      void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec3 vP;
      uniform vec3 top; uniform vec3 bottom;
      void main() {
        float h = clamp(vP.y / ${(WORLD_SIZE * 1.4).toFixed(1)} * 1.2 + 0.1, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, h), 1.0);
      }
    `,
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));

  // -------- Sea --------------------------------------------------------
  const seaGeo = new THREE.PlaneGeometry(WORLD_SIZE * 2.4, WORLD_SIZE * 2.4, 64, 64);
  seaGeo.rotateX(-Math.PI / 2);
  const seaMat = new THREE.MeshStandardMaterial({
    color: 0x1f6ea0, roughness: 0.85, metalness: 0.05, flatShading: true,
  });
  const sea = new THREE.Mesh(seaGeo, seaMat);
  group.add(sea);

  // -------- Islands at their extracted ROM positions ------------------
  const islands = [];
  for (const d of ISLAND_DATA) {
    const x = (d.col - (GRID_W - 1) / 2) / (GRID_W - 1) * WORLD_SIZE * 0.9;
    const z = (d.row - (GRID_H - 1) / 2) / (GRID_H - 1) * WORLD_SIZE * 0.9;
    const center = new THREE.Vector3(x, 0, z);
    const isHome = (d.name === 'BASE');
    const base = 12 + Math.max(d.wHint, d.hHint) * 0.9 + (isHome ? 6 : 0);
    const is = makeShapedIsland(center, base, d.shape, isHome, rand);
    is.name = d.name;
    is.col = d.col; is.row = d.row;
    islands.push(is);
  }
  for (const is of islands) group.add(is.mesh);

  // -------- Clouds --------------------------------------------------
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const s = 28 + rand() * 46;
    const g = new THREE.SphereGeometry(s, 10, 8);
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: 0.7,
      roughness: 1, metalness: 0, emissive: 0x223344, emissiveIntensity: 0.05,
      flatShading: true,
    });
    const cl = new THREE.Mesh(g, m);
    cl.position.set(
      (rand()*2-1) * WORLD_SIZE * 0.6,
      110 + rand() * 60,
      (rand()*2-1) * WORLD_SIZE * 0.6,
    );
    cl.scale.set(1.6 + rand()*1.2, 0.6 + rand()*0.3, 1 + rand()*1.0);
    cl.userData.drift = 2 + rand() * 3;
    group.add(cl);
    clouds.push(cl);
  }

  function update(dt, t) {
    // sea waves
    const pos = seaGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = Math.sin((x + t*8) * 0.03) * 0.35 + Math.cos((z - t*6) * 0.04) * 0.35;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    for (const cl of clouds) {
      cl.position.x += cl.userData.drift * dt;
      if (cl.position.x > WORLD_SIZE * 0.7) cl.position.x = -WORLD_SIZE * 0.7;
    }
  }

  return { group, islands, update, gridToWorld, worldSize: WORLD_SIZE };
}

export function gridToWorld(col, row) {
  const x = (col - (GRID_W - 1) / 2) / (GRID_W - 1) * WORLD_SIZE * 0.9;
  const z = (row - (GRID_H - 1) / 2) / (GRID_H - 1) * WORLD_SIZE * 0.9;
  return { x, z };
}


// Nine distinct island silhouettes, keyed off the ROM's 2-byte shape code.
// Code[0] (0/1/2) = footprint style: round / elongated / jagged.
// Code[1] (0/1/2) = profile style:   flat / hill / peak.
//
// These are hand-authored approximations of the original sprite outlines —
// not byte-exact, but each ROM shape pair renders a visibly different
// silhouette so PEAK looks different from LAGOON looks different from CLAW.
function makeShapedIsland(center, radiusBase, shape, isHome, rand) {
  const [footprint, profile] = shape;

  const grp = new THREE.Group();
  grp.position.copy(center);

  // Choose shape parameters
  const FOOTPRINTS = [
    // 0: round
    { rx: 1.0, rz: 1.0, lobes: 0, jitter: 0.06 },
    // 1: elongated (ridge)
    { rx: 1.35, rz: 0.75, lobes: 0, jitter: 0.08 },
    // 2: jagged / lobed (claw / rocks)
    { rx: 1.1, rz: 1.1, lobes: 4, jitter: 0.22 },
  ];
  const PROFILES = [
    // 0: flat atoll
    { height: 2.5, taperTop: 0.85, crown: 'plateau' },
    // 1: rounded hill
    { height: 6,   taperTop: 0.55, crown: 'dome' },
    // 2: sharp peak
    { height: 14,  taperTop: 0.15, crown: 'peak' },
  ];
  const fp = FOOTPRINTS[footprint];
  const pf = PROFILES[profile];

  const rx = radiusBase * fp.rx + (isHome ? 4 : 0);
  const rz = radiusBase * fp.rz + (isHome ? 4 : 0);
  const h  = pf.height + (isHome ? 2 : 0);

  // Underwater base — a cone of rock
  const baseR = Math.max(rx, rz) * 1.3;
  const baseGeo = new THREE.ConeGeometry(baseR, h + 14, 24, 1, false);
  baseGeo.translate(0, -(h + 14) / 2 + h, 0);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a5a80, roughness: 1 });
  grp.add(new THREE.Mesh(baseGeo, baseMat));

  // Beach ring using the same footprint
  const beachMat = new THREE.MeshStandardMaterial({ color: 0xe8d9a8, roughness: 1 });
  const beachGeo = makeFootprintRing(rx * 1.08, rz * 1.08, fp.lobes, fp.jitter, 0.8, rand);
  grp.add(new THREE.Mesh(beachGeo, beachMat));

  // Island body — profile extrusion.  We build it in rings from base to crown.
  const bodyGeo = makeShapedBody(rx, rz, h, pf, fp, rand);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: isHome ? 0x4f9a54 : 0x4a8a47,
    roughness: 0.95, flatShading: true,
  });
  grp.add(new THREE.Mesh(bodyGeo, bodyMat));

  // Decorate
  const decoR = Math.min(rx, rz);
  const palmCount = profile === 2 ? 0 : Math.floor(2 + rand() * 5);
  for (let i = 0; i < palmCount; i++) {
    const palm = makePalm(rand);
    const a = rand() * Math.PI * 2;
    const r = rand() * decoR * 0.65;
    palm.position.set(Math.cos(a) * r, h - 0.4, Math.sin(a) * r);
    grp.add(palm);
  }
  const rocks = profile === 2 ? 6 : 3 + Math.floor(rand()*3);
  for (let i = 0; i < rocks; i++) {
    const rockGeo = new THREE.DodecahedronGeometry(0.6 + rand() * 1.2, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777266, flatShading: true, roughness: 1 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const a = rand() * Math.PI * 2;
    const r = rand() * decoR * 0.85;
    rock.position.set(Math.cos(a)*r, h - 0.2, Math.sin(a)*r);
    rock.rotation.set(rand()*2, rand()*2, rand()*2);
    grp.add(rock);
  }

  const topCenter = new THREE.Vector3(center.x, h, center.z);
  return { mesh: grp, center: center.clone(), radius: Math.max(rx, rz), height: h, topCenter, isHome, shape };
}


// Builds an extruded island body from base to crown using a specified
// profile & footprint.
function makeShapedBody(rx, rz, height, pf, fp, rand) {
  const SEGMENTS = 32;
  const LAYERS = 8;
  const verts = [];
  const norms = [];
  const idx = [];

  function footRadius(angle, layerT) {
    // layerT 0 = base, 1 = top.  Taper controls upper pinch.
    const t = layerT;
    const taper = 1 - t * (1 - pf.taperTop);
    const lobeAmp = fp.lobes > 0 ? fp.jitter * (1 - t * 0.5) : 0;
    const lobe    = fp.lobes > 0 ? Math.cos(angle * fp.lobes) * lobeAmp : 0;
    const jitter  = (Math.sin(angle * 7) + Math.cos(angle * 11)) * fp.jitter * (1 - t * 0.5);
    return (1 + lobe + jitter * 0.3) * taper;
  }

  // Generate rings
  for (let ly = 0; ly <= LAYERS; ly++) {
    const t = ly / LAYERS;
    // Profile curve: flat rises linearly, hill curves smoothly, peak spikes
    let y;
    if (pf.crown === 'plateau') {
      y = height * (t < 0.15 ? t / 0.15 * 0.8 : 0.8 + (t - 0.15) * 0.2);
    } else if (pf.crown === 'dome') {
      y = height * Math.sqrt(t);
    } else {
      y = height * t * t;
    }
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2;
      const r = footRadius(a, t);
      const x = Math.cos(a) * rx * r;
      const z = Math.sin(a) * rz * r;
      verts.push(x, y + 0.4, z);
      // Approximate normals pointing outward (good enough with flatShading)
      norms.push(Math.cos(a), 0.3, Math.sin(a));
    }
  }
  // Close crown
  const crownIdx = verts.length / 3;
  verts.push(0, height + 0.45, 0);
  norms.push(0, 1, 0);

  // Triangulate sides
  for (let ly = 0; ly < LAYERS; ly++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = ly * SEGMENTS + s;
      const b = ly * SEGMENTS + ((s + 1) % SEGMENTS);
      const c = (ly + 1) * SEGMENTS + s;
      const d = (ly + 1) * SEGMENTS + ((s + 1) % SEGMENTS);
      idx.push(a, c, b,  b, c, d);
    }
  }
  // Cap
  for (let s = 0; s < SEGMENTS; s++) {
    const a = LAYERS * SEGMENTS + s;
    const b = LAYERS * SEGMENTS + ((s + 1) % SEGMENTS);
    idx.push(a, crownIdx, b);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Low-lying beach ring follows the same footprint curve.
function makeFootprintRing(rx, rz, lobes, jitter, thickness, rand) {
  const SEGMENTS = 40;
  const verts = [];
  const idx = [];
  function r(a, outward) {
    const lobe = lobes > 0 ? Math.cos(a * lobes) * jitter : 0;
    const jit  = (Math.sin(a * 7) + Math.cos(a * 11)) * jitter * 0.3;
    return 1 + lobe + jit + (outward ? 0.05 : 0);
  }
  for (let s = 0; s < SEGMENTS; s++) {
    const a = (s / SEGMENTS) * Math.PI * 2;
    // Outer ring
    const r2 = r(a, true);
    verts.push(Math.cos(a) * rx * r2, 0,               Math.sin(a) * rz * r2);
    verts.push(Math.cos(a) * rx * r2, thickness,       Math.sin(a) * rz * r2);
  }
  for (let s = 0; s < SEGMENTS; s++) {
    const s2 = (s + 1) % SEGMENTS;
    const a0 = s  * 2;
    const a1 = s  * 2 + 1;
    const b0 = s2 * 2;
    const b1 = s2 * 2 + 1;
    idx.push(a0, a1, b1,  a0, b1, b0);
    // top cap toward center
    idx.push(a1, b1, a1); // degenerate, harmless — we don't need a true top cap
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}


function makeIsland(center, radius, height, isHome, rand, shape) {
  const grp = new THREE.Group();
  grp.position.copy(center);

  // Underwater base
  const baseGeo = new THREE.ConeGeometry(radius * 1.4, height + 14, 24, 1, false);
  baseGeo.translate(0, -(height + 14) / 2 + height, 0);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a5a80, roughness: 1 });
  grp.add(new THREE.Mesh(baseGeo, baseMat));

  // Sandy beach band
  const beachGeo = new THREE.CylinderGeometry(radius * 1.05, radius * 1.15, 0.8, 32);
  beachGeo.translate(0, 0.4, 0);
  const beachMat = new THREE.MeshStandardMaterial({ color: 0xe8d9a8, roughness: 1 });
  grp.add(new THREE.Mesh(beachGeo, beachMat));

  // Main island body with some randomised bumps.  Shape codes:
  //   (2,x) -> tall peak (PEAK, BANANA)
  //   (1,x) -> medium
  //   (0,x) -> low / flat
  const peakBoost = shape[0] === 2 ? 1.6 : (shape[0] === 1 ? 1.0 : 0.5);
  const bodyH = height * peakBoost;
  const bodyGeo = new THREE.CylinderGeometry(radius * 0.92, radius * 1.05, bodyH, 28, 4);
  const vp = bodyGeo.attributes.position;
  for (let i = 0; i < vp.count; i++) {
    const y = vp.getY(i);
    if (y > bodyH * 0.3) {
      vp.setX(i, vp.getX(i) * (0.92 + rand() * 0.12));
      vp.setZ(i, vp.getZ(i) * (0.92 + rand() * 0.12));
      vp.setY(i, y + (rand() - 0.3) * 1.5);
    }
  }
  bodyGeo.computeVertexNormals();
  bodyGeo.translate(0, bodyH / 2 + 0.4, 0);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: isHome ? 0x4f9a54 : 0x4a8a47,
    roughness: 0.95, flatShading: true,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  grp.add(body);

  const palmCount = Math.floor(2 + rand() * 5);
  for (let i = 0; i < palmCount; i++) {
    const palm = makePalm(rand);
    const a = rand() * Math.PI * 2;
    const r = rand() * radius * 0.75;
    palm.position.set(Math.cos(a) * r, bodyH + 0.4, Math.sin(a) * r);
    grp.add(palm);
  }
  for (let i = 0; i < 3 + Math.floor(rand()*3); i++) {
    const rockGeo = new THREE.DodecahedronGeometry(0.6 + rand() * 1.1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777266, flatShading: true, roughness: 1 });
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const a = rand() * Math.PI * 2;
    const r = rand() * radius * 0.85;
    rock.position.set(Math.cos(a)*r, bodyH + 0.3, Math.sin(a)*r);
    rock.rotation.set(rand()*2, rand()*2, rand()*2);
    grp.add(rock);
  }

  const topCenter = new THREE.Vector3(center.x, bodyH + 0.8, center.z);
  return { mesh: grp, center: center.clone(), radius, height: bodyH, topCenter, isHome };
}

function makePalm(rand) {
  const g = new THREE.Group();
  const trunkH = 4 + rand() * 3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.35, trunkH, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1, flatShading: true }),
  );
  trunk.position.y = trunkH / 2;
  trunk.rotation.z = (rand() - 0.5) * 0.3;
  g.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d8a3a, roughness: 1, flatShading: true, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const leafGeo = new THREE.ConeGeometry(0.5, 2.2, 4, 1);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.y = trunkH;
    leaf.rotation.z = Math.PI / 2.4;
    leaf.rotation.y = (i / 7) * Math.PI * 2;
    leaf.position.x = Math.cos((i/7)*Math.PI*2) * 1.2;
    leaf.position.z = Math.sin((i/7)*Math.PI*2) * 1.2;
    leaf.position.y += 0.2;
    leaf.scale.set(1, 1.4 + rand()*0.3, 1);
    g.add(leaf);
  }
  return g;
}
