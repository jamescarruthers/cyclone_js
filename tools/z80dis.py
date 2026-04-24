#!/usr/bin/env python3
"""
A more complete Z80 disassembler.  Handles the full DD / FD prefix table
(IX/IY variants of every main-table op), plus DDCB / FDCB indexed bit
operations.  Still not perfect for edge cases, but correct enough to trace
through Cyclone's physics routines.
"""

R8 = ["B", "C", "D", "E", "H", "L", "(HL)", "A"]
R8_IX = ["B", "C", "D", "E", "IXH", "IXL", "(IX+d)", "A"]
R8_IY = ["B", "C", "D", "E", "IYH", "IYL", "(IY+d)", "A"]
R16  = ["BC", "DE", "HL", "SP"]
R16_IX = ["BC", "DE", "IX", "SP"]
R16_IY = ["BC", "DE", "IY", "SP"]
R16P = ["BC", "DE", "HL", "AF"]
R16P_IX = ["BC", "DE", "IX", "AF"]
R16P_IY = ["BC", "DE", "IY", "AF"]
CC   = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"]
ALU  = ["ADD A,", "ADC A,", "SUB ", "SBC A,", "AND ", "XOR ", "OR ", "CP "]
ROT  = ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SLL", "SRL"]


def to_s8(b):
    return b - 256 if b & 0x80 else b


def decode_main(mem, pc, mem_end, r8_tab, r16_tab, r16p_tab, idx_reg, base):
    """Decode a main-table opcode using the current register set.
    idx_reg is None for plain HL, or "IX"/"IY" under a prefix."""
    start = pc
    op = mem[pc]; pc += 1

    # For IX/IY prefixed, (HL) becomes (IX+d) and needs an extra displacement byte.
    def r8_name(i):
        name = r8_tab[i]
        if idx_reg and name == "(IX+d)" if idx_reg == "IX" else idx_reg and name == "(IY+d)":
            pass
        return name

    x = op >> 6; y = (op >> 3) & 7; z = op & 7
    p = y >> 1; q = y & 1

    def read_disp():
        nonlocal pc
        d = to_s8(mem[pc]); pc += 1
        return d

    def operand_r8(i):
        """Return the disassembly text for R8 slot `i`, consuming a disp byte for (HL)/(IX+d)/(IY+d)."""
        name = r8_tab[i]
        if idx_reg and i == 6:
            d = read_disp()
            return f"({idx_reg}{d:+d})"
        return name

    txt = None

    if x == 0:
        if z == 0:
            if y == 0: txt = "NOP"
            elif y == 1: txt = "EX AF,AF'"
            elif y == 2:
                d = read_disp(); txt = f"DJNZ ${base+pc+d:04X}"
            elif y == 3:
                d = read_disp(); txt = f"JR ${base+pc+d:04X}"
            else:
                d = read_disp(); txt = f"JR {CC[y-4]},${base+pc+d:04X}"
        elif z == 1:
            if q == 0:
                lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
                txt = f"LD {r16_tab[p]},${(hi<<8)|lo:04X}"
            else:
                txt = f"ADD {idx_reg or 'HL'},{r16_tab[p]}"
        elif z == 2:
            if y == 0: txt = "LD (BC),A"
            elif y == 1: txt = "LD A,(BC)"
            elif y == 2: txt = "LD (DE),A"
            elif y == 3: txt = "LD A,(DE)"
            elif y == 4:
                lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
                txt = f"LD (${(hi<<8)|lo:04X}),{idx_reg or 'HL'}"
            elif y == 5:
                lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
                txt = f"LD {idx_reg or 'HL'},(${(hi<<8)|lo:04X})"
            elif y == 6:
                lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
                txt = f"LD (${(hi<<8)|lo:04X}),A"
            elif y == 7:
                lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
                txt = f"LD A,(${(hi<<8)|lo:04X})"
        elif z == 3:
            if q == 0: txt = f"INC {r16_tab[p]}"
            else:      txt = f"DEC {r16_tab[p]}"
        elif z == 4:
            name = operand_r8(y); txt = f"INC {name}"
        elif z == 5:
            name = operand_r8(y); txt = f"DEC {name}"
        elif z == 6:
            # LD r,n — for (IX+d) the disp comes BEFORE the immediate byte
            if idx_reg and y == 6:
                d = read_disp(); n = mem[pc]; pc += 1
                txt = f"LD ({idx_reg}{d:+d}),${n:02X}"
            else:
                n = mem[pc]; pc += 1
                txt = f"LD {r8_tab[y]},${n:02X}"
        elif z == 7:
            txt = ["RLCA","RRCA","RLA","RRA","DAA","CPL","SCF","CCF"][y]
    elif x == 1:
        if y == 6 and z == 6:
            txt = "HALT"
        else:
            # LD r,r' — handle potential (IX+d) on either side, but the
            # displacement byte is shared (single disp if either side is (IX+d))
            if idx_reg and (y == 6 or z == 6):
                d = read_disp()
                def nm(i):
                    if i == 6: return f"({idx_reg}{d:+d})"
                    return r8_tab[i]
                txt = f"LD {nm(y)},{nm(z)}"
            else:
                txt = f"LD {r8_tab[y]},{r8_tab[z]}"
    elif x == 2:
        name = operand_r8(z); txt = f"{ALU[y]}{name}"
    else:  # x == 3
        if z == 0:
            txt = f"RET {CC[y]}"
        elif z == 1:
            if q == 0:
                txt = f"POP {r16p_tab[p]}"
            else:
                if p == 0: txt = "RET"
                elif p == 1: txt = "EXX"
                elif p == 2: txt = f"JP ({idx_reg or 'HL'})"
                elif p == 3: txt = f"LD SP,{idx_reg or 'HL'}"
        elif z == 2:
            lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
            txt = f"JP {CC[y]},${(hi<<8)|lo:04X}"
        elif z == 3:
            if y == 0:
                lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
                txt = f"JP ${(hi<<8)|lo:04X}"
            elif y == 2:
                n = mem[pc]; pc += 1; txt = f"OUT (${n:02X}),A"
            elif y == 3:
                n = mem[pc]; pc += 1; txt = f"IN A,(${n:02X})"
            elif y == 4: txt = f"EX (SP),{idx_reg or 'HL'}"
            elif y == 5: txt = "EX DE,HL"
            elif y == 6: txt = "DI"
            elif y == 7: txt = "EI"
        elif z == 4:
            lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
            txt = f"CALL {CC[y]},${(hi<<8)|lo:04X}"
        elif z == 5:
            if q == 0:
                txt = f"PUSH {r16p_tab[p]}"
            elif p == 0:
                lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
                txt = f"CALL ${(hi<<8)|lo:04X}"
        elif z == 6:
            n = mem[pc]; pc += 1; txt = f"{ALU[y]}${n:02X}"
        elif z == 7:
            txt = f"RST ${y*8:02X}"

    return pc - start, txt


