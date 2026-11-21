#!/usr/bin/env python3
# Usage: python3 test/test_netplay_cf.py web [seconds] [typed room name]  (needs web/assets; creates one room, leaves it at the end)
# The host types the room name in the F7 field (default 'Saulo Teste' -> SAULO-TESTE); the guest joins by ?sala=<lowercase name>.
# 2-peer netplay against the PRODUCTION Cloudflare Worker (default DEFAULT_SIGNAL, no ?signal=), nicks teste-bot/teste-bot2.
import os, sys, json, time, socket, subprocess, urllib.request
from playwright.sync_api import sync_playwright
WEB = sys.argv[1]; SECS = float(sys.argv[2]) if len(sys.argv) > 2 else 45; TYPED = sys.argv[3] if len(sys.argv) > 3 else 'Saulo Teste'
SIG = 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php'
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', WEB], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'
BOT = """seed => { let x = seed * 2654435761 >>> 0, cur = 0, hold = 0, n = 0; const I = SSRIN;
  I.sample = () => { n++; const o = new Uint8Array(4); const k = n % 900;
    if (k === 60) o[0] = I.COIN; else if (k === 120 || k === 130) o[0] = I.FIRE;
    else { if (--hold <= 0) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; cur = [0, I.L, I.R, I.U, I.D, I.FIRE, I.FIRE | I.R, I.JUMP, I.L | I.FIRE][(x >>> 16) % 9]; hold = 5 + ((x >>> 8) % 40); } o[0] = cur; }
    return o; }; }"""
STATS = """() => { const N = SSRNETPLAY.session; if (!N || !N.rb) return null; const r = N.rb.stats;
  return { slot: N.slot, frame: N.rb.frame, confirmed: N.rb.confirmed, rollbacks: r.rollbacks, stalls: r.stalls, resyncs: N.stats.resyncs, desyncs: N.stats.desyncs, hashChecks: N.stats.hashChecks, names: N.names(), peers: N.peers() }; }"""
def lst():
    return json.load(urllib.request.urlopen(urllib.request.Request(SIG + '?a=list', headers={'User-Agent': 'Mozilla/5.0'}), timeout=10))
ice = json.load(urllib.request.urlopen(urllib.request.Request(SIG + '?a=ice', headers={'User-Agent': 'Mozilla/5.0'}), timeout=10))
ice_urls = [u for x in ice.get('ice', []) for u in ([x['urls']] if isinstance(x.get('urls'), str) else x.get('urls', []))]
print('ice ok', ice.get('ok'), 'servers', len(ice.get('ice', [])), 'turn urls', len([u for u in ice_urls if u.startswith('turn')]), 'hosts', sorted({u.split(':')[1] for u in ice_urls}))
res = {'ws': [[], []], 'logs': [[], []], 'errors': [], 'reqs': [[], []]}
with sync_playwright() as p:
    args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
    bs = [p.chromium.launch(args=args) for _ in range(2)]; pages = []
    for i, b in enumerate(bs):
        pg = b.new_page(); pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(["teste-bot","teste-bot2"][i])}) }} catch (e) {{}}')
        pg.on('pageerror', lambda e, i=i: res['errors'].append(f'{i}: {e}'))
        pg.on('websocket', lambda ws, i=i: res['ws'][i].append(ws.url))
        pg.on('console', lambda m, i=i: res['logs'][i].append(m.text) if ('netplay-cf' in m.text or 'ssr-net' in m.text or 'signal' in m.text) else None)
        pg.on('request', lambda r, i=i: res['reqs'][i].append(r.url.split('?')[0] + '?' + (r.url.split('?')[1].split('&')[0] if '?' in r.url else '')) if 'workers.dev' in r.url or 'alwaysdata' in r.url else None)
        pages.append(pg)
    h, g = pages
    h.goto(BASE); h.evaluate('SSRG.ready'); h.evaluate(BOT, 1); time.sleep(3)
    sig_used = h.evaluate('SSRNETPLAY.signal'); print('signal', sig_used)
    tcf = h.evaluate('!!window.NETCF')
    want = h.evaluate('x => SSRNETPLAY.normRoom(x)', TYPED)
    h.keyboard.press('F7'); h.click('#np-room'); h.keyboard.type(TYPED, delay=30)
    typed_ok = h.input_value('#np-room') == want and not h.is_disabled('#np-create'); print('typed', repr(TYPED), '->', h.input_value('#np-room'), 'create enabled', not h.is_disabled('#np-create'))
    h.click('#np-create'); h.wait_for_function('SSRNETPLAY.session', timeout=30000); time.sleep(2)
    room = h.evaluate('SSRNETPLAY.state.room'); print('room', room, 'link', h.evaluate('SSRNETPLAY.link()')); typed_ok = typed_ok and room == want
    listed = lst(); print('listed', [r for r in listed.get('rooms', []) if r.get('room') == room or r.get('r') == room] or listed)
    g.goto(f'{BASE}?sala={room.lower()}'); g.evaluate('SSRG.ready'); g.evaluate(BOT, 2)
    t0 = time.time()
    while time.time() - t0 < SECS:
        time.sleep(5); st = [pg.evaluate(STATS) for pg in pages]
        print(f'{time.time()-t0:5.1f}s', ' | '.join(f"P{s['slot']+1} f{s['frame']} rb{s['rollbacks']} st{s['stalls']} rs{s['resyncs']} ds{s['desyncs']} hc{s['hashChecks']}" if s else '-' for s in st), flush=True)
    st = [pg.evaluate(STATS) for pg in pages]; gr = g.evaluate('SSRNETPLAY.state.room')
    g.evaluate('SSRNETPLAY.leave()'); time.sleep(1); h.evaluate('SSRNETPLAY.leave()'); time.sleep(3)
    for b in bs: b.close()
srv.terminate(); time.sleep(2)
after = lst(); still = [r for r in after.get('rooms', []) if room in json.dumps(r)]
print(json.dumps(st, default=str)[:2500])
print('ws', res['ws']); print('logs', [l[:12] for l in res['logs']]); print('errors', res['errors'][:5])
print('alwaysdata requests', [u for r in res['reqs'] for u in r if 'alwaysdata' in u])
from collections import Counter; print('worker http reqs', [Counter(r) for r in res['reqs']])
print('room after leave listed:', still)
print('typed room ok', typed_ok, 'guest room', gr)
ok = typed_ok and gr == room and tcf and all(st) and st[0]['desyncs'] == 0 and st[1]['desyncs'] == 0 and st[0]['hashChecks'] >= 5 and all(res['ws']) and not still and not res['errors'] and sig_used == SIG and any('websocket push on' in l for l in res['logs'][0]) and any('websocket push on' in l for l in res['logs'][1])
print('PASS' if ok else 'FAIL')
