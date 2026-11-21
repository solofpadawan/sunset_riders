#!/usr/bin/env python3
"""Spectator-only "Aguardando o host…" / "Waiting for the host…" notice.
Shown only when a spectator has no new confirmed host frames (avail=0, not advancing) for ~3 s
(typical case: the host's requestAnimationFrame stopped because the tab went to the background).
Hidden as soon as frames arrive again. Never shown to the host or to players, nor during the join
prebuffer or a short jitter underrun. Styled like the sound-unlock hint; the two do not overlap.
Usage: python3 test/test_spec_wait_host.py web [--preview DIR] [--room NAME]
PRODUCTION Worker (slug sunsetriders_web). Gestures that would unlock audio use CDP, not page.evaluate.
"""
import argparse, json, os, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('web'); ap.add_argument('--preview', default=''); ap.add_argument('--room', default='')
a = ap.parse_args()
if not a.room: a.room = 'AGUARD' + time.strftime('%H%M%S')
SIG = 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php'
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
BASE = f'http://127.0.0.1:{port}/index.html'
fails = []
def check(n, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + n, info, flush=True)
    if not ok: fails.append(n)

HINT = """() => {
  const e = document.getElementById('hosthint'), s = document.getElementById('sndhint');
  const cs = e ? getComputedStyle(e) : null, ss = s ? getComputedStyle(s) : null;
  const N = window.SSRNETPLAY && SSRNETPLAY.session;
  const b = N && N.specBuf ? N.specBuf() : null;
  const r = el => { if (!el || getComputedStyle(el).display === 'none') return null; const x = el.getBoundingClientRect(); return { x: x.x, y: x.y, w: x.width, h: x.height, t: el.textContent }; };
  return {
    exists: !!e, display: cs ? cs.display : 'none', text: e ? (e.textContent || '') : '',
    snd: { exists: !!s, display: ss ? ss.display : 'none', text: s ? (s.textContent || '') : '' },
    hostBox: r(e), sndBox: r(s),
    spec: !!(N && N.spec), role: N ? N.role : null, slot: N ? N.slot : null,
    pb: b, wait: !!(N && N.specWaitingHost && N.specWaitingHost())
  };
}"""
INFO = """() => {
  const N = window.SSRNETPLAY && SSRNETPLAY.session;
  const b = N && N.specBuf ? N.specBuf() : null;
  return N ? { spec: N.spec, role: N.role, slot: N.slot, frame: N.rb ? N.rb.frame : -1, playing: !!(b && b.playing), avail: b ? b.avail : null, starveMs: b ? b.starveMs : 0, waitHost: !!(b && b.waitHost) } : null;
}"""
STOP_RAF = """() => {
  if (window.__rafResume) return 'already';
  const orig = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { window.__rafPending = cb; return 0; };
  window.__rafResume = () => {
    window.requestAnimationFrame = orig;
    const cb = window.__rafPending; window.__rafPending = null; window.__rafResume = null;
    if (cb) orig.call(window, cb);
  };
  return 'ok';
}"""
RESUME_RAF = "() => { if (window.__rafResume) { window.__rafResume(); return 'resumed'; } return 'idle'; }"

def ev_page(pg, expr):
    return pg.evaluate('(' + expr + ')()' if expr.lstrip().startswith('()') else expr)

def ev_cdp(cdp, expr):
    # CDP Runtime.evaluate WITHOUT userGesture: Playwright's page.evaluate grants user activation
    e = '(' + expr + ')()' if expr.lstrip().startswith('()') else expr
    r = cdp.send('Runtime.evaluate', {'expression': e, 'returnByValue': True, 'awaitPromise': True})
    if 'exceptionDetails' in r: raise Exception(str(r['exceptionDetails'])[:300])
    return r['result'].get('value')

def wait_until(fn, pred, to=15, step=0.1):
    t0 = time.time(); last = None
    while time.time() - t0 < to:
        try: last = fn()
        except Exception: last = None
        if last is not None and pred(last): return last
        time.sleep(step)
    return last