def disasm_one(mem, pc, base):
    start = pc
    op = mem[pc]
    if op == 0xDD:
        pc += 1; op2 = mem[pc]
        # DD CB: DDCB dd op — indexed bit ops
        if op2 == 0xCB:
            d = to_s8(mem[pc+1]); op3 = mem[pc+2]; pc += 3
            y = (op3 >> 3) & 7; z = op3 & 7; xx = op3 >> 6
            target = f"(IX{d:+d})"
            if xx == 0:
                if z == 6:
                    txt = f"{ROT[y]} {target}"
                else:
                    txt = f"LD {R8[z]},{ROT[y]} {target}"
            elif xx == 1:
                txt = f"BIT {y},{target}"
            elif xx == 2:
                txt = f"RES {y},{target}"
            else:
                txt = f"SET {y},{target}"
            return pc - start, txt
        # Check for NOPs (plain DD with no valid IX prefix usage)
        n, txt = decode_main(mem, pc, len(mem), R8_IX, R16_IX, R16P_IX, "IX", base)
        return (pc - start) + n, txt
    if op == 0xFD:
        pc += 1; op2 = mem[pc]
        if op2 == 0xCB:
            d = to_s8(mem[pc+1]); op3 = mem[pc+2]; pc += 3
            y = (op3 >> 3) & 7; z = op3 & 7; xx = op3 >> 6
            target = f"(IY{d:+d})"
            if xx == 0:
                if z == 6: txt = f"{ROT[y]} {target}"
                else:      txt = f"LD {R8[z]},{ROT[y]} {target}"
            elif xx == 1: txt = f"BIT {y},{target}"
            elif xx == 2: txt = f"RES {y},{target}"
            else:         txt = f"SET {y},{target}"
            return pc - start, txt
        n, txt = decode_main(mem, pc, len(mem), R8_IY, R16_IY, R16P_IY, "IY", base)
        return (pc - start) + n, txt
    if op == 0xED:
        pc += 1; op2 = mem[pc]; pc += 1
        # A handful of useful ED-prefixed
        if op2 == 0xB0: txt = "LDIR"
        elif op2 == 0xB8: txt = "LDDR"
        elif op2 == 0xA0: txt = "LDI"
        elif op2 == 0xA8: txt = "LDD"
        elif op2 == 0x47: txt = "LD I,A"
        elif op2 == 0x4F: txt = "LD R,A"
        elif op2 == 0x57: txt = "LD A,I"
        elif op2 == 0x5F: txt = "LD A,R"
        elif op2 in (0x42, 0x52, 0x62, 0x72):
            rr = (op2 >> 4) - 4; txt = f"SBC HL,{R16[rr]}"
        elif op2 in (0x4A, 0x5A, 0x6A, 0x7A):
            rr = (op2 >> 4) - 4; txt = f"ADC HL,{R16[rr]}"
        elif op2 in (0x43, 0x53, 0x63, 0x73):
            lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
            rr = (op2 >> 4) - 4
            txt = f"LD (${(hi<<8)|lo:04X}),{R16[rr]}"
        elif op2 in (0x4B, 0x5B, 0x6B, 0x7B):
            lo = mem[pc]; pc += 1; hi = mem[pc]; pc += 1
            rr = (op2 >> 4) - 4
            txt = f"LD {R16[rr]},(${(hi<<8)|lo:04X})"
        elif op2 == 0x44: txt = "NEG"
        elif op2 in (0x45, 0x55, 0x65, 0x75): txt = "RETN"
        elif op2 == 0x4D: txt = "RETI"
        elif op2 == 0x46: txt = "IM 0"
        elif op2 == 0x56: txt = "IM 1"
        elif op2 == 0x5E: txt = "IM 2"
        elif op2 == 0x67: txt = "RRD"
        elif op2 == 0x6F: txt = "RLD"
        elif op2 == 0xB1: txt = "CPIR"
        elif op2 == 0xB9: txt = "CPDR"
        else:
            txt = f"DB $ED,${op2:02X}"
        return pc - start, txt
    if op == 0xCB:
        pc += 1; op2 = mem[pc]; pc += 1
        y = (op2 >> 3) & 7; z = op2 & 7; xx = op2 >> 6
        if xx == 0: txt = f"{ROT[y]} {R8[z]}"
        elif xx == 1: txt = f"BIT {y},{R8[z]}"
        elif xx == 2: txt = f"RES {y},{R8[z]}"
        else:         txt = f"SET {y},{R8[z]}"
        return pc - start, txt
    # Plain main table
    n, txt = decode_main(mem, pc, len(mem), R8, R16, R16P, None, base)
    return n, txt


def disasm(mem, base, start, count):
    out = []
    pc = start
    for _ in range(count):
        if pc >= len(mem):
            break
        addr = base + pc
        try:
            n, txt = disasm_one(mem, pc, base)
        except Exception as e:
            n, txt = 1, f"DB ${mem[pc]:02X}  ; {e}"
        out.append((addr, mem[pc:pc+n], txt))
        pc += n
    return out


def main(argv):
    from pathlib import Path
    if len(argv) < 4:
        print(f"usage: {argv[0]} <file> <base_hex> <start_addr_hex> [count]")
        return 2
    data = Path(argv[1]).read_bytes()
    base = int(argv[2], 16)
    addr_start = int(argv[3], 16)
    off = addr_start - base
    n = int(argv[4]) if len(argv) > 4 else 40
    for addr, bb, txt in disasm(data, base, off, n):
        bytes_str = " ".join(f"{b:02X}" for b in bb)
        print(f"{addr:04X}  {bytes_str:<16}  {txt}")


if __name__ == "__main__":
    import sys
    sys.exit(main(sys.argv) or 0)
