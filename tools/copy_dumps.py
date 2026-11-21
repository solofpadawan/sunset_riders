#!/usr/bin/env python3
"""Copy run/dump_vram.lua dumps (ref/dump, ref/play) into gitignored web/assets/dumps/<dir>/ for the web debug mode
(?dump=f3800 or ?dump=play/f1700) and test/test_recon_web.py; writes web/assets/dumps/index.json."""
import glob, os, shutil, json
OUT = 'web/assets/dumps'; idx = []
for d in ['dump', 'play']:
    os.makedirs(f'{OUT}/{d}', exist_ok=True)
    for mp in sorted(glob.glob(f'ref/{d}/f*_mame.png')):
        p = mp[:-9]
        for f in glob.glob(p + '_*'): shutil.copy(f, f'{OUT}/{d}/')
        idx.append(f'{d}/{os.path.basename(p)}')
json.dump(idx, open(f'{OUT}/index.json', 'w')); print(len(idx), 'dumps ->', OUT)
