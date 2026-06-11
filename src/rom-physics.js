// Instruction-exact port of Cyclone's helicopter physics tick — the code
// at $8135..$8268 inside the routine entered at $80F9, plus the velocity
// table at $826F.  Pure JS, no three.js: shared by the web app
// (helicopter.js) and the byte-accuracy tests, which verify every
// state transition of this function against golden traces of the real
// game running in the emulator (test/romtick-parity.test.mjs).
//
// Faithfulness notes (all confirmed by disassembly + traces):
//
//   * One tick == one main-loop iteration of the original, NOT one 50 Hz
//     vsync.  The 1985 main loop is render-bound and iterates roughly
//     every 5 vsync frames (~10 Hz).  Pacing is the caller's concern.
//
//   * Buttons byte ($7522): bit0 FORWARD, bit1 DOWN, bit2 UP,
//     bit3 TURN-RIGHT, bit4 TURN-LEFT.
//
//   * Heading lives in the ROM's 16-value space (0..15, committed values
//     always even; 0=N, 4=E, 8=S, 12=W).  A turn press writes
//     pend1 = heading∓1 and pend2 = heading∓2 and arms turnDelay=3.
//     While turnDelay > 0 turn input is IGNORED ($813E); the delay
//     decrements once per tick and the commit (heading = pend2) happens
//     when it reaches exactly 1 ($8141-$814C).  Net effect: a held turn
//     steps 45° every 4 ticks.
//
//   * Pressing LEFT and RIGHT in the same tick cancels the turn
//     ($8193: pend = heading, delay = 0).
//
//   * Movement uses the heading LATCHED at $753B while FORWARD is held
//     ($81D6); during coast-down (thrust decaying after release) the
//     helicopter keeps drifting in that latched direction even if it is
//     turned meanwhile ($81C6).
//
//   * While landed ($7515=1, turnDelay 0) steering/thrust/movement are
//     skipped entirely ($8152).  Landed + UP clears the flag and ends
//     the tick immediately ($820C-$8213): take-off costs one tick.
//
//   * UP and DOWN are NOT mutually exclusive: holding both climbs by
//     rampUp then descends by rampDn in the same tick.
//
//   * Descending below 0 sets the ground-contact flag $7514 instead of
//     wrapping ($8269); the landing logic elsewhere consumes it.
//
//   * No fuel ($7516=1) forces the thrust-decay branch, blocks climbing,
//     and forces descent ($81AB-$81B0, $81FE-$8203, $823C-$8241).

// Velocity-delta table at $826F: two opcode bytes per even heading,
// (dx, dy) with -y = north.  Byte-exact: 00 2b 23 2b 23 00 23 23
//                                        00 23 2b 23 2b 00 2b 2b
export const VELOCITY_TABLE = [
  [0, -1],   // heading  0  N
  [1, -1],   // heading  2  NE
  [1, 0],    // heading  4  E
  [1, 1],    // heading  6  SE
  [0, 1],    // heading  8  S
  [-1, 1],   // heading 10  SW
  [-1, 0],   // heading 12  W
  [-1, -1],  // heading 14  NW
];

export const BTN_FORWARD = 0x01;   // bit 0
export const BTN_DOWN    = 0x02;   // bit 1
export const BTN_UP      = 0x04;   // bit 2
export const BTN_RIGHT   = 0x08;   // bit 3
export const BTN_LEFT    = 0x10;   // bit 4

export const THRUST_CAP = 7;       // $81CE
export const ALT_CAP    = 0x3C;    // $8223
export const RAMP_CAP   = 3;       // $8217 / $824F
export const TURN_DELAY = 3;       // $8175 / $81A6

// Pacing: the original's main loop (one physics tick per iteration) was
// measured from the golden traces at one iteration per ~5.04 vsync frames
// at full flight (test/sim-parity.test.mjs prints the measurement).  The
// web app uses a fixed 5 vsyncs/tick = 10 Hz.
export const MAIN_LOOP_VSYNCS = 5;
export const TICK_SECONDS = MAIN_LOOP_VSYNCS / 50;   // 0.1 s

