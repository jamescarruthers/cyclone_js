import * as THREE from 'three';
import { ISLAND_DATA } from './islands_data.js';
import { romXYToWorld, ROM_SCALE } from './helicopter.js';
import { heightmapFor } from './terrain.js';

// World height of one terrain level (alt/4 units -> altitude*ALT_SCALE):
// level * 4 ROM altitude units * (ROM_SCALE * 0.8) world per unit.
const LEVEL_Y = 4 * ROM_SCALE * 0.8;

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

  // -------- Islands: authentic terrain ---------------------------------
  // Geometry is built straight from the surveyed heightmaps — the
  // terraced terrain the 1985 renderer actually tests collisions and
  // landings against (one terrace = 4 altitude units = LEVEL_Y world).
  // Order matters: world.islands[i] corresponds to islandAt() index i.
  const islands = [];
  for (let i = 0; i < ISLAND_DATA.length; i++) {
    const d = ISLAND_DATA[i];
    const hm = heightmapFor(i);
    const is = makeTerrainIsland(d, hm, d.name === 'BASE', rand);
    is.name = d.name;
    is.bounds = d;
    is.hm = hm;
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

  return { group, islands, update, worldSize: WORLD_SIZE };
}


// Builds an island mesh directly from its surveyed heightmap: terraced
// flat-topped terrain with cliff walls, exactly the height field the
// 1985 renderer tests collisions and landings against.  Levels are
// altitude/4 units; one level = LEVEL_Y world units.  Colours by level:
// sand at the waterline, grasses, rock, and the dark "structure" levels
// (>= 14) that the landing comparator can never clear.
function makeTerrainIsland(d, hm, isHome, rand) {
  const grp = new THREE.Group();
  const cellW = hm.step * ROM_SCALE;

  const sample = (i, j) =>
    (i < 0 || j < 0 || i >= hm.w || j >= hm.h) ? 0 : parseInt(hm.rows[j][i], 36);

  const COLORS = [
    [1,  new THREE.Color(0xd8c388)],   // beach
    [2,  new THREE.Color(0x9fb24e)],   // low grass
    [5,  new THREE.Color(0x4a8a47)],   // grass
    [9,  new THREE.Color(0x3a6e3a)],   // high grass
    [13, new THREE.Color(0x8a8576)],   // rock
    [99, new THREE.Color(0x55514a)],   // structures / unclearable
  ];
  const colorFor = (v) => COLORS.find(([max]) => v <= max)[1];
  const wallColor = (c) => c.clone().multiplyScalar(0.72);

  const pos = [], nrm = [], col = [];
  const quad = (a, b, c2, dd, n, color) => {
    for (const p of [a, b, c2, a, c2, dd]) pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 6; k++) { nrm.push(n[0], n[1], n[2]); col.push(color.r, color.g, color.b); }
  };

  const landCells = [];
  let top = { v: 0, x: 0, z: 0 };
  for (let j = 0; j < hm.h; j++) {
    for (let i = 0; i < hm.w; i++) {
      const v = sample(i, j);
      if (v === 0) continue;
      const x0 = romXYToWorld(hm.x0 + i * hm.step) - cellW / 2;
      const z0 = romXYToWorld(hm.y0 + j * hm.step) - cellW / 2;
      const x1 = x0 + cellW, z1 = z0 + cellW;
      const y = v * LEVEL_Y;
      const c = colorFor(v);
      quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], c);
      // cliff walls down to each lower neighbour (or the sea)
      const wc = wallColor(c);
      const sides = [
        [sample(i, j - 1), [x0, z0], [x1, z0], [0, 0, -1]],   // north
        [sample(i + 1, j), [x1, z0], [x1, z1], [1, 0, 0]],    // east
        [sample(i, j + 1), [x1, z1], [x0, z1], [0, 0, 1]],    // south
        [sample(i - 1, j), [x0, z1], [x0, z0], [-1, 0, 0]],   // west
      ];
      for (const [nv, p0, p1, n] of sides) {
        if (nv >= v) continue;
        const yLo = nv * LEVEL_Y;
        quad([p0[0], y, p0[1]], [p1[0], y, p1[1]],
             [p1[0], yLo, p1[1]], [p0[0], yLo, p0[1]], n, wc);
      }
      const romX = hm.x0 + i * hm.step, romY = hm.y0 + j * hm.step;
      if (v >= 2 && v <= 9) {
        landCells.push({
          x: romX, y: romY, v,
          wx: romXYToWorld(romX), wy: v * LEVEL_Y, wz: romXYToWorld(romY),
        });
      }
      if (v > top.v) top = { v, x: romXYToWorld(romX), z: romXYToWorld(romY) };
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  grp.add(new THREE.Mesh(geo, mat));

  // Decoration on real land cells: palms on the grassy levels, rocks on
  // the high ground.
  for (const cell of landCells) {
    if (cell.v >= 2 && cell.v <= 6 && rand() < 0.05) {
      const palm = makePalm(rand);
      palm.position.set(romXYToWorld(cell.x), cell.v * LEVEL_Y, romXYToWorld(cell.y));
      grp.add(palm);
    }
  }

  const cx = romXYToWorld((d.x0 + d.x1) / 2), cz = romXYToWorld((d.y0 + d.y1) / 2);
  const rx = (d.x1 - d.x0) / 2 * ROM_SCALE;
  const rz = (d.y1 - d.y0) / 2 * ROM_SCALE;
  return {
    mesh: grp,
    center: new THREE.Vector3(cx, 0, cz),
    radius: Math.min(rx, rz), rx, rz,
    height: top.v * LEVEL_Y,
    topCenter: new THREE.Vector3(top.x, top.v * LEVEL_Y, top.z),
    isHome,
    landCells,
  };
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
