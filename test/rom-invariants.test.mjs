// Sanity assertions on the golden traces themselves: the documented ROM
// mechanics must be visible in the recorded behaviour of the real game.
// These test the *oracle* (and our understanding of the disassembly), not
// the JS port — they read the committed traces only, no emulation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Velocity-delta table recovered from ROM $826F, indexed by heading/2.
// [dx, dy] with -y = north.
const VELOCITY = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

function loadTrace(name) {
  const t = JSON.parse(readFileSync(`${ROOT}traces/${name}.trace.json`, 'utf8'));
  const idx = Object.fromEntries(t.meta.fields.map((f, i) => [f, i]));
  return { rows: t.rows, idx };
}

// The front-end boots and initialises the state block during the first
// ~50 frames (template copy at $5B1B writes posX 0 -> 313 in one go);
// every script's first input lands at frame 250, so scan after settle.
const BOOT_SETTLE = 240;

for (const name of ['takeoff_climb', 'forward_flight', 'turns']) {
  test(`ROM invariants hold in trace: ${name}`, () => {
    const { rows, idx } = loadTrace(name);
    let movedFrames = 0;
    for (let f = BOOT_SETTLE; f < rows.length; f++) {
      const r = rows[f], p = rows[f - 1];

      // Hard caps recovered from the disassembly.
      assert.ok(r[idx.thrust] <= 7, `thrust cap ($7527 <= 7) violated at frame ${f}`);
      assert.ok(r[idx.altitude] <= 0x3C, `altitude cap ($3C) violated at frame ${f}`);
      assert.ok(r[idx.turnDelay] <= 3, `turn delay cap (3) violated at frame ${f}`);
      assert.ok(r[idx.rampUp] <= 3 && r[idx.rampDn] <= 3, `altitude ramp cap violated at frame ${f}`);

      // Committed heading is always even (16-value space, steps of 2).
      assert.equal(r[idx.heading] % 2, 0, `odd committed heading at frame ${f}`);

      // Movement: at most 1 unit per axis per physics tick, and only the
      // velocity-table direction for the *latched* heading.
      const dx = r[idx.posX] - p[idx.posX];
      const dy = r[idx.posY] - p[idx.posY];
      if (dx !== 0 || dy !== 0) {
        movedFrames++;
        assert.ok(Math.abs(dx) <= 1 && Math.abs(dy) <= 1,
          `moved more than 1 unit/axis between vsyncs at frame ${f} (${dx},${dy})`);
        assert.ok(p[idx.thrust] > 0 || r[idx.thrust] > 0,
          `moved with zero thrust at frame ${f}`);
        const [vx, vy] = VELOCITY[(r[idx.latchedHeading] / 2) | 0];
        if (dx !== 0) assert.equal(dx, vx, `x-step disagrees with ROM velocity table at frame ${f}`);
        if (dy !== 0) assert.equal(dy, vy, `y-step disagrees with ROM velocity table at frame ${f}`);
      }
    }
    if (name !== 'takeoff_climb') {
      assert.ok(movedFrames > 20, 'expected sustained movement in this trace');
    }
  });
}

test('takeoff clears the landed flag and climb saturates at $3C', () => {
  const { rows, idx } = loadTrace('takeoff_climb');
  assert.equal(rows[200][idx.landed], 1, 'should start landed');
  assert.equal(rows[200][idx.altitude], 8, 'template altitude is 8');
  const last = rows[rows.length - 1];
  assert.equal(last[idx.landed], 0, 'should be airborne after climb');
  assert.equal(Math.max(...rows.map(r => r[idx.altitude])), 0x3C, 'climb should reach exactly the $3C cap');
});

test('turn cadence: heading steps by 2 with a 3-tick delay between steps', () => {
  const { rows, idx } = loadTrace('turns');
  const commits = [];
  for (let f = BOOT_SETTLE; f < rows.length; f++) {
    if (rows[f][idx.heading] !== rows[f - 1][idx.heading]) {
      commits.push({ f, from: rows[f - 1][idx.heading], to: rows[f][idx.heading] });
    }
  }
  assert.ok(commits.length >= 10, 'expected at least 10 heading commits');
  for (const c of commits) {
    const step = ((c.to - c.from) + 16) % 16;
    assert.ok(step === 2 || step === 14, `heading must step ±2, got ${c.from}->${c.to} at frame ${c.f}`);
  }
  // Left-turn phase walks counterclockwise, right-turn phase clockwise.
  const leftPhase = commits.filter(c => c.f < 600).map(c => c.to);
  const rightPhase = commits.filter(c => c.f >= 600).map(c => c.to);
  assert.deepEqual(leftPhase, [2, 0, 14, 12, 10, 8], 'left-turn heading sequence');
  assert.deepEqual(rightPhase, [10, 12, 14, 0, 2, 4], 'right-turn heading sequence');
});
