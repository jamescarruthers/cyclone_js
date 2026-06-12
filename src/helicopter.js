import * as THREE from 'three';
import {
  romTick, createRomState, VELOCITY_TABLE, TICK_SECONDS,
  BTN_FORWARD, BTN_DOWN, BTN_UP, BTN_RIGHT, BTN_LEFT,
  THRUST_CAP, ALT_CAP,
  fuelTick, timerTick, landRom,
  fuelStepsRemaining, FUEL_STEPS_FULL,
  timerStepsRemaining, TIMER_STEPS_FULL,
  prngNext, createCycloneState, cycloneTick,
  mapCell, cycloneDistance, windCorrupt,
} from './rom-physics.js';

// ============================================================================
// The player helicopter.  All flight physics comes from src/rom-physics.js,
// an instruction-exact port of the routine at $8135-$8268 in the decrypted
// ROM, verified per-tick against golden traces of the real game running in
// the emulator (test/romtick-parity.test.mjs).  This file owns:
//
//   * the mesh;
//   * pacing — the original ticks physics once per main-loop iteration
//     (~5 vsync frames = 10 Hz, render-bound; measured from the traces),
//     reproduced here with a fixed accumulator at TICK_SECONDS;
//   * mapping ctrl inputs to the ROM's $7522 button byte;
//   * the cyclone-wind push, folded into the integer ROM position via a
//     fractional accumulator so ROM state stays integer-exact;
//   * interpolation/visual smoothing between the coarse 10 Hz ticks.
//
// ROM positions are unsigned 16-bit in the authentic 0..704 map space
// (22 x 21 cells of 32 units, cell = pos >> 5).  The world maps that
// space around its centre (ROM 352) at ROM_SCALE world units per ROM
// unit, so the map-cell arithmetic — and with it the cyclone distance
// and "leaving map" logic — works on real coordinates.

const ROM_SCALE  = 0.8;            // world units per ROM position unit
const ROM_CENTER = 352;            // ROM coordinate at world origin
const ALT_SCALE  = ROM_SCALE * 0.8;
const toSigned16 = (v) => (v << 16) >> 16;
const romToWorld = (v) => (toSigned16(v) - ROM_CENTER) * ROM_SCALE;
const worldToRom = (w) => (Math.round(w / ROM_SCALE) + ROM_CENTER) & 0xFFFF;

export const CELL_SIZE_WORLD = 32 * ROM_SCALE;
export const cellToWorld = (c) => (c * 32 + 16 - ROM_CENTER) * ROM_SCALE;
// Flat ROM-coordinate (0..704) to world conversion, for placing world
// geometry (islands) at their authentic positions.
export const romXYToWorld = (v) => (v - ROM_CENTER) * ROM_SCALE;

// The genuine 1985 helicopter: side-profile sprite frame from the
// 16-rotation table at $E8E8 (72 bytes per frame, stored column-major,
// 24x24 px; this is the East-facing profile, cropped to content).
// The fuselage mesh below is a voxel extrusion of these exact pixels.
const HELI_SPRITE = [
  '............#...........',
  '.........###.###........',
  '###.....####.######.....',
  '###################.#...',
  '###################.#...',
  '#####################...',
  '##...################...',
  '##....#####.#.#.####....',
  '.......###############..',
  '...........#####........',
  '...........#####........',
];

