import * as THREE from 'three';
import { ISLAND_DATA } from './islands_data.js';

// Cyclone — movement mirrors the ROM behaviour we have confirmed by
// disassembly:
//
//   * State vars at $754B (col) and $754C (row) on the 32x24 grid.
//     Disassembly of the init routine at $8378..$838B shows:
//
//         CALL $8B74                  ; ROM rand into HL, bits of L read below
//         LD   A,$02
//         BIT  0,L  ;  JR Z,..  ; LD A,$14    -> col = $02 or $14
//         LD   ($754B),A
//         LD   A,$02
//         BIT  1,L  ;  JR Z,..  ; LD A,$13    -> row = $02 or $13
//         LD   ($754C),A
//
//     So the ROM spawns the cyclone in one of FOUR map corners each
//     game: (2, 2), (20, 2), (2, 19), (20, 19).  We do the same.
//
//   * Wind-force at $7550 is the Chebyshev distance (max of |dcol|,
//     |drow|) between player ($7540/$7541) and cyclone ($754B/$754C),
//     clamped to 0..15 (see $9111..$9138).  That drives the WIND /
//     DANGER / FORCE meter and the crate-destruction trigger.
//
// The inter-cell drift *pattern* still uses a waypoint tour below —
// porting the ROM's entity-scheduler at $87F0 (which walks the entity
// list starting at $E740) is a bigger RE job.  Pacing is tuned to the
// ROM's observed sweep time.
//
// Exports: CYCLONE_SPAWNS and CYCLONE_GRID are consumed by main.js.

const TICK_HZ = 50;
const TICK_DT = 1 / TICK_HZ;

// ROM position units per tick.  Helicopter moves 1 unit / tick at max,
// so the cyclone at ~0.12 unit / tick is about 1/8 helicopter speed.
const CYCLONE_STEP = 0.12;

export const CYCLONE_GRID = { W: 32, H: 24 };

// Four corner spawn positions, recovered from $8378..$838B
export const CYCLONE_SPAWNS = [
  { col:  2, row:  2 }, { col: 20, row:  2 },
  { col:  2, row: 19 }, { col: 20, row: 19 },
];

// Build a waypoint tour through the archipelago.  We pick a fixed order
// chosen to visit the outer ring first, then spiral inward, producing a
// predictable but threatening sweep.
function buildTour() {
  // Order to visit, selected so adjacent waypoints are roughly reachable
  // without hopping back and forth — approximates the ROM's smooth drift.
  const order = [
    'PEAK', 'BONE', 'BANANA', 'CLAW', 'RED', 'ORTE ROCKS',
    'LUKELAND ISLES', 'SKEG', 'ENTERPRISE', 'BASE',
    'LAGOON', 'GILLIGANS', 'KOKOLA', 'GIANTS GATEWAY',
  ];
  const byName = Object.fromEntries(ISLAND_DATA.map(d => [d.name, d]));
  return order.map(n => byName[n]).filter(Boolean);
}


