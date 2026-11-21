#!/usr/bin/env python3
"""Copy the MAME attract recording at one frame (video state + work RAM + sprite RAM) into web/assets/attract/
as the temporary seed of web/sim/attract.js (gitignored; built from the user's own ROM recording).
Usage: python3 tools/export_attract_seed.py [FRAME=3156]"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from attract_state import FIELDS
F = int(sys.argv[1]) if len(sys.argv) > 1 else 3156
REC = sum(n for _, n in FIELDS)
os.chdir(os.path.join(os.path.dirname(__file__), '..')); os.makedirs('web/assets/attract', exist_ok=True)
def rd(name, n):
    with open(f'ref/attract/{name}', 'rb') as f: f.seek((F - 1) * n); return f.read(n)
open(f'web/assets/attract/seed{F}_state.bin', 'wb').write(rd('state.bin', REC))
open(f'web/assets/attract/seed{F}_wram.bin', 'wb').write(rd('wram.bin', 0x4000))
open(f'web/assets/attract/seed{F}_spr.bin', 'wb').write(rd('spr.bin', 0x4000))
print('seed', F, 'written')
