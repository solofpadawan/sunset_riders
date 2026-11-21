#!/usr/bin/env python3
"""Netplay UI language (i18next, web/i18n/) in headless Chromium, signaling on php -S (no production server).
Variants: ?lang=pt (browser en-US), ?lang=en (browser pt-BR), browser pt-BR, browser en-US.
For each: F7 panel (idle + room list row from a host in the OTHER language), guest panel after joining that room
(slot names minted by the other-language host), chat field (TAB), own hosted room, ROM loader (assets 404 + a bad file).
EN: scans textContent / placeholder / title / value / canvas overlay strings for leftover Portuguese.
PT: with --base DIR, the idle and host panels must equal those of an older build (off by default since the typed room name
(2026-11-09) intentionally changed the idle panel: room-name field + hint).
Usage: python3 test/test_i18n_panel.py [--preview ref/preview] [--base DIR]"""
import argparse, os, re, subprocess, time, socket, json, shutil
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('--preview', default=''); ap.add_argument('--base', default=''); a = ap.parse_args()
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
def serve(d):
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    pr = subprocess.Popen(['php', '-S', f'127.0.0.1:{port}', '-t', d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=dict(os.environ, PHP_CLI_SERVER_WORKERS='6'))
    return pr, f'http://127.0.0.1:{port}'
shutil.rmtree(os.path.join(ROOT, 'web/net/rooms'), ignore_errors=True)
php, URL = serve(os.path.join(ROOT, 'web')); time.sleep(1)
SIG = f'{URL}/net/signal.php'
PTRE = re.compile(r'[ãõçáéíóúâêôàÃÕÇÁÉÍÓÚÂÊÔ]|\b(sala|salas|entrar|assistir|assistindo|cheia|multijogador|jogador|jogadores|espectador|espectadores|criar|sair|conectando|anfitri\w*|livre|voc[eê]|nenhum|fase|tela|mensagem|aperte|ficha|carregando|copiar|recebendo|apelido|c[oó]digo|p[uú]blica|privada|vaga|selecione|arquivo|escolher|lendo|verificando|erro|tentar|convide|amigos)\b', re.I)
SCAN = """() => { const out = []; const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) { const x = c.textContent.trim(); if (x) out.push(['text', x]); }
    else if (c.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(c.tagName)) { for (const at of ['placeholder', 'title', 'aria-label', 'alt']) if (c.getAttribute(at)) out.push([at, c.getAttribute(at)]);
      if (c.tagName === 'INPUT' && c.value && c.id !== 'np-link') out.push(['value', c.value]); walk(c); } } };
  walk(document.body); if (document.title) out.push(['title', document.title]);
  const H = window.SSRHINT; if (H) { for (const v of Object.values(H.TXT)) out.push(['hint', v]); const P = SSRNETPLAY.state, w0 = P.wait;
    for (const w of ['connecting', 'relay', 'receiving', 'fail']) { P.wait = w; const N = SSRNETPLAY.session; if (N && N.role === 'guest' && !N.rb) { const x = H.waitText(); if (x) out.push(['wait', x.join(' ')]); } } P.wait = w0; }
  out.push(['chat.watching', t('chat.watching')]); return out; }"""
fails = []; ok = lambda c, m: print(('PASS ' if c else 'FAIL ') + m) or (c or fails.append(m))
args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
def leftovers(items): return [(k, v) for k, v in items if PTRE.search(v)]
def norm(h, room):
    h = re.sub(r'127\.0\.0\.1(%3A|:)\d+(/|%2F)index', r'127.0.0.1\1PAGE\2index', h)  # page origin differs (base build served on another port)
    return h.replace(room, 'ROOM') if room else h
try:
  with sync_playwright() as p:
    br = p.chromium.launch(args=args); brs = []
    def page(locale, q, nick='', base=URL):
        b2 = p.chromium.launch(args=args); brs.append(b2)   # one browser per peer, like test_netplay.py
        ctx = b2.new_context(locale=locale, viewport={'width': 1100, 'height': 760}); pg = ctx.new_page(); pg.set_default_timeout(120000)
        if nick: pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(nick)}) }} catch (e) {{}}')
        pg.add_init_script('try { localStorage.setItem("ssr_public", "1") } catch (e) {}')
        pg.on('pageerror', lambda e: fails.append(f'{locale}{q}: {e}'))
        pg.goto(f'{base}/index.html?signal={SIG}&sound=0{q}'); pg.evaluate('SSRG.ready'); return pg
    results = {}
    for q, loc, want in [('&lang=pt', 'en-US', 'pt'), ('&lang=en', 'pt-BR', 'en'), ('', 'pt-BR', 'pt'), ('', 'en-US', 'en')]:
        tag = f"{'?lang=' + want if q else 'navigator ' + loc}"; print('==', tag)
        other = 'en' if want == 'pt' else 'pt'
        o = page('en-US', f'&lang={other}')             # host in the other language, no nickname (default names)
        o.keyboard.press('F7'); o.fill('#np-room', f'XQ{len(results)}-HOST'); o.click('#np-create'); o.wait_for_function('SSRNETPLAY.session'); oroom = o.evaluate('SSRNETPLAY.state.room')
        pg = page(loc, q)
        ok(pg.evaluate('SSRI18N.language') == want, f'{tag}: language {pg.evaluate("SSRI18N.language")} == {want}')
        btn = pg.inner_text('#npb'); ok(btn == ('Multijogador (F7)' if want == 'pt' else 'Multiplayer (F7)'), f'{tag}: button "{btn}"')
        pg.keyboard.press('F7'); pg.wait_for_function(f'(SSRNETPLAY.roomList() || []).some(r => r.room === "{oroom}")', timeout=120000); time.sleep(0.3)
        idle = pg.inner_text('#np'); items = pg.evaluate(SCAN); print('  list row:', pg.inner_text('#np-list').replace('\n', ' | ')[:200])
        row = pg.inner_text('#np-list')
        ok((('Jogador 1' in row and 'Tela de título' in row) if want == 'pt' else ('Player 1' in row and 'Title screen' in row)), f'{tag}: room list host/stage in local language')
        if a.preview and q: pg.screenshot(path=os.path.join(a.preview, f'i18n_panel_{want}.png'))
        # guest in the other-language host's room
        pg.evaluate(f'SSRNETPLAY.join("{oroom}").catch(e => console.warn(e)), 0'); pg.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot === 1', timeout=120000); time.sleep(1.5)
        pg.evaluate('document.activeElement && document.activeElement.blur()'); time.sleep(1.2)
        gtxt = pg.inner_text('#np'); print('  guest panel:', gtxt.replace('\n', ' | ')[:260])
        ok(('Jogador 1' in gtxt and 'você' in gtxt) if want == 'pt' else ('Player 1' in gtxt and 'you' in gtxt), f'{tag}: guest panel slot names in local language')
        items += pg.evaluate(SCAN)
        pg.focus('#screen') if pg.query_selector('#screen') else None
        pg.keyboard.press('Tab'); pg.wait_for_function('SSRCHAT.open', timeout=5000)
        ph = pg.get_attribute('#chatin', 'placeholder'); print('  chat placeholder:', ph)
        ok(ph == ('Mensagem (Enter envia, Esc cancela)' if want == 'pt' else 'Message (Enter sends, Esc cancels)'), f'{tag}: chat placeholder')
        pg.keyboard.type('ola'); pg.keyboard.press('Enter'); time.sleep(0.8)
        got = o.evaluate('SSRCHAT.recent ? SSRCHAT.recent.map(x => x.text) : null'); print('  host received chat:', got)
        items += pg.evaluate(SCAN)
        if a.preview and q: pg.screenshot(path=os.path.join(a.preview, f'i18n_guest_{want}.png'))
        pg.evaluate('SSRNETPLAY.leave()'); o.evaluate('SSRNETPLAY.leave()'); time.sleep(0.5)
        # own room
        pg.fill('#np-room', f'XQ{len(results)}-OWN'); pg.click('#np-create'); pg.wait_for_function('SSRNETPLAY.session'); time.sleep(0.5)
        room = pg.evaluate('SSRNETPLAY.state.room'); host = pg.inner_html('#np'); htxt = pg.inner_text('#np'); items += pg.evaluate(SCAN)
        ok(('convide até 3 amigos' in htxt) if want == 'pt' else ('invite up to 3 friends' in htxt), f'{tag}: host panel invite text')
        if a.preview and q: pg.screenshot(path=os.path.join(a.preview, f'i18n_host_{want}.png'))
        pg.evaluate('SSRNETPLAY.leave()'); time.sleep(0.3); idle_html = pg.evaluate("document.querySelector('#np').innerHTML.replace(/<div id=\"np-list\">.*?<\\/div><\\/div>$/s, '')")
        results[tag] = dict(want=want, host=norm(host, room), idle=idle_html, room=room)
        pg.context.browser.close(); o.context.browser.close()
        # ROM loader: assets missing -> loader; then a non-zip file
        ctx = br.new_context(locale=loc, viewport={'width': 1100, 'height': 760}); lp = ctx.new_page(); lp.set_default_timeout(120000)
        lp.route('**/assets/**', lambda r: r.fulfill(status=404, body='')); lp.on('pageerror', lambda e: fails.append(f'loader {tag}: {e}'))
        lp.goto(f'{URL}/index.html?sound=0{q}'); lp.wait_for_selector('#romload'); time.sleep(0.3)
        lt = lp.inner_text('#romload'); items += lp.evaluate(SCAN)
        lp.set_input_files('#rz', files=[{'name': 'x.zip', 'mimeType': 'application/zip', 'buffer': b'not a zip at all'}]); time.sleep(0.8)
        em = lp.inner_text('#romload .m'); items += lp.evaluate(SCAN); print('  loader:', lt.replace('\n', ' | ')[:160], '| err:', em)
        ok(('Selecione seu ssriders.zip' in lt and em == 'não é um arquivo zip') if want == 'pt' else ('Select your ssriders.zip' in lt and em == 'not a zip file'), f'{tag}: ROM loader + error text')
        if a.preview and q: lp.screenshot(path=os.path.join(a.preview, f'i18n_loader_{want}.png'))
        ctx.close()
        if want == 'en':
            lo = leftovers(items); ok(not lo, f'{tag}: no Portuguese left in EN ({len(items)} strings scanned)' + ('' if not lo else ' ' + json.dumps(lo[:8], ensure_ascii=False)))
        else:
            en = [v for k, v in items if re.search(r'\b(Create room|Join|Spectate|Player|Leave|Connecting|Message|Press)\b', v)]
            ok(not en, f'{tag}: no English UI words in PT ({len(items)} strings)' + ('' if not en else ' ' + json.dumps(en[:6])))
    # PT panels identical to the pre-i18n build (browser pt-BR, same signal server)
    if a.base and os.path.isdir(a.base):
        php2, URL2 = serve(a.base); time.sleep(1)
        try:
            bp = page('pt-BR', '', base=URL2); bp.keyboard.press('F7'); time.sleep(1.5); bp.click('#np-create'); bp.wait_for_function('SSRNETPLAY.session'); time.sleep(0.5)
            broom = bp.evaluate('SSRNETPLAY.state.room'); bhost = norm(bp.inner_html('#np'), broom)
            bp.evaluate('SSRNETPLAY.leave()'); time.sleep(0.3); bidle = bp.evaluate("document.querySelector('#np').innerHTML.replace(/<div id=\"np-list\">.*?<\\/div><\\/div>$/s, '')")
            bbtn = bp.inner_text('#npb'); bp.context.browser.close()
            for tag, r in results.items():
                if r['want'] != 'pt': continue
                ok(r['host'] == bhost, f'{tag}: host panel HTML identical to pre-i18n build')
                ok(r['idle'] == bidle, f'{tag}: idle panel HTML identical to pre-i18n build')
                if r['host'] != bhost: print(' base:', bhost[:600], '\n new:', r['host'][:600])
                if r['idle'] != bidle: print(' base:', bidle[:600], '\n new:', r['idle'][:600])
        finally: php2.terminate()
    else: print('skip baseline compare (no', a.base, ')')
    br.close()
finally:
    php.terminate(); shutil.rmtree(os.path.join(ROOT, 'web/net/rooms'), ignore_errors=True)
print('FAIL' if fails else 'PASS', fails[:6])
