// THE byte-accuracy gate: every physics state transition of the real 1985
// game (golden traces) must be reproduced exactly by romTick() in
// src/rom-physics.js.
//
// Method: the game's main loop increments a counter at $7528 once per
// iteration, and runs exactly one physics pass ($80F9) per iteration.
// From each trace we sample, at every counter increment:
//   * the physics state at the vsync frame BEFORE the increment
//     (iteration k's writes have landed, iteration k+1 hasn't run);
//   * the buttons byte ($7522) at the increment frame itself (the input
//     read at $5B8C lands between those two frames and is what iteration
//     k+1's physics consumes).
// Then assert  romTick(S_k, B_k) === S_{k+1}  for every consecutive pair.
//
// This validates the entire ported control flow — turn gating and commit
// timing, latched coast heading, takeoff, ramp loops, caps — against
// hundreds of real transitions, with zero tolerance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { romTick } from '../src/rom-physics.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Physics fields: state-block offset and byte width.
const FIELDS = {
  posX: [0x00, 2], posY: [0x02, 2],
  heading: [0x06, 1], pend1: [0x07, 1], pend2: [0x08, 1],
  altitude: [0x0D, 1], hitGround: [0x14, 1], landed: [0x15, 1],
  noFuel: [0x16, 1], rampUp: [0x1A, 1], rampDn: [0x1B, 1],
  turnDelay: [0x21, 1], thrust: [0x27, 1], latchedHeading: [0x3B, 1],
};
const COUNTER = 0x28;   // $7528: main-loop iteration counter
const BUTTONS = 0x22;   // $7522: decoded input byte
const BOOT_SETTLE = 300;

const read = (blk, [o, n]) => (n === 2 ? blk[o] | (blk[o + 1] << 8) : blk[o]);

function iterationSamples(name) {
  const t = JSON.parse(readFileSync(`${ROOT}traces/${name}.trace.json`, 'utf8'));
  const blk = [];
  let cur = null;
  for (let f = 0; f < t.rows.length; f++) {
    if (t.blocks[f]) cur = Buffer.from(t.blocks[f], 'hex');
    blk.push(cur);
  }
  const samples = [];
  for (let f = BOOT_SETTLE + 1; f < blk.length; f++) {
    if (blk[f][COUNTER] !== blk[f - 1][COUNTER]) {
      const s = {};
      for (const k in FIELDS) s[k] = read(blk[f - 1], FIELDS[k]);
      samples.push({ state: s, buttons: blk[f][BUTTONS], frame: f });
    }
  }
  return samples;
}

for (const name of ['takeoff_climb', 'forward_flight', 'turns']) {
  test(`romTick reproduces every transition of the real game: ${name}`, () => {
    const samples = iterationSamples(name);
    assert.ok(samples.length > 40, `expected >40 iterations in ${name}, got ${samples.length}`);
    for (let i = 0; i + 1 < samples.length; i++) {
      const got = { ...samples[i].state };
      romTick(got, samples[i].buttons);
      assert.deepEqual(got, samples[i + 1].state,
        `transition ${i} (vsync frame ${samples[i].frame} -> ${samples[i + 1].frame}, ` +
        `buttons ${samples[i].buttons.toString(2).padStart(5, '0')}) diverged`);
    }
  });
}
