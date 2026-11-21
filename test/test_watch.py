#!/usr/bin/env python3
"""Spectator-first joining ("Assistir", 2026-11-09) against the PRODUCTION Cloudflare Worker, headless Chromium.
Usage: python3 test/test_watch.py web [--lang pt|en] [--preview DIR] [--room NAME]
Host (P1) opens a room with free slots. Spectators join by: (1) ?sala=NAME&assistir=1, (2) the room-list "Watch" (eye) button,
(3) another list "Watch" (the join-by-name field has no Watch button), (4) a 4th ?assistir=1 link. Checks: nobody takes a player slot (host roster, list p=1),
spectators are in sync (host specHashChecks > 0, specDesyncs 0, frame close to the host), send no input and no voice (0 audio bytes),
no mic button, sound-unlock hint hidden once audio is running, "Watching" hint banner only for the ?assistir=1 link guests (not list), no coin-to-join prompt, the Worker list
counter (s) goes 0->1->2->3->4->3, the list "Watch" button is disabled with a tooltip at 4/4, a 5th ?assistir=1 link shows the
translated "no spectator spots" message, a normal ?sala= guest still gets a player slot, rooms are gone at the end."""
import argparse, os, sys, json, time, socket, subprocess, urllib.request
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--lang', default='pt'); ap.add_argument('--preview', default=''); ap.add_argument('--room', default='ASSISTIR TESTE')
a = ap.parse_args()
SIG = 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php'; UA = {'User-Agent': 'Mozilla/5.0'}
def lst(): return json.load(urllib.request.urlopen(urllib.request.Request(SIG + '?a=list', headers=UA), timeout=10)).get('rooms', [])
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'; L = f'lang={a.lang}'
BOT = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_voice.py')).read().split('BOT = """')[1].split('"""')[0]
fails = []
def check(name, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)
    if not ok: fails.append(name)
def srow(room): 
    r = [x for x in lst() if x['room'] == room]; return r[0] if r else None