// Authentic initial values from the game's state template at $7564
// (fuel/timer gauge pointers are re-initialised by the front-end at boot;
// those use the observed runtime values).
export function createRomState() {
  return {
    posX: 0x0139,        // $7500/01
    posY: 0x0170,        // $7502/03
    heading: 4,          // $7506 (East)
    pend1: 4,            // $7507
    pend2: 4,            // $7508
    altitude: 8,         // $750D
    hitGround: 0,        // $7514
    landed: 1,           // $7515
    noFuel: 0,           // $7516
    rampUp: 0,           // $751A
    rampDn: 0,           // $751B
    turnDelay: 0,        // $7521
    thrust: 0,           // $7527
    refueling: 1,        // $752E (set while landed in a refuel zone)
    latchedHeading: 4,   // $753B
    crashed: 0,          // $7505 (set by the crash paths at $8B5D)
    fuelPrescaler: 0,    // $7517
    fuelGauge: 0x47BC,   // $7518/19 — display-file pointer used as counter
    timerPrescaler: 0,   // $7528
    timerGauge: 0x471E,  // $751C/1D — runtime boot value
  };
}

// ---------------------------------------------------------------------------
// Island detection ($76E5): the renderer walks the 20-byte records at
// $F230 and matches the helicopter position against each island's
// bounding box — page bytes (+0/+1) must equal the position high bytes,
// then the low bytes must satisfy min <= lo <= max per axis (the max is
// inclusive via a DEC A before the compare, with 8-bit wraparound).
// First match wins; $FF terminates the table.  Returns the record index
// or -1 for open sea.  Verified probe-for-probe against the routine
// running in the emulator (test/island-parity.test.mjs).
import { ISLAND_DATA } from './islands_data.js';

export function islandAt(posX, posY) {
  const xh = (posX >> 8) & 0xFF, xl = posX & 0xFF;
  const yh = (posY >> 8) & 0xFF, yl = posY & 0xFF;
  for (let i = 0; i < ISLAND_DATA.length; i++) {
    const d = ISLAND_DATA[i];
    if (xh !== d.xPage) continue;                  // $76E9-$76EF
    if (yh !== d.yPage) continue;                  // $76F1-$76F7
    if (xl < d.xMinLo) continue;                   // $76F9-$76FF
    if (((xl - 1) & 0xFF) >= d.xMaxLo) continue;   // $7701-$7705 (DEC A)
    if (yl < d.yMinLo) continue;                   // $7707-$770D
    if (((yl - 1) & 0xFF) >= d.yMaxLo) continue;   // $770F-$7713
    return i;                                      // $7724: ($7552) = IX
  }
  return -1;
}

// ---------------------------------------------------------------------------
// The cyclone ($909E-$910E) and its wind ($9111-$9138 + $7378).
//
// The cyclone lives at a map cell ($754B/$754C; cell = position >> 5,
// see $9038).  Once every 25 main-loop iterations (prescaler $754E,
// CP $18) it random-walks: a "direction regime" — an (AND, OR) mask pair
// patched into the operands at $90D0/$90D2 — is re-rolled from the table
// at $9178 every 9th move ($754F), and each move picks a delta pair from
// the table at $9198 with index (rand >> 8 & AND) | OR.  X is bounded to
// [1, $15], Y to [1, $14]; a blocked axis doesn't move and forces a
// regime re-roll on an immediate next attempt ($754F=8, $754E=$18).
//
// Wind is NOT a force: the main loop ($5B8F) computes the Chebyshev
// distance between the helicopter's map cell and the cyclone ($7550,
// clamped to 15) and, when it is < 5, $7378 CORRUPTS THE CONTROLS for
// the next physics tick:
//     dist 4   : buttons |= rand & $1A   (random DOWN/RIGHT/LEFT)
//     dist 2-3 : buttons |= rand & $1B   (random FWD/DOWN/RIGHT/LEFT)
//     dist 0-1 : buttons  = $12          (forced DOWN+LEFT, and any
//                                         pending turn delay decrements)
// Nothing happens while landed.  The randomness source is the 16-bit
// PRNG at $8B74 over the spare sysvar $5C76.

