#!/usr/bin/env node
// Byte-accuracy oracle for Cyclone.
//
// Runs the decrypted 1985 game inside the headless 48K machine (emu/) and
// records the game's state block once per 50 Hz vsync frame while a
// scripted input timeline plays.  The resulting JSON trace is the ground
// truth that the JavaScript re-implementation is compared against.
//
// Usage:
//   node tools/oracle.mjs --script traces/scripts/forward_flight.json \
//                         --out traces/forward_flight.trace.json
//
// Script format:
//   {
//     "name":   "forward_flight",
//     "frames": 800,
//     "events": [
//       { "frame": 250, "controls": { "up": true } },
//       { "frame": 400, "controls": { "up": false, "forward": true } }
//     ]
//   }
// Controls: forward / up / down / left / right (see emu/machine.mjs for the
// key rows they map to under the game's default input scheme).

import { readFileSync, writeFileSync } from 'node:fs';
import { createMachine } from '../emu/machine.mjs';

// Cold entry: installs the IM 2 stub at $FFF4/$FFFF (ISR $83C2), sets
// I=$3A / IM 2 and jumps to the front-end at $E280, which initialises the
// game world itself.  See the disassembly notes in the PR / DECRYPTION docs.
export const COLD_ENTRY = 0x8C87;

export const TRACE_FIELDS = [
  'posX', 'posY', 'heading', 'altitude', 'thrust', 'turnDelay',
  'pend1', 'pend2', 'rampUp', 'rampDn', 'landed', 'noFuel',
  'buttons', 'latchedHeading', 'fuel',
  'heliCellX', 'heliCellY', 'cycloneX', 'cycloneY',
  'cycMovePrescaler', 'cycRegimeCounter', 'cycRegimeAnd', 'cycRegimeOr',
  'cycloneDist', 'seed',
];

export function runScript(script) {
  const m = createMachine();
  const st = m.cpu.getState();
  st.pc = COLD_ENTRY;
  m.cpu.setState(st);

  const events = [...(script.events ?? [])].sort((a, b) => a.frame - b.frame);
  let nextEvent = 0;

  const rows = [];
  let lastBlk = '';
  const blocks = {};            // frame -> hex of $7500..$7563, only on change

  for (let f = 0; f < script.frames; f++) {
    while (nextEvent < events.length && events[nextEvent].frame === f) {
      m.setControls(events[nextEvent].controls ?? {});
      nextEvent++;
    }
    m.runFrame();

    const g = { ...m.gameState(), fuel: m.word(0x7518) };
    rows.push(TRACE_FIELDS.map((k) => g[k]));

    const blk = Buffer.from(m.stateBlock()).toString('hex');
    if (blk !== lastBlk) { blocks[f] = blk; lastBlk = blk; }
  }

  return {
    meta: {
      script: script.name,
      frames: script.frames,
      entry: '0x' + COLD_ENTRY.toString(16),
      fields: TRACE_FIELDS,
      generator: 'tools/oracle.mjs',
    },
    rows,
    blocks,
  };
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const scriptPath = get('--script');
  const outPath = get('--out');
  if (!scriptPath) {
    console.error('usage: node tools/oracle.mjs --script <script.json> [--out <trace.json>]');
    process.exit(2);
  }
  const script = JSON.parse(readFileSync(scriptPath, 'utf8'));
  const trace = runScript(script);
  const json = JSON.stringify(trace);
  if (outPath) {
    writeFileSync(outPath, json);
    console.log(`wrote ${outPath} (${trace.rows.length} frames, ${Object.keys(trace.blocks).length} state changes)`);
  } else {
    console.log(json);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
