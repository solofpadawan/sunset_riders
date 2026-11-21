#!/usr/bin/env python3
"""Spectator "Sair da sala": leaves the room properly (host sees it go) and the page reloads (only for that user) WITHOUT ?sala= / ?assistir=
(other params kept), the game boots fresh (frame counter restarted, coin hint back, F7 closed), no automatic rejoin. location.replace so
the browser Back button does not return to the ?sala= link and rejoin. (Players: see test_player_leave_reload.py.)
PRODUCTION Worker (slug sunsetriders_web).
Usage: python3 test/test_spec_leave.py web [--lang pt|en] [--preview DIR] [--room NAME]"""
import argparse, sys, time, socket, subprocess, json, urllib.request
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--lang', default='pt'); ap.add_argument('--preview', default=''); ap.add_argument('--room', default='')
a = ap.parse_args()
if not a.room: a.room = 'SAIRSPEC' + time.strftime('%H%M%S')
SIG = 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php'
def lst(): return json.load(urllib.request.urlopen(urllib.request.Request(SIG + '?a=list', headers={'User-Agent': 'Mozilla/5.0'}), timeout=10))['rooms']
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'
fails = []
def check(n, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + n, info, flush=True)
    if not ok: fails.append(n)
def wait(fn, to=20):
    t0 = time.time()
    while time.time() - t0 < to:
        try: v = fn()
        except Exception: v = None  # page navigating (reload in progress)
        if v: return v
        time.sleep(0.2)
    return None
errs = []
try:
    with sync_playwright() as p:
        args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
        bs = [p.chromium.launch(args=args) for _ in range(3)]
        pgs = []
        for i, b in enumerate(bs):
            pg = b.new_page(viewport={'width': 1280, 'height': 720}); pgs.append(pg)
            pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(["Saulo", "Ouvinte", "Jogador2"][i])}) }} catch (e) {{}}')
            pg.on('pageerror', lambda e, i=i: errs.append(f'{i}: {e}'))
            pg.on('console', lambda m, i=i: errs.append(f'{i} console: {m.text}') if m.type == 'error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text else None)
        h, sp, g = pgs
        h.goto(f'{BASE}?lang={a.lang}'); h.evaluate('SSRG.ready'); time.sleep(1.5)
        h.keyboard.press('F7'); h.click('#np-room'); h.keyboard.type(a.room, delay=20); h.click('#np-create')
        h.wait_for_function('SSRNETPLAY.session', timeout=30000); time.sleep(1.5); h.keyboard.press('F7')
        room = h.evaluate('SSRNETPLAY.state.room'); print('room', room)
        # history entry without sala first, so after location.replace, Back must not rejoin
        sp.goto(f'{BASE}?lang={a.lang}&voice=0'); sp.evaluate('SSRG.ready')
        # ---- spectator through the Assistir link, with an extra param that must survive the reload
        sp.goto(f'{BASE}?lang={a.lang}&voice=0&sala={room}&assistir=1'); sp.evaluate('SSRG.ready')
        sp.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=40000); time.sleep(3)
        sp.evaluate('window.__marker = 123')
        f_before = sp.evaluate('SSRG.frameNo')
        print('spectator URL before leaving:', sp.url)
        check('host sees the spectator', wait(lambda: h.evaluate('SSRNETPLAY.session.spectators().length') == 1), h.evaluate('SSRNETPLAY.session.spectators()'))
        check('spectator panel has the Sair da sala button', sp.evaluate("!!document.getElementById('np-leave')"))
        if a.preview: sp.screenshot(path=f'{a.preview}/spec_leave_before_{a.lang}.png')
        sp.click('#np-leave')
        ok = wait(lambda: sp.evaluate('window.__marker') is None if not sp.is_closed() else False, 15)
        for _ in range(40):
            try: sp.wait_for_load_state('load'); sp.evaluate('SSRG.ready'); break
            except Exception: time.sleep(0.25)  # still navigating
        time.sleep(2)
        url = sp.url; print('spectator URL after leaving:', url)
        check('spectator page reloaded (JS marker gone)', sp.evaluate('typeof window.__marker') == 'undefined')
        check('URL without sala / assistir', 'sala=' not in url and 'assistir' not in url, url)
        check('other params kept (lang, voice)', f'lang={a.lang}' in url and 'voice=0' in url, url)
        fa = sp.evaluate('SSRG.frameNo'); check('game booted fresh (frame counter restarted, no session)', fa < f_before and sp.evaluate('!SSRNETPLAY.session') and sp.evaluate('SSRG.net === null || !SSRG.net.active()'), (f_before, fa))
        time.sleep(1.5); fb = sp.evaluate('SSRG.frameNo'); check('fresh game is running (frames advance)', fb > fa + 30, (fa, fb))
        check('F7 panel stays closed after reload', sp.evaluate("getComputedStyle(document.getElementById('np')).display") == 'none')
        hint = sp.evaluate('SSRHINT.shown'); print('coin hint:', hint)
        check('normal coin hint (attract), not the spectator hint', bool(hint) and ('ficha' in hint or 'coin' in hint), hint)
        check('host roster: spectator gone', wait(lambda: h.evaluate('SSRNETPLAY.session.spectators().length') == 0, 15), h.evaluate('SSRNETPLAY.session.spectators()'))
        r = [x for x in lst() if x['room'] == room]; check('Worker list: s=0 for the room', r and r[0]['s'] == 0, r)
        if a.preview: sp.screenshot(path=f'{a.preview}/spec_leave_after_{a.lang}.png')
        # Back must not return to ?sala= / ?assistir= and rejoin (location.replace replaced that history entry)
        sp.go_back()
        try: sp.wait_for_load_state('load', timeout=10000)
        except Exception: pass
        time.sleep(1)
        back = '' if sp.is_closed() else sp.url
        print('spectator URL after Back:', back)
        check('Back does not rejoin (URL without sala / assistir)', 'sala=' not in back and 'assistir' not in back, back)
        if not sp.is_closed():
            check('Back does not start a session', sp.evaluate('!SSRNETPLAY.session'))
        # ---- the SSRNETPLAY.leave() API for a PLAYER stays in place (the button now reloads, see test_player_leave_reload.py)
        g.goto(f'{BASE}?lang={a.lang}&sala={room}'); g.evaluate('SSRG.ready')
        g.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot > 0', timeout=40000); time.sleep(3)
        g.evaluate('window.__marker = 456'); check('player is not a spectator', g.evaluate('SSRNETPLAY.session.spec') is False)
        g.evaluate('SSRNETPLAY.leave()'); time.sleep(4)
        check('player API leave(): page NOT reloaded (marker still there)', g.evaluate('window.__marker') == 456)
        check('player API leave(): session ended in place', g.evaluate('!SSRNETPLAY.session') and g.evaluate("getComputedStyle(document.getElementById('np')).display") == 'block')
        check('no page errors / console errors', not errs, errs[:5])
        for b in bs: b.close()
finally:
    srv.terminate()
if fails: print('FAILED', fails); sys.exit(1)
print('OK')
