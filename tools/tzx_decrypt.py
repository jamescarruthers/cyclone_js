#!/usr/bin/env python3
"""
TZX parser and SpeedLock-1 unwrapper for Cyclone (Vortex Software, 1985).

The TZX file wraps ZX Spectrum tape data in structured blocks.  SpeedLock 1
protection works by replacing the normal ROM-speed loader with a custom loader
that reads "turbo" blocks (TZX id 0x11) using non-standard pulse timings.  The
data on the tape, for SpeedLock 1, is the raw Z80 code itself — there is no
per-byte XOR like later variants.  So "decryption" for SL1 is simply:

  * walk the TZX
  * for every data-bearing block, extract its payload
  * drop the 1-byte "flag" prefix and the trailing XOR checksum
  * concatenate in load order

We also emit an unprotected .tap file alongside the dumps so the result can be
inspected in any Spectrum tool.
"""

import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
IN_FILE = HERE.parent / "extracted" / "Cyclone - Side 1.tzx"
OUT_DIR = HERE.parent / "decrypted"
OUT_DIR.mkdir(exist_ok=True)


# ---------- TZX block definitions --------------------------------------
#
# Only the block ids actually found in this file are fully decoded; others are
# skipped by length.  A short fall-through table covers the rest.

BLOCK_NAMES = {
    0x10: "Standard Speed Data",
    0x11: "Turbo Speed Data",
    0x12: "Pure Tone",
    0x13: "Pulse Sequence",
    0x14: "Pure Data",
    0x15: "Direct Recording",
    0x18: "CSW Recording",
    0x19: "Generalized Data",
    0x20: "Pause / Stop The Tape",
    0x21: "Group Start",
    0x22: "Group End",
    0x23: "Jump to Block",
    0x24: "Loop Start",
    0x25: "Loop End",
    0x26: "Call Sequence",
    0x27: "Return from Sequence",
    0x28: "Select Block",
    0x2A: "Stop if 48k",
    0x2B: "Set Signal Level",
    0x30: "Text Description",
    0x31: "Message",
    0x32: "Archive Info",
    0x33: "Hardware Type",
    0x35: "Custom Info",
    0x5A: "Glue",
}


def read_exact(buf, pos, n):
    if pos + n > len(buf):
        raise EOFError(f"need {n} bytes at {pos}, have {len(buf) - pos}")
    return buf[pos:pos + n], pos + n


def parse_tzx(buf):
    """Yield (block_id, payload_bytes_including_flag_and_checksum_or_None, raw_header_bytes)."""
    assert buf[:8] == b"ZXTape!\x1a", "not a TZX"
    major, minor = buf[8], buf[9]
    print(f"  TZX version {major}.{minor}")
    pos = 10
    idx = 0
    while pos < len(buf):
        bid = buf[pos]; pos += 1
        name = BLOCK_NAMES.get(bid, f"unknown 0x{bid:02X}")

        if bid == 0x10:  # standard speed data
            pause, length = struct.unpack_from("<HH", buf, pos); pos += 4
            data, pos = read_exact(buf, pos, length)
            yield idx, bid, name, data, {"pause": pause}
        elif bid == 0x11:  # turbo speed data
            (pilot, sync1, sync2, zero, one, pilotLen, used_bits,
             pause) = struct.unpack_from("<HHHHHHBH", buf, pos)
            pos += 15
            length = buf[pos] | (buf[pos+1] << 8) | (buf[pos+2] << 16)
            pos += 3
            data, pos = read_exact(buf, pos, length)
            yield idx, bid, name, data, {
                "pilot": pilot, "sync1": sync1, "sync2": sync2,
                "zero": zero, "one": one, "pilotLen": pilotLen,
                "used_bits": used_bits, "pause": pause,
            }
        elif bid == 0x12:
            pos += 4
            yield idx, bid, name, None, {}
        elif bid == 0x13:
            n = buf[pos]; pos += 1
            pos += 2 * n
            yield idx, bid, name, None, {}
        elif bid == 0x14:
            (zero, one, used_bits, pause) = struct.unpack_from("<HHBH", buf, pos); pos += 7
            length = buf[pos] | (buf[pos+1] << 8) | (buf[pos+2] << 16)
            pos += 3
            data, pos = read_exact(buf, pos, length)
            yield idx, bid, name, data, {"zero": zero, "one": one, "pause": pause}
        elif bid == 0x20:
            pos += 2
            yield idx, bid, name, None, {}
        elif bid == 0x21:
            n = buf[pos]; pos += 1
            pos += n
            yield idx, bid, name, None, {}
        elif bid == 0x22:
            yield idx, bid, name, None, {}
        elif bid == 0x24:
            pos += 2
            yield idx, bid, name, None, {}
        elif bid == 0x25:
            yield idx, bid, name, None, {}
        elif bid == 0x2A:
            pos += 4
            yield idx, bid, name, None, {}
        elif bid == 0x30:
            n = buf[pos]; pos += 1
            text, pos = read_exact(buf, pos, n)
            yield idx, bid, name, text, {}
        elif bid == 0x31:
            pos += 1
            n = buf[pos]; pos += 1
            text, pos = read_exact(buf, pos, n)
            yield idx, bid, name, text, {}
        elif bid == 0x32:
            length = struct.unpack_from("<H", buf, pos)[0]; pos += 2
            data, pos = read_exact(buf, pos, length)
            yield idx, bid, name, data, {}
        elif bid == 0x33:
            n = buf[pos]; pos += 1
            pos += 3 * n
            yield idx, bid, name, None, {}
        elif bid == 0x35:
            pos += 16
            length = struct.unpack_from("<I", buf, pos)[0]; pos += 4
            pos += length
            yield idx, bid, name, None, {}
        elif bid == 0x5A:
            pos += 9
            yield idx, bid, name, None, {}
        else:
            raise NotImplementedError(
                f"block 0x{bid:02X} at {pos-1} not handled — extend parser"
            )
        idx += 1


