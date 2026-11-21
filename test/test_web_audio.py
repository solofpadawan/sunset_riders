#!/usr/bin/env python3
"""Sound in headless Chrome: (1) machine step cost with and without the sound board, (2) SoundMixer render cost
(the AudioWorklet's work) for 10 s of stage-1 movie audio, (3) a real-time run with the worklet (first key press
unlocks it) reporting the worklet's stats (starved blocks, nudges, output RMS).
Usage: python3 test/test_web_audio.py [SECONDS=10]"""
import sys, os, threading, functools, http.server, time
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); os.chdir(ROOT)
SEC = float(sys.argv[1]) if len(sys.argv) > 1 else 10
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory='web')); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
STEP = "async n => { const t0 = performance.now(); SSRG.run(n); return (performance.now() - t0) / n; }"
MIX = """async () => {
  for (const f of ['sim/ym2151.js', 'sim/mixer.js']) await new Promise(r => { const s = document.createElement('script'); s.src = f; s.onload = r; document.head.appendChild(s); });
  const snd = SSRG.machine.snd, log = snd.takeLog(), mx = new SoundMixer(snd.k.rom, 48000); mx.push(log);
  const N = 4800, L = new Float32Array(N), R = new Float32Array(N), sec = Math.floor(snd.safeSamples() / 55930) - 1;
  const t0 = performance.now(); for (let i = 0; i < sec * 10; i++) mx.render(L, R, N); return { sec, ms: performance.now() - t0 }; }"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page()
    for q in ['sound=0', 'sound=1']:
        pg.goto(f'http://127.0.0.1:{port}/index.html?pause=1&movie=assets/movie/ports.bin&{q}'); pg.evaluate('SSRG.ready')
        print(f'{q}: machine step {pg.evaluate(STEP, 1800):.3f} ms/frame (movie frames 1-1800)')
    r = pg.evaluate(MIX)
    print(f"audio render (YM2151 + K053260 + resampler): {r['ms'] / r['sec']:.1f} ms per second of audio = {r['ms'] / r['sec'] / 10:.2f}% of one core")
    pg.goto(f'http://127.0.0.1:{port}/index.html?movie=assets/movie/ports.bin'); pg.evaluate('SSRG.ready')
    pg.keyboard.press('F12')  # any key unlocks the audio
    time.sleep(SEC)
    print('real time', SEC, 's: frame', pg.evaluate('SSRG.frame'), 'audio state', pg.evaluate('SSRG.audio && SSRG.audio.ac.state'),
          'worklet stats', pg.evaluate('SSRG.audio && SSRG.audio.stats'))
    b.close()
