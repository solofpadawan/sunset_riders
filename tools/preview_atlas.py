#!/usr/bin/env python3
"""Debug previews: colour the decoded tile/sprite atlases with a captured palette.
Usage: tools/preview_atlas.py ref/dump/f4300 [--tilecol 64] [--sprcol 32] -> ref/preview/{tiles,sprites}_<frame>.png"""
import sys, os, argparse, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import extract_gfx
from render_frame import palette_rgb
ap = argparse.ArgumentParser(); ap.add_argument('prefix'); ap.add_argument('--zip', default='roms/ssriders.zip')
ap.add_argument('--tilecol', type=int, default=64); ap.add_argument('--sprcol', type=int, default=32); ap.add_argument('--count', type=int, default=4096)
a = ap.parse_args()
rgb = palette_rgb(open(a.prefix + '_pal.bin', 'rb').read())
tiles, sprites = extract_gfx.load(a.zip)
os.makedirs('ref/preview', exist_ok=True); fr = os.path.basename(a.prefix)
for name, g, col, per in (('tiles', tiles, a.tilecol, 64), ('sprites', sprites, a.sprcol, 32)):
    g = g[:a.count]; n, h, w = g.shape; rows = (n + per - 1) // per
    at = np.zeros((rows*h, per*w), np.int32)
    for i in range(n): at[(i//per)*h:(i//per+1)*h, (i%per)*w:(i%per+1)*w] = g[i]
    Image.fromarray(rgb[col*16 + at]).save(f'ref/preview/{name}_{fr}.png'); print(f'ref/preview/{name}_{fr}.png')
