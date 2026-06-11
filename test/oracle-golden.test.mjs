// Golden-trace reproducibility: re-running each input script through the
// emulator must produce exactly the committed trace.  This pins down both
// the oracle's determinism and the integrity of the committed traces that
// every parity test relies on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runScript } from '../tools/oracle.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

for (const file of readdirSync(`${ROOT}traces/scripts`)) {
  const script = JSON.parse(readFileSync(`${ROOT}traces/scripts/${file}`, 'utf8'));
  test(`oracle reproduces golden trace: ${script.name}`, () => {
    const golden = JSON.parse(readFileSync(`${ROOT}traces/${script.name}.trace.json`, 'utf8'));
    const fresh = runScript(script);
    assert.deepEqual(fresh.rows, golden.rows, 'per-frame state rows differ');
    assert.deepEqual(fresh.blocks, golden.blocks, 'state-block snapshots differ');
  });
}
