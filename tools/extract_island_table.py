#!/usr/bin/env python3
"""
Extract the 14-island record table at memory $F230 from the decrypted
Cyclone code (file loads at $5B00).

The game stores 14 x 20-byte records.  The field we most care about is at
offset +16/+17: a display-file address that places the island's label on
the 32x24 character grid.  We decode that back into (col, row) and pair
it with the island-name order from the name list at $6A50.

Output: a JSON file consumed by the three.js world builder.
"""

from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
DEC  = HERE.parent / "decrypted"
OUT  = HERE.parent / "src" / "islands_data.js"

# Islands in the order the game iterates them (from the name list at $6A50,
# terminated by $FD / $FE separators).  Verified by inspecting the raw bytes.
NAMES = [
    "BANANA", "ORTE ROCKS", "KOKOLA", "LAGOON", "PEAK",
    "BASE", "GILLIGANS", "RED", "SKEG", "BONE",
    "GIANTS GATEWAY", "CLAW", "LUKELAND ISLES", "ENTERPRISE",
]

BASE = 0x5B00
TBL  = 0xF230
REC_SIZE = 20

def decode_df_addr(addr):
    """Convert a ZX Spectrum display-file character address ($4000-$57FF)
    into (col, row) on the 32x24 text grid."""
    off = addr - 0x4000
    row_block = off >> 11            # 0..2
    row_inside = (off >> 5) & 7      # 0..7
    col = off & 31
    row = row_block * 8 + row_inside
    return col, row


def main():
    data = (DEC / "cyclone_code_and_data.bin").read_bytes()
    off = TBL - BASE
    islands = []
    for i, name in enumerate(NAMES):
        rec = data[off + i * REC_SIZE : off + (i + 1) * REC_SIZE]
        pos = rec[16] | (rec[17] << 8)
        col, row = decode_df_addr(pos)
        # Two other bytes at +14/+15 look like a shape id pair (width/height
        # in char cells, or a sprite ID).  We keep them so the 3D version can
        # scale bigger/smaller islands correctly.
        w, h = rec[14], rec[15]
        # The 2-byte pair at +0/+1 is a shape type code (0..2, 0..2).
        shape = (rec[0], rec[1])
        islands.append({
            "name": name,
            "col": col,
            "row": row,
            "width_hint": w,
            "height_hint": h,
            "shape": shape,
            "raw": rec.hex(),
        })
    # Emit JS
    lines = [
        "// Auto-generated from tools/extract_island_table.py",
        "// Source: decrypted Cyclone ROM, island record table at $F230.",
        "// Each record is 20 bytes; we extract the screen label position and",
        "// a shape/size hint.  The (col,row) pair is on the 32x24 text grid.",
        "",
        "export const ISLAND_DATA = [",
    ]
    for is_ in islands:
        lines.append(
            f"  {{ name: {json.dumps(is_['name']) + ',':<19} "
            f"col: {is_['col']:>2}, row: {is_['row']:>2}, "
            f"wHint: {is_['width_hint']}, hHint: {is_['height_hint']}, "
            f"shape: [{is_['shape'][0]}, {is_['shape'][1]}] }},"
        )
    lines.append("];")
    lines.append("")
    OUT.write_text("\n".join(lines))

    # also pretty-print to stdout
    print(f"Wrote {OUT}")
    print()
    print(f"{'#':>2}  {'name':<16}  col  row  wHint  hHint  shape")
    print("-" * 60)
    for i, is_ in enumerate(islands):
        print(f"{i:>2}  {is_['name']:<16}  {is_['col']:>3}  {is_['row']:>3}  "
              f"{is_['width_hint']:>4}   {is_['height_hint']:>4}   {is_['shape']}")
    # Draw the map
    print("\nOriginal archipelago layout (label positions on the 32x24 text grid):")
    grid = [["." for _ in range(32)] for _ in range(24)]
    for i, is_ in enumerate(islands):
        c = is_['col']; r = is_['row']
        ch = is_['name'][0]
        if grid[r][c] != ".":
            # simple collision resolution: put '*' to note
            grid[r][c] = "*"
        else:
            grid[r][c] = ch
    print("    " + "".join(str(i % 10) for i in range(32)))
    for i, row in enumerate(grid):
        print(f"  {i:>2}  {''.join(row)}")


if __name__ == "__main__":
    main()
