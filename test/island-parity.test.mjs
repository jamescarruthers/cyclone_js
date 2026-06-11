// Island-detection parity: islandAt() in src/rom-physics.js must agree
// with the real comparator at $76E5 for every probed position.
//
// The survey drives the actual routine in the emulator: poke posX/posY,
// run from $76E5 until either the match-store at $7724 completes or the
// no-match RET at $7723 fires, then read the record pointer at $7552.
// Probes cover a full grid over the map space plus every record's box
// edges ±1 (the inclusive-max DEC A semantics live or die there).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { islandAt } from '../src/rom-physics.js';
import { ISLAND_DATA } from '../src/islands_data.js';
import { createMachine } from '../emu/machine.mjs';

function makeProbe() {
  const m = createMachine();
  return function probe(x, y) {
    m.mem[0x7500] = x & 0xFF; m.mem[0x7501] = (x >> 8) & 0xFF;
    m.mem[0x7502] = y & 0xFF; m.mem[0x7503] = (y >> 8) & 0xFF;
    m.mem[0x7552] = 0xFF; m.mem[0x7553] = 0xFF;          // sentinel
    m.mem[0xFF3E] = 0x00; m.mem[0xFF3F] = 0x70;          // RET -> $7000
    const st = m.cpu.getState();
    st.pc = 0x76E5; st.sp = 0xFF3E;
    m.cpu.setState(st);
    let guard = 0;
    while (guard++ < 4000) {
      const pc = m.cpu.getState().pc;
      if (pc === 0x7728 || pc === 0x7000) break;          // stored / RET
      m.cpu.run_instruction();
    }
    const ptr = m.mem[0x7552] | (m.mem[0x7553] << 8);
    return ptr === 0xFFFF ? -1 : (ptr - 0xF230) / 20;
  };
}

test('islandAt matches the $76E5 comparator over a full-map grid', () => {
  const probe = makeProbe();
  let checked = 0, islands = 0;
  for (let y = 0; y <= 768; y += 16) {
    for (let x = 0; x <= 768; x += 16) {
      const want = probe(x, y);
      const got = islandAt(x, y);
      assert.equal(got, want, `islandAt(${x},${y}) = ${got}, ROM says ${want}`);
      checked++;
      if (want >= 0) islands++;
    }
  }
  console.log(`  ${checked} grid probes, ${islands} over islands`);
  assert.ok(islands > 100, 'grid should hit plenty of island cells');
});

test('islandAt matches the ROM at every record box edge (±1)', () => {
  const probe = makeProbe();
  let checked = 0;
  for (const d of ISLAND_DATA) {
    const xs = [d.x0 - 1, d.x0, d.x0 + 1, d.x1 - 1, d.x1, d.x1 + 1,
                (d.x0 + d.x1) >> 1];
    const ys = [d.y0 - 1, d.y0, d.y0 + 1, d.y1 - 1, d.y1, d.y1 + 1,
                (d.y0 + d.y1) >> 1];
    for (const x of xs) {
      for (const y of ys) {
        const want = probe(x & 0xFFFF, y & 0xFFFF);
        const got = islandAt(x & 0xFFFF, y & 0xFFFF);
        assert.equal(got, want, `edge islandAt(${x},${y}) = ${got}, ROM says ${want}`);
        checked++;
      }
    }
  }
  console.log(`  ${checked} edge probes across ${ISLAND_DATA.length} records`);
});

test('the helicopter spawn position is over BASE', () => {
  assert.equal(ISLAND_DATA[islandAt(0x0139, 0x0170)].name, 'BASE');
});
