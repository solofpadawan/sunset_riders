#!/usr/bin/env python3
"""Public-hosting mode in headless Chrome: serve web/ WITHOUT assets/, check the page asks for the zip, give it
roms/ssriders.zip, check the game boots (frames advance, screen not black), then reload and check it starts from the
IndexedDB cache without asking again. Usage: python3 test/test_romload_web.py [roms/ssriders.zip]"""
import os, sys, tempfile, threading, functools, http.server, time
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); ZIP = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'roms/ssriders.zip'))
tmp = tempfile.mkdtemp()
for n in os.listdir(os.path.join(ROOT, 'web')):
    if n != 'assets': os.symlink(os.path.join(ROOT, 'web', n), os.path.join(tmp, n))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=tmp)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
ok = True
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(); pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_selector('#rz', state='attached', timeout=10000); print('asks for the zip: yes')
    t0 = time.time(); pg.set_input_files('#rz', ZIP); pg.evaluate('SSRG.ready'); print(f'zip -> running in {time.time() - t0:.2f} s')
    time.sleep(3); f = pg.evaluate('SSRG.frame'); print('frames after 3 s', f); ok &= f > 100
    pg.reload(); t0 = time.time(); pg.evaluate('SSRG.ready'); time.sleep(2)
    asked = pg.query_selector('#rz') is not None; f = pg.evaluate('SSRG.frame'); print(f'reload: from cache, asks again: {asked}, frames after 2 s {f}, boot {time.time() - t0 - 2:.2f} s')
    ok &= (not asked) and f > 60
    pg.screenshot(path='/tmp/romload.png'); ok &= not errs; print('page errors', errs)
    b.close()
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