export function createHelicopter({ seed } = {}) {
  const group = new THREE.Group();   // world transform (yaw here)
  const body  = new THREE.Group();   // cosmetic tilt
  // The voxel mesh's skid base sits at local y=0, so the group origin is
  // the ground-contact point (matching the ROM's altitude semantics).
  body.position.y = 0.05;
  group.add(body);

  // --- mesh: voxel extrusion of the authentic sprite ----------------
  // Each set pixel of the $E8E8 side-profile frame becomes a voxel;
  // the fuselage band is widened laterally, everything else stays a
  // thin slab.  Forward is -Z (the sprite's nose points East/right).
  const PX = 0.3;
  const yellow = new THREE.Color(0xffcc33);
  const dark   = new THREE.Color(0x333842);
  const glass  = new THREE.Color(0x77b9d6);

  const vox = { pos: [], nrm: [], col: [] };
  const FACES = [
    [[1,0,0],  [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],
    [[-1,0,0], [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],
    [[0,1,0],  [[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]]],
    [[0,-1,0], [[-1,-1,1],[1,-1,1],[1,-1,-1],[-1,-1,-1]]],
    [[0,0,1],  [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
    [[0,0,-1], [[-1,1,-1],[1,1,-1],[1,-1,-1],[-1,-1,-1]]],
  ];
  function voxel(cx, cy, cz, sx, sy, sz, color) {
    for (const [n, corners] of FACES) {
      const p = corners.map(([a,b,c]) => [cx + a*sx/2, cy + b*sy/2, cz + c*sz/2]);
      for (const v of [p[0], p[1], p[2], p[0], p[2], p[3]]) vox.pos.push(...v);
      for (let k = 0; k < 6; k++) { vox.nrm.push(...n); vox.col.push(color.r, color.g, color.b); }
    }
  }
  const ROWS = HELI_SPRITE.length;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < 24; c++) {
      if (HELI_SPRITE[r][c] !== '#') continue;
      const y = (ROWS - 1 - r) * PX + PX / 2;
      const z = -(c - 11.5) * PX;
      const isBody  = r >= 2 && r <= 8 && c >= 4 && c <= 19;
      const isGlass = r >= 3 && r <= 5 && c >= 16 && c <= 19;
      const isDark  = r <= 1 || r >= 9 || c <= 2;
      const w = isBody ? 1.7 : 0.5;
      voxel(0, y, z, w, PX, PX, isGlass ? glass : isDark ? dark : yellow);
    }
  }
  const voxGeo = new THREE.BufferGeometry();
  voxGeo.setAttribute('position', new THREE.Float32BufferAttribute(vox.pos, 3));
  voxGeo.setAttribute('normal',   new THREE.Float32BufferAttribute(vox.nrm, 3));
  voxGeo.setAttribute('color',    new THREE.Float32BufferAttribute(vox.col, 3));
  body.add(new THREE.Mesh(voxGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.6, metalness: 0.2, flatShading: true,
  })));

  const blade = new THREE.MeshStandardMaterial({ color: 0x202128, roughness: 0.3, metalness: 0.7 });
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, ROWS * PX + 0.05, -0.15);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.06, 0.25), blade);
    b.rotation.y = (i * Math.PI) / 2;
    mainRotor.add(b);
  }
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 32),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.06, side: THREE.DoubleSide })
  );
  disk.rotation.x = -Math.PI / 2;
  mainRotor.add(disk);
  body.add(mainRotor);

  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.35, 2.3, 3.3);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.1), blade);
    b.rotation.z = (i * Math.PI) / 2;
    tailRotor.add(b);
  }
  body.add(tailRotor);

  // --- ROM state (integer-exact, see rom-physics.js) ----------------
  const rom = createRomState();

  // Track previous tick state for interpolation
  const prev = { x: rom.posX, y: rom.altitude, z: rom.posY };
  const visual = { yaw: 0 };   // smoothed visual yaw
  let tickAcc = 0;
  let lastDx = 0, lastDy = 0;  // movement of the most recent tick

  // Exposed Cartesian velocity (world units / sec), derived from the ROM
  // movement — read-only for consumers (HUD speed).
  const velocity = new THREE.Vector3();

  // --- The cyclone & wind system ($8370 init, $9038-$9176, $7378) -----
  // PRNG seed: the original inherits whatever the spare sysvar held; we
  // roll a fresh 16-bit seed per session (tests pin one for determinism).
  const prng = { seed: (seed ?? (Math.random() * 0x10000)) & 0xFFFF };
  const cyclone = {
    ...createCycloneState(prng),
    dist: 15,            // $7550
    heliCellX: 0,        // $7540
    heliCellY: 0,        // $7541
    offMap: false,       // $754D analogue
  };
  // Buttons consumed by the NEXT physics tick — written by the input
  // read + wind corruption at the END of each iteration, exactly like
  // $7522 in the original loop ($5B8C/$5B8F run after physics $5B36).
  let pendingButtons = 0;

  // ----- Per-frame driver -----------------------------------------
  // Returns per-frame events: { refuelBlip, timeUp } from the authentic
  // fuel/timer systems that tick alongside the physics.
  function update(dt, ctrl) {
    const events = { refuelBlip: false, timeUp: false };
    mainRotor.rotation.y += dt * (rom.landed ? 14 : 38);
    tailRotor.rotation.x += dt * 55;

    // Translate inputs into the ROM's $7522 button byte.
    let buttons = 0;
    if (ctrl.pitch > 0 || ctrl.forward === true) buttons |= BTN_FORWARD;
    if (ctrl.yaw < 0 || ctrl.turnL === true)     buttons |= BTN_LEFT;
    if (ctrl.yaw > 0 || ctrl.turnR === true)     buttons |= BTN_RIGHT;
    if (ctrl.lift > 0) buttons |= BTN_UP;
    if (ctrl.lift < 0) buttons |= BTN_DOWN;

    // Advance simulation in fixed main-loop-cadence steps (~10 Hz),
    // in the original's iteration order: physics consumes the buttons
    // read (and wind-corrupted) at the end of the previous iteration.
    tickAcc += dt;
    while (tickAcc >= TICK_SECONDS) {
      prev.x = romToWorld(rom.posX); prev.y = rom.altitude; prev.z = romToWorld(rom.posY);
      const beforeX = rom.posX, beforeY = rom.posY;
      romTick(rom, pendingButtons);                  // $5B36 / $80F9
      if (fuelTick(rom)) events.refuelBlip = true;   // $82A7 / $8478
      if (timerTick(rom)) events.timeUp = true;      // $8284
      lastDx = toSigned16((rom.posX - beforeX) & 0xFFFF);
      lastDy = toSigned16((rom.posY - beforeY) & 0xFFFF);

      // Cyclone routine ($9038 cells -> $909E walk -> $9111 distance)
      const cx = mapCell(rom.posX), cy = mapCell(rom.posY);
      cyclone.heliCellX = cx.cell; cyclone.heliCellY = cy.cell;
      cyclone.offMap = cx.offMap || cy.offMap;
      cycloneTick(cyclone, prng);
      cyclone.dist = cycloneDistance(cyclone, cx.cell, cy.cell);

      // Input read + wind corruption ($5B8C / $5B8F + $7378): determines
      // what the NEXT tick's physics will see.
      pendingButtons = (cyclone.dist < 5)
        ? windCorrupt(rom, cyclone.dist, buttons, prng)
        : buttons;

      tickAcc -= TICK_SECONDS;
    }

    // --- Interpolation for smooth rendering between ticks -----------
    const alpha = THREE.MathUtils.clamp(tickAcc / TICK_SECONDS, 0, 1);
    const sx = romToWorld(rom.posX), sz = romToWorld(rom.posY);
    const ix = prev.x + (sx - prev.x) * alpha;
    const iy = prev.y + (rom.altitude - prev.y) * alpha;
    const iz = prev.z + (sz - prev.z) * alpha;
    group.position.set(ix, iy * ALT_SCALE, iz);

    // --- Visual heading smoothing ------------------------------------
    // rom.heading is the ROM's 16-value compass (even values only);
    // 0 = N = -Z in our frame, increasing clockwise.
    const targetYaw = -rom.heading * (Math.PI / 8);
    let delta = targetYaw - visual.yaw;
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    visual.yaw += delta * Math.min(1, dt * 12);
    group.rotation.y = visual.yaw;

    // --- Cosmetic tilt from thrust/turn ------------------------------
    const tgtTiltX = (rom.thrust / THRUST_CAP) * -0.22;   // nose down under thrust
    let tgtTiltZ = 0;
    if (rom.turnDelay > 0) {
      const turning = ((rom.pend2 - rom.heading) + 16) % 16;
      if (turning === 2) tgtTiltZ = -0.30;        // right roll
      else if (turning === 14) tgtTiltZ = 0.30;   // left roll
    }
    body.rotation.x += (tgtTiltX - body.rotation.x) * Math.min(1, dt * 8);
    body.rotation.z += (tgtTiltZ - body.rotation.z) * Math.min(1, dt * 8);

    // --- Expose speed (world units/sec) for the HUD -------------------
    const unitsPerSec = ROM_SCALE / TICK_SECONDS;
    velocity.set(lastDx * unitsPerSec, 0, lastDy * unitsPerSec);

    return events;
  }

  // Place helicopter at a given world position by back-converting to ROM
  // units.  Pass { landed: true } to spawn on the ground (refuelling, as
  // the original starts on the BASE pad).
  function setWorldPosition(v, { landed = false } = {}) {
    rom.posX = worldToRom(v.x);
    rom.posY = worldToRom(v.z);
    rom.altitude = Math.round(THREE.MathUtils.clamp(v.y / ALT_SCALE, 0, ALT_CAP));
    rom.landed = landed ? 1 : 0;
    rom.refueling = landed ? 1 : 0;
    rom.hitGround = 0;
    group.position.set(
      romToWorld(rom.posX),
      rom.altitude * ALT_SCALE,
      romToWorld(rom.posY),
    );
    prev.x = romToWorld(rom.posX); prev.z = romToWorld(rom.posY); prev.y = rom.altitude;
    lastDx = 0; lastDy = 0;
    // Refresh the cyclone-system view of where we are.
    const cx = mapCell(rom.posX), cy = mapCell(rom.posY);
    cyclone.heliCellX = cx.cell; cyclone.heliCellY = cy.cell;
    cyclone.offMap = cx.offMap || cy.offMap;
    cyclone.dist = cycloneDistance(cyclone, cx.cell, cy.cell);
  }

  // Touch down at the current position (ROM landing commit, $8AEB-$8B0D).
  // groundY is the world-space ground height under the helicopter.
  function land({ refuelZone = true, groundY = 0 } = {}) {
    landRom(rom, {
      refuelZone,
      groundAltitude: Math.round(THREE.MathUtils.clamp(groundY / ALT_SCALE, 0, ALT_CAP)),
    });
    prev.y = rom.altitude;
  }

  // Authentic HUD values derived from the gauge pointers.
  const fuelFraction = () => fuelStepsRemaining(rom.fuelGauge) / FUEL_STEPS_FULL;
  const timeLeftSeconds = () =>
    timerStepsRemaining(rom.timerGauge) * 255 * TICK_SECONDS
    + (255 - rom.timerPrescaler) * TICK_SECONDS;

  // Note: reset() restores the helicopter template ($5B1B) but the
  // cyclone keeps wandering across lives, as in the original.
  function reset() {
    Object.assign(rom, createRomState());
    velocity.set(0, 0, 0);
    pendingButtons = 0;
    visual.yaw = -rom.heading * (Math.PI / 8);
    body.rotation.set(0, 0, 0);
    tickAcc = 0;
    lastDx = 0; lastDy = 0;
  }

  reset();

  return {
    group, body, update, velocity, cyclone,
    setWorldPosition, land, reset, rom, ROM_SCALE,
    fuelFraction, timeLeftSeconds,
  };
}

export { VELOCITY_TABLE, ROM_SCALE };
