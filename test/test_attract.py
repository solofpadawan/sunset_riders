#!/usr/bin/env python3
"""Run the attract sim (web/sim/attract.js) in headless Chromium from power-on, render every frame with
web/render.js and pixel-compare with the MAME snapshots ref/attract/snaps/NNNN.png (= frame NNNN+1).
Prints per-frame match % (only non-100% frames + summary), the first divergent frame, and writes a contact sheet
(every ~40 frames, sim | MAME) to ref/preview/attract_sheet.png.
Usage: python3 test/test_attract.py [FIRST=14] [LAST=4171]   (exit 1 unless every frame is 100%)"""
import sys, os, threading, functools, http.server, base64
import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); os.chdir(ROOT)
FIRST = int(sys.argv[1]) if len(sys.argv) > 1 else 14
LAST = int(sys.argv[2]) if len(sys.argv) > 2 else 4171
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory='web'))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
pcts, first_bad, sheet = [], None, []
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.goto(url); pg.evaluate('SSR.ready')
    pg.evaluate("""async () => { window.__fb = new Uint32Array(288*224);
        const g = async n => new Uint8Array(await (await fetch(n)).arrayBuffer());
        window.__sim = new SSRATT.Sim(SSR.sim.rom); window.__sim.powerOn(await g('assets/eeprom.bin')); }""")
    for f in range(1, LAST + 1):
        r = pg.evaluate("""() => { const s = window.__sim; s.step(); if (s.unimpl) return {err: s.unimpl};
            SSRV.render(s.v, window.__fb); const u8 = new Uint8Array(window.__fb.buffer); let t = '';
            for (let i = 0; i < u8.length; i += 0x8000) t += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            return {px: btoa(t)}; }""")
        if 'err' in r: print('sim stopped:', r['err']); break
        if f < FIRST: continue
        web = np.frombuffer(base64.b64decode(r['px']), np.uint8).reshape(224, 288, 4)[:, :, :3]
        m = np.array(Image.open(f'ref/attract/snaps/{f - 1:04d}.png').convert('RGB'))
        pct = 100 * (1 - np.any(web != m, axis=2).mean()); pcts.append(pct)
        if pct < 100:
            print(f'frame {f}: {pct:.4f}%')
            if first_bad is None: first_bad = f
        if (f - FIRST) % 40 == 0 or f == LAST: sheet.append((f, web.copy(), m))
    b.close()
n = len(pcts); exact = sum(x == 100 for x in pcts)
cols = 4; rows = (len(sheet) + cols - 1) // cols; tw, th = 288 * 2 + 4, 224 + 14
im = Image.new('RGB', (cols * tw, rows * th), (40, 40, 40)); d = ImageDraw.Draw(im)
for i, (f, a, m) in enumerate(sheet):
    x, y = (i % cols) * tw, (i // cols) * th
    im.paste(Image.fromarray(a), (x, y + 14)); im.paste(Image.fromarray(m), (x + 288 + 2, y + 14))
    d.text((x + 2, y + 1), f'frame {f}  sim | MAME', fill=(255, 255, 0))
os.makedirs('ref/preview', exist_ok=True); im.save('ref/preview/attract_sheet.png')
print(f'{exact}/{n} frames pixel-exact ({FIRST}..{FIRST + n - 1}), mean {np.mean(pcts) if pcts else 0:.4f}%, '
      f'first divergence {first_bad}; sheet ref/preview/attract_sheet.png')
sys.exit(0 if n == LAST - FIRST + 1 and exact == n else 1)
