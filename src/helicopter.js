import * as THREE from 'three';

// ============================================================================
// Byte-exact port of Cyclone's helicopter physics, extracted from the
// decrypted ROM.
//
// Key findings from the disassembly of $80F9 (main physics routine) and the
// velocity-delta table at $826F:
//
//   * Physics runs at 50 Hz (Spectrum vsync) — we advance with a fixed
//     accumulator, never using dt directly.  Visuals interpolate between
//     ticks so movement still looks smooth at 60+ fps.
//
//   * Heading is a 4-bit value (0..15) stored at $7506, but it always moves
//     in steps of 2 — every turn press writes TWO decrements or increments
//     into $7507 / $7508, and the final value is committed to $7506 after a
//     3-frame delay.  That reduces the effective heading space to 8 even
//     values (0, 2, 4, 6, 8, 10, 12, 14) -> 8 compass directions at 45°
//     each.  The velocity-delta table at $826F is 16 bytes = 8 entries of
//     two single-byte HL-modifying opcodes (INC HL / DEC HL / NOP).
//
//         heading  (x,y)    dir
//            0     ( 0,-1)  N
//            2     (+1,-1)  NE
//            4     (+1, 0)  E
//            6     (+1,+1)  SE
//            8     ( 0,+1)  S
//           10     (-1,+1)  SW
//           12     (-1, 0)  W
//           14     (-1,-1)  NW
//
//   * Turn-delay counter $7521 is set to 3 on every turn press; movement
//     continues in the old heading until it decrements to zero.  So the
//     player can issue one turn every 3 frames (60 ms) = max 16.67 turns/s.
//
//   * Thrust counter $7527 (range 0..7): while FORWARD is held, it increments
//     by 1 per frame (capped at 7).  When released, it decrements by 1 per
//     frame.  Movement happens only while $7527 > 0.  This gives a 7-frame
//     spin-up and 7-frame coast-down — the characteristic "drift" of the
//     Cyclone helicopter.
//
//   * Movement per tick, when thrust > 0: the velocity-table opcode is
//     patched into self-modifying slots at $81EF / $81F6 surrounded by
//     LD HL,($7500) / LD ($7500),HL — i.e. it does exactly ONE INC HL / DEC
//     HL / NOP per axis per frame.  So max horizontal speed is 1 ROM unit
//     per axis per frame.  For cardinals = 50 u/s.  For diagonals the
//     per-axis delta is ±1 on both axes so the Euclidean speed is
//     50 * sqrt(2) ≈ 70 u/s (the ROM does not normalise diagonals).
//
//   * Altitude $750D ranges 0..$3C (0..60).  Up-ramp counter $751A is
//     capped at 3 — while UP is held it grows 1 → 2 → 3 and the altitude
//     increments by the ramp value each frame.  Down-ramp $751B behaves
//     symmetrically.  Releasing clears the counter.
//
// Scaling to the three.js world:
//   ROM positions are 16-bit in an internal unit space.  Our world is
//   600 world units across; the playable ROM world is roughly 768 units
//   wide based on the initial position ($0139,$0170).  Scale ratio:
//   ROM_SCALE ≈ 600 / 768 ≈ 0.78.  We set it to 0.8 which keeps the
//   authentic pace while fitting our world.

const TICK_HZ   = 50;          // Spectrum vsync
const TICK_DT   = 1 / TICK_HZ; // 20 ms
const ROM_SCALE = 0.8;         // world units per ROM position unit

const TURN_DELAY  = 3;         // $7521 — frames between 45° turns
const THRUST_CAP  = 7;         // $7527 max
const ALT_CAP     = 60;        // $3C — maximum altitude
const ALT_RAMP    = 3;         // $751A / $751B max

// Velocity-delta table at $826F, one (dx, dy) pair per 8 compass points.
// These are the exact values recovered from the ROM.
const VELOCITY_TABLE = [
  [ 0, -1], // 0  N   (ROM heading 0)
  [+1, -1], // 1  NE  (ROM heading 2)
  [+1,  0], // 2  E   (ROM heading 4)
  [+1, +1], // 3  SE  (ROM heading 6)
  [ 0, +1], // 4  S   (ROM heading 8)
  [-1, +1], // 5  SW  (ROM heading 10)
  [-1,  0], // 6  W   (ROM heading 12)
  [-1, -1], // 7  NW  (ROM heading 14)
];