def wait_s(room, n, secs=20):
    t0 = time.time()
    while time.time() - t0 < secs:
        r = srow(room)
        if r and r['s'] == n: return r
        time.sleep(1)
    return srow(room)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'])
    def newpage(nick):
        pg = b.new_context(viewport={'width': 1280, 'height': 720}).new_page(); pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(nick)}) }} catch (e) {{}}')
        pg.on('pageerror', lambda e: errors.append(str(e))); return pg
    h = newpage('Saulo'); h.goto(f'{BASE}?{L}'); h.evaluate('SSRG.ready'); h.evaluate(BOT, 1)
    h.keyboard.press('F7'); h.click('#np-room'); h.keyboard.type(a.room, delay=15); h.click('#np-create'); h.wait_for_function('SSRNETPLAY.session', timeout=30000); time.sleep(1.5)
    room = h.evaluate('SSRNETPLAY.state.room'); print('room', room)
    check('before: list shows 1 player, 0 spectators', (wait_s(room, 0) or {}).get('s') == 0 and (srow(room) or {}).get('p') == 1, srow(room))
    SPEC = lambda pg: pg.evaluate('(() => { const N = SSRNETPLAY.session; return N ? { spec: N.spec, slot: N.slot, frame: N.rb ? N.rb.frame : -1, vaga: N.vaga, watchOnly: N.watchOnly } : null })()')
    # (1) direct link
    s1 = newpage('Ouvinte1'); s1.goto(f'{BASE}?{L}&sala={room.lower()}&assistir=1'); s1.evaluate('SSRG.ready'); s1.evaluate('SSRG.startAudio()')
    t0 = time.time(); hv = None
    while time.time() - t0 < 30 and hv is None: hv = s1.evaluate('SSRNETPLAY.hint'); time.sleep(0.1)
    print('S1 hint:', hv)
    check('?assistir=1 guest: "Watching" hint (not the player hint)', bool(hv) and ('Assistindo' in hv or 'Watching' in hv) and 'microfone' not in hv and 'microphone' not in hv, hv)
    s1.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=40000); time.sleep(2)
    check('spectator with audio running: sound-unlock hint is hidden', s1.evaluate("(() => { const e = document.getElementById('sndhint'); const ac = SSRG.audio && SSRG.audio.ac; return { hide: !e || getComputedStyle(e).display === 'none', ac: ac && ac.state, ready: !!(SSRG.audio && SSRG.audio.ready) }; })()")['hide'] and s1.evaluate('SSRG.audio && SSRG.audio.ready && SSRG.audio.ac.state === "running"'))
    if a.preview: s1.screenshot(path=f'{a.preview}/watch_link_hint_{a.lang}.png')
    st = SPEC(s1); check('?assistir=1 with free slots: spectator, slot -1, watchOnly', st['spec'] and st['slot'] == -1 and st['watchOnly'], st)
    hp = h.evaluate('SSRNETPLAY.session.peers()'); check('host: the link is a spectator, no player slot taken', len(hp) == 1 and hp[0]['spec'] and hp[0]['slot'] == -1, hp)
    check('host roster: slots 2-4 still free', h.evaluate('SSRNETPLAY.session.rb.join.slice(1).every(x => x === SSRROLL.INF)'))
    for k in ['Digit5', 'KeyZ']: s1.keyboard.press(k)
    s1.keyboard.press('F7'); time.sleep(1)
    check('spectator pressing coin/fire does not take a slot; no coin-to-join prompt', SPEC(s1)['spec'] and SPEC(s1)['slot'] == -1 and s1.evaluate('SSRHINT.shown') in (None, ''), s1.evaluate('SSRHINT.shown'))
    check('spectator panel: no mic button, voice volume present, "spectators only listen" text', s1.query_selector('#np-mic') is None and s1.query_selector('#np-vvol') is not None, s1.inner_text('#np .vc')[:80])
    r = wait_s(room, 1); check('Worker list: spectators 0 -> 1, players still 1', r and r['s'] == 1 and r['p'] == 1, r)
    if a.preview: s1.screenshot(path=f'{a.preview}/watch_panel_{a.lang}.png')
    # (2) room-list button
    s2 = newpage('Ouvinte2'); s2.goto(f'{BASE}?{L}'); s2.evaluate('SSRG.ready'); s2.keyboard.press('F7')
    s2.wait_for_function(f'document.querySelector("#np-list button[data-d][data-r={room}]")', timeout=30000)
    btns = s2.evaluate(f'Array.from(document.querySelectorAll("#np-list button")).map(b => b.textContent.trim() + (b.disabled ? " [disabled]" : ""))'); print('list buttons:', btns)
    check('list row has Join + Watch (eye icon)', len(btns) >= 2 and s2.evaluate('!!document.querySelector("#np-list button.eye svg")'), btns)
    if a.preview: s2.screenshot(path=f'{a.preview}/watch_list_{a.lang}.png')
    s2.click(f'#np-list button[data-d][data-r="{room}"]'); s2.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=40000); time.sleep(1)
    check('list Watch button: spectator, no hint banner', SPEC(s2)['slot'] == -1 and s2.evaluate('SSRNETPLAY.hint') is None)
    # (3) another spectator from the list (the join-by-name field no longer has a Watch button)
    s3 = newpage('Ouvinte3'); s3.goto(f'{BASE}?{L}'); s3.evaluate('SSRG.ready'); s3.keyboard.press('F7')
    s3.wait_for_function(f'document.querySelector("#np-list button[data-d][data-r={room}]")', timeout=30000)
    check('join-by-name has no Watch button', s3.query_selector('#np-watchcode') is None and s3.query_selector('#np-join') is not None)
    if a.preview: s3.screenshot(path=f'{a.preview}/nowatchfield_{a.lang}.png')
    s3.click(f'#np-list button[data-d][data-r="{room}"]'); s3.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=40000); time.sleep(1)
    check('2nd list Watch: spectator, no hint banner', SPEC(s3)['slot'] == -1 and s3.evaluate('SSRNETPLAY.hint') is None)
    r = wait_s(room, 3); check('Worker list: spectators = 3', r and r['s'] == 3 and r['p'] == 1, r)
    # (4) 4th spectator -> limit
    s4 = newpage('Ouvinte4'); s4.goto(f'{BASE}?{L}&sala={room.lower()}&assistir=1'); s4.evaluate('SSRG.ready'); s4.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=40000)
    r = wait_s(room, 4); check('Worker list: spectators = 4/4 (MAXSPEC)', r and r['s'] == 4, r)
    # list at 4/4: disabled Watch + tooltip (visitor page refreshes the list every 5 s)
    v = newpage('Visitante'); v.goto(f'{BASE}?{L}'); v.evaluate('SSRG.ready'); v.keyboard.press('F7')
    v.wait_for_function(f'Array.from(document.querySelectorAll("#np-list button.eye")).some(b => b.disabled)', timeout=30000)
    tip = v.evaluate('(() => { const b = Array.from(document.querySelectorAll("#np-list button.eye")).find(b => b.disabled); return [b.title, getComputedStyle(b).opacity, getComputedStyle(b).backgroundColor, b.textContent.trim()] })()')
    print('disabled watch button:', tip); check('list at 4/4 spectators: Watch disabled with translated tooltip', bool(tip[0]) and 'watchNone' not in tip[0], tip)
    if a.preview: v.screenshot(path=f'{a.preview}/watch_list_full_{a.lang}.png')
    # 5th direct link -> message
    s5 = newpage('Ouvinte5'); s5.goto(f'{BASE}?{L}&sala={room.lower()}&assistir=1'); s5.evaluate('SSRG.ready'); s5.keyboard.press('F7')
    s5.wait_for_function('SSRNETPLAY.state.full', timeout=40000); time.sleep(0.5)
    txt = s5.inner_text('#np'); print('5th spectator panel:', txt.replace('\n', ' | ')[:200])
    check('?assistir=1 on a room with 4/4 spectators: translated message, not a spectator', ('máximo de 4 espectadores' in txt or 'maximum of 4 spectators' in txt) and s5.evaluate('SSRNETPLAY.session.spec') is False, txt[:100])
    if a.preview: s5.screenshot(path=f'{a.preview}/watch_full_msg_{a.lang}.png')
    # a regular link guest still gets a player slot
    g = newpage('Jogador2'); g.goto(f'{BASE}?{L}&sala={room.lower()}'); g.evaluate('SSRG.ready'); g.evaluate(BOT, 2)
    g.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot === 1', timeout=40000)
    check('normal ?sala= link still joins as player P2', SPEC(g)['slot'] == 1 and not SPEC(g)['spec'])
    time.sleep(20)
    # sync + silence
    hs = h.evaluate('(() => { const N = SSRNETPLAY.session; return { frame: N.rb.frame, specHashChecks: N.stats.specHashChecks, specDesyncs: N.stats.specDesyncs, desyncs: N.stats.desyncs, hashChecks: N.stats.hashChecks, peers: N.peers().map(x => [x.slot, x.spec]) } })()')
    print('host:', hs)
    check('spectators in sync: host compared spectator hashes, 0 desyncs', hs['specHashChecks'] >= 3 and hs['specDesyncs'] == 0 and hs['desyncs'] == 0, hs)
    fr = [SPEC(x)['frame'] for x in (s1, s2, s3, s4)]; print('frames host/spectators:', hs['frame'], fr)
    check('spectator frames close to the host', all(abs(f - hs['frame']) < 90 for f in fr), fr)
    # spectator playout buffer (2026-11-11): spectators run the jitter buffer + the stronger worklet nudge; host and players never do
    SB = lambda pg: pg.evaluate('(() => { const N = SSRNETPLAY.session; const b = N.specBuf ? N.specBuf() : null; return { specAudio: SSRG.specAudio, pb: b && { c: b.c, playing: b.playing, underruns: b.underruns }, stalls: N.rb.stats.stalls } })()')
    sb = [SB(x) for x in (s2, s3, s4)]; print('spectator playout:', sb)
    check('spectators: playout buffer active (playing, c in 9..30) and worklet cfg = spectator', all(x['pb'] and x['pb']['playing'] and 9 <= x['pb']['c'] <= 30 and x['specAudio'] is True for x in sb), sb)
    pl = [SB(h), SB(g)]; print('players playout:', pl)
    check('host and player: NO playout buffer, worklet cfg = player default', all(x['pb'] is None and x['specAudio'] is False for x in pl), pl)
    AUD = '(async () => { let n = 0; for (const l of SSRNETPLAY.session.links) { const vx = l.link.vx; if (!vx || !vx.usable()) continue; for (const tx of vx.txs) (await tx.sender.getStats()).forEach(r => { if (r.type === "outbound-rtp") n += r.bytesSent }) } return n })()'
    aud = [x.evaluate(AUD) for x in (s1, s2, s3, s4)]; check('spectators sent 0 voice bytes', all(x == 0 for x in aud), aud)
    inp = h.evaluate('SSRNETPLAY.session.rb.known.slice(1)'); print('host known input frames for slots 2..4:', inp)
    check('spectators sent no input (slots 3-4 never played)', h.evaluate('SSRNETPLAY.session.rb.join[2] === SSRROLL.INF && SSRNETPLAY.session.rb.join[3] === SSRROLL.INF'))
    # leaving lowers the counter
    s1.evaluate('void SSRNETPLAY.leave()'); time.sleep(1); s1.close(); r = wait_s(room, 3, 25); check('Worker list: spectators 4 -> 3 after one leaves', r and r['s'] == 3, r)
    for x in (g, s5, v, s4, s3, s2): 
        try: x.evaluate('void SSRNETPLAY.leave()')
        except Exception as e: print('leave', e)
        time.sleep(0.5)
    h.evaluate('SSRNETPLAY.leave()'); time.sleep(3); b.close()
srv.terminate(); time.sleep(1)
check('test room gone from the list', srow(room) is None, srow(room))
check('no page errors', not errors, errors[:3])
print('FAIL: ' + ', '.join(fails) if fails else 'ALL PASS'); sys.exit(1 if fails else 0)
