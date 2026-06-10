// A minimal headless ZX Spectrum 48K, just enough to run the decrypted
// Cyclone binary as a byte-accurate game-logic oracle.
//
// No display, no tape, no sound output: memory + Z80 + keyboard port +
// a 50 Hz maskable interrupt every 69,888 T-states (the 48K frame length).
// The game code is loaded pre-decrypted at $5B00 (see decrypted/), so no
// loader emulation is required.  The real 48K ROM is mapped at $0000
// because the game uses IM 1 (ROM ISR needs IY=$5C3A) and IM 2 with I=$3A,
// whose vector is fetched from ROM bytes $3AFF/$3B00 (= $FFFF), and CALLs
// the ROM beeper at $03B5.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Z80 from './z80.mjs';

export const T_PER_FRAME = 69888;     // 48K Spectrum: 224 T × 312 lines
export const GAME_ORG    = 0x5B00;
export const STATE_BASE  = 0x7500;    // the game's main state block
export const STATE_SIZE  = 0x64;      // init copies $64 bytes from $7564

const HERE = fileURLToPath(new URL('.', import.meta.url));

// Keyboard matrix: half-row r is selected when bit r of the high address
// byte is LOW.  Bits 0..4 of each row, active low.
export const KEYS = {
  CAPS: [0, 0], Z: [0, 1], X: [0, 2], C: [0, 3], V: [0, 4],
  A: [1, 0], S: [1, 1], D: [1, 2], F: [1, 3], G: [1, 4],
  Q: [2, 0], W: [2, 1], E: [2, 2], R: [2, 3], T: [2, 4],
  N1: [3, 0], N2: [3, 1], N3: [3, 2], N4: [3, 3], N5: [3, 4],
  N0: [4, 0], N9: [4, 1], N8: [4, 2], N7: [4, 3], N6: [4, 4],
  P: [5, 0], O: [5, 1], I: [5, 2], U: [5, 3], Y: [5, 4],
  ENTER: [6, 0], L: [6, 1], K: [6, 2], J: [6, 3], H: [6, 4],
  SPACE: [7, 0], SYM: [7, 1], M: [7, 2], N: [7, 3], B: [7, 4],
};

// Cyclone's default control scheme (input mode $7FD5 = 0, routine $7FE8):
//   forward = any key in the CAPS..V row     -> we use Z
//   up      = any key in the 1..5 row        -> we use 1
//   down    = any key in the Q..T row        -> we use Q
//   right   = P,  left = O                   (row $DF bits 0/1)
// The decoded button byte lands in $7522 (bit0 fwd, 1 down, 2 up, 3 right,
// 4 left), which the physics routine at $80F9/$815A consumes.
export const CONTROL_KEYS = {
  forward: 'Z', up: 'N1', down: 'Q', left: 'O', right: 'P',
};

export function createMachine({
  romPath    = HERE + 'roms/48.rom',
  gamePath   = HERE + '../decrypted/cyclone_code_and_data.bin',
  screenPath = HERE + '../decrypted/cyclone_loading_screen.bin',
} = {}) {
  const mem = new Uint8Array(0x10000);
  const rom = readFileSync(romPath);
  if (rom.length !== 0x4000) throw new Error(`48.rom must be 16384 bytes, got ${rom.length}`);
  mem.set(rom, 0x0000);
  try { mem.set(readFileSync(screenPath), 0x4000); } catch { /* screen is cosmetic */ }
  const game = readFileSync(gamePath);
  mem.set(game, GAME_ORG);

  // Keyboard state: 8 half-rows × 5 bits, 1 = released (active low).
  const keyRows = new Uint8Array(8).fill(0x1F);

  const core = {
    mem_read:  (a) => mem[a & 0xFFFF],
    mem_write: (a, v) => { a &= 0xFFFF; if (a >= 0x4000) mem[a] = v & 0xFF; },
    io_read: (port) => {
      if ((port & 0x0001) === 0) {            // ULA / keyboard
        const high = (port >> 8) & 0xFF;
        let bits = 0x1F;
        for (let r = 0; r < 8; r++) {
          if ((high & (1 << r)) === 0) bits &= keyRows[r];
        }
        return 0xE0 | bits;                   // EAR/unused bits high
      }
      if ((port & 0x00FF) === 0x1F) return 0x00;  // Kempston: idle
      return 0xFF;
    },
    io_write: () => {},                       // border / beeper: ignored
  };

  const cpu = new Z80(core);
  cpu.reset();
  const boot = cpu.getState();
  boot.pc = GAME_ORG;       // game entry: init + main loop (see $5B00 disasm)
  boot.sp = 0xFF40;         // plausible post-BASIC stack, game may move it
  boot.iy = 0x5C3A;         // ROM IM 1 ISR requires the sysvar base in IY
  boot.i  = 0x3F;
  cpu.setState(boot);

  function pressKey(name)   { const k = KEYS[name]; if (k) keyRows[k[0]] &= ~(1 << k[1]) & 0x1F; }
  function releaseKey(name) { const k = KEYS[name]; if (k) keyRows[k[0]] |=  (1 << k[1]); }

  // controls: { forward, up, down, left, right } -> booleans
  function setControls(controls) {
    for (const [name, key] of Object.entries(CONTROL_KEYS)) {
      if (controls[name] === true) pressKey(key);
      else if (controls[name] === false) releaseKey(key);
    }
  }

  // Run one 50 Hz frame: pulse INT (data bus = $FF), then execute T-states.
  function runFrame() {
    cpu.interrupt(false, 0xFF);
    let t = 0;
    while (t < T_PER_FRAME) t += cpu.run_instruction();
    return t;
  }

  const peek  = (a) => mem[a & 0xFFFF];
  const word  = (a) => mem[a & 0xFFFF] | (mem[(a + 1) & 0xFFFF] << 8);
  const stateBlock = () => mem.slice(STATE_BASE, STATE_BASE + STATE_SIZE);

  // Parsed view of the documented $7500 state variables.
  function gameState() {
    return {
      posX:      word(0x7500),
      posY:      word(0x7502),
      heading:   peek(0x7506),
      pend1:     peek(0x7507),
      pend2:     peek(0x7508),
      altitude:  peek(0x750D),
      landed:    peek(0x7515),
      noFuel:    peek(0x7516),
      rampUp:    peek(0x751A),
      rampDn:    peek(0x751B),
      turnDelay: peek(0x7521),
      buttons:   peek(0x7522),
      thrust:    peek(0x7527),
      latchedHeading: peek(0x753B),
      // Cyclone / wind system
      heliCellX: peek(0x7540),
      heliCellY: peek(0x7541),
      cycloneX:  peek(0x754B),
      cycloneY:  peek(0x754C),
      cycMovePrescaler: peek(0x754E),
      cycRegimeCounter: peek(0x754F),
      cycRegimeAnd: peek(0x90D0),   // self-modified operand
      cycRegimeOr:  peek(0x90D2),   // self-modified operand
      cycloneDist: peek(0x7550),
      seed: word(0x5C76),           // PRNG state
    };
  }

  return {
    mem, cpu, keyRows,
    pressKey, releaseKey, setControls,
    runFrame, peek, word, stateBlock, gameState,
  };
}
