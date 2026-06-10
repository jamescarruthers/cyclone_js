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

// Authentic initial values from the game's state template at $7564.
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
    latchedHeading: 4,   // $753B
  };
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
      s.landed = 0;                               // $820C-$8210
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
