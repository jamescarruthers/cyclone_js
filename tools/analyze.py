#!/usr/bin/env python3
"""
Deeper analysis of the three SpeedLock turbo payloads:

    block 11 ->  21 bytes  (tiny — the SpeedLock loader header/stub)
    block 21 ->  46,927 bytes (the main program)
    block 31 ->  1,454 bytes (secondary payload — looks like sprite data)

We also detokenise the BASIC loader (block 2) so we can see what CYCLONE's
LOAD ""-line actually does.
"""

from pathlib import Path
from collections import Counter
import struct

HERE = Path(__file__).resolve().parent
DEC  = HERE.parent / "decrypted"

# --------------------------------------------------------------------
# 1) ZX Spectrum BASIC detokeniser (just enough to read the loader).
# --------------------------------------------------------------------
TOKENS = {
    0xA5:"RND", 0xA6:"INKEY$", 0xA7:"PI", 0xA8:"FN", 0xA9:"POINT",
    0xAA:"SCREEN$", 0xAB:"ATTR", 0xAC:"AT", 0xAD:"TAB", 0xAE:"VAL$",
    0xAF:"CODE", 0xB0:"VAL", 0xB1:"LEN", 0xB2:"SIN", 0xB3:"COS",
    0xB4:"TAN", 0xB5:"ASN", 0xB6:"ACS", 0xB7:"ATN", 0xB8:"LN",
    0xB9:"EXP", 0xBA:"INT", 0xBB:"SQR", 0xBC:"SGN", 0xBD:"ABS",
    0xBE:"PEEK", 0xBF:"IN", 0xC0:"USR", 0xC1:"STR$", 0xC2:"CHR$",
    0xC3:"NOT", 0xC4:"BIN", 0xC5:"OR", 0xC6:"AND", 0xC7:"<=",
    0xC8:">=", 0xC9:"<>", 0xCA:"LINE", 0xCB:"THEN", 0xCC:"TO",
    0xCD:"STEP", 0xCE:"DEF FN", 0xCF:"CAT", 0xD0:"FORMAT", 0xD1:"MOVE",
    0xD2:"ERASE", 0xD3:"OPEN #", 0xD4:"CLOSE #", 0xD5:"MERGE",
    0xD6:"VERIFY", 0xD7:"BEEP", 0xD8:"CIRCLE", 0xD9:"INK", 0xDA:"PAPER",
    0xDB:"FLASH", 0xDC:"BRIGHT", 0xDD:"INVERSE", 0xDE:"OVER", 0xDF:"OUT",
    0xE0:"LPRINT", 0xE1:"LLIST", 0xE2:"STOP", 0xE3:"READ", 0xE4:"DATA",
    0xE5:"RESTORE", 0xE6:"NEW", 0xE7:"BORDER", 0xE8:"CONTINUE",
    0xE9:"DIM", 0xEA:"REM", 0xEB:"FOR", 0xEC:"GO TO", 0xED:"GO SUB",
    0xEE:"INPUT", 0xEF:"LOAD", 0xF0:"LIST", 0xF1:"LET", 0xF2:"PAUSE",
    0xF3:"NEXT", 0xF4:"POKE", 0xF5:"PRINT", 0xF6:"PLOT", 0xF7:"RUN",
    0xF8:"SAVE", 0xF9:"RANDOMIZE", 0xFA:"IF", 0xFB:"CLS", 0xFC:"DRAW",
    0xFD:"CLEAR", 0xFE:"RETURN", 0xFF:"COPY",
}

def detokenise(data):
    """ZX BASIC lines are stored as:  line_no(BE u16)  line_len(LE u16)  body  0x0D
       Numbers in the body appear twice: ASCII form, then 0x0E + 5-byte float."""
    out = []
    i = 0
    while i + 4 < len(data):
        line_no = (data[i] << 8) | data[i+1]
        ln = data[i+2] | (data[i+3] << 8)
        i += 4
        if i + ln > len(data):
            break
        body = data[i:i+ln]
        i += ln
        s = [f"{line_no:4d} "]
        j = 0
        while j < len(body):
            b = body[j]
            if b == 0x0D:
                break
            if b == 0x0E and j + 5 < len(body):
                j += 6   # skip the binary-form numeric literal
                continue
            if b in TOKENS:
                s.append(" " + TOKENS[b] + " ")
            elif 32 <= b < 127:
                s.append(chr(b))
            else:
                s.append(f"<{b:02X}>")
            j += 1
        out.append("".join(s).replace("  ", " ").strip())
    return "\n".join(out)


