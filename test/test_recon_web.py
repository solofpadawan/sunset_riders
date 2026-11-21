#!/usr/bin/env python3
"""Render every dump in web/assets/dumps (tools/copy_dumps.py) with the web renderer in headless Chromium (Playwright)
and pixel-compare with ref/<dir>/fNNNN_mame.png. Also times render() and screenshots index.html.
Usage: python3 test/test_recon_web.py   (exit 1 unless all frames 100%)"""
import sys, os, json, threading, functools, http.server, base64, io
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
os.chdir(ROOT)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
h = functools.partial(Q, directory='web')
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
idx = json.load(open('web/assets/dumps/index.json')); bad = 0
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 288 * 3, 'height': 224 * 3})
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.evaluate('SSR.ready')
    for name in idx:
        r = pg.evaluate("""async n => { await SSR.load(n); const st = await SSRV.loadDump('assets/dumps/' + n);
            const fb = new Uint32Array(288*224); const N = 20, t0 = performance.now();
            for (let i = 0; i < N; i++) SSRV.render(st, fb);
            const ms = (performance.now() - t0) / N; const u8 = new Uint8Array(fb.buffer); let s = '';
            for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            return {ms, px: btoa(s)}; }""", name)
        web = np.frombuffer(base64.b64decode(r['px']), np.uint8).reshape(224, 288, 4)[:, :, :3]
        m = np.array(Image.open(f'ref/{name}_mame.png').convert('RGB'))
        pct = 100 * (1 - np.any(web != m, axis=2).mean()); bad += pct < 100
        print(f'{name:12s} {pct:9.4f}%  render {r["ms"]:6.2f} ms')
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.evaluate('SSR.ready'); pg.wait_for_timeout(1500)
    print(f'index.html live draw avg {pg.evaluate("SSR.msPerFrame()"):.2f} ms/frame')
    os.makedirs('ref/preview', exist_ok=True); pg.screenshot(path='ref/preview/web_title.png')
    b.close()
print(f'{len(idx) - bad}/{len(idx)} frames pixel-exact'); sys.exit(1 if bad else 0)