def overlap(a, b):
    if not a or not b: return False
    return a['x'] < b['x'] + b['w'] and a['x'] + a['w'] > b['x'] and a['y'] < b['y'] + b['h'] and a['y'] + a['h'] > b['y']

def launch(p, autoplay, nick):
    args = [autoplay, '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows']
    b = p.chromium.launch(args=args)
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(nick)}) }} catch (e) {{}}')
    return b, pg

try:
    with sync_playwright() as p:
        # ===== host + spectator (audio allowed) for the main cases =====
        bh, h = launch(p, '--autoplay-policy=no-user-gesture-required', 'HostBot')
        bs, sp = launch(p, '--autoplay-policy=no-user-gesture-required', 'Ouvinte')
        errs = []
        h.on('pageerror', lambda e: errs.append('h ' + str(e)))
        sp.on('pageerror', lambda e: errs.append('s ' + str(e)))
        h.goto(f'{BASE}?lang=pt'); h.evaluate('SSRG.ready')
        h.keyboard.press('F7'); h.click('#np-room'); h.keyboard.type(a.room, delay=15); h.click('#np-create')
        h.wait_for_function('SSRNETPLAY.session', timeout=30000); time.sleep(1.2)
        room = h.evaluate('SSRNETPLAY.state.room'); print('room', room)
        h.keyboard.press('F7')

        seen_during_join = []
        sp.goto(f'{BASE}?lang=pt&sala={room.lower()}&assistir=1'); sp.evaluate('SSRG.ready')
        sp.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=40000)
        t_join = time.time()
        while time.time() - t_join < 8:
            st = ev_page(sp, HINT); seen_during_join.append(st)
            info = ev_page(sp, INFO)
            if info and info.get('playing') and (info.get('avail') or 0) > 0 and time.time() - t_join > 2:
                break
            time.sleep(0.15)
        shown_join = [x for x in seen_during_join if x and x['display'] == 'block']
        check('join prebuffer + first seconds: wait-host notice stays hidden',
              not shown_join and ev_page(sp, HINT)['display'] in ('none', ''), (len(seen_during_join), ev_page(sp, INFO), shown_join[:1]))
        st = ev_page(sp, HINT)
        check('joined spectator has a playout buffer and is playing',
              st['spec'] and st['pb'] and st['pb']['playing'] and st['pb']['avail'] > 0, st['pb'])

        # --- short underrun (host rAF stopped ~0.8 s after avail hits 0): notice must not appear ---
        print('short stall: stop host rAF', h.evaluate(STOP_RAF))
        starved = wait_until(lambda: ev_page(sp, INFO), lambda i: i and i['avail'] is not None and i['avail'] <= 0, to=8)
        print('short stall: avail hit 0', starved)
        check('short stall: spectator reaches avail=0 after host rAF stops', bool(starved) and starved['avail'] <= 0, starved)
        t0 = time.time()
        short_shown = False
        while time.time() - t0 < 0.85:
            if ev_page(sp, HINT)['display'] == 'block': short_shown = True; break
            time.sleep(0.05)
        print('short stall resume', h.evaluate(RESUME_RAF))
        rec = wait_until(lambda: ev_page(sp, INFO), lambda i: i and i.get('avail', 0) > 0 and i.get('playing'), to=8)
        time.sleep(0.4)
        check('short (~0.8 s) underrun: wait-host notice never appears',
              not short_shown and ev_page(sp, HINT)['display'] in ('none', ''), (short_shown, ev_page(sp, HINT), rec))

        # --- long stall: notice appears after ~3 s of avail=0, hides when the host resumes ---
        print('long stall: stop host rAF', h.evaluate(STOP_RAF))
        starved = wait_until(lambda: ev_page(sp, INFO), lambda i: i and i['avail'] is not None and i['avail'] <= 0, to=8)
        check('long stall: avail=0 after host rAF stops', bool(starved) and starved['avail'] <= 0, starved)
        t0 = time.time()
        early = False
        while time.time() - t0 < 2.2:
            st = ev_page(sp, HINT)
            if st['display'] == 'block': early = True; break
            time.sleep(0.08)
        check('notice still hidden 2.2 s after avail=0', not early and ev_page(sp, HINT)['display'] in ('none', ''), ev_page(sp, INFO))
        appeared = wait_until(lambda: ev_page(sp, HINT), lambda s: s['display'] == 'block', to=4)
        elapsed = time.time() - t0
        print('notice appeared after', round(elapsed, 2), 's:', appeared)
        check('pt: notice appears after ~3 s of avail=0',
              appeared and appeared['display'] == 'block' and appeared['text'] == 'Aguardando o host…' and 2.5 <= elapsed <= 5.5,
              (elapsed, appeared))
        if a.preview and appeared and appeared['display'] == 'block':
            os.makedirs(a.preview, exist_ok=True)
            sp.screenshot(path=os.path.join(a.preview, 'spec_wait_host_pt.png'))
        # resume: notice must hide once frames flow again
        print('long stall resume', h.evaluate(RESUME_RAF))
        hidden = wait_until(lambda: ev_page(sp, HINT), lambda s: s['display'] in ('none', '') and not s['wait'], to=8)
        rec = ev_page(sp, INFO)
        check('notice hides as soon as host frames arrive again',
              hidden and hidden['display'] in ('none', '') and rec and rec.get('avail', 0) > 0, (hidden, rec))

        # --- players never see it (host + a real player, host rAF stopped for 5 s) ---
        bg, g = launch(p, '--autoplay-policy=no-user-gesture-required', 'Jogador2')
        g.on('pageerror', lambda e: errs.append('g ' + str(e)))
        g.goto(f'{BASE}?lang=pt&sala={room.lower()}'); g.evaluate('SSRG.ready')
        g.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot === 1', timeout=40000)
        time.sleep(1.5)
        check('player joined as P2, not a spectator', ev_page(g, INFO)['slot'] == 1 and not ev_page(g, INFO)['spec'], ev_page(g, INFO))
        print('player case: stop host rAF', h.evaluate(STOP_RAF))
        time.sleep(5.0)
        hs, gs, ss = ev_page(h, HINT), ev_page(g, HINT), ev_page(sp, HINT)
        check('host never shows the wait-host notice', hs['display'] in ('none', '') and not hs['exists'], hs)
        check('player never shows the wait-host notice (even with host rAF stopped)',
              gs['display'] in ('none', '') and not gs['wait'] and gs['pb'] is None, gs)
        check('spectator still shows the notice while the host is stopped (with a player in the room)',
              ss['display'] == 'block' and ss['text'] == 'Aguardando o host…', ss)
        print('player case resume', h.evaluate(RESUME_RAF))
        wait_until(lambda: ev_page(sp, HINT), lambda s: s['display'] in ('none', ''), to=8)
        try: g.evaluate('void SSRNETPLAY.leave()')
        except Exception: pass
        bg.close()

        # --- English text + preview (fresh spectator, host rAF stopped) ---
        be, en = launch(p, '--autoplay-policy=no-user-gesture-required', 'Watcher')
        en.on('pageerror', lambda e: errs.append('e ' + str(e)))
        en.goto(f'{BASE}?lang=en&sala={room.lower()}&assistir=1'); en.evaluate('SSRG.ready')
        en.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=40000)
        wait_until(lambda: ev_page(en, INFO), lambda i: i and i.get('playing') and (i.get('avail') or 0) > 0, to=10)
        time.sleep(0.8)
        check('en: notice hidden while the host is running', ev_page(en, HINT)['display'] in ('none', ''), ev_page(en, HINT))
        print('en stall: stop host rAF', h.evaluate(STOP_RAF))
        wait_until(lambda: ev_page(en, INFO), lambda i: i and i['avail'] is not None and i['avail'] <= 0, to=8)
        appeared = wait_until(lambda: ev_page(en, HINT), lambda s: s['display'] == 'block', to=8)
        check('en: notice is "Waiting for the host…"',
              appeared and appeared['display'] == 'block' and appeared['text'] == 'Waiting for the host…', appeared)
        if a.preview and appeared and appeared['display'] == 'block':
            os.makedirs(a.preview, exist_ok=True)
            en.screenshot(path=os.path.join(a.preview, 'spec_wait_host_en.png'))
        print('en stall resume', h.evaluate(RESUME_RAF))
        wait_until(lambda: ev_page(en, HINT), lambda s: s['display'] in ('none', ''), to=8)
        try: en.evaluate('void SSRNETPLAY.leave()')
        except Exception: pass
        be.close()

        try: sp.evaluate('void SSRNETPLAY.leave()')
        except Exception: pass
        bs.close()

        # ===== clash with the sound-unlock hint: CDP, no page.evaluate gesture on the spectator =====
        b2, sp2 = launch(p, '--autoplay-policy=document-user-activation-required', 'OuvinteSom')
        cdp = sp2.context.new_cdp_session(sp2)
        ev = lambda expr: ev_cdp(cdp, expr)
        sp2.on('pageerror', lambda e: errs.append('s2 ' + str(e)))
        # host already running; stop rAF after this spectator has the snapshot
        sp2.goto(f'{BASE}?lang=pt&sala={room.lower()}&assistir=1')
        ev('SSRG.ready.then(() => 1)')
        wait_until(lambda: ev(INFO), lambda i: i and i.get('spec') and i.get('frame', -1) >= 0, to=40)
        # give the unlock hint a moment (AudioContext starts suspended under this policy)
        snd = wait_until(lambda: ev(HINT), lambda s: s['snd']['display'] == 'block' or (s.get('snd') and False), to=6)
        # if autoplay still started, force-suspend so the unlock hint shows
        st = ev(HINT)
        if st['snd']['display'] != 'block':
            ev("""() => { const ac = SSRG.audio && SSRG.audio.ac; if (ac && ac.state === 'running') return ac.suspend().then(() => ac.state); return ac && ac.state; }""")
            st = wait_until(lambda: ev(HINT), lambda s: s['snd']['display'] == 'block', to=4) or ev(HINT)
        check('clash setup: sound-unlock hint is visible (audio blocked, no gesture)',
              st and st['snd']['display'] == 'block' and 'ativar o som' in (st['snd']['text'] or ''), st['snd'])
        print('clash: stop host rAF', h.evaluate(STOP_RAF))
        wait_until(lambda: ev(INFO), lambda i: i and i['avail'] is not None and i['avail'] <= 0, to=8)
        both = wait_until(lambda: ev(HINT), lambda s: s['display'] == 'block' and s['snd']['display'] == 'block', to=8)
        check('clash: both notices visible at once',
              both and both['display'] == 'block' and both['snd']['display'] == 'block'
              and both['text'] == 'Aguardando o host…' and 'ativar o som' in (both['snd']['text'] or ''), both)
        if both and both['hostBox'] and both['sndBox']:
            check('clash: wait-host and sound-unlock boxes do not overlap',
                  not overlap(both['hostBox'], both['sndBox']), (both['hostBox'], both['sndBox']))
        else:
            check('clash: wait-host and sound-unlock boxes do not overlap', False, both)
        print('clash resume', h.evaluate(RESUME_RAF))
        wait_until(lambda: ev(HINT), lambda s: s['display'] in ('none', ''), to=8)
        try: ev('void SSRNETPLAY.leave()')
        except Exception: pass
        b2.close()

        try: h.evaluate('SSRNETPLAY.leave()')
        except Exception: pass
        bh.close()
        check('no page errors', not errs, errs[:4])
finally:
    srv.terminate()

if fails:
    print('FAILED', fails); sys.exit(1)
print('OK')
