# Third-party components in `emu/`

## `z80.mjs`

Vendored from [DrGoldfire/Z80.js](https://github.com/DrGoldfire/Z80.js)
(`Z80.js`), © Molly Howell, MIT license.  Local changes are limited to a
Node-safe `window` guard and an ES-module export; see the file header.

## `roms/48.rom`

The original ZX Spectrum 48K ROM image (16,384 bytes,
MD5 `4c42a2f075212361c3117015b107ff68`), © Amstrad plc.

Amstrad has long granted permission for the free redistribution of the
Sinclair ZX Spectrum ROMs for use with emulators, while retaining the
copyright (the widely cited 1999 statement by Cliff Lawson on
comp.sys.sinclair).  It is included here solely so the headless emulator
in this directory can run the game for byte-accuracy testing:

* the game's IM 2 interrupt vector is fetched from ROM bytes `$3AFF/$3B00`;
* the IM 1 path uses the ROM ISR at `$0038` (which requires `IY=$5C3A`);
* the game calls the ROM beeper at `$03B5` and key-scan routines.

Amstrad's permission notice requests that distributions acknowledge their
copyright, which this file does.