export function createCyclone(worldSize = 600) {
  const group = new THREE.Group();

  // --------- visual: stack of particle rings + funnel mesh -------------
  const RADIUS = 28;
  const HEIGHT = 180;
  const LAYERS = 60, PER_LAYER = 42;
  const positions = new Float32Array(LAYERS * PER_LAYER * 3);
  const colors    = new Float32Array(LAYERS * PER_LAYER * 3);
  const sizes     = new Float32Array(LAYERS * PER_LAYER);
  const phases    = new Float32Array(LAYERS * PER_LAYER);

  let k = 0;
  for (let L = 0; L < LAYERS; L++) {
    const t = L / (LAYERS - 1);
    const y = t * HEIGHT;
    const shape = Math.sin(Math.pow(t, 0.6) * Math.PI);
    const r = 4 + shape * RADIUS * 1.4;
    for (let P = 0; P < PER_LAYER; P++) {
      const a = (P / PER_LAYER) * Math.PI * 2;
      positions[k*3+0] = Math.cos(a) * r;
      positions[k*3+1] = y;
      positions[k*3+2] = Math.sin(a) * r;
      const v = 0.55 + Math.random() * 0.3;
      const warm = Math.random() * 0.15;
      colors[k*3+0] = v + warm;
      colors[k*3+1] = v;
      colors[k*3+2] = v - warm * 0.5;
      sizes[k]  = 2.8 + Math.random() * 4.0;
      phases[k] = Math.random() * Math.PI * 2;
      k++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase',   new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0.55 } },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vA;
      void main() {
        vColor = color;
        vec3 p = position;
        p.x += sin(uTime * 1.3 + aPhase) * 0.8;
        p.z += cos(uTime * 1.1 + aPhase * 1.3) * 0.8;
        p.y += sin(uTime * 0.8 + aPhase) * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * (260.0 / -mv.z);
        vA = smoothstep(180.0, 20.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vA;
      uniform float uAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float soft = smoothstep(0.5, 0.15, d);
        gl_FragColor = vec4(vColor, soft * uAlpha * vA);
      }
    `,
    transparent: true, depthWrite: false, vertexColors: true,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  group.add(points);
  const funnelGeo = new THREE.CylinderGeometry(8, 3, HEIGHT, 20, 1, true);
  funnelGeo.translate(0, HEIGHT / 2, 0);
  const funnel = new THREE.Mesh(funnelGeo, new THREE.MeshBasicMaterial({
    color: 0x2c2f35, transparent: true, opacity: 0.35,
    side: THREE.DoubleSide, depthWrite: false,
  }));
  group.add(funnel);

  // --------- tour state ------------------------------------------------
  const GRID_W = 32, GRID_H = 24;
  function gridToWorld(col, row) {
    return {
      x: (col - (GRID_W - 1) / 2) / (GRID_W - 1) * worldSize * 0.9,
      z: (row - (GRID_H - 1) / 2) / (GRID_H - 1) * worldSize * 0.9,
    };
  }
  const tour = buildTour();
  let tourIndex = 0;
  const target = new THREE.Vector3();
  function setTargetFromTour() {
    const t = tour[tourIndex];
    const w = gridToWorld(t.col, t.row);
    target.set(w.x, 0, w.z);
  }

  // ROM spawn (see $8378..$838B): pick one of the four map corners.
  const spawn = CYCLONE_SPAWNS[Math.floor(Math.random() * CYCLONE_SPAWNS.length)];
  {
    const w = gridToWorld(spawn.col, spawn.row);
    group.position.set(w.x, 0, w.z);
  }
  // Aim tour at the nearest waypoint not in the spawn corner so the first
  // move is toward the map centre rather than snapping back across the grid.
  {
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < tour.length; i++) {
      const w = tour[i];
      const dc = (w.col - spawn.col), dr = (w.row - spawn.row);
      const d = dc*dc + dr*dr;
      if (d > 0 && d < bestD) { bestD = d; bestI = i; }
    }
    tourIndex = bestI;
    setTargetFromTour();
  }

  // Read-only grid position exposed to main.js for the ROM's Chebyshev
  // wind formula ($9111..$9138).
  const gridPos = { col: spawn.col, row: spawn.row };
  function updateGridPos() {
    // Invert gridToWorld
    const cx = group.position.x;
    const cz = group.position.z;
    const col = Math.round(cx / (worldSize * 0.9) * (GRID_W - 1) + (GRID_W - 1) / 2);
    const row = Math.round(cz / (worldSize * 0.9) * (GRID_H - 1) + (GRID_H - 1) / 2);
    gridPos.col = Math.max(0, Math.min(GRID_W - 1, col));
    gridPos.row = Math.max(0, Math.min(GRID_H - 1, row));
  }

  // --------- fixed-step update ----------------------------------------
  let tickAcc = 0;
  const dir = new THREE.Vector3();
  function oneTick() {
    dir.copy(target).sub(group.position);
    dir.y = 0;
    const d = dir.length();
    if (d < 6) {
      // arrived at this waypoint, advance
      tourIndex = (tourIndex + 1) % tour.length;
      setTargetFromTour();
      return;
    }
    dir.multiplyScalar(CYCLONE_STEP / d);
    group.position.add(dir);
  }

  function update(dt, t /*, world */) {
    mat.uniforms.uTime.value = t;
    points.rotation.y = t * 1.4;
    funnel.rotation.y = -t * 0.6;

    tickAcc += dt;
    let guard = 0;
    while (tickAcc >= TICK_DT && guard < 6) {
      oneTick();
      tickAcc -= TICK_DT;
      guard++;
    }
    updateGridPos();
  }

  // ROM wind formula at $9111..$9138: max(|dcol|, |drow|) clamped to 0..15.
  function windForce(playerCol, playerRow) {
    const dc = Math.abs(gridPos.col - playerCol);
    const dr = Math.abs(gridPos.row - playerRow);
    const d = Math.max(dc, dr);
    return Math.min(15, d);
  }

  return {
    group, update,
    radius: RADIUS,
    get position() { return group.position; },
    get gridPos() { return gridPos; },
    windForce,
    spawn,
    // Expose for debugging / future tuning
    _tour: tour, get _target() { return target; },
  };
}