// $9178: 16 (AND, OR) regime pairs.
export const CYCLONE_REGIMES = [
  0x02, 0x00, 0x0A, 0x08, 0x0E, 0x06, 0x0E, 0x0C,
  0x08, 0x00, 0x06, 0x00, 0x0A, 0x00, 0x0E, 0x04,
  0x0E, 0x08, 0x06, 0x04, 0x02, 0x00, 0x0A, 0x08,
  0x0E, 0x0C, 0x06, 0x00, 0x0E, 0x08, 0x06, 0x04,
];
// $9198: (dx, dy) byte pairs at even indices (signed bytes).
export const CYCLONE_DELTAS = [
  0xFF, 0x00, 0xFF, 0xFF, 0x00, 0xFF, 0x01, 0xFF,
  0xFF, 0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0x00,
];

// Exact port of the PRNG at $8B74: a borrow-chained shuffle of the
// 16-bit seed at $5C76.  Mutates state.seed, returns the new 16 bits.
export function prngNext(state) {
  const de = state.seed & 0xFFFF;
  let hl = ((de & 0xFF) << 8) | 0xFD;       // H=E, L=$FD
  let a = de >> 8;                          // A=D
  let carry = 0;                            // OR A
  let t = hl - de;                          // SBC HL,DE
  carry = t < 0 ? 1 : 0; hl = t & 0xFFFF;
  t = a - carry;                            // SBC A,$00
  carry = t < 0 ? 1 : 0; a = t & 0xFF;
  t = hl - de - carry;                      // SBC HL,DE
  carry = t < 0 ? 1 : 0; hl = t & 0xFFFF;
  t = a - carry;                            // SBC A,$00
  carry = t < 0 ? 1 : 0; a = t & 0xFF;
  t = hl - a - carry;                       // E=A; D=0; SBC HL,DE
  carry = t < 0 ? 1 : 0; hl = t & 0xFFFF;
  if (carry) hl = (hl + 1) & 0xFFFF;        // JR NC / INC HL
  state.seed = hl;
  return hl;
}

// Game start places the cyclone in a random corner ($8370): X = 2 or
// $14 (20) by rand bit 0, Y = 2 or $13 (19) by rand bit 1.
export function createCycloneState(prng) {
  const r = prng ? prngNext(prng) : 0;
  return {
    x: (r & 1) ? 0x14 : 0x02,        // $7378-$8380
    y: (r & 2) ? 0x13 : 0x02,        // $8383-$838B
    movePrescaler: 0,                // $754E
    regimeCounter: 0,                // $754F
    regimeAnd: 0x0E,                 // operand patched at $90D0 (file default)
    regimeOr: 0x06,                  // operand patched at $90D2 (file default)
  };
}

// One per-iteration call of the movement section at $909E.
export function cycloneTick(c, prng) {
  c.movePrescaler = (c.movePrescaler + 1) & 0xFF;   // $90A1
  if (c.movePrescaler <= 0x18) return;              // $90A2-$90A5
  c.movePrescaler = 0;
  c.regimeCounter = (c.regimeCounter + 1) & 0xFF;   // $90AC
  if (c.regimeCounter > 0x08) {                     // $90AD-$90B0
    c.regimeCounter = 0;
    const r = prngNext(prng) & 0x0F;                // $90B7-$90B8
    c.regimeAnd = CYCLONE_REGIMES[r * 2];
    c.regimeOr  = CYCLONE_REGIMES[r * 2 + 1];
  }
  const idx = ((prngNext(prng) >> 8) & c.regimeAnd) | c.regimeOr;  // $90CB-$90D1
  const nx = (c.x + CYCLONE_DELTAS[idx]) & 0xFF;    // $90D8-$90DC (8-bit add)
  if (nx < 0x01 || nx >= 0x16) {                    // $90DD-$90E3
    c.regimeCounter = 0x08; c.movePrescaler = 0x18; // $90EA-$90F1
  } else {
    c.x = nx;                                       // $90E5
  }
  const ny = (c.y + CYCLONE_DELTAS[idx + 1]) & 0xFF;
  if (ny < 0x01 || ny >= 0x15) {                    // $90FA-$9100
    c.regimeCounter = 0x08; c.movePrescaler = 0x18;
  } else {
    c.y = ny;                                       // $9102
  }
}

