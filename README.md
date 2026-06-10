# cyclone_js

A two-part project built around the file `Cyclone.tzx.zip` that ships in this
repository:

1. **Decrypt** the SpeedLock-1 protected ZX Spectrum tape image inside the zip
   and produce an unprotected, disassemblable dump of the original game.
2. **Recreate** the game &mdash; *Cyclone* by Costa Panayi / Vortex Software,
   1985 &mdash; as a web app using [three.js](https://threejs.org/).

## 1. Decrypting the tape

```bash
unzip Cyclone.tzx.zip -d extracted/
python3 tools/tzx_decrypt.py          # parses the TZX, emits a clean .tap
python3 tools/analyze.py              # inspects every block
python3 tools/strings_and_entry.py    # finds in-game strings / entry point
```

Outputs land in `decrypted/`.  See
[`decrypted/DECRYPTION_NOTES.md`](decrypted/DECRYPTION_NOTES.md) for the full
write-up, including:

* how SpeedLock 1 actually protects the tape (custom pulse timings, no
  per-byte XOR &mdash; that came later);
* detokenised BASIC loader;
* disassembly of the 21-byte SpeedLock stub;
* every in-game text string lifted straight out of the Z80 binary (island
  names, HUD labels, mission text).

## 2. Running the web app

It's a pure static site that loads `three` from a CDN via `importmap`, so any
static server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

### Controls

The control model matches the ROM's five buttons (FORWARD / TURN_L /
TURN_R / UP / DOWN) — there is no pitch, roll or strafing in the original.

| key | action |
| --- | --- |
| <kbd>W</kbd> / <kbd>&uarr;</kbd> | forward thrust |
| <kbd>A</kbd> / <kbd>Q</kbd> / <kbd>&larr;</kbd> | turn left (45° steps) |
| <kbd>D</kbd> / <kbd>E</kbd> / <kbd>&rarr;</kbd> | turn right (45° steps) |
| <kbd>Space</kbd> / <kbd>Shift</kbd> | climb / descend |
| <kbd>M</kbd> | map view |
| <kbd>C</kbd> | cycle camera (iso / chase / cinematic / overhead) |
| <kbd>P</kbd> | pause |
| <kbd>N</kbd> | mute |
| <kbd>R</kbd> | restart |

### Faithfulness to the 1985 original

The web app uses the real ROM-recovered:

* **island names** &mdash; BASE, BANANA, KOKOLA, LAGOON, PEAK, GILLIGANS,
  RED, SKEG, BONE, CLAW, ENTERPRISE (+ ORTE ROCKS, GIANTS GATEWAY,
  LUKELAND ISLES);
* **mission brief** &mdash; *"COLLECT FIVE CRATES AND RETURN TO BASE"*;
* **wind mechanic** &mdash; *"WIND SPEED INCREASES WHEN APPROACHING CYCLONE"*.

What it does *not* do is emulate the Z80 &mdash; if you want the genuine
article, load `decrypted/cyclone_side1.tap` in any Spectrum emulator
(`fuse`, `Spectaculator`, etc.).

## File layout

```
Cyclone.tzx.zip          original SpeedLock-1 tape archive
extracted/               unzipped TZX files
tools/
  tzx_decrypt.py         TZX parser + SL1 unwrapper
  analyze.py             per-block inspector, BASIC detokeniser, glyph viewer
  strings_and_entry.py   text-string extractor, screen$ decoder, entry finder
decrypted/
  DECRYPTION_NOTES.md    the full write-up
  cyclone_side1.tap      clean, SpeedLock-free tape
  cyclone_loading_screen.pgm   256x192 preview of the loading screen
  cyclone_code_and_data.bin    40 KB of plaintext Z80 code + data
  ...
index.html               web app entry
src/
  main.js                game loop, state, HUD
  world.js               sky, sea, islands, clouds
  helicopter.js          the player vehicle
  cyclone.js             the tornado (GPU-billboarded points)
  props.js               crate & helipad
```