export function createHelicopter() {
  const group = new THREE.Group();   // world transform (yaw here)
  const body  = new THREE.Group();   // cosmetic tilt
  group.add(body);

  // --- mesh -------------------------------------------------------
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffcc33, roughness: 0.4, metalness: 0.3, flatShading: true });
  const dark   = new THREE.MeshStandardMaterial({ color: 0x333842, roughness: 0.7, metalness: 0.4, flatShading: true });
  const glass  = new THREE.MeshStandardMaterial({ color: 0x6dbcd8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55 });
  const blade  = new THREE.MeshStandardMaterial({ color: 0x202128, roughness: 0.3, metalness: 0.7 });

  const shell = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), yellow);
  shell.scale.set(1.3, 1.0, 1.7);
  body.add(shell);
  const cab = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 10), glass);
  cab.scale.set(1.05, 0.85, 1.25);
  cab.position.set(0, 0.15, 1.1);
  body.add(cab);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.08, 3.2, 8), yellow);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.25, -2.2);
  body.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.6), yellow);
  fin.position.set(0, 0.8, -3.5);
  body.add(fin);
  for (const side of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8), dark);
    skid.rotation.x = Math.PI / 2;
    skid.position.set(side * 0.9, -1.2, 0);
    body.add(skid);
    for (const z of [-0.9, 0.9]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), dark);
      strut.position.set(side * 0.9, -0.75, z);
      body.add(strut);
    }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.25, 8), dark);
  hub.position.set(0, 1.5, 0);
  body.add(hub);

  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 1.65, 0);
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
  tailRotor.position.set(0.35, 0.6, -3.6);
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.1), blade);
    b.rotation.z = (i * Math.PI) / 2;
    tailRotor.add(b);
  }
  body.add(tailRotor);

  // --- ROM state mirror ------------------------------------------
  const rom = {
    heading:    0,     // $7506: 8 compass values (we store 0..7, render as 16)
    headingEnd: 0,     // $7508: target-after-turn-completes
    turnDelay:  0,     // $7521
    thrust:     0,     // $7527
    altitude:   24,    // $750D  (start mid-range so we're not on the ground)
    altUp:      0,     // $751A
    altDn:      0,     // $751B
    posX:       0,     // $7500 (world units, real-valued)
    posY:       0,     // $7502
    dirX:       0,     // current velocity X (from table)
    dirY:       0,
  };
  // Track previous tick state for interpolation
  const prev = { x: 0, y: 0, z: 0, yaw: 0 };
  const visual = { yaw: 0 };   // smoothed visual yaw
  let tickAcc = 0;

  // Exposed Cartesian velocity (world units / sec) — consumers like the
  // cyclone-wind push still modify this between ticks.
  const velocity = new THREE.Vector3();

  // ----- Single ROM tick (runs exactly like $80F9 does) -----------
  function romTick(ctrl) {
    // ctrl.turnL / turnR / forward / up / down are booleans.

    // --- Steering ($815A-$81A9) --------------------------------------
    if (rom.turnDelay > 0) {
      rom.turnDelay--;
      if (rom.turnDelay === 0) {
        rom.heading = rom.headingEnd & 7;   // commit
      }
    }
    if (rom.turnDelay === 0) {
      if (ctrl.turnL) {
        rom.headingEnd = (rom.heading - 1) & 7;
        rom.turnDelay  = TURN_DELAY;
      } else if (ctrl.turnR) {
        rom.headingEnd = (rom.heading + 1) & 7;
        rom.turnDelay  = TURN_DELAY;
      }
    }

    // --- Thrust counter ($81B6-$81C5 / $81CB-$81D5) ------------------
    if (ctrl.forward) {
      if (rom.thrust < THRUST_CAP) rom.thrust++;
    } else {
      if (rom.thrust > 0) rom.thrust--;
    }

    // --- Movement ($81DC-$81F7) --------------------------------------
    if (rom.thrust > 0) {
      const [dx, dy] = VELOCITY_TABLE[rom.heading];
      rom.dirX = dx; rom.dirY = dy;
      rom.posX += dx;
      rom.posY += dy;
    } else {
      rom.dirX = 0; rom.dirY = 0;
    }

    // --- Altitude ($81FA-$8268) --------------------------------------
    // NOTE: the ROM routine runs an inner DJNZ B loop that applies the
    // ramp value as the number of 1-unit altitude steps per frame.
    if (ctrl.up && !ctrl.down) {
      if (rom.altUp < ALT_RAMP) rom.altUp++;
      rom.altDn = 0;
      for (let k = 0; k < rom.altUp; k++) {
        if (rom.altitude < ALT_CAP) rom.altitude++;
      }
    } else if (ctrl.down && !ctrl.up) {
      if (rom.altDn < ALT_RAMP) rom.altDn++;
      rom.altUp = 0;
      for (let k = 0; k < rom.altDn; k++) {
        if (rom.altitude > 0) rom.altitude--;
      }
    } else {
      rom.altUp = 0; rom.altDn = 0;
    }
  }

  // ----- Per-frame driver -----------------------------------------
  function update(dt, ctrl) {
    mainRotor.rotation.y += dt * 38;
    tailRotor.rotation.x += dt * 55;

    // Translate the tilt-sim inputs from main.js into ROM button state.
    // (We keep the existing W/S/A/D/Space/Shift mapping externally; here
    // it's converted into FORWARD / TURN_L / TURN_R / UP / DOWN.)
    const romCtrl = {
      forward: ctrl.pitch > 0 || ctrl.forward === true,
      turnL:   ctrl.yaw < 0   || ctrl.turnL   === true,
      turnR:   ctrl.yaw > 0   || ctrl.turnR   === true,
      up:      ctrl.lift > 0,
      down:    ctrl.lift < 0,
    };

    // External pushes (cyclone wind) come in through `velocity` between
    // ticks; convert them to ROM-unit displacement per 50-Hz step.
    const windPerTick = new THREE.Vector3().copy(velocity).multiplyScalar(TICK_DT / ROM_SCALE);

    // Advance simulation in fixed 50 Hz steps.
    tickAcc += dt;
    let ticks = 0;
    while (tickAcc >= TICK_DT && ticks < 6) {   // safety cap on catch-up
      prev.x = rom.posX; prev.y = rom.altitude; prev.z = rom.posY;
      romTick(romCtrl);
      // Fold in wind for this tick, then decay the external velocity
      // proportionally so it feels like a continuous force.
      rom.posX += windPerTick.x;
      rom.posY += windPerTick.z;
      rom.altitude = THREE.MathUtils.clamp(rom.altitude + windPerTick.y, 0, ALT_CAP);

      tickAcc -= TICK_DT;
      ticks++;
    }
    // Wind decay (drag on whatever main.js pushed us with)
    velocity.multiplyScalar(Math.pow(0.92, dt * TICK_HZ));

    // --- Interpolation for smooth rendering between ticks -----------
    const alpha = THREE.MathUtils.clamp(tickAcc / TICK_DT, 0, 1);
    const ix = prev.x + (rom.posX - prev.x) * alpha;
    const iy = prev.y + (rom.altitude - prev.y) * alpha;
    const iz = prev.z + (rom.posY - prev.z) * alpha;

    // Place the helicopter.  The parent group is assumed to be at world
    // origin; main.js uses the position directly for collisions etc.
    group.position.set(ix * ROM_SCALE, iy * (ROM_SCALE * 0.8 /*altitude scaler*/), iz * ROM_SCALE);

    // --- Visual heading smoothing ------------------------------------
    // The ROM displays 16 sprite rotations but only moves in 8.  We do
    // the same: the 8-direction heading is an integer; the smooth
    // visual yaw tweens toward it.
    const targetYaw = -rom.heading * (Math.PI * 2 / 8);  // -Z is N in our frame
    // Shortest-arc lerp
    let delta = targetYaw - visual.yaw;
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    visual.yaw += delta * Math.min(1, dt * 12);
    group.rotation.y = visual.yaw;

    // --- Cosmetic tilt from thrust/turn ------------------------------
    const tgtTiltX = (rom.thrust / THRUST_CAP) * -0.22;   // nose down under thrust
    let tgtTiltZ = 0;
    if (rom.turnDelay > 0) {
      // which way did we just turn?
      const turning = ((rom.headingEnd - rom.heading + 8) & 7);
      if (turning === 1) tgtTiltZ = -0.30;        // right roll
      else if (turning === 7) tgtTiltZ = 0.30;    // left roll
    }
    body.rotation.x += (tgtTiltX - body.rotation.x) * Math.min(1, dt * 8);
    body.rotation.z += (tgtTiltZ - body.rotation.z) * Math.min(1, dt * 8);

    // --- Expose a Cartesian velocity for consumers that want speed --
    // Derived from the active direction, scaled to world units/sec.
    const unitsPerSec = TICK_HZ * ROM_SCALE;
    velocity.x = rom.dirX * unitsPerSec + velocity.x * 0.0;  // discard prev cached
    velocity.z = rom.dirY * unitsPerSec;
    // Don't overwrite .y — main.js reads only x/z for speed HUD
  }

  // Place helicopter at a given world position by back-converting to ROM units.
  function setWorldPosition(v) {
    rom.posX = v.x / ROM_SCALE;
    rom.posY = v.z / ROM_SCALE;
    rom.altitude = THREE.MathUtils.clamp(v.y / (ROM_SCALE * 0.8), 0, ALT_CAP);
    group.position.copy(v);
    prev.x = rom.posX; prev.z = rom.posY; prev.y = rom.altitude;
  }

  function reset() {
    rom.heading = 0; rom.headingEnd = 0; rom.turnDelay = 0;
    rom.thrust = 0; rom.altUp = 0; rom.altDn = 0;
    velocity.set(0, 0, 0);
    visual.yaw = 0;
    body.rotation.set(0, 0, 0);
  }

  return { group, body, update, velocity, setWorldPosition, reset, rom, ROM_SCALE };
}
