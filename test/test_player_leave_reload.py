#!/usr/bin/env python3
"""PLAYER (guest and HOST) clicking the "Sair da sala" button: clean leave (Worker 'leave' + links closed, so the others see it) and then the page
reloads for that user only, on the same URL without ?sala= / ?assistir= / ?watch= (other params kept; location.replace so Back does not rejoin).
(1) guest leaves -> reloads clean; host, the other player and the spectator keep playing and see the departure (roster, Worker list p/s counts)
(2) host leaves -> reloads clean; the others get the CURRENT behaviour (session ended in place with the host-left notice), room gone from ?a=list
(3) spectator still behaves the same (reload, others continue); SSRNETPLAY.leave() (used by the idle auto-close) does NOT reload and keeps the notice
(4) a button click in the F7 panel without a session (no room) does not reload
PRODUCTION Worker (slug sunsetriders_web).
Usage: python3 test/test_player_leave_reload.py web [--lang pt|en] [--preview DIR]"""
import argparse, sys, time, socket, subprocess, json, urllib.request
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--lang', default='pt'); ap.add_argument('--preview', default='')
a = ap.parse_args(); RUN = time.strftime('%H%M%S')
SIG = 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php'
def lst(): return json.load(urllib.request.urlopen(urllib.request.Request(SIG + '?a=list', headers={'User-Agent': 'Mozilla/5.0'}), timeout=10))['rooms']
def info(room):
    r = [x for x in lst() if x['room'] == room]; return r[0] if r else None
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'
fails = []; errs = []
def check(n, ok, i=''):
    print(('PASS ' if ok else 'FAIL ') + n, i, flush=True)
    if not ok: fails.append(n)
def wait(fn, to=20):
    t0 = time.time()
    while time.time() - t0 < to:
        try: v = fn()
        except Exception: v = None  # navigating
        if v: return v
        time.sleep(0.2)
    return None
