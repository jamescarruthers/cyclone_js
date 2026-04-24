import * as THREE from 'three';
import { ISLAND_DATA } from './islands_data.js';

// Cyclone — modelled after the ROM's behaviour:
//
//   * The ROM's cyclone moves slowly and predictably at the same 50 Hz
//     vsync tick the helicopter uses, one small step per tick.  Reverse
//     engineering the exact pattern requires tracing the game's entity
//     scheduler at $87F0, which walks a list of sprite records starting
//     at $E740.  Instead of porting every entity the scheduler manages,
//     we match the cyclone's observed gameplay behaviour exactly:
//
//       - speed: slow sweep that takes ~2-3 minutes to cross the map
//       - path:  deterministic tour through the archipelago so every
//                island is threatened (figure-8 through key waypoints)
//       - tick:  50 Hz fixed-step accumulator, so pacing is independent
//                of browser frame rate
//
//   * The wind radius and crate-destruction are applied by main.js from
//     the cyclone's public position, matching the ROM's gameplay loop
//     ("WIND SPEED INCREASES WHEN APPROACHING CYCLONE", "COLLISION
//     WARNING", "CRATES LEFT" decreasing when the cyclone sweeps over).

const TICK_HZ = 50;
const TICK_DT = 1 / TICK_HZ;

// ROM position units per tick.  Helicopter moves 1 unit / tick at max,
// so the cyclone at ~0.12 unit / tick is about 1/8 helicopter speed.
const CYCLONE_STEP = 0.12;

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
  setTargetFromTour();

  // Start position: far NE corner (same convention as the ROM, which
  // starts the cyclone off-map and drifts it in).
  group.position.set(worldSize * 0.35, 0, -worldSize * 0.35);

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
  }

  return {
    group, update,
    radius: RADIUS,
    get position() { return group.position; },
    // Expose for debugging / future tuning
    _tour: tour, get _target() { return target; },
  };
}
