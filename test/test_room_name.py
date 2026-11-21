#!/usr/bin/env python3
"""Typed room names (2026-11-09) in headless Chromium against a signal server (default: the PRODUCTION Cloudflare Worker).
Checks: empty name -> "Create room" disabled + hint; 2 chars -> "too short" message; typing is normalized live
("Saulo Teste" -> SAULO-TESTE, accents dropped, max 16); host with the typed name; a 2nd host with the same name gets
409 'room taken' -> "name in use" message, form kept, UI usable, a different name then works; EN panel has no pt text;
join by the typed name field (lowercase input), by ?sala=<lowercase>, and from the room list; unknown room -> friendly
message; ?sala=ab -> invalid-name message. All rooms are left at the end (checked with ?a=list).
Usage: python3 test/test_room_name.py web [--signal URL] [--name "Saulo Teste"] [--preview ref/preview]"""
import argparse, os, re, sys, json, time, socket, subprocess, urllib.request
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--signal', default='https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php')
ap.add_argument('--name', default='Saulo Teste'); ap.add_argument('--preview', default=''); a = ap.parse_args()
SIG = a.signal
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'
PTRE = re.compile(r'[ãõçáéíóúâêôà]|\b(sala|salas|entrar|criar|nome|digite|curto|caracteres|letras|n[uú]meros|em uso|escolha|outro|servidor|existe|anfitri\w*|j[aá])\b', re.I)
fails = []; ok = lambda c, m: print(('PASS ' if c else 'FAIL ') + m, flush=True) or (c or fails.append(m))
def lst():
    try: return json.load(urllib.request.urlopen(urllib.request.Request(SIG + '?a=list', headers={'User-Agent': 'Mozilla/5.0'}), timeout=10)).get('rooms', [])
    except Exception as e: return [{'err': str(e)}]