def main():
    # --- BASIC loader ------------------------------------------------
    basic = DEC / "cyclone_side1_block02.bin"
    if basic.exists():
        body = basic.read_bytes()
        print("=" * 72)
        print(f"BASIC LOADER (block 2, {len(body)} bytes)")
        print("=" * 72)
        print(detokenise(body))

    # --- SpeedLock stub ---------------------------------------------
    stub = DEC / "cyclone_side1_block11.bin"
    if stub.exists():
        b = stub.read_bytes()
        print("\n" + "=" * 72)
        print(f"SPEEDLOCK STUB HEADER (block 11, {len(b)} bytes)")
        print("=" * 72)
        print("  hex:  " + b.hex(" "))
        # Look for ASCII name (Spectrum headers have a 10-byte filename at offset 2)
        try:
            maybe_name = b[2:12].decode('ascii', 'replace')
            print(f"  name guess (off +2..+12): {maybe_name!r}")
        except Exception:
            pass
        # Standard header would be 19 bytes — print as if it were one:
        if len(b) >= 19:
            flag = b[0]; typ = b[1]
            name = b[2:12].decode('ascii', 'replace').rstrip()
            length, p1, p2 = struct.unpack_from('<HHH', b, 12)
            xor = b[18]
            print(f"  interpreted as header: flag={flag:02X} type={typ} "
                  f"name={name!r} length={length} p1=${p1:04X} p2={p2} xor={xor:02X}")

    # --- Main code block ---------------------------------------------
    main_blk = DEC / "cyclone_side1_block21.bin"
    b = main_blk.read_bytes()
    print("\n" + "=" * 72)
    print(f"MAIN TURBO PAYLOAD (block 21, {len(b)} bytes)")
    print("=" * 72)

    # Entropy-ish check: histogram of byte values.  Encrypted data is near
    # uniform (~= 1/256 each); plain Z80 has strong peaks at 00, FF, CD, etc.
    hist = Counter(b)
    top = hist.most_common(8)
    print("  top byte frequencies:")
    for v, n in top:
        print(f"    0x{v:02X}  {n:>6}  ({100*n/len(b):5.2f}%)")

    # How many bytes are 0x00 / 0xFF (rough smoothness indicator)
    print(f"  zero bytes: {hist[0]}  ({100*hist[0]/len(b):.1f}%)")
    print(f"  FF bytes:   {hist[0xFF]}  ({100*hist[0xFF]/len(b):.1f}%)")

    # Look at first & last chunks
    print(f"  first 64 bytes: {b[:64].hex(' ')}")
    print(f"  last  32 bytes: {b[-32:].hex(' ')}")

    # Look for the Z80 "DI / LD SP,nn / JP nn" prelude common at game entry.
    # Opcodes: DI = F3, LD SP,nn = 31 lo hi, JP nn = C3 lo hi
    for i in range(0, min(len(b), 2048) - 5):
        if b[i] == 0xF3 and b[i+1] == 0x31:
            print(f"  found DI ; LD SP,${b[i+3]:02X}{b[i+2]:02X} at offset +{i}")
        if b[i] == 0xC3 and i > 0 and b[i-1] in (0x00, 0xC9):
            pass   # too noisy

    # Is the leading zero area suspicious?
    leading_zero = 0
    while leading_zero < len(b) and b[leading_zero] == 0:
        leading_zero += 1
    print(f"  leading-zero run length: {leading_zero}")

    # --- Secondary block (graphics?) --------------------------------
    tail_blk = DEC / "cyclone_side1_block31.bin"
    if tail_blk.exists():
        t = tail_blk.read_bytes()
        print("\n" + "=" * 72)
        print(f"SECONDARY PAYLOAD (block 31, {len(t)} bytes)")
        print("=" * 72)
        # Character glyphs: draw one by treating last 8 bytes as a 8x8 bitmap.
        # We saw "G" and "H" patterns in the tail.  Show a few.
        print("  last 64 bytes rendered as 8x8 glyphs (. = 0, # = 1):")
        for g in range(len(t) - 64, len(t), 8):
            rows = []
            for r in range(8):
                byte = t[g + r]
                rows.append("".join("#" if byte & (1 << (7 - bit)) else "." for bit in range(8)))
            print("    glyph @ +%d:" % g)
            for r in rows:
                print("      " + r)


if __name__ == "__main__":
    main()
