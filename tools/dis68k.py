#!/usr/bin/env python3
"""Disassemble the ssriders 68000 program (assets_extracted/prog.bin, built locally from your ROM) with capstone.
Usage: tools/dis68k.py START [COUNT]"""
import sys, capstone
p = open('assets_extracted/prog.bin', 'rb').read()
md = capstone.Cs(capstone.CS_ARCH_M68K, capstone.CS_MODE_BIG_ENDIAN | capstone.CS_MODE_M68K_000)
a = int(sys.argv[1], 16); n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
for i, ins in enumerate(md.disasm(p[a:a + n * 10], a)):
    if i >= n: break
    print(f'{ins.address:06x}  {ins.bytes.hex():20s} {ins.mnemonic} {ins.op_str}')