pv = lambda pg, n: a.preview and pg.screenshot(path=os.path.join(a.preview, n))
sigq = '' if 'workers.dev' in SIG else f'&signal={SIG}'
pages = []
try:
  with sync_playwright() as p:
    args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
    br = p.chromium.launch(args=args)
    def page(nick, lang, extra=''):
        ctx = br.new_context(locale='pt-BR' if lang == 'pt' else 'en-US', viewport={'width': 1100, 'height': 760}); pg = ctx.new_page(); pg.set_default_timeout(60000)
        pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(nick)}); localStorage.setItem("ssr_public", "1") }} catch (e) {{}}')
        pg.on('pageerror', lambda e: fails.append(f'{nick}: {e}')); pg.goto(f'{BASE}?lang={lang}&sound=0{sigq}{extra}'); pg.evaluate('SSRG.ready'); pages.append(pg); return pg
    want = None
    # --- host A (pt): empty / short / typed
    A = page('teste-bot', 'pt'); A.keyboard.press('F7'); time.sleep(0.5)
    ok(A.is_disabled('#np-create') and 'Digite um nome' in A.inner_text('#np-room-msg'), 'empty name: create disabled + hint "' + A.inner_text('#np-room-msg') + '"')
    A.click('#np-room'); A.keyboard.type('ab'); ok(A.is_disabled('#np-create') and 'curto' in A.inner_text('#np-room-msg'), 'short name: "' + A.inner_text('#np-room-msg') + '"')
    A.fill('#np-room', ''); A.keyboard.type('Ação já 123456789xyz!@#', delay=10); v = A.input_value('#np-room')
    ok(v == 'ACAO-JA-12345678', f'normalized while typing (accents, spaces, symbols, max 16): {v}')
    A.fill('#np-room', ''); A.keyboard.type(a.name, delay=20); want = A.input_value('#np-room'); ok(re.fullmatch(r'[A-Z0-9-]{3,16}', want) is not None and not A.is_disabled('#np-create'), f'typed "{a.name}" -> {want}, create enabled')
    pv(A, 'room_name_create_pt.png')
    A.keyboard.press('Enter'); A.wait_for_function('SSRNETPLAY.session', timeout=30000); time.sleep(1)
    ok(A.evaluate('SSRNETPLAY.state.room') == want and want in A.inner_text('#np'), f'host room = typed name {want} (Enter in the field)')
    # --- host B (pt): same name -> 409
    B = page('teste-bot2', 'pt'); B.keyboard.press('F7'); B.click('#np-room'); B.keyboard.type(a.name.lower(), delay=10); B.click('#np-create')
    B.wait_for_function('document.querySelector("#np").innerText.includes("já está em uso")', timeout=30000); time.sleep(0.3)
    bt = B.inner_text('#np'); ok('em uso' in bt and B.evaluate('!SSRNETPLAY.session && !SSRNETPLAY.state.room') and B.input_value('#np-room') == want and not B.is_disabled('#np-create'),
        'second host same name: "name in use" shown, no session, name kept, button usable')
    pv(B, 'room_name_taken_pt.png')
    B.fill('#np-room', ''); B.keyboard.type(a.name + ' 2'); want2 = B.input_value('#np-room'); B.click('#np-create'); B.wait_for_function('SSRNETPLAY.session', timeout=30000)
    ok(B.evaluate('SSRNETPLAY.state.room') == want2, f'after choosing another name ({want2}) the room opens')
    B.evaluate('SSRNETPLAY.leave()'); time.sleep(0.5)
    # --- C (en): create screen + 409 in English, then join by typed name
    C = page('teste-bot3', 'en'); C.keyboard.press('F7'); time.sleep(0.5)
    ok(C.is_disabled('#np-create') and C.inner_text('#np-room-msg') == 'Type a name to create the room.', 'EN empty hint')
    C.click('#np-room'); C.keyboard.type('wild bunch'); pv(C, 'room_name_create_en.png')
    etxt = [C.inner_text('#np')]
    C.fill('#np-room', ''); C.keyboard.type(a.name); C.click('#np-create'); C.wait_for_function('document.querySelector("#np").innerText.includes("already in use")', timeout=30000); time.sleep(0.3)
    etxt.append(C.inner_text('#np')); pv(C, 'room_name_taken_en.png')
    C.click('#np-room'); C.keyboard.type('ab', delay=5); C.fill('#np-room', 'ab'); C.dispatch_event('#np-room', 'input'); etxt.append(C.inner_text('#np'))
    ph = C.evaluate('[...document.querySelectorAll("#np [placeholder]")].map(e => e.placeholder).join(" | ")'); etxt.append(ph)
    lo = [m.group(0) for x in etxt for m in PTRE.finditer(re.sub(r'\b[A-Z0-9-]{3,16}\b', '', x))]
    ok(not lo, 'EN panel (create / taken / short / placeholders) has no Portuguese: ' + (json.dumps(lo[:6], ensure_ascii=False) if lo else 'ok'))
    C.fill('#np-room', ''); C.fill('#np-code', a.name.lower()); cv = C.input_value('#np-code'); C.click('#np-join')
    C.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot === 1', timeout=60000)
    ok(cv == want, f'join field normalized ({a.name.lower()!r} -> {cv}) and joined as P2')
    # --- D: ?sala=<lowercase>
    D = page('teste-bot4', 'pt', f'&sala={want.lower()}'); D.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot === 2', timeout=60000)
    ok(D.evaluate('SSRNETPLAY.state.room') == want, f'?sala={want.lower()} joined as P3')
    # --- E: room list
    E = page('teste-bot5', 'pt'); E.keyboard.press('F7')
    E.wait_for_function(f'(SSRNETPLAY.roomList() || []).some(r => r.room === "{want}")', timeout=60000); time.sleep(0.5)
    row = [r for r in E.evaluate('SSRNETPLAY.roomList()') if r['room'] == want]; print('  list row', row)
    E.click(f'#np-list button[data-r="{want}"]'); E.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot === 3', timeout=60000)
    ok(True, f'room {want} listed and joined from the list as P4')
    time.sleep(3); hc = A.evaluate('SSRNETPLAY.session.stats'); ds = [pg.evaluate('SSRNETPLAY.session && SSRNETPLAY.session.stats.desyncs') for pg in (A, C, D, E)]
    print('  host stats', json.dumps(hc)[:300], 'desyncs', ds); ok(all(x == 0 for x in ds), '4 players, 0 desyncs')
    # --- F: unknown room + bad ?sala=
    F = page('teste-bot6', 'pt'); F.keyboard.press('F7'); F.fill('#np-code', 'nao existe xyz'); F.click('#np-join')
    F.wait_for_function('document.querySelector("#np").innerText.includes("não existe")', timeout=60000); ft = F.inner_text('#np')
    ok(F.evaluate('!SSRNETPLAY.session') and '#np-room' and F.query_selector('#np-room') is not None, 'unknown room: friendly message, back to the form: ' + ft.split('\n')[-1])
    G2 = page('teste-bot7', 'en', '&sala=ab'); time.sleep(1.5); gt = G2.inner_text('#np') if G2.is_visible('#np') else G2.evaluate('document.querySelector("#np").innerText')
    ok('invalid room name' in gt and G2.evaluate('!SSRNETPLAY.session'), '?sala=ab -> invalid name message')
    for pg in (E, D, C): pg.evaluate('SSRNETPLAY.leave()'); time.sleep(0.3)
    A.evaluate('SSRNETPLAY.leave()'); time.sleep(3)
    br.close()
finally:
    srv.terminate()
time.sleep(2); left = [r for r in lst() if r.get('room', '').startswith(re.sub(r'[^A-Z0-9-]', '', (want or 'NONE'))[:8]) or 'err' in r]
ok(not left, 'no test rooms left in ?a=list: ' + json.dumps(left))
print('ALL PASS' if not fails else 'FAILED: ' + '; '.join(fails)); raise SystemExit(1 if fails else 0)