// Map cell of a 16-bit ROM position ($9038): cell = pos >> 5, with
// off-map markers 0 / $16 (the $754D "leaving map" mechanic).
export function mapCell(pos) {
  const hl = (pos & 0xFFFF) >> 5;
  const h = hl >> 8, l = hl & 0xFF;
  if (h !== 0) return { cell: h >= 0x80 ? 0x16 : 0x00, offMap: true };
  if (l >= 0x17) return { cell: 0x16, offMap: true };
  return { cell: l, offMap: false };
}

// Chebyshev distance, clamped to 15 ($9111-$9136 -> $7550).
export function cycloneDistance(c, heliCellX, heliCellY) {
  let dx = (c.x - heliCellX) & 0xFF; if (dx >= 0x80) dx = (-dx) & 0xFF;
  let dy = (c.y - heliCellY) & 0xFF; if (dy >= 0x80) dy = (-dy) & 0xFF;
  const d = Math.max(dx, dy);
  return d >= 0x10 ? 0x0F : d;
}

// Control corruption ($7378), applied to the buttons byte that the NEXT
// physics tick will consume.  Only call when distance < 5 ($5B8F).
export function windCorrupt(rom, dist, buttons, prng) {
  if (rom.landed === 1) return buttons;             // $7379-$737E
  if (dist >= 4) return buttons | (prngNext(prng) & 0x1A);   // $7382-$7390
  if (dist >= 2) return buttons | (prngNext(prng) & 0x1B);   // $7392-$73A0
  if (rom.turnDelay !== 0) rom.turnDelay--;         // $73A2-$73A9
  return 0x12;                                      // $73AA-$73AC
}

// ---------------------------------------------------------------------------
// Fuel ($8470 dispatcher -> $8478 refuel / $82A7+$82B1 burn).
//
// The fuel "counter" is literally the screen address of the gauge's current
// pixel row.  Burning walks it forward one pixel row every 49th iteration
// (prescaler $7517, CP $30 at $82AB); reaching the sentinel $48BC sets the
// no-fuel flag $7516.  While landed in a refuel zone ($752E=1) it walks
// BACKWARD one row per iteration (with a beeper blip per row, $8494) until
// the gauge column reaches $1C = full.  Returns true when a refuel blip
// happened this tick.
export const FUEL_EMPTY = 0x48BC;  // $82B6/$82BB
export const FUEL_FULL_COL = 0x1C; // $848A

export function fuelTick(s) {
  if (s.refueling === 1) {                          // $8470 -> $8478
    s.fuelPrescaler = 0;                            // $8482
    if ((s.fuelGauge & 0xFF) === FUEL_FULL_COL) return false;  // $848A RET Z
    let h = (s.fuelGauge >> 8) - 1;                 // $849A DEC H
    let l = s.fuelGauge & 0xFF;
    if (h === 0x3F) { h = 0x47; l = (l - 0x20) & 0xFF; }  // $849C-$84A5
    s.fuelGauge = (h << 8) | l;                     // $84A6
    s.noFuel = 0;                                   // $84A9-$84AA
    return true;                                    // beeper blip ($8494)
  }
  // Burn ($82A7): gauge advances every 49th iteration.
  s.fuelPrescaler = (s.fuelPrescaler + 1) & 0xFF;   // INC (HL)
  if (s.fuelPrescaler <= 0x30) return false;        // CP $30 / RET NC
  s.fuelPrescaler = 0;                              // $82AF
  let h = (s.fuelGauge >> 8) + 1;                   // $82B4 INC H
  let l = s.fuelGauge & 0xFF;
  if (h === 0x48) {                                 // $82B6
    if (l === 0xBC) { s.noFuel = 1; return false; } // $82BA-$82C4
    h = 0x40; l = (l + 0x20) & 0xFF;                // $82C5-$82CA
  }
  s.fuelGauge = (h << 8) | l;                       // $82CD
  return false;
}