# ---------- Spectrum header decoding -----------------------------------

def describe_header(data):
    """A Spectrum ROM header block is 19 bytes: flag(1) + header(17) + xor(1)."""
    if len(data) != 19 or data[0] != 0x00:
        return None
    typ = data[1]
    name = data[2:12].decode("ascii", errors="replace").rstrip()
    length, p1, p2 = struct.unpack_from("<HHH", data, 12)
    kinds = {0: "Program", 1: "Number Array", 2: "Character Array", 3: "Code"}
    return {
        "kind": kinds.get(typ, f"type {typ}"),
        "name": name,
        "length": length,
        "p1": p1, "p2": p2,
    }


# ---------- Write a .tap ------------------------------------------------
#
# A .tap file is simply a sequence of length-prefixed payloads.  By taking the
# payload of every turbo & standard block and emitting it with a 2-byte length
# prefix, we effectively create a "ROM-speed" version of the tape — i.e.,
# SpeedLock removed.

def write_tap(path, payloads):
    with open(path, "wb") as f:
        for p in payloads:
            f.write(struct.pack("<H", len(p)))
            f.write(p)


# ---------- Dump the Z80 plaintext --------------------------------------

def main():
    buf = IN_FILE.read_bytes()
    print(f"Reading {IN_FILE.name}  ({len(buf)} bytes)")

    blocks = list(parse_tzx(buf))
    print(f"  {len(blocks)} TZX blocks\n")

    all_payloads = []
    code_chunks = []          # data bytes only, no flag/xor
    header_chunks = []

    print(f"{'#':>3}  {'id':<4}  {'name':<24}  bytes  notes")
    print("-" * 78)
    for idx, bid, name, data, info in blocks:
        size = len(data) if data is not None else 0
        note = ""
        if data is not None and bid in (0x10, 0x11, 0x14):
            all_payloads.append(data)
            if len(data) >= 2:
                flag = data[0]; xor = data[-1]
                body = data[1:-1]
                # ROM-format (std speed) block: 19-byte header, or flag 0xFF + data + XOR
                if bid == 0x10 and flag == 0x00 and len(data) == 19:
                    meta = describe_header(data)
                    if meta:
                        note = f"HEADER: {meta['kind']} '{meta['name']}' len={meta['length']} p1={meta['p1']}"
                        header_chunks.append((idx, meta, data))
                elif bid == 0x10 and flag == 0xFF:
                    note = f"BASIC/data block ({len(body)} bytes)"
                    code_chunks.append((idx, body))
                else:
                    # Custom turbo / pure-data blocks — treat whole payload as code.
                    note = (f"turbo payload flag=0x{flag:02X} "
                            f"checksum=0x{xor:02X} len={len(data)}")
                    code_chunks.append((idx, data))
        elif bid == 0x32:
            # archive info: data[0] = number of strings, then (id, len, text)*
            n = data[0]
            p = 1
            infos = []
            for _ in range(n):
                tid = data[p]; l = data[p+1]
                txt = data[p+2:p+2+l].decode("ascii", "replace")
                infos.append(f"[{tid:02X}]{txt}")
                p += 2 + l
            note = "; ".join(infos)
        elif bid == 0x30:
            note = data.decode("ascii", "replace")
        print(f"{idx:>3}  0x{bid:02X}  {name:<24}  {size:>5}  {note}")

    # --- Extract plaintext dumps -------------------------------------
    full = b"".join(d for _, d in code_chunks)
    (OUT_DIR / "cyclone_side1_full.bin").write_bytes(full)

    # Emit per-block code chunks too
    for idx, body in code_chunks:
        p = OUT_DIR / f"cyclone_side1_block{idx:02d}.bin"
        p.write_bytes(body)

    # Unprotected .tap
    write_tap(OUT_DIR / "cyclone_side1.tap", all_payloads)

    print("\nWrote:")
    print(f"  {OUT_DIR / 'cyclone_side1.tap'}   ({sum(2+len(p) for p in all_payloads)} bytes)")
    print(f"  {OUT_DIR / 'cyclone_side1_full.bin'}   ({len(full)} bytes of raw code)")
    print(f"  {len(code_chunks)} per-block binaries")

    # Look at the very first standard block (the BASIC loader) — that's
    # public/unencrypted and gives us the game title & entry point.
    if header_chunks:
        idx, meta, _ = header_chunks[0]
        print(f"\nFirst header (block {idx}): {meta}")

    # Try to list the entry point recorded in the Code header, if any.
    for idx, meta, _ in header_chunks:
        if meta["kind"] == "Code":
            print(f"  Code header '{meta['name']}' expects load at ${meta['p1']:04X}"
                  f" ({meta['p1']}), length {meta['length']}")

    # Print a tiny hex preview of the first 64 bytes of decrypted code
    preview = full[:64]
    hex_ = " ".join(f"{b:02X}" for b in preview)
    print(f"\nfirst 64 bytes of combined code stream:\n  {hex_}")


if __name__ == "__main__":
    main()
