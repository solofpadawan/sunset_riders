#!/usr/bin/env python3
"""Host idle auto-close (web/net/idle.js). PRODUCTION Worker (slug sunsetriders_web), ?idletest=1 (IDLE 20 s, WARN 5 s).
(a) idle host -> countdown warning (pt/en) -> room closed notice, room gone from ?a=list, a connected idle player does not keep it alive (neutral frames are not input)
(b) local input (key, click) during the warning cancels it; the timer restarts
(c) an active remote player (real input changes) keeps the room open; once the player goes idle the host closes and the player gets the usual host-left behaviour
(d) hidden tab (document.hidden emulated) closes even with local input; visible again restarts the hidden timer
(e) spectator, player and local game never fire (idle 28 s, spectator also hidden)
(p) PRODUCTION constants (no ?idletest): the Date.now clock is shifted +9 min -> "... em 60 s" warning, +10 min -> closed; previews idle_close_{warn,closed}_{pt,en}.png
Usage: python3 test/test_idle_close.py web [--preview DIR] [--only a,b,c,d,e]"""
import argparse, json, os, re, socket, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--preview', default=''); ap.add_argument('--only', default='a,b,c,d,e,p')
a = ap.parse_args(); ONLY = set(a.only.split(','))
SIG = 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php'
def secs(txt):
    m = re.search(r'em (\d+) s|in (\d+) s', txt or ''); return int(m.group(1) or m.group(2)) if m else -1
def lst():
    return json.load(urllib.request.urlopen(urllib.request.Request(SIG + '?a=list', headers={'User-Agent': 'Mozilla/5.0'}), timeout=10))['rooms']
def listed(room): return any(x['room'] == room for x in lst())
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'
fails = []; errs = []
def check(n, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + n, info, flush=True)
    if not ok: fails.append(n)
STATE = "() => { const I = window.SSRIDLE; const e = document.getElementById('idlehint'); const N = window.SSRNETPLAY && SSRNETPLAY.session;" \
        " return { idle: I ? I.state() : null, shown: !!e && getComputedStyle(e).display !== 'none', text: e ? e.textContent : '', session: !!N, role: N ? N.role : null, remoteAt: N ? N.remoteAt : null, slot: N ? N.slot : null, links: N ? N.links.length : 0 }; }"
def st(pg): return pg.evaluate(STATE)
def wait(fn, to=40, step=0.25):
    t0 = time.time(); v = None
    while time.time() - t0 < to:
        try: v = fn()
        except Exception: v = None
        if v: return v
        time.sleep(step)
    return v
def mk(p, lang, nick, hidden_emul=False):
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(nick)}) }} catch (e) {{}}')
    if hidden_emul:
        pg.add_init_script("Object.defineProperty(document,'hidden',{configurable:true,get:()=>!!window.__hid});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__hid?'hidden':'visible'});")
    pg.on('pageerror', lambda e: errs.append(f'{nick}: {e}'))
    return b, pg
def set_hidden(pg, v): pg.evaluate('(v)=>{window.__hid=v;document.dispatchEvent(new Event("visibilitychange"))}', v)
def goto(pg, q):
    pg.goto(f'{BASE}?{q}'); pg.evaluate('SSRG.ready'); time.sleep(0.8)
def make_room(pg, room):
    pg.keyboard.press('F7'); pg.click('#np-room'); pg.keyboard.type(room, delay=15); pg.click('#np-create')
    pg.wait_for_function('SSRNETPLAY.session', timeout=30000); time.sleep(1.2); pg.keyboard.press('F7')
    return pg.evaluate('SSRNETPLAY.state.room')
def join_player(pg, lang, room, nick='Jogador2'):
    goto(pg, f'lang={lang}&idletest=1&voice=0&sala={room}')
    pg.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot > 0', timeout=45000); time.sleep(1.5)
def tap(pg, key='ArrowRight', hold=0.15):
    pg.keyboard.down(key); time.sleep(hold); pg.keyboard.up(key)
def quiet_leave(*pgs):
    for pg in pgs:
        try: pg.evaluate('void SSRNETPLAY.leave()')
        except Exception: pass
