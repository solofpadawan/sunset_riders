#!/usr/bin/env python3
"""Audio unlock hint: shown ONLY while the AudioContext is suspended/blocked; first click or key resumes audio and hides it.
Never shown when audio is already running, nor with ?sound=0.
Usage: python3 test/test_sound_unlock.py web [--preview DIR]
"""
import argparse, os, sys, time, socket, subprocess
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--preview', default='')
a = ap.parse_args()
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = f'http://127.0.0.1:{port}/index.html'
fails = []
def check(name, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)
    if not ok: fails.append(name)

def hint(pg):
    return pg.evaluate("""() => {
      const e = document.getElementById('sndhint');
      const ac = SSRG.audio && SSRG.audio.ac;
      const cs = e ? getComputedStyle(e) : null;
      return {
        exists: !!e,
        display: cs ? cs.display : 'none',
        text: e ? (e.textContent || '') : '',
        ac: ac ? ac.state : null,
        ready: !!(SSRG.audio && SSRG.audio.ready)
      };
    }""")

try:
    with sync_playwright() as p:
        # --- no autoplay: context starts suspended, hint must appear, then vanish on click / key ---
        for lang, expect in (('pt', 'Clique para ativar o som'), ('en', 'Click to enable sound')):
            b = p.chromium.launch(args=['--autoplay-policy=document-user-activation-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
            pg = b.new_page(viewport={'width': 1280, 'height': 720})
            pg.goto(f'{BASE}?lang={lang}')
            pg.evaluate('SSRG.ready')
            # give ensureCtx + startAudio a moment (resume must fail without a gesture under this policy)
            t0 = time.time(); st = hint(pg)
            while time.time() - t0 < 5 and not (st['display'] == 'block' and st['ac'] in ('suspended', 'interrupted')):
                time.sleep(0.1); st = hint(pg)
            if st['ac'] == 'running':
                pg.evaluate("SSRG.audio && SSRG.audio.ac && SSRG.audio.ac.suspend()")
                t0 = time.time(); st = hint(pg)
                while time.time() - t0 < 3 and st['display'] != 'block':
                    time.sleep(0.1); st = hint(pg)
            check(f'{lang}: hint visible while AudioContext is suspended',
                  st['display'] == 'block' and st['ac'] in ('suspended', 'interrupted') and st['text'] == expect,
                  st)
            if a.preview and st['display'] == 'block':
                pg.screenshot(path=f'{a.preview}/sound_unlock_{lang}.png')
            # click the game (pointerdown) unlocks
            pg.click('#screen', position={'x': 140, 'y': 110}, force=True)
            t0 = time.time(); st = hint(pg)
            while time.time() - t0 < 5 and not (st['ac'] == 'running' and st['display'] in ('none', '') and st['ready']):
                time.sleep(0.1); st = hint(pg)
            check(f'{lang}: click resumes audio and hides the hint',
                  st['ac'] == 'running' and st['display'] in ('none', '') and st['ready'], st)
            b.close()

        # key path (fresh page, pt)
        b = p.chromium.launch(args=['--autoplay-policy=document-user-activation-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
        pg = b.new_page(viewport={'width': 1280, 'height': 720})
        pg.goto(f'{BASE}?lang=pt')
        pg.evaluate('SSRG.ready')
        t0 = time.time(); st = hint(pg)
        while time.time() - t0 < 5 and st['display'] != 'block':
            time.sleep(0.1); st = hint(pg)
        if st['ac'] == 'running':
            pg.evaluate("SSRG.audio && SSRG.audio.ac && SSRG.audio.ac.suspend()")
            t0 = time.time(); st = hint(pg)
            while time.time() - t0 < 3 and st['display'] != 'block':
                time.sleep(0.1); st = hint(pg)
        check('keydown path: hint shown before a key', st['display'] == 'block' and st['ac'] in ('suspended', 'interrupted'), st)
        pg.keyboard.press('Enter')
        t0 = time.time(); st = hint(pg)
        while time.time() - t0 < 5 and not (st['ac'] == 'running' and st['display'] in ('none', '')):
            time.sleep(0.1); st = hint(pg)
        check('keydown path: key resumes audio and hides the hint', st['ac'] == 'running' and st['display'] in ('none', '') and st['ready'], st)
        b.close()

        # ?sound=0: never show, no context
        b = p.chromium.launch(args=['--autoplay-policy=document-user-activation-required', '--disable-background-timer-throttling'])
        pg = b.new_page()
        pg.goto(f'{BASE}?lang=pt&sound=0')
        pg.evaluate('SSRG.ready')
        time.sleep(0.8)
        st = hint(pg)
        check('?sound=0: no unlock hint and no AudioContext', st['display'] in ('none', '') and st['ac'] is None, st)
        pg.keyboard.press('Enter'); time.sleep(0.3); st = hint(pg)
        check('?sound=0: still no hint after a key', st['display'] in ('none', '') and st['ac'] is None, st)
        b.close()

        # autoplay allowed: context runs without a click, hint must never appear
        b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page()
        pg.goto(f'{BASE}?lang=pt')
        pg.evaluate('SSRG.ready')
        t0 = time.time(); st = hint(pg)
        while time.time() - t0 < 8 and not (st['ac'] == 'running' and st['ready']):
            time.sleep(0.1); st = hint(pg)
        check('autoplay: AudioContext is running and the hint stays hidden',
              st['ac'] == 'running' and st['display'] in ('none', '') and st['ready'], st)
        b.close()
finally:
    srv.terminate()

if fails:
    print('FAILED', fails); sys.exit(1)
print('OK')
