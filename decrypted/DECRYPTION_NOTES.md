# Decrypting `Cyclone - Side 1.tzx`

The file on disk is a [TZX tape image](https://worldofspectrum.net/TZXformat.html)
of **Cyclone** (Vortex Software, 1985, by Costa Panayi) with **SpeedLock 1**
copy protection.

## The structure inside the TZX

```
 #  id    block type             bytes   notes
 0  0x32  Archive Info              129   "Cyclone" / Vortex / Costa Panayi / SpeedLock 1
 1  0x10  Standard Speed Data        19   ROM header: Program 'CYCLONE' (834 bytes, LINE 0)
 2  0x10  Standard Speed Data       836   The BASIC loader itself
 3  0x21  Group Start                     [Turbo group #1 — SpeedLock stub]
  .. custom pulse sequences ..
11  0x14  Pure Data                  21   SpeedLock loader stub (Z80)
12  0x22  Group End
13  0x21  Group Start                     [Turbo group #2 — the entire game]
  .. custom pulse sequences ..
21  0x14  Pure Data              46,927   Loading screen + game code + data
22  0x22  Group End
23  0x21  Group Start                     [Turbo group #3 — secondary payload]
  .. custom pulse sequences ..
31  0x14  Pure Data               1,454   Sprite / character data
32  0x22  Group End
```

## How SpeedLock 1 actually protects the tape

SpeedLock 1 is the *simplest* variant of Vortex / Dominic Wood's tape
protection.  It works by:

1. Replacing the ROM's standard loading routine with a smaller, custom Z80
   loader (the 21-byte stub in block 11).
2. Writing the protected blocks as TZX **Pure Data** blocks (id `0x14`)
   using non-standard pulse timings for "0" and "1" bits — the Spectrum ROM
   loader literally cannot read them, so you need the custom loader.
3. Disabling the break key and overwriting key system variables
   (`ERR_SP`, `LAST_K`, `CH_ADD`) so breaking out of the loader mid-load
   crashes the machine.

Critically: **SpeedLock 1 does not XOR-encrypt the payload.**  Once you lift
the bytes out of the TZX turbo blocks, what you get is already the plaintext
Z80 code and graphics.  Later SpeedLock versions (2, 3, Alkatraz, etc.) add
real byte-level encryption, but SL1 relies on pulse timing alone.

So "decrypting" this TZX reduces to:

> Parse the TZX, pull the raw bytes out of each `0x14` Pure Data block,
> and write them back into a standard `.tap` (no custom timings).

That's exactly what `tools/tzx_decrypt.py` does.

## The BASIC loader (block 2)

Detokenised:

```basic
0 BORDER 0: PAPER 0: CLS : POKE 23659,0
0 POKE 23662, PEEK 23618: POKE 23663, PEEK 23619
0 POKE 23647, PEEK 23613: POKE 23648, PEEK 23614
0 POKE (PEEK 23633+256*PEEK 23634), PEEK 23647
  POKE (PEEK 23633+256*PEEK 23634)+1, PEEK 23648
0 POKE (PEEK 23641+256*PEEK 23642), PEEK 23620
  ...
```

Classic SpeedLock preamble — it saves off `ERR_SP` / `LAST_K`, zeros
`DF_SZ`, then patches `CH_ADD` / `X_PTR` so control passes into machine code
instead of back to BASIC once the loader is POKEd into place.

## The 21-byte SpeedLock stub (block 11)

Raw bytes:

```
F3 AF 11 FF FF C3 CB 11   2A 5D 5C 22 5F 5C 18 43   C3 F2 15 FF DE
```

Disassembly:

```asm
DI                      ; F3             disable interrupts
XOR  A                  ; AF             A = 0
LD   DE, $FFFF          ; 11 FF FF
JP   $11CB              ; C3 CB 11       enter real SL loader
LD   HL, ($5C5D)        ; 2A 5D 5C       grab CH_ADD
LD   ($5C5F), HL        ; 22 5F 5C       save to X_PTR_L
JR   +0x43              ; 18 43
JP   $15F2              ; C3 F2 15       jump into ROM
RST  $38                ; FF             interrupt trap
; DE = block checksum
```

The `JP $11CB` hands control to the main SpeedLock loader body (stored
inside the main turbo block), which then reads block 21 using the custom
pulse timing.

## Decrypted artefacts

After running `python3 tools/tzx_decrypt.py` followed by
`python3 tools/strings_and_entry.py`, this directory contains:

| file | purpose |
| --- | --- |
| `cyclone_side1.tap` | Fully un-SpeedLocked `.tap` image.  Loadable in any Spectrum emulator at ROM speed — no custom loader required. |
| `cyclone_side1_full.bin` | Concatenation of every block's raw payload. |
| `cyclone_side1_block02.bin` | The BASIC loader (plaintext tokens). |
| `cyclone_side1_block11.bin` | The 21-byte SpeedLock stub (plaintext Z80). |
| `cyclone_side1_block21.bin` | Loading screen + game code + data. |
| `cyclone_side1_block31.bin` | Secondary payload (character graphics). |
| `cyclone_loading_screen.bin` | First 6,912 bytes of block 21 — SCREEN\$ format, loads to $4000. |
| `cyclone_code_and_data.bin` | The remaining 40,015 bytes — game proper, loads to $5B00. |
| `cyclone_loading_screen.pgm` | Decoded 256x192 monochrome preview of the loading screen. |

## What the strings reveal about the game

Game strings, recovered bit-7-stripped from block 21, tell us almost the
entire HUD & UX design:

**Islands**
```
BANANA        ORTE ROCKS     KOKOLA       LAGOON       PEAK
BASE          GILLIGANS      RED          SKEG         BONE
GIANTS GATEWAY  CLAW        LUKELAND ISLES   ENTERPRISE
```

**HUD / instruction panel**
```
UP / LEFT / DOWN / RIGHT / FORWARD
VIEW CHANGE
MAP OR MAIN SCREEN
HELICOPTER POSITION
CYCLONE LOCATION
LEAVING MAP AREA
COLLECT FIVE CRATES
AND RETURN TO BASE
RESCUE SURVIVORS FOR EXTRA POINTS
PRESS ANY KEY
CRATES LEFT
ALTIMETER
SPEEDOMETER
FUEL GAUGE
TIME LEFT
COMPASS
HEADING
LIVES
VIEW SELECTED WITH KEY
COLLISION WARNING
WIND SPEED INCREASES WHEN APPROACHING CYCLONE
NO FUEL
BEWARE AIRCRAFT
WIND    DANGER    FORCE
NORTH / SOUTH / EAST / WEST
```

These are the *actual* labels Costa Panayi shipped in 1985, straight out of
the plaintext Z80 code — a nice confirmation that the SpeedLock 1 unwrap is
complete.