// Burn steps until empty (for HUD display; max from full $471C is 41).
export function fuelStepsRemaining(gauge) {
  let h = gauge >> 8, l = gauge & 0xFF, steps = 0;
  while (steps < 64) {
    h++;
    if (h === 0x48) {
      if (l === 0xBC) break;
      h = 0x40; l = (l + 0x20) & 0xFF;
    }
    steps++;
  }
  return steps;
}
export const FUEL_STEPS_FULL = fuelStepsRemaining((0x47 << 8) | FUEL_FULL_COL);

// ---------------------------------------------------------------------------
// Mission timer ($8284/$8292): prescaler $7528 advances the timer gauge
// $751C one row every 255 iterations; the game ends when the gauge column
// reaches $DE (checked in the main loop at $5BCC).  From the boot value
// $471E that is 41 steps — about 17.4 minutes at the authentic cadence.
export const TIME_UP_COL = 0xDE;

export function timerTick(s) {
  s.timerPrescaler = (s.timerPrescaler + 1) & 0xFF; // INC / CP $FF / RET C
  if (s.timerPrescaler !== 0xFF) return false;
  s.timerPrescaler = 0;
  let h = (s.timerGauge >> 8) + 1;                  // $8295 INC H
  let l = s.timerGauge & 0xFF;
  if (h === 0x48) { h = 0x40; l = (l + 0x20) & 0xFF; }  // $8297-$82A0
  s.timerGauge = (h << 8) | l;
  return (l & 0xFF) === TIME_UP_COL;                // $5BCC: L == $DE
}

export function timerStepsRemaining(gauge) {
  let h = gauge >> 8, l = gauge & 0xFF, steps = 0;
  while ((l & 0xFF) !== TIME_UP_COL && steps < 64) {
    h++;
    if (h === 0x48) { h = 0x40; l = (l + 0x20) & 0xFF; }
    steps++;
  }
  return steps;
}
export const TIMER_STEPS_FULL = timerStepsRemaining(0x471E);

// ---------------------------------------------------------------------------
// Landing commit ($8AEB-$8B0D): semantics port.  In the original the
// decision (land vs crash, $8B5D -> $7505=1) is made against view-space
// terrain tables built by the 3D renderer; the web app supplies its own
// terrain query and calls this on touchdown.  The exact recorded rules:
//   * descent ramp must be gentle — rampDn >= 3 crashes ($8AB7-$8ABC);
//   * a refuel-zone landing sets $752E ($8AEB-$8AF2);
//   * altitude snaps UP to the next multiple of 8 ($8AFE-$8B0D);
//   * the contact flag clears, landed sets ($8AF5-$8AFB).
export function landRom(s, { refuelZone = false, groundAltitude = s.altitude } = {}) {
  if (refuelZone) s.refueling = 1;                  // $8AF0-$8AF2
  s.landed = 1;                                     // $8AF5-$8AF7
  s.hitGround = 0;                                  // $8AFA-$8AFB
  s.altitude = Math.min(ALT_CAP, ((groundAltitude + 7) >> 3) << 3);  // $8AFE-$8B0D
  return s;
}

