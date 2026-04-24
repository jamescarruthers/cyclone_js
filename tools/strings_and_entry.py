#!/usr/bin/env python3
"""
Final-pass analysis: find in-game text, the entry point, and verify that the
main turbo payload really is plaintext Z80 code (i.e. that SpeedLock 1's
"encryption" is nothing more than custom tape-pulse timing).

Also: split the 46,927-byte dump into the three canonical regions of the
Spectrum memory map:

   offset  0x0000 .. 0x1AFF (6,912)       -> loading screen ($4000 layout)
   offset  0x1B00 .. 0x1B2F (0x2F)        -> gap
   offset  0x1B00+  up to end             -> game code + data
"""

from pathlib import Path
import re
import struct

HERE = Path(__file__).resolve().parent
DEC  = HERE.parent / "decrypted"

blk2  = (DEC / "cyclone_side1_block02.bin").read_bytes()
blk21 = (DEC / "cyclone_side1_block21.bin").read_bytes()
blk31 = (DEC / "cyclone_side1_block31.bin").read_bytes()


# ----- 1) printable-text search -------------------------------------
def find_strings(data, min_len=5):
    results = []
    for m in re.finditer(rb"[\x20-\x7E]{%d,}" % min_len, data):
        results.append((m.start(), m.group().decode("ascii")))
    # ZX Spectrum often stores text with the last character of each word
    # having bit 7 set.  Strip bit 7 and retry.
    stripped = bytes(b & 0x7F for b in data)
    for m in re.finditer(rb"[\x20-\x7E]{%d,}" % min_len, stripped):
        results.append((m.start(), "[bit7-stripped] " + m.group().decode("ascii")))
    return results

print("=" * 72)
print("TEXT STRINGS found in main payload (block 21)")
print("=" * 72)
hits = find_strings(blk21, min_len=6)
seen = set()
for off, s in hits:
    key = s.strip().lower()
    if key in seen:
        continue
    seen.add(key)
    if any(c.isalpha() for c in s) and len(s.strip()) >= 6:
        print(f"  +0x{off:04X}  {s}")

print("\n" + "=" * 72)
print("TEXT STRINGS found in secondary payload (block 31)")
print("=" * 72)
for off, s in find_strings(blk31, min_len=6):
    if any(c.isalpha() for c in s):
        print(f"  +0x{off:04X}  {s}")


# ----- 2) split loading screen from game code ------------------------
SCREEN_SIZE = 6912   # 6144 pixel + 768 attr bytes
# The main payload starts with 108 zero bytes (loading screen's top-left is
# usually black).  So offset 0..6911 is the screen data.
screen = blk21[:SCREEN_SIZE]
rest   = blk21[SCREEN_SIZE:]

(DEC / "cyclone_loading_screen.bin").write_bytes(screen)
(DEC / "cyclone_code_and_data.bin").write_bytes(rest)
print("\nWrote:")
print(f"  cyclone_loading_screen.bin   ({len(screen)} bytes)  -- SCREEN$ layout, load to $4000")
print(f"  cyclone_code_and_data.bin    ({len(rest)} bytes)  -- game code + data (loads to $5B00)")


# ----- 3) Convert loading screen to a PGM so we can view it ----------
def screen_to_pgm(screen_bytes, out_path):
    """ZX screen layout: 6144 bytes pixels in a funky interleaved order."""
    pixels = [[0]*256 for _ in range(192)]
    for ay in range(24):
        for by in range(8):
            for cy in range(8):
                y = ay*8 + by + cy*0 # placeholder
    # Correct addressing:
    # address = 0x0000 + (y & 0xC0) * 32 + (y & 0x07) * 256 + (y & 0x38) * 4 + x
    #   where y is 0..191 screen row, x is 0..31 byte column
    for y in range(192):
        hi = (y & 0xC0) >> 6   # 0..3
        lo = y & 0x07
        mid = (y & 0x38) >> 3
        addr = (hi << 11) | (lo << 8) | (mid << 5)
        for xb in range(32):
            byte = screen_bytes[addr + xb]
            for bit in range(8):
                px = 255 if byte & (0x80 >> bit) else 0
                pixels[y][xb*8 + bit] = px
    with open(out_path, "wb") as f:
        f.write(b"P5\n256 192\n255\n")
        for row in pixels:
            f.write(bytes(row))

screen_to_pgm(screen, DEC / "cyclone_loading_screen.pgm")
print(f"  cyclone_loading_screen.pgm   -- 256x192 monochrome preview (PGM)")


# ----- 4) Find the probable game entry point ------------------------
# A Z80 game usually starts with one of these prologues:
#   F3              DI
#   F3 31 lo hi     DI : LD SP,nnnn
#   31 lo hi F3     LD SP : DI
# Look through the first few KB of the code region.
print("\n" + "=" * 72)
print("Entry-point candidates in game code")
print("=" * 72)
for i in range(min(len(rest), 4096) - 4):
    if rest[i] == 0xF3 and rest[i+1] == 0x31:
        sp = rest[i+2] | (rest[i+3] << 8)
        abs_addr = 0x5B00 + i
        print(f"  +0x{i:04X}  (addr ${abs_addr:04X})  DI ; LD SP,${sp:04X}")
    if rest[i] == 0x31 and i+4 < len(rest) and rest[i+3] == 0xF3:
        sp = rest[i+1] | (rest[i+2] << 8)
        abs_addr = 0x5B00 + i
        print(f"  +0x{i:04X}  (addr ${abs_addr:04X})  LD SP,${sp:04X} ; DI")

# The Vortex/SpeedLock convention: after SL loads the code to its target
# address, it hands control to the address stored in the header's p1 field.
# Our SpeedLock stub header (block 11) had p1 = $4318 — but that's actually
# the *reloc* address of the stub, not the game entry.
# The game itself is almost certainly entered via a RANDOMIZE USR in BASIC,
# pointing at the code-region start.
print(f"\nGame code region starts at offset $1B00 in memory ($5B00).")
print(f"Byte at $5B00:  0x{rest[0]:02X}  (first code byte)")
print(f"Bytes $5B00..$5B0F: {rest[:16].hex(' ')}")