RUN = time.strftime('%H%M%S')
try:
    with sync_playwright() as p:
        # ---------- (a) idle host: warning -> closed; both languages (previews) ----------
        if 'a' in ONLY:
            for lang, warn_re, closed_txt in (('pt', 'Sala será fechada por inatividade em', 'Sala fechada por inatividade'), ('en', 'Room will close due to inactivity in', 'Room closed due to inactivity')):
                b, h = mk(p, lang, 'HostBot'); bg, g = mk(p, lang, 'Jogador2')
                goto(h, f'lang={lang}&idletest=1&voice=0')
                room = make_room(h, f'IDLE{lang.upper()}{RUN}'); print('(a)', lang, 'room', room)
                check(f'a/{lang}: room listed', wait(lambda: listed(room), 10))
                join_player(g, lang, room)
                check(f'a/{lang}: player seated, host sees 1 link', st(h)['links'] == 1, st(h))
                t_in = st(h)['idle']['localAt'] / 1000  # last local input of the host (F7 / click / typing above)
                s0 = wait(lambda: (lambda x: x if x['shown'] else None)(st(h)), 25)
                t_warn = time.time() - t_in
                check(f'a/{lang}: warning shown (~15 s of 20 s)', bool(s0) and warn_re in s0['text'] and '—' in s0['text'] and 8 <= t_warn <= 19, (round(t_warn, 1), s0 and s0['text']))
                n1 = secs(s0['text']) if s0 else 0
                time.sleep(2.2); s1 = st(h)  # ~2 s later
                n2 = secs(s1['text']) if s1['shown'] else -1
                check(f'a/{lang}: countdown decreases', 0 < n2 < n1 <= 5, (n1, n2))
                s2 = wait(lambda: (lambda x: x if x['text'] == closed_txt and x['shown'] else None)(st(h)), 12)
                t_close = time.time() - t_in
                check(f'a/{lang}: "{closed_txt}" shown after closing (~20 s)', bool(s2) and 14 <= t_close <= 26, (round(t_close, 1), s2 and s2['text']))
                check(f'a/{lang}: host left the session', s2 and not s2['session'], s2)
                check(f'a/{lang}: room gone from ?a=list', wait(lambda: not listed(room), 10), [x['room'] for x in lst()])
                gs = wait(lambda: (lambda x: x if not x['session'] else None)(st(g)), 15)
                check(f'a/{lang}: idle player (neutral frames only) did not keep it alive; player got host-left', bool(gs), gs)
                time.sleep(max(0, 13.5 - (time.time() - t_in - t_close)))  # closed notice goes away
                check(f'a/{lang}: closed notice disappears by itself', not st(h)['shown'], st(h))
                quiet_leave(h, g); b.close(); bg.close()

        # ---------- (b) input during the warning cancels it ----------
        if 'b' in ONLY:
            b, h = mk(p, 'pt', 'HostBot'); goto(h, 'lang=pt&idletest=1&voice=0')
            room = make_room(h, f'IDLEB{RUN}'); t0 = time.time()
            s0 = wait(lambda: (lambda x: x if x['shown'] else None)(st(h)), 25)
            check('b: warning appears', bool(s0) and 'Sala será fechada' in s0['text'], s0 and s0['text'])
            tap(h, 'KeyZ'); t_key = time.time()
            gone = wait(lambda: (lambda x: x if not x['shown'] else None)(st(h)), 3)
            check('b: key press cancels the warning (<1.5 s)', bool(gone) and time.time() - t_key < 2.5, gone)
            time.sleep(max(0, 26 - (time.time() - t0)))  # past the ORIGINAL 20 s deadline
            check('b: room still listed and session alive after the original deadline', listed(room) and st(h)['session'] and not st(h)['shown'], st(h))
            s1 = wait(lambda: (lambda x: x if x['shown'] else None)(st(h)), 20)
            check('b: timer restarted from the key press (warning again ~15 s later)', bool(s1) and 10 <= time.time() - t_key <= 19, round(time.time() - t_key, 1))
            h.mouse.click(300, 300); t_clk = time.time()
            gone = wait(lambda: (lambda x: x if not x['shown'] else None)(st(h)), 3)
            check('b: mouse click cancels the warning', bool(gone) and listed(room), gone)
            quiet_leave(h); check('b: cleanup, room gone', wait(lambda: not listed(room), 10)); b.close()

        # ---------- (c) active remote player keeps the room; idle remote player does not ----------
        if 'c' in ONLY:
            b, h = mk(p, 'pt', 'HostBot'); bg, g = mk(p, 'pt', 'Jogador2')
            goto(h, 'lang=pt&idletest=1&voice=0')
            room = make_room(h, f'IDLEC{RUN}'); join_player(g, 'pt', room)
            s = st(h); print('(c) host', s['idle'], 'remoteAt', s['remoteAt'])
            check('c: neutral remote frames do not count as input (remoteAt == 0 after joining)', s['links'] == 1 and s['remoteAt'] == 0, s)
            t0 = time.time(); warned = False; n = 0
            while time.time() - t0 < 34:
                tap(g, 'ArrowRight' if n % 2 == 0 else 'ArrowLeft'); n += 1
                if st(h)['shown']: warned = True
                time.sleep(3.2)
            hs = st(h)
            check('c: active remote player (34 s of presses): no warning, room still listed', not warned and hs['session'] and listed(room), (n, hs))
            check('c: host registered real remote input (remoteAt > 0)', (hs['remoteAt'] or 0) > 0, hs['remoteAt'])
            t_last = time.time()
            s2 = wait(lambda: (lambda x: x if x['shown'] else None)(st(h)), 25)
            check('c: remote player goes idle -> warning ~15 s after the last press', bool(s2) and 10 <= time.time() - t_last <= 20, (round(time.time() - t_last, 1), s2 and s2['text']))
            s3 = wait(lambda: (lambda x: x if not x['session'] else None)(st(h)), 15)
            check('c: host closed the room', bool(s3) and wait(lambda: not listed(room), 10), s3)
            gs = wait(lambda: (lambda x: x if not x['session'] else None)(st(g)), 15)
            check('c: player gets the usual host-left behaviour', bool(gs), gs)
            quiet_leave(h, g); b.close(); bg.close()

        # ---------- (d) hidden tab ----------
        if 'd' in ONLY:
            b, h = mk(p, 'pt', 'HostBot', True); goto(h, 'lang=pt&idletest=1&voice=0')
            room = make_room(h, f'IDLED{RUN}')
            set_hidden(h, True); t0 = time.time()
            # keep the idle rule quiet with local input: only the hidden-tab rule may fire
            while time.time() - t0 < 12: tap(h, 'KeyZ'); time.sleep(2.5)
            check('d: hidden 12 s (< 20 s) with input: still open', st(h)['session'] and listed(room), st(h))
            set_hidden(h, False); time.sleep(1.5)
            check('d: visible again: warning not shown, still open', not st(h)['shown'] and st(h)['session'], st(h))
            set_hidden(h, True); t1 = time.time()
            while time.time() - t1 < 14: tap(h, 'KeyZ'); time.sleep(2.5)
            check('d: hidden again 14 s: timer restarted on visible, still open (total hidden > 20 s)', st(h)['session'] and listed(room), (st(h), round(time.time() - t0, 1)))
            s1 = wait(lambda: (lambda x: x if x['shown'] else None)(st(h)), 12)
            check('d: hidden-tab warning appears (~15 s hidden) even with input', bool(s1) and 'Sala será fechada' in s1['text'], s1 and s1['text'])
            s2 = wait(lambda: (lambda x: x if not x['session'] else None)(st(h)), 15)
            t_hid = time.time() - t1
            check('d: hidden 20 s -> room closed (not seen in ?a=list)', bool(s2) and wait(lambda: not listed(room), 10) and 17 <= t_hid <= 30, (round(t_hid, 1), s2))
            check('d: closed notice', st(h)['text'] == 'Sala fechada por inatividade' and st(h)['shown'], st(h))
            quiet_leave(h); b.close()

        # ---------- (e) spectator, player, local game never fire ----------
        if 'e' in ONLY:
            bh, h = mk(p, 'pt', 'HostBot'); bs, sp = mk(p, 'pt', 'Ouvinte', True); bg, g = mk(p, 'pt', 'Jogador2'); bl, lo = mk(p, 'pt', 'Local', True)
            goto(h, 'lang=pt&idletest=1&voice=0'); room = make_room(h, f'IDLEE{RUN}')
            join_player(g, 'pt', room)
            goto(sp, f'lang=pt&idletest=1&voice=0&sala={room}&assistir=1')
            sp.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=40000)
            goto(lo, 'lang=pt&idletest=1&voice=0')
            set_hidden(sp, True); set_hidden(lo, True)  # hidden-tab rule must not apply to a spectator or local game either
            t0 = time.time(); seen = {'sp': False, 'g': False, 'lo': False, 'h': False}
            while time.time() - t0 < 28:
                tap(h, 'KeyZ')  # keeps the HOST alive (local input), so the others stay in the room
                for k, pg in (('sp', sp), ('g', g), ('lo', lo), ('h', h)):
                    if st(pg)['shown']: seen[k] = True
                time.sleep(3)
            ss, gs, ls, hs = st(sp), st(g), st(lo), st(h)
            check('e: spectator (idle + hidden 28 s): no warning, still a spectator', not seen['sp'] and ss['session'] and ss['role'] == 'guest' and not ss['idle']['host'], ss)
            check('e: player (idle 28 s): no warning, still in the room', not seen['g'] and gs['session'] and gs['slot'] > 0 and not gs['idle']['host'], gs)
            check('e: local game (idle + hidden 28 s): no warning, idle module inactive', not seen['lo'] and not ls['session'] and ls['idle']['mode'] == 'none' and not ls['idle']['host'], ls)
            check('e: host (active) did not close', not seen['h'] and hs['session'] and listed(room), hs)
            r = [x for x in lst() if x['room'] == room]
            check('e: Worker list still shows the room with the spectator', bool(r) and r[0].get('s') == 1, r)
            quiet_leave(sp, g, lo, h); wait(lambda: not listed(room), 10); bs.close(); bg.close(); bl.close(); bh.close()

        # ---------- (p) production constants + previews (clock shifted, no waiting 10 min) ----------
        if 'p' in ONLY:
            for lang, warn_txt, closed_txt in (('pt', 'Sala será fechada por inatividade em 60 s — aperte qualquer tecla', 'Sala fechada por inatividade'), ('en', 'Room will close due to inactivity in 60 s — press any key', 'Room closed due to inactivity')):
                b, h = mk(p, lang, 'HostBot')
                h.add_init_script("window.__off = 0; const _n = Date.now.bind(Date); Date.now = () => _n() + window.__off;")
                goto(h, f'lang={lang}&voice=0')  # no ?idletest: IDLE 10 min, WARN 60 s
                room = make_room(h, f'IDLEP{lang.upper()}{RUN}')
                check(f'p/{lang}: constants are 10 min / 60 s', h.evaluate('[SSRIDLE.IDLE_MS, SSRIDLE.WARN_MS]') == [600000, 60000], h.evaluate('[SSRIDLE.IDLE_MS, SSRIDLE.WARN_MS]'))
                time.sleep(2.5); check(f'p/{lang}: no warning right after creating the room', not st(h)['shown'])
                # shift the clock so that exactly `idle_s` seconds of inactivity have elapsed, then run one idle tick
                SHIFT = "(idle_s) => { const I = SSRIDLE.state(), last = Math.max(I.startAt, I.localAt), real = Date.now() - window.__off; window.__off = idle_s * 1000 - (real - last); SSRIDLE.tick(); }"
                h.evaluate(SHIFT, 8 * 60 + 56); time.sleep(0.3)
                check(f'p/{lang}: nothing at 8:56 idle (warning is at 9:00)', not st(h)['shown'], st(h))
                h.evaluate(SHIFT, 9 * 60 + 0.1)
                s1 = st(h)
                check(f'p/{lang}: warning at 9 min idle: "{warn_txt}"', s1['shown'] and s1['text'] == warn_txt, s1['text'])
                if a.preview:
                    os.makedirs(a.preview, exist_ok=True); h.screenshot(path=os.path.join(a.preview, f'idle_close_warn_{lang}.png'))
                h.evaluate(SHIFT, 9 * 60 + 30); s1b = st(h)
                check(f'p/{lang}: countdown at 9:30 shows 30 s', s1b['shown'] and ' 30 s' in s1b['text'], s1b['text'])
                h.evaluate(SHIFT, 9 * 60 + 59.5); time.sleep(0.2); check(f'p/{lang}: still open at 9:59.5', st(h)['session'] and listed(room))
                h.evaluate(SHIFT, 10 * 60 + 1); s2 = wait(lambda: (lambda x: x if x['text'] == closed_txt and x['shown'] else None)(st(h)), 5)
                check(f'p/{lang}: closed notice "{closed_txt}" at 10 min', bool(s2) and not s2['session'], s2)
                if a.preview and s2: h.screenshot(path=os.path.join(a.preview, f'idle_close_closed_{lang}.png'))
                check(f'p/{lang}: room gone from ?a=list', wait(lambda: not listed(room), 10))
                b.close()
        check('no page errors', not errs, errs[:4])
finally:
    srv.terminate()
    try:
        left = [x['room'] for x in lst() if 'IDLE' in x['room']]
        print('test rooms still listed:', left)
    except Exception as e: print('list error', e)
if fails: print('FAILED', fails); sys.exit(1)
print('OK')
