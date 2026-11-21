#!/usr/bin/env python3
"""Regression: re-render every dumped frame (ref/dump, ref/play, or dirs given) and compare with its MAME snapshot.
Usage: tools/check_recon.py [dir ...] [--zip roms/ssriders.zip]   exit 1 if any frame < 100%."""
import sys, os, glob, argparse, numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import extract_gfx, render_frame
ap = argparse.ArgumentParser(); ap.add_argument('dirs', nargs='*', default=['ref/dump', 'ref/play']); ap.add_argument('--zip', default='roms/ssriders.zip')
a = ap.parse_args()
tiles, sprites = extract_gfx.load(a.zip)
bad = 0; n = 0
for d in a.dirs:
    for mp in sorted(glob.glob(f'{d}/f*_mame.png')):
        prefix = mp[:-len('_mame.png')]
        img, info = render_frame.render(prefix, tiles, sprites)
        m = np.array(Image.open(mp).convert('RGB')); diff = np.any(m != img, axis=2)
        pct = 100 * (1 - diff.mean()); n += 1; bad += pct < 100
        print(f'{prefix:24s} {pct:9.4f}%  sprites={info["sprites"]:3d} sc={info["scrollctrl"]:02x} dim_c={info["dim_c"]:02x} dim_v={info["dim_v"]} factor={info["factor"]}')
print(f'{n - bad}/{n} frames pixel-exact'); sys.exit(1 if bad else 0)