// One physics tick: the exact control flow of $8135..$8268.
// `buttons` is the $7522 byte.  Mutates and returns `s`.
export function romTick(s, buttons) {
  const c = buttons & 0xFF;

  // ---- Turn delay / commit ($8139-$814F) -------------------------------
  let steeringAllowed = false;
  if (s.turnDelay !== 0) {
    s.turnDelay = (s.turnDelay - 1) & 0xFF;       // DEC (HL)
    if (s.turnDelay === 1) {                      // commit when it hits 1
      s.heading = s.pend2;                        // $7508 -> $7506
      s.pend1 = s.pend2;                          //       -> $7507
    }
    // JP $81AB: skip the landed check and steering input entirely.
  } else {
    // ---- Landed gate ($8152) ------------------------------------------
    if (s.landed === 1) {
      altitudeSection(s, c);                      // JP $81FA
      return s;
    }
    steeringAllowed = true;
  }

  // ---- Steering input ($815A-$81A9), only when delay was 0 -------------
  if (steeringAllowed) {
    if (c & BTN_LEFT) {                           // BIT 4,C
      let a = s.heading;
      a = (a - 1) & 0xFF; if (a === 0xFF) a = 0x0F;
      s.pend1 = a;
      a = (a - 1) & 0xFF; if (a === 0xFF) a = 0x0F;
      s.pend2 = a;
      s.turnDelay = TURN_DELAY;
    }
    if (c & BTN_RIGHT) {                          // BIT 3,C
      let a = s.heading;
      a = (a + 1) & 0xFF; if (a === 0x10) a = 0;
      s.pend1 = a;
      a = (a + 1) & 0xFF; if (a === 0x10) a = 0;
      s.pend2 = a;
      // $8193: if a turn is already pending THIS tick (i.e. LEFT was
      // pressed too), cancel everything; otherwise arm the delay.
      if (s.turnDelay !== 0) {
        s.pend1 = s.heading;
        s.pend2 = s.heading;
        s.turnDelay = 0;
      } else {
        s.turnDelay = TURN_DELAY;
      }
    }
  }

  // ---- Thrust ($81AB-$81DC) ---------------------------------------------
  let moveHeading = null;
  if (s.noFuel !== 1 && (c & BTN_FORWARD)) {      // $81B2 -> $81CB
    if (s.thrust !== THRUST_CAP) s.thrust++;
    s.latchedHeading = s.heading;                 // $81D6-$81D9
    moveHeading = s.latchedHeading;
  } else {                                        // $81B6 decay branch
    let a = (s.thrust - 1) & 0xFF;
    if (a === 0xFF) a = 0;                        // floor 0
    s.thrust = a;
    if (a === 0) {                                // JR Z,$81FA: no movement
      altitudeSection(s, c);
      return s;
    }
    moveHeading = s.latchedHeading;               // $81C6: coast on latch
  }

  // ---- Movement ($81DC-$81F7): one table step, 16-bit wrap --------------
  const [dx, dy] = VELOCITY_TABLE[(moveHeading >> 1) & 7];
  s.posX = (s.posX + dx) & 0xFFFF;
  s.posY = (s.posY + dy) & 0xFFFF;

  altitudeSection(s, c);
  return s;
}

// ---- Altitude ($81FA-$8268) ---------------------------------------------
function altitudeSection(s, c) {
  if (c & BTN_UP) {                               // BIT 2,C
    if (s.noFuel === 1) {
      s.rampUp = 0;                               // $8232 via $8203
    } else if (s.landed !== 0) {                  // $8205: landed -> takeoff
      s.landed = 0;                               // $820C-$820D
      s.refueling = 0;                            // $8210 (clears $752E)
      return;                                     // RET: tick ends here
    } else {
      if (s.rampUp !== RAMP_CAP) s.rampUp++;      // $8214-$821C
      for (let b = s.rampUp; b > 0; b--) {        // DJNZ $8223
        if (s.altitude >= ALT_CAP) break;         // CP $3C / JR NC,$8236
        s.altitude++;
      }
    }
  } else {
    s.rampUp = 0;                                 // $8232
  }

  if (s.landed === 1) return;                     // $8236-$823B RET Z

  // $823C: no fuel forces descent; otherwise DOWN must be held.
  if (s.noFuel !== 1 && !(c & BTN_DOWN)) {
    s.rampDn = 0;                                 // $8247
    return;
  }

  if (s.rampDn !== RAMP_CAP) s.rampDn++;          // $824C-$8254
  for (let b = s.rampDn; b > 0; b--) {            // DJNZ $825B
    const a = s.altitude - 1;
    if (a < 0) {                                  // BIT 7,A -> negative
      s.hitGround = 1;                            // $8269-$826B
      break;
    }
    s.altitude = a;
  }
}