def mk(p, nick):
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(nick)}) }} catch (e) {{}}')
    pg.on('pageerror', lambda e: errs.append(f'{nick}: {e}'))
    pg.on('console', lambda m: errs.append(f'{nick} console: {m.text}') if m.type == 'error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text else None)
    return b, pg
def settle(pg):
    for _ in range(60):
        try: pg.wait_for_load_state('load'); pg.evaluate('SSRG.ready'); return
        except Exception: time.sleep(0.25)
def make_room(pg, room):
    pg.goto(f'{BASE}?lang={a.lang}&voice=0'); pg.evaluate('SSRG.ready'); time.sleep(1.2)
    pg.keyboard.press('F7'); pg.click('#np-room'); pg.keyboard.type(room, delay=15); pg.click('#np-create')
    pg.wait_for_function('SSRNETPLAY.session', timeout=30000); time.sleep(1.2); pg.keyboard.press('F7')
    return pg.evaluate('SSRNETPLAY.state.room')
def join(pg, room, spec=False, extra='&voice=0'):
    pg.goto(f'{BASE}?lang={a.lang}{extra}&sala={room}' + ('&assistir=1' if spec else '')); pg.evaluate('SSRG.ready')
    pg.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && ' + ('SSRNETPLAY.session.spec === true' if spec else 'SSRNETPLAY.session.slot > 0'), timeout=45000); time.sleep(2.5)
def S(pg, expr): return pg.evaluate(expr)
def npc(pg): return S(pg, 'SSRNETPLAY.session ? SSRNETPLAY.session.links.length : -1')
def active(pg, slot): return S(pg, f'(()=>{{const rb=SSRNETPLAY.session.rb; return rb.join[{slot}] !== SSRROLL.INF && rb.leave[{slot}] === SSRROLL.INF}})()')
def clean(url, extra_ok=()): return all(k + '=' not in url for k in ('sala', 'assistir', 'watch')) and all(e in url for e in extra_ok)
def frames_run(pg):
    f0 = S(pg, 'SSRG.frameNo'); time.sleep(1.5); return S(pg, 'SSRG.frameNo') - f0 > 30
def quiet(*pgs):
    for pg in pgs:
        try: pg.evaluate('void SSRNETPLAY.leave()')
        except Exception: pass
try:
    with sync_playwright() as p:
        bh, h = mk(p, 'Anfitriao'); bg, g = mk(p, 'Convidado'); bg2, g2 = mk(p, 'Jogador3'); bs, sp = mk(p, 'Ouvinte')
        # ================= (1) guest leaves =================
        room = make_room(h, f'SAIRJ{RUN}'); print('room', room)
        join(g, room, extra='&voice=0&foo=bar'); join(g2, room); join(sp, room, spec=True)
        check('1: roster before: host sees 2 players + 1 spectator', wait(lambda: npc(h) == 3 and S(h, 'SSRNETPLAY.session.spectators().length') == 1), (npc(h), S(h, 'SSRNETPLAY.session.spectators()')))
        i0 = wait(lambda: (lambda x: x if x and x['p'] == 3 and x['s'] == 1 else None)(info(room)), 20); print('Worker list before:', i0)  # host meta is piggybacked every 5 s; p counts the host
        S(g, 'window.__marker = 1'); f_before = S(g, 'SSRG.frameNo'); print('guest URL before:', g.url)
        if S(g, "getComputedStyle(document.getElementById('np')).display") != 'block': g.keyboard.press('F7'); time.sleep(0.3)
        if a.preview: g.screenshot(path=f'{a.preview}/player_leave_guest_before_{a.lang}.png')
        g.click('#np-leave')
        wait(lambda: S(g, 'window.__marker') is None, 15); settle(g); time.sleep(2)
        url = g.url; print('guest URL after:', url)
        check('1: guest page reloaded (JS marker gone)', S(g, 'typeof window.__marker') == 'undefined')
        check('1: URL without sala / assistir / watch, other params kept (lang, foo)', clean(url, (f'lang={a.lang}', 'foo=bar')), url)
        check('1: guest booted fresh (no session, frames restarted and running)', S(g, '!SSRNETPLAY.session') and S(g, 'SSRG.frameNo') < f_before and frames_run(g), f_before)
        check('1: F7 panel closed after reload', S(g, "getComputedStyle(document.getElementById('np')).display") == 'none')
        if a.preview: g.screenshot(path=f'{a.preview}/player_leave_guest_after_{a.lang}.png')
        check('1: host sees the guest leave (links 3 -> 2, slot 1 left the roster)', wait(lambda: npc(h) == 2 and not active(h, 1), 15), (npc(h), S(h, 'SSRNETPLAY.session.rb.leave')))
        check('1: the other player sees the departure and keeps playing', wait(lambda: not active(g2, 1), 15) and S(g2, '!!SSRNETPLAY.session') and frames_run(g2))
        check('1: spectator keeps watching and sees the room continue', S(sp, 'SSRNETPLAY.session && SSRNETPLAY.session.spec') is True and frames_run(sp))
        check('1: host keeps the room open and running', S(h, '!!SSRNETPLAY.session') and frames_run(h))
        i1 = wait(lambda: (lambda x: x if x and i0 and x['p'] == i0['p'] - 1 else None)(info(room)), 20); check('1: Worker list: players 3 -> 2 (p includes the host), spectators unchanged', bool(i0) and bool(i1) and i1['s'] == i0['s'], (i0, i1))
        g.go_back(); settle(g); time.sleep(1.5); back = g.url
        check('1: Back does not rejoin', clean(back) and (back.startswith('about:') or S(g, '!SSRNETPLAY.session')), back)
        # a new guest can take the freed slot (room still healthy)
        join(g, room); check('1: a new guest can join the room afterwards', S(g, 'SSRNETPLAY.session.slot') > 0 and wait(lambda: npc(h) == 3, 15))
        quiet(g)
        # ================= (3) spectator unchanged =================
        S(sp, 'window.__marker = 3'); sp.keyboard.press('F7') if S(sp, "getComputedStyle(document.getElementById('np')).display") != 'block' else None; time.sleep(0.3)
        sp.click('#np-leave'); wait(lambda: S(sp, 'window.__marker') is None, 15); settle(sp); time.sleep(1.5)
        check('3: spectator reloads clean as before', clean(sp.url, (f'lang={a.lang}',)) and S(sp, '!SSRNETPLAY.session'), sp.url)
        check('3: host roster: spectator gone, players continue', wait(lambda: S(h, 'SSRNETPLAY.session.spectators().length') == 0, 15) and frames_run(h))
        # ================= (3b) leave() API (idle auto-close path) does not reload =================
        S(g2, 'window.__marker = 33'); g2.evaluate('void SSRNETPLAY.leave()'); time.sleep(3)
        check('3b: SSRNETPLAY.leave() (used by the host idle close) does NOT reload', S(g2, 'window.__marker') == 33 and S(g2, '!SSRNETPLAY.session'))
        # ================= (2) host leaves =================
        quiet(h); wait(lambda: not info(room), 10)
        bh.close(); bh, h = mk(p, 'Anfitriao')
        room2 = make_room(h, f'SAIRH{RUN}'); print('room2', room2)
        join(g, room2, extra='&voice=0&foo=bar'); join(g2, room2); join(sp, room2, spec=True)
        check('2: host sees 2 players + 1 spectator', wait(lambda: npc(h) == 3), npc(h))
        S(h, 'window.__marker = 2'); f_before = S(h, 'SSRG.frameNo'); print('host URL before:', h.url)
        if S(h, "getComputedStyle(document.getElementById('np')).display") != 'block': h.keyboard.press('F7'); time.sleep(0.3)
        if a.preview: h.screenshot(path=f'{a.preview}/player_leave_host_before_{a.lang}.png')
        h.click('#np-leave')
        wait(lambda: S(h, 'window.__marker') is None, 15); settle(h); time.sleep(2)
        print('host URL after:', h.url)
        check('2: host page reloaded (JS marker gone)', S(h, 'typeof window.__marker') == 'undefined')
        check('2: host URL clean', clean(h.url, (f'lang={a.lang}',)), h.url)
        check('2: host booted fresh (no session, running)', S(h, '!SSRNETPLAY.session') and S(h, 'SSRG.frameNo') < f_before and frames_run(h))
        if a.preview: h.screenshot(path=f'{a.preview}/player_leave_host_after_{a.lang}.png')
        check('2: room gone from the Worker list', bool(wait(lambda: info(room2) is None, 20)), info(room2))
        S(g, 'window.__m4 = 1')
        check('2: remaining players ended in place (current host-left behaviour: session closed, notice in state.msg)', all(wait(lambda: S(pg, '!SSRNETPLAY.session'), 20) for pg in (g, g2, sp)) and all(S(pg, 'SSRNETPLAY.state.msg') in ('O anfitrião saiu da sala.', 'The host left the room.') for pg in (g, g2, sp)), S(g, 'SSRNETPLAY.state.msg'))
        print('guest panel text after host left:', repr(S(g, "document.getElementById('np').textContent"))[:300], '| state.msg:', repr(S(g, 'SSRNETPLAY.state && SSRNETPLAY.state.msg')))
        check('2: they were NOT reloaded (JS state still there)', S(g, 'window.__m4') == 1)
        if a.preview: g.screenshot(path=f'{a.preview}/player_leave_hostgone_guest_{a.lang}.png')
        # ================= (4) no session: button does not reload =================
        S(g, 'window.__m5 = 5'); 
        if S(g, "!!document.getElementById('np-leave')"): g.click('#np-leave'); time.sleep(2)
        check('4: no-room panel / leave without session does not reload', S(g, 'window.__m5') == 5)
        check('no page errors / console errors', not errs, errs[:5])
        for b in (bh, bg, bg2, bs): b.close()
finally:
    srv.terminate()
if fails: print('FAILED', fails); sys.exit(1)
print('OK')
