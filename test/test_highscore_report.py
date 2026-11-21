#!/usr/bin/env python3
"""Online highscore report (web/net/highscore.js, contract highscores/DESIGN.md section 7), headless Chromium, real Cloudflare Worker for the
SIGNALING only (host / join / WebRTC; the Worker answers match_id). POST /scores/report is INTERCEPTED (Playwright route): nothing is ever sent
to the production score endpoint and the bodies are validated here.
The game end is produced by a test hook in BOTH pages (a Machine.step wrapper that is a pure function of the machine state, so it is
deterministic and rollback-safe): once a game runs it pokes two players' energy/score into work RAM and then jumps the game's own state
machine to its end-of-game routine (0x604e, phase 7 step 9) while zeroing the scores, like the real end does. The real end path and the RAM
addresses are checked on the real machine by test/highscore_check.js (run first by this test).
 A  host + guest (+ spectator): both players report ONE body each, same match_id / room / scores set, own nick derived from ssr_nick, role / slot right;
    the F7 panel has no "Nick do placar online" field; the spectator never reports; a second game in the same room does not send a second report; nothing for offline play
 B  network failure of the guest's POST: the ending is not blocked (game goes on to the attract screens), the SAME body is retried, host unaffected
 C  a nick with accents/spaces ("João Silva" -> JOAOSILV) and a nick that is too short ("Zé" in slot 1 -> ZEP2): both players still report automatically,
    every occupied slot carries a nick, no extra field and no player action
 D  3 players (host + 2 guests, the 2nd joins late, the 1st changes its normal nick afterwards): nicks travel through the existing session roster
    (hello / {t:'nick'} / who.pl); the three bodies carry the derived nick of ALL three slots (one accented, one short), same slot:score set, own nick / my_slot on top
 E  3 players, one guest leaves mid-match: the leaver is omitted from every remaining report (no score, no nick); the two who stayed send the same
    2-slot fingerprint and the leaver itself sends nothing
 F  3 players, the host leaves mid-match (Sair da sala): the match is treated as ended; the 2 guests (and the host, who reports before leaving)
    send matching reports that INCLUDE the host's slot; a normal end that already reported does not send a second body
Usage: python3 test/test_highscore_report.py web [--lang pt|en] [--preview DIR]"""
import argparse, sys, time, socket, subprocess, json, os
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--lang', default='pt'); ap.add_argument('--preview', default='')
a = ap.parse_args(); RUN = time.strftime('%H%M%S')
here = os.path.dirname(os.path.abspath(__file__))
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'
fails = []; errs = []; ALL = []; two_bodies = None
def check(n, ok, i=''):
    print(('PASS ' if ok else 'FAIL ') + n, i, flush=True)
    if not ok: fails.append(n)
def wait(fn, to=20):
    t0 = time.time()
    while time.time() - t0 < to:
        try: v = fn()
        except Exception: v = None
        if v: return v
        time.sleep(0.25)
    return None
HOOK = """() => { const M = SSRM.Machine.prototype; if (M.__hs) return; M.__hs = 1; const orig = M.step;
  M.step = function () {
    const w = this.wram, F = this.s[1];
    if (w[1] === 2 && w[5] === 4 && F % 120 === 0) { // phase 4 = a stage is being played
      const sc = s => SSRHS.bcd32(w, 0x206 + 0x40 * s);
      if (sc(0) < 12340) { // game running: two (or three, window.__HSN) players present, scores in RAM (packed BCD)
        for (let s = 0; s < (window.__HSN || 2); s++) { w[0x200 + 0x40 * s] = 0x15; w[0x210 + 0x40 * s] = 0x81; }
        if (window.__HSN === 3) { w[0x286] = 0; w[0x287] = 0; w[0x288] = 0x08; w[0x289] = 0x90; }
        w[0x206] = 0; w[0x207] = 1; w[0x208] = 0x23; w[0x209] = 0x40; w[0x246] = 0; w[0x247] = 0; w[0x248] = 0x56; w[0x249] = 0x70;
      } else if (!window.__HS_NOEND) { // end: the game's own end-of-game routine (phase 7, step 9 -> 0x604e: mode 1 / hi-score screen), scores cleared like the real end
        w[5] = 7; w[7] = 9; for (let s = 0; s < 4; s++) for (let i = 0; i < 4; i++) w[0x206 + 0x40 * s + i] = 0;
      }
    }
    return orig.call(this);
  }; }"""
