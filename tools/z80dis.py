#!/usr/bin/env python3
"""
Minimal, pragmatic Z80 disassembler.  Just enough to read a few hundred
bytes of Cyclone at a time and look for data-table references.  Does not
handle every rare opcode — unknowns are emitted as "DB $xx".
"""

# --- opcode tables ----------------------------------------------------
R8   = ["B", "C", "D", "E", "H", "L", "(HL)", "A"]
R16  = ["BC", "DE", "HL", "SP"]
R16P = ["BC", "DE", "HL", "AF"]     # PUSH / POP
CC   = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"]
ALU  = ["ADD A,", "ADC A,", "SUB ", "SBC A,", "AND ", "XOR ", "OR ", "CP "]
ROT  = ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SLL", "SRL"]


def disasm(mem, base, start, count):
    """Disassemble `count` instructions from mem[start:] as if loaded at `base`.
    Returns list of (addr, bytes, mnemonic)."""
    out = []
    pc = start
    end = len(mem)
    for _ in range(count):
        if pc >= end:
            break
        addr = base + pc
        op = mem[pc]
        nb = 1
        txt = f"DB ${op:02X}"

        # Prefixes
        if op in (0xDD, 0xFD):
            ix = "IX" if op == 0xDD else "IY"
            pc += 1; op2 = mem[pc] if pc < end else 0
            nb = 2
            if op2 in (0x21,):
                lo, hi = mem[pc+1], mem[pc+2]
                txt = f"LD {ix},${(hi<<8)|lo:04X}"; nb += 2; pc += 2
            elif op2 == 0xE5:
                txt = f"PUSH {ix}"
            elif op2 == 0xE1:
                txt = f"POP {ix}"
            elif op2 == 0xE9:
                txt = f"JP ({ix})"
            elif op2 == 0x36:
                d = to_s8(mem[pc+1]); n = mem[pc+2]
                txt = f"LD ({ix}{d:+d}),${n:02X}"; nb += 2; pc += 2
            elif op2 == 0x7E:
                d = to_s8(mem[pc+1]); txt = f"LD A,({ix}{d:+d})"; nb += 1; pc += 1
            elif op2 == 0x77:
                d = to_s8(mem[pc+1]); txt = f"LD ({ix}{d:+d}),A"; nb += 1; pc += 1
            elif op2 == 0x09:
                txt = f"ADD {ix},BC"
            elif op2 == 0x19:
                txt = f"ADD {ix},DE"
            elif op2 == 0x29:
                txt = f"ADD {ix},{ix}"
            elif op2 == 0x39:
                txt = f"ADD {ix},SP"
            else:
                txt = f"DB ${op:02X},${op2:02X}   ; {ix}-prefixed"
            pc += 1
            out.append((addr, mem[pc-nb:pc], txt))
            continue
        if op == 0xED:
            pc += 1; op2 = mem[pc] if pc < end else 0
            nb = 2
            if op2 == 0xB0: txt = "LDIR"
            elif op2 == 0xB8: txt = "LDDR"
            elif op2 == 0xA0: txt = "LDI"
            elif op2 == 0xA8: txt = "LDD"
            elif op2 == 0x47: txt = "LD I,A"
            elif op2 == 0x4F: txt = "LD R,A"
            elif op2 == 0x57: txt = "LD A,I"
            elif op2 == 0x5F: txt = "LD A,R"
            elif op2 in (0x42, 0x52, 0x62, 0x72):  # SBC HL,rr
                rr = (op2 >> 4) - 4
                txt = f"SBC HL,{R16[rr]}"
            elif op2 in (0x4A, 0x5A, 0x6A, 0x7A):  # ADC HL,rr
                rr = (op2 >> 4) - 4
                txt = f"ADC HL,{R16[rr]}"
            elif op2 in (0x43, 0x53, 0x63, 0x73):  # LD (nn),rr
                lo, hi = mem[pc+1], mem[pc+2]
                rr = (op2 >> 4) - 4
                txt = f"LD (${(hi<<8)|lo:04X}),{R16[rr]}"; nb += 2; pc += 2
            elif op2 in (0x4B, 0x5B, 0x6B, 0x7B):  # LD rr,(nn)
                lo, hi = mem[pc+1], mem[pc+2]
                rr = (op2 >> 4) - 4
                txt = f"LD {R16[rr]},(${(hi<<8)|lo:04X})"; nb += 2; pc += 2
            elif op2 == 0x44: txt = "NEG"
            elif op2 == 0x45: txt = "RETN"
            elif op2 == 0x4D: txt = "RETI"
            elif op2 == 0x46: txt = "IM 0"
            elif op2 == 0x56: txt = "IM 1"
            elif op2 == 0x5E: txt = "IM 2"
            else:
                txt = f"DB ${op:02X},${op2:02X}"
            pc += 1
            out.append((addr, mem[pc-nb:pc], txt))
            continue
        if op == 0xCB:
            pc += 1; op2 = mem[pc] if pc < end else 0
            nb = 2
            y = (op2 >> 3) & 7; z = op2 & 7
            x = op2 >> 6
            if x == 0: txt = f"{ROT[y]} {R8[z]}"
            elif x == 1: txt = f"BIT {y},{R8[z]}"
            elif x == 2: txt = f"RES {y},{R8[z]}"
            else:        txt = f"SET {y},{R8[z]}"
            pc += 1
            out.append((addr, mem[pc-nb:pc], txt))
            continue

        # Main table — decoded via the standard Z80 scheme
        x = op >> 6; y = (op >> 3) & 7; z = op & 7
        p = y >> 1; q = y & 1

        if x == 0:
            if z == 0:
                if   y == 0: txt = "NOP"
                elif y == 1: txt = "EX AF,AF'"
                elif y == 2:
                    d = to_s8(mem[pc+1]); nb += 1; pc += 1
                    txt = f"DJNZ ${base+pc+1+d:04X}"
                elif y == 3:
                    d = to_s8(mem[pc+1]); nb += 1; pc += 1
                    txt = f"JR ${base+pc+1+d:04X}"
                else:
                    d = to_s8(mem[pc+1]); nb += 1; pc += 1
                    txt = f"JR {CC[y-4]},${base+pc+1+d:04X}"
            elif z == 1:
                if q == 0:
                    lo, hi = mem[pc+1], mem[pc+2]
                    txt = f"LD {R16[p]},${(hi<<8)|lo:04X}"; nb += 2; pc += 2
                else:
                    txt = f"ADD HL,{R16[p]}"
            elif z == 2:
                # LD (BC)/A, etc — abridged
                rows = ["LD (BC),A", "LD A,(BC)", "LD (DE),A", "LD A,(DE)",
                        "LD (nn),HL", "LD HL,(nn)", "LD (nn),A", "LD A,(nn)"]
                t = rows[y]
                if "nn" in t:
                    lo, hi = mem[pc+1], mem[pc+2]
                    t = t.replace("nn", f"${(hi<<8)|lo:04X}")
                    nb += 2; pc += 2
                txt = t
            elif z == 3:
                if q == 0: txt = f"INC {R16[p]}"
                else:      txt = f"DEC {R16[p]}"
            elif z == 4:
                txt = f"INC {R8[y]}"
            elif z == 5:
                txt = f"DEC {R8[y]}"
            elif z == 6:
                n = mem[pc+1]; nb += 1; pc += 1
                txt = f"LD {R8[y]},${n:02X}"
            elif z == 7:
                txt = ["RLCA","RRCA","RLA","RRA","DAA","CPL","SCF","CCF"][y]
        elif x == 1:
            if y == 6 and z == 6:
                txt = "HALT"
            else:
                txt = f"LD {R8[y]},{R8[z]}"
        elif x == 2:
            txt = f"{ALU[y]}{R8[z]}"
        else:  # x == 3
            if z == 0:
                txt = f"RET {CC[y]}"
            elif z == 1:
                if q == 0: txt = f"POP {R16P[p]}"
                else:
                    txt = ["RET","EXX","JP (HL)","LD SP,HL"][p]
            elif z == 2:
                lo, hi = mem[pc+1], mem[pc+2]
                txt = f"JP {CC[y]},${(hi<<8)|lo:04X}"; nb += 2; pc += 2
            elif z == 3:
                if   y == 0:
                    lo, hi = mem[pc+1], mem[pc+2]
                    txt = f"JP ${(hi<<8)|lo:04X}"; nb += 2; pc += 2
                elif y == 2:
                    n = mem[pc+1]; nb += 1; pc += 1
                    txt = f"OUT (${n:02X}),A"
                elif y == 3:
                    n = mem[pc+1]; nb += 1; pc += 1
                    txt = f"IN A,(${n:02X})"
                elif y == 4: txt = "EX (SP),HL"
                elif y == 5: txt = "EX DE,HL"
                elif y == 6: txt = "DI"
                elif y == 7: txt = "EI"
            elif z == 4:
                lo, hi = mem[pc+1], mem[pc+2]
                txt = f"CALL {CC[y]},${(hi<<8)|lo:04X}"; nb += 2; pc += 2
            elif z == 5:
                if q == 0:
                    txt = f"PUSH {R16P[p]}"
                elif p == 0:
                    lo, hi = mem[pc+1], mem[pc+2]
                    txt = f"CALL ${(hi<<8)|lo:04X}"; nb += 2; pc += 2
            elif z == 6:
                n = mem[pc+1]; nb += 1; pc += 1
                txt = f"{ALU[y]}${n:02X}"
            elif z == 7:
                txt = f"RST ${y*8:02X}"

        pc += 1
        out.append((addr, mem[pc-nb:pc], txt))
    return out


def to_s8(b):
    return b - 256 if b & 0x80 else b


def main(argv):
    import sys
    from pathlib import Path
    if len(argv) < 4:
        print(f"usage: {argv[0]} <file> <base_hex> <offset_hex> [count]")
        return 2
    path = Path(argv[1])
    mem = path.read_bytes()
    base = int(argv[2], 16)
    off  = int(argv[3], 16)
    n    = int(argv[4]) if len(argv) > 4 else 32
    for addr, bb, txt in disasm(mem, base, off, n):
        bytes_str = " ".join(f"{b:02X}" for b in bb)
        print(f"{addr:04X}  {bytes_str:<12}  {txt}")


if __name__ == "__main__":
    import sys
    sys.exit(main(sys.argv) or 0)