BOT = """seed => { let x = seed * 2654435761 >>> 0, cur = 0, hold = 0, n = 0; const I = SSRIN;
  I.sample = () => { n++; const o = new Uint8Array(4), k = n % 150;
    if (k === 10) o[0] = I.COIN; else if (k === 40 || k === 50) o[0] = I.FIRE;
    else { if (--hold <= 0) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; cur = [0, I.L, I.R, I.U, I.D, I.FIRE, I.FIRE | I.R, I.JUMP, I.L | I.FIRE][(x >>> 16) % 9]; hold = 5 + ((x >>> 8) % 40); } o[0] = cur; }
    return o; }; }"""
def mk(p, ctx_nick, bodies=None, mode='ok', pend_first=True):
    """ctx_nick: the player's normal nick (ssr_nick); the board nick is derived from it automatically."""
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'])
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    init = f'try {{ localStorage.setItem("ssr_nick", {json.dumps(ctx_nick)}); localStorage.removeItem("ssr_board_nick"); }} catch (e) {{}}'
    pg.add_init_script(init)
    pg.on('pageerror', lambda e: errs.append(f'{ctx_nick}: {e}'))
    pg.on('console', lambda m: errs.append(f'{ctx_nick} console: {m.text}') if m.type == 'error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text and 'ERR_FAILED' not in m.text else None)
    cors = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'}
    pg.__bodies = bodies if bodies is not None else []
    def handler(route):
        req = route.request
        if req.method == 'OPTIONS': return route.fulfill(status=204, headers=cors)
        pg.__bodies.append({'url': req.url, 'ct': req.headers.get('content-type'), 'body': json.loads(req.post_data or 'null'), 'at': time.time()})
        if mode == 'abort': return route.abort('failed')
        ALL.append(1); st = 'pending' if len(ALL) == 1 and pend_first else 'accepted'
        route.fulfill(status=200, headers=dict(cors, **{'Content-Type': 'application/json'}), body=json.dumps({'ok': True, 'status': st}))
    pg.route('**/scores/report', handler)
    return b, pg
def S(pg, e): return pg.evaluate(e)
def names(pg): return S(pg, 'SSRNETPLAY.session.names()')
def board_nicks(pg): return S(pg, '[0,1,2,3].map(i => SSRHS.boardNickOf(SSRNETPLAY.session.names()[i], i))')
def set_nick(pg, n):
    pg.evaluate('n => { const f = document.getElementById("np-nick"); f.value = n; f.dispatchEvent(new Event("change", { bubbles: true })); }', n)
def settle(pg):
    for _ in range(60):
        try: pg.wait_for_load_state('load'); pg.evaluate('SSRG.ready'); return
        except Exception: time.sleep(0.25)
def make_room(pg, room):
    pg.goto(f'{BASE}?lang={a.lang}&voice=0'); pg.evaluate('SSRG.ready'); time.sleep(1.2)
    pg.keyboard.press('F7'); pg.click('#np-room'); pg.keyboard.type(room, delay=15); pg.click('#np-create')
    pg.wait_for_function('SSRNETPLAY.session', timeout=30000); time.sleep(1.2); pg.keyboard.press('F7')
    return pg.evaluate('SSRNETPLAY.state.room')
def join(pg, room, spec=False):
    pg.goto(f'{BASE}?lang={a.lang}&voice=0&sala={room}' + ('&assistir=1' if spec else '')); pg.evaluate('SSRG.ready')
    pg.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && ' + ('SSRNETPLAY.session.spec === true' if spec else 'SSRNETPLAY.session.slot > 0'), timeout=45000); time.sleep(2.5)
def panel(pg, want=True):
    shown = S(pg, "getComputedStyle(document.getElementById('np')).display") == 'block'
    if shown != want: pg.keyboard.press('F7'); time.sleep(0.4)
def evs(pg, typ=None): return [e for e in S(pg, 'SSRHS.events') if typ is None or e['type'] == typ]
def mode(pg): return S(pg, 'SSRG.machine.wram[1]')
def quiet(*pgs):
    for pg in pgs:
        try: pg.evaluate('void SSRNETPLAY.leave()')
        except Exception: pass
def frames_run(pg):
    f0 = S(pg, 'SSRG.frameNo'); time.sleep(1.5); return S(pg, 'SSRG.frameNo') - f0 > 30
def start_game(pgs, n=2):
    for i, pg in enumerate(pgs): pg.evaluate(f'window.__HSN = {n}'); pg.evaluate(HOOK); pg.evaluate(BOT, 11 + i)
try:
    # the node check first: RAM addresses, tracker rules, stubbed finish() / retries
    r = subprocess.run(['node', os.path.join(here, 'highscore_check.js')], capture_output=True, text=True, timeout=300)
    print(r.stdout.strip()); check('node highscore_check.js (RAM on the real machine + tracker + finish/retry stubs)', r.returncode == 0, r.stderr[-300:])
    with sync_playwright() as p:
        # ================= A: normal match =================
        ALL.clear()
        bh, h = mk(p, 'Chico'); bg, g = mk(p, 'Rita'); bs, sp = mk(p, 'Ouvinte')
        room = make_room(h, f'PLACAR{RUN}'); print('room A', room)
        # panel: the extra board-nick field is gone (preview)
        panel(h, True)
        txt = S(h, "document.getElementById('np').innerText")
        check('A: F7 panel has the normal nick and no "Nick do placar online" field',
              S(h, "document.getElementById('np-nick').value") == 'Chico' and S(h, "!!document.getElementById('np-bnick')") is False
              and S(h, "!!document.getElementById('np-bnick-msg')") is False
              and 'Nick do placar online' not in txt and 'Online scoreboard nick' not in txt, txt)
        if a.preview: h.screenshot(path=f'{a.preview}/highscore_panel_no_bnick_{a.lang}.png')
        panel(h, False)
        join(g, room); join(sp, room, spec=True)
        check('A: guest got slot 1 and a match_id equal to the host\'s (from the Worker)', S(g, 'SSRNETPLAY.session.slot') == 1 and S(h, 'SSRNETPLAY.state.t.match_id') == S(g, 'SSRNETPLAY.state.t.match_id') and len(S(h, 'SSRNETPLAY.state.t.match_id')) == 32, S(h, 'SSRNETPLAY.state.t.match_id'))
        mid = S(h, 'SSRNETPLAY.state.t.match_id'); hid = S(h, 'SSRNETPLAY.state.t.id'); gid = S(g, 'SSRNETPLAY.state.t.id')
        check('A: spectator transport has a match_id but no reporter armed on a spectator session', S(sp, 'SSRNETPLAY.session.spec') is True and not S(sp, 'SSRNETPLAY.session.onConfirmed'))
        check('A: before the game nothing was sent', not h.__bodies and not g.__bodies and not sp.__bodies)
        start_game([h, g])  # coin + fire pulses on both, hook on both
        ok_run = wait(lambda: mode(h) == 2 and mode(g) == 2, 60); check('A: both peers are in a running game', bool(ok_run))
        ok_end = wait(lambda: evs(h, 'result') and evs(g, 'result'), 90)
        check('A: both players got a report result (host and guest)', bool(ok_end), (evs(h), evs(g)))
        time.sleep(1)
        check('A: exactly ONE POST per player', len(h.__bodies) == 1 and len(g.__bodies) == 1, (len(h.__bodies), len(g.__bodies)))
        if h.__bodies and g.__bodies:
            bh_, bg_ = h.__bodies[0], g.__bodies[0]; H, G = bh_['body'], bg_['body']
            print(json.dumps({'host': H, 'guest': G}, indent=1))
            check('A: JSON POST to the Worker /scores/report (same origin as the signaling)', bh_['url'] == 'https://games4me-netplay.games4me.workers.dev/scores/report' and 'application/json' in (bh_['ct'] or ''), bh_['url'])
            check('A: game / match_id / room equal and right', H['game'] == G['game'] == 'sunsetriders_web' and H['match_id'] == G['match_id'] == mid and H['room'] == G['room'] == room, (H['room'], G['room']))
            check('A: peer ids are the signaling ids, different per peer', H['peer_id'] == hid and G['peer_id'] == gid and hid != gid)
            check('A: role / my_slot: host 0, guest 1', (H['role'], H['my_slot'], G['role'], G['my_slot']) == ('host', 0, 'guest', 1), (H['role'], H['my_slot'], G['role'], G['my_slot']))
            check('A: own board nick normalized (CHICO / RITA, 3-8 A-Z0-9)', H['nick'] == 'CHICO' and G['nick'] == 'RITA', (H['nick'], G['nick']))
            fp = lambda B: sorted((x['slot'], x['score']) for x in B['scores'])
            check('A: same slot:score set on both peers, both occupied slots listed (0 and 1)', fp(H) == fp(G) and [x[0] for x in fp(H)] == [0, 1], fp(H))
            check('A: scores are integers read from RAM (>= the poked 12340 / 5670, <= 99,999,999)', all(isinstance(x['score'], int) and 0 <= x['score'] <= 99999999 for x in H['scores']) and fp(H)[0][1] >= 12340 and fp(H)[1][1] >= 5670, fp(H))
            check('A: each body carries the nick of EVERY occupied slot in scores[] (own + the other player\'s, from the session)', [x.get('nick') for x in H['scores']] == ['CHICO', 'RITA'] and [x.get('nick') for x in G['scores']] == ['CHICO', 'RITA'], (H['scores'], G['scores']))
            check('A: Worker answers logged (first report pending, second accepted), never blocking', sorted([evs(h, 'result')[0]['status'], evs(g, 'result')[0]['status']]) == ['accepted', 'pending'], ([e['status'] for e in evs(h, 'result')], [e['status'] for e in evs(g, 'result')]))
        check('A: spectator sent nothing and logged no report', not sp.__bodies and not evs(sp, 'report'))
        check('A: the ending went on (mode left the game, frames keep running) on host and guest', wait(lambda: mode(h) != 2 and mode(g) != 2, 10) and frames_run(h) and frames_run(g), (mode(h), mode(g)))
        # a second game of the same match (the game cannot restart after the hook's shortcut, so two synthetic confirmed frames drive the page's own observer): no second report
        SYN = """() => { const s = SSRNETPLAY.session, w = new Uint8Array(0x4000), f = s.rb.confirmed;
          w[1] = 1; s.onConfirmed(f, { wram: w }); w[1] = 2; for (let i = 0; i < 2; i++) { w[0x200 + 0x40 * i] = 0x15; w[0x210 + 0x40 * i] = 0x81; } w[0x208] = 0x20; w[0x248] = 0x10; s.onConfirmed(f, { wram: w }); w[1] = 1; s.onConfirmed(f, { wram: w }); }"""
        h.evaluate(SYN); g.evaluate(SYN); time.sleep(1)
        check('A: a second game of the same match ended (page observer): gameover logged, NO second report (one per match_id)', len(evs(h, 'gameover')) == 2 and len(evs(g, 'gameover')) == 2 and len(h.__bodies) == 1 and len(g.__bodies) == 1 and any(e.get('why') == 'already reported' for e in evs(h, 'skip')) and any(e.get('why') == 'already reported' for e in evs(g, 'skip')), (len(evs(h, 'gameover')), len(h.__bodies), evs(h, 'skip')))
        if a.preview:
            two_bodies = {'host': h.__bodies[0]['body'] if h.__bodies else None, 'guest': g.__bodies[0]['body'] if g.__bodies else None}
        quiet(g, sp, h); time.sleep(1.5)
        for b in (bh, bg, bs): b.close()
        # offline: same hook, no session -> nothing sent
        bo, o = mk(p, 'Solo')
        o.goto(f'{BASE}?lang={a.lang}&voice=0'); o.evaluate('SSRG.ready'); start_game([o])
        ok_o = wait(lambda: mode(o) == 2, 40) and wait(lambda: len(evs(o, 'gameover')) >= 1 or mode(o) != 2, 60)
        time.sleep(2)
        check('A: offline game reached its end (mode left the game) with nothing sent and no reporter', ok_o and mode(o) != 2 and not o.__bodies and not evs(o), (mode(o), o.__bodies, evs(o)))
        bo.close()
        ALL.clear()
        # ================= B: the guest's POST fails (network) =================
        bh, h = mk(p, 'Chico'); bg, g = mk(p, 'Rita', mode='abort')
        room = make_room(h, f'FALHA{RUN}'); print('room B', room); join(g, room)
        start_game([h, g]); wait(lambda: mode(h) == 2 and mode(g) == 2, 60)
        okb = wait(lambda: evs(g, 'gameover') and evs(h, 'result'), 90)
        check('B: the guest reached the game end and the host reported', bool(okb))
        okf = wait(lambda: evs(g, 'result'), 30)
        check('B: guest POST retried 3 times with the IDENTICAL body, then gave up quietly (status failed)', bool(okf) and len(g.__bodies) == 3 and g.__bodies[0]['body'] == g.__bodies[1]['body'] == g.__bodies[2]['body'] and evs(g, 'result')[0]['status'] == 'failed', (len(g.__bodies), evs(g, 'result')))
        check('B: the failed report did not block the ending: game left game mode, frames run, no page errors', mode(g) != 2 and frames_run(g) and frames_run(h) and not errs, (mode(g), errs[:3]))
        check('B: host report unaffected (one POST)', len(h.__bodies) == 1 and h.__bodies[0]['body']['role'] == 'host')
        quiet(g, h); time.sleep(1.5); bh.close(); bg.close()
        # ================= C: accented / spaced nick and a short nick, both auto-reported =================
        bh, h = mk(p, 'João Silva'); bg, g = mk(p, 'Zé')
        room = make_room(h, f'APELIDO{RUN}'); print('room C', room); join(g, room)
        panel(h, True)
        check('C: F7 panel still has no board-nick field (only the normal nick)', S(h, "!!document.getElementById('np-bnick')") is False and S(h, "document.getElementById('np-nick').value") == 'João Silva', S(h, "document.getElementById('np-nick') && document.getElementById('np-nick').value"))
        panel(h, False)
        check('C: session already carries the normal nicks (accents/spaces and a short one)', wait(lambda: names(h)[:2] == ['João Silva', 'Zé'] and names(g)[:2] == ['João Silva', 'Zé'], 10), (names(h), names(g)))
        check('C: board nicks are derived automatically (JOAOSILV / ZEP2) with no extra field', wait(lambda: board_nicks(h)[:2] == ['JOAOSILV', 'ZEP2'] and board_nicks(g)[:2] == ['JOAOSILV', 'ZEP2'], 10), (board_nicks(h), board_nicks(g)))
        start_game([h, g]); wait(lambda: mode(h) == 2 and mode(g) == 2, 60)
        okc = wait(lambda: evs(g, 'result') and evs(h, 'result'), 90)
        check('C: both reported (short and accented nicks never block the report)', bool(okc) and len(h.__bodies) == 1 and len(g.__bodies) == 1 and not evs(h, 'skip') and not evs(g, 'skip'), (evs(h, 'skip'), evs(g, 'skip'), len(h.__bodies), len(g.__bodies)))
        if h.__bodies and g.__bodies:
            want = {0: 'JOAOSILV', 1: 'ZEP2'}
            check('C: every body carries the derived nick of BOTH slots', all({x['slot']: x.get('nick') for x in B['body']['scores']} == want for B in (h.__bodies[0], g.__bodies[0])) and h.__bodies[0]['body']['nick'] == 'JOAOSILV' and g.__bodies[0]['body']['nick'] == 'ZEP2', (h.__bodies[0]['body']['scores'], g.__bodies[0]['body']['scores']))
        quiet(g, h); time.sleep(1.5); bh.close(); bg.close()
        ALL.clear()
        # ================= D: 3 players, nicks reused from the session roster =================
        bh, h = mk(p, 'João Silva'); bg, g = mk(p, 'Rita'); b2, g2 = mk(p, 'Zé')
        room = make_room(h, f'TRES{RUN}'); print('room D', room); join(g, room)
        check('D: guest 1 (slot 1) and the host see each other\'s normal nick', wait(lambda: names(h)[:2] == ['João Silva', 'Rita'] and names(g)[:2] == ['João Silva', 'Rita'], 10), (names(h), names(g)))
        join(g2, room)
        check('D: guest 2 joined late in slot 2', S(g2, 'SSRNETPLAY.session.slot') == 2, S(g2, 'SSRNETPLAY.session.slot'))
        check('D: the late joiner learns the nicks of the host and guest 1, the others learn the late one', wait(lambda: all(names(x)[:3] == ['João Silva', 'Rita', 'Zé'] for x in (h, g, g2)), 15), [names(x) for x in (h, g, g2)])
        panel(g, True); set_nick(g, 'Rita2'); time.sleep(0.3)
        check('D: guest 1 changes its normal nick afterwards (Rita2) and everybody follows', wait(lambda: all(names(x)[:3] == ['João Silva', 'Rita2', 'Zé'] for x in (h, g, g2)), 15), [names(x) for x in (h, g, g2)])
        check('D: derived board nicks (JOAOSILV / RITA2 / ZEP3) follow the same roster', wait(lambda: all(board_nicks(x)[:3] == ['JOAOSILV', 'RITA2', 'ZEP3'] for x in (h, g, g2)), 10), [board_nicks(x) for x in (h, g, g2)])
        panel(g, False)
        start_game([h, g, g2], 3); wait(lambda: mode(h) == 2 and mode(g) == 2 and mode(g2) == 2, 60)
        okd = wait(lambda: evs(h, 'result') and evs(g, 'result') and evs(g2, 'result'), 120)
        check('D: the three players reported', bool(okd) and len(h.__bodies) == len(g.__bodies) == len(g2.__bodies) == 1, (len(h.__bodies), len(g.__bodies), len(g2.__bodies)))
        if h.__bodies and g.__bodies and g2.__bodies:
            BD = [x.__bodies[0]['body'] for x in (h, g, g2)]; print(json.dumps(BD, indent=1))
            fp3 = lambda B: sorted((x['slot'], x['score']) for x in B['scores'])
            check('D: same match_id / room and same slot:score set (3 slots) in the three bodies', len({B['match_id'] for B in BD}) == 1 and len({B['room'] for B in BD}) == 1 and fp3(BD[0]) == fp3(BD[1]) == fp3(BD[2]) and [x[0] for x in fp3(BD[0])] == [0, 1, 2], [fp3(B) for B in BD])
            want = {0: 'JOAOSILV', 1: 'RITA2', 2: 'ZEP3'}
            check('D: every body carries the nick of ALL three slots (accented + short padded)', all({x['slot']: x.get('nick') for x in B['scores']} == want for B in BD), [B['scores'] for B in BD])
            check('D: top-level nick / my_slot / role unchanged (own)', [(B['role'], B['my_slot'], B['nick']) for B in BD] == [('host', 0, 'JOAOSILV'), ('guest', 1, 'RITA2'), ('guest', 2, 'ZEP3')], [(B['role'], B['my_slot'], B['nick']) for B in BD])
            if a.preview:
                with open(f'{a.preview}/highscore_report_bodies.json', 'w') as f: json.dump({'three_players': {'host': BD[0], 'guest1': BD[1], 'guest2': BD[2]}, 'two_players': two_bodies, 'events_host': evs(h)}, f, indent=1)
        quiet(g2, g, h); time.sleep(1.5); bh.close(); bg.close(); b2.close()
        ALL.clear()
        # ================= E: a player who leaves mid-match is omitted from every report =================
        bh, h = mk(p, 'Chico'); bg, g = mk(p, 'Rita'); b2, g2 = mk(p, 'Zé')
        room = make_room(h, f'SAIU{RUN}'); print('room E', room); join(g, room); join(g2, room)
        check('E: three players seated', wait(lambda: S(g2, 'SSRNETPLAY.session.slot') == 2 and names(h)[:3] == ['Chico', 'Rita', 'Zé'], 15), (S(g2, 'SSRNETPLAY.session.slot'), names(h)))
        start_game([h, g, g2], 3); wait(lambda: mode(h) == 2 and mode(g) == 2 and mode(g2) == 2, 60)
        g2.evaluate('void SSRNETPLAY.leave()')
        left = "() => { const s = SSRNETPLAY.session, INF = SSRROLL.INF; return !!(s && s.rb && s.rb.join[2] !== INF && s.rb.leave[2] !== INF); }"
        check('E: host and guest 1 see that slot 2 has left (rollback roster)', wait(lambda: S(h, left) and S(g, left), 20), (S(h, left), S(g, left), names(h), names(g)))
        oke = wait(lambda: evs(h, 'result') and evs(g, 'result'), 120)
        check('E: the two who stayed reported, the leaver sent nothing', bool(oke) and len(h.__bodies) == 1 and len(g.__bodies) == 1 and not g2.__bodies and not evs(g2, 'report'), (len(h.__bodies), len(g.__bodies), g2.__bodies, evs(g2)))
        if h.__bodies and g.__bodies:
            BE = [x.__bodies[0]['body'] for x in (h, g)]; print(json.dumps(BE, indent=1))
            fp2 = lambda B: sorted((x['slot'], x['score']) for x in B['scores'])
            check('E: remaining reports agree (same match_id / room / 2-slot fingerprint), leaver slot absent',
                  BE[0]['match_id'] == BE[1]['match_id'] and BE[0]['room'] == BE[1]['room'] and fp2(BE[0]) == fp2(BE[1]) and [x[0] for x in fp2(BE[0])] == [0, 1],
                  [fp2(B) for B in BE])
            check('E: only Chico and Rita (no Zé / ZEP3) appear in either body',
                  all({x['slot']: x.get('nick') for x in B['scores']} == {0: 'CHICO', 1: 'RITA'} and B['nick'] in ('CHICO', 'RITA') and 2 not in {x['slot'] for x in B['scores']} for B in BE),
                  [B['scores'] for B in BE])
            if a.preview:
                prev = {}
                try:
                    with open(f'{a.preview}/highscore_report_bodies.json') as f: prev = json.load(f)
                except Exception:
                    prev = {}
                prev['left_mid_match'] = {'host': BE[0], 'guest': BE[1]}
                with open(f'{a.preview}/highscore_report_bodies.json', 'w') as f: json.dump(prev, f, indent=1)
        quiet(g, h); time.sleep(1.5); bh.close(); bg.close(); b2.close()
        ALL.clear()
        # ================= F: host leaves mid-match: remaining guests (and the host) report including the host's slot =================
        bh, h = mk(p, 'Chico'); bg, g = mk(p, 'Rita'); b2, g2 = mk(p, 'Zé')
        room = make_room(h, f'HOSTSAI{RUN}'); print('room F', room); join(g, room); join(g2, room)
        check('F: three players seated', wait(lambda: S(g2, 'SSRNETPLAY.session.slot') == 2 and names(h)[:3] == ['Chico', 'Rita', 'Zé'], 15), (S(g2, 'SSRNETPLAY.session.slot'), names(h)))
        start_game([h, g, g2], 3)
        for pg in (h, g, g2): pg.evaluate('window.__HS_NOEND = 1')
        wait(lambda: mode(h) == 2 and mode(g) == 2 and mode(g2) == 2, 60)
        scored = "SSRHS.bcd32(SSRG.machine.wram, 0x206) >= 12340"
        check('F: scores are in RAM (hook has poked them) before the host leaves', wait(lambda: S(h, scored) and S(g, scored) and S(g2, scored), 40), (S(h, scored), S(g, scored)))
        time.sleep(1.2)  # let the poked scores become confirmed on every peer (same last host-confirmed state); hook will not end the game (__HS_NOEND)
        panel(h, True); h.click('#np-leave')
        okf = wait(lambda: evs(g, 'result') and evs(g2, 'result') and len(h.__bodies) >= 1, 40)
        check('F: host reported before leaving and both guests reported on hostgone', bool(okf) and len(h.__bodies) == 1 and len(g.__bodies) == 1 and len(g2.__bodies) == 1, (len(h.__bodies), len(g.__bodies), len(g2.__bodies), evs(g), evs(g2)))
        if h.__bodies and g.__bodies and g2.__bodies:
            BF = [x.__bodies[0]['body'] for x in (h, g, g2)]; print(json.dumps(BF, indent=1))
            fp3 = lambda B: sorted((x['slot'], x['score']) for x in B['scores'])
            check('F: the three bodies agree (same match_id / room / 3-slot fingerprint including the host)',
                  len({B['match_id'] for B in BF}) == 1 and len({B['room'] for B in BF}) == 1 and fp3(BF[0]) == fp3(BF[1]) == fp3(BF[2]) and [x[0] for x in fp3(BF[0])] == [0, 1, 2],
                  [fp3(B) for B in BF])
            want = {0: 'CHICO', 1: 'RITA', 2: 'ZEP3'}
            check('F: every body includes the host\'s slot (CHICO) plus Rita and Zé, no slot omitted',
                  all({x['slot']: x.get('nick') for x in B['scores']} == want for B in BF), [B['scores'] for B in BF])
            check('F: top-level nick / my_slot / role (host + two guests)',
                  [(B['role'], B['my_slot'], B['nick']) for B in BF] == [('host', 0, 'CHICO'), ('guest', 1, 'RITA'), ('guest', 2, 'ZEP3')],
                  [(B['role'], B['my_slot'], B['nick']) for B in BF])
            if a.preview:
                prev = {}
                try:
                    with open(f'{a.preview}/highscore_report_bodies.json') as f: prev = json.load(f)
                except Exception:
                    prev = {}
                prev['host_left_mid_match'] = {'host': BF[0], 'guest1': BF[1], 'guest2': BF[2]}
                with open(f'{a.preview}/highscore_report_bodies.json', 'w') as f: json.dump(prev, f, indent=1)
        quiet(g2, g); time.sleep(1.5); bh.close(); bg.close(); b2.close()
finally:
    srv.terminate()
print('console/page errors:', errs[:5])
check('no page errors', not errs)
print('FAIL: ' + ', '.join(fails) if fails else 'ALL PASS'); sys.exit(1 if fails else 0)
