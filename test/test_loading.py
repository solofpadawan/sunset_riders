#!/usr/bin/env python3
"""Loading message: one centred overlay (#loadmsg) on the game canvas (#screen) naming the current boot step, gone at the first drawn frame,
boot errors shown in the same place and left visible. Headless Chromium, assets served by a local http.server; requests under /assets/ are
HELD by page.route and released stage by stage so every step can be observed (no sleeps on timing).
Checks, in pt, en and es (?lang=): the 4 step texts in order (rom -> gfx -> engine -> sound), each visible and centred on #screen (centre of the
overlay vs centre of the canvas rect, tolerance 2 px) in a normal window and in a different-size window, re-centred when the window is resized
during a step; text style (white, 15px, 600, rgba(0,0,0,.6), padding 8px 16px, radius 8px, no border, no animation); hidden at the first drawn frame
(never visible once a frame has been simulated), game runs on; boot errors (assets/gfx_tiles.bin 404, assets/gfx/tiles.bin 404) shown at the same
place, still visible 1.5 s later, game does not start; the sound hint (#sndhint) never overlaps it (loading already gone); ?sound=0 skips the sound step;
no page errors besides the simulated ones.
Usage: python3 test/test_loading.py web [--preview DIR]"""
import argparse, sys, time, socket, subprocess
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--preview', default='')
a = ap.parse_args()
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'
fails = []
def check(name, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + name, info, flush=True)
    if not ok: fails.append(name)
TXT = {
  'pt': ['Carregando a ROM…', 'Carregando os gráficos…', 'Iniciando o motor…', 'Preparando o som…'],
  'en': ['Loading the ROM…', 'Loading the graphics…', 'Starting the engine…', 'Preparing the sound…'],
  'es': ['Cargando la ROM…', 'Cargando los gráficos…', 'Iniciando el motor…', 'Preparando el sonido…'],
}
ERR = {'pt': 'Erro ao carregar: ', 'en': 'Loading error: ', 'es': 'Error al cargar: '}
WATCH = """() => { window.__viol = 0; const f = () => { try { if (SSRG.frame > 0 && SSRLOAD.visible) window.__viol++; } catch (e) {} requestAnimationFrame(f); }; requestAnimationFrame(f); }"""
GEOM = """() => { const m = document.getElementById('loadmsg'), c = document.getElementById('screen');
  if (!m) return null; const r = m.getBoundingClientRect(), k = c.getBoundingClientRect(), cs = getComputedStyle(m);
  return { vis: cs.visibility === 'visible' && cs.display !== 'none' && r.width > 0, text: m.textContent, cx: r.left + r.width / 2, cy: r.top + r.height / 2,
    kx: k.left + k.width / 2, ky: k.top + k.height / 2, w: r.width, h: r.height, kw: k.width, kh: k.height, iw: innerWidth, ih: innerHeight,
    color: cs.color, size: cs.fontSize, weight: cs.fontWeight, bg: cs.backgroundColor, pad: cs.padding, rad: cs.borderRadius, bw: cs.borderTopWidth, anim: cs.animationName, trans: cs.transitionDuration,
    inside: r.left >= k.left - 1 && r.right <= k.right + 1 && r.top >= k.top - 1 && r.bottom <= k.bottom + 1 } }"""
def centred(g, tol=2): return g and abs(g['cx'] - g['kx']) <= tol and abs(g['cy'] - g['ky']) <= tol
def held_page(br, lang, vp, extra='', fail404=None):
    pg = br.new_page(viewport=vp); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    held = []
    def h(route):
        u = route.request.url
        if fail404 and fail404 in u: return route.fulfill(status=404, body='nope')
        held.append(route)
    pg.route('**/assets/**', h)
    pg.goto(f'{BASE}?lang={lang}{extra}', wait_until='commit')
    return pg, held, errs
def wait_held(pg, held, n=1, to=8):
    t0 = time.time()
    while time.time() - t0 < to and len(held) < n: pg.wait_for_timeout(50)
    pg.wait_for_timeout(150)
def release(held):
    for r in held: r.continue_()
    held.clear()
def snap(pg): return pg.evaluate(GEOM)
def style_ok(g): return (g['color'] == 'rgb(255, 255, 255)' and g['size'] == '15px' and g['weight'] == '600' and g['bg'] == 'rgba(0, 0, 0, 0.6)' and g['pad'] == '8px 16px'
                         and g['rad'] == '8px' and g['bw'] == '0px' and g['anim'] == 'none' and g['trans'] in ('0s', ''))
try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--autoplay-policy=document-user-activation-required'])
        for lang in ('pt', 'en', 'es'):
            for vp in ({'width': 1280, 'height': 720}, {'width': 900, 'height': 760}):
                tag = f'{lang} {vp["width"]}x{vp["height"]}'
                pg, held, errs = held_page(br, lang, vp)
                pg.wait_for_function('window.SSRLOAD', timeout=5000); pg.evaluate(WATCH)
                seen = []
                for i, need in enumerate((1, 2, 4, 2)):
                    wait_held(pg, held, need); g = snap(pg); seen.append(g['text'] if g else None)
                    check(f'{tag}: step {i + 1} text', g and g['text'] == TXT[lang][i], g and g['text'])
                    check(f'{tag}: step {i + 1} visible, centred on the canvas, inside it', g and g['vis'] and centred(g) and g['inside'], g and (round(g['cx'] - g['kx'], 1), round(g['cy'] - g['ky'], 1)))
                    if i == 0: check(f'{tag}: style', g and style_ok(g), g and {k: g[k] for k in ('color', 'size', 'weight', 'bg', 'pad', 'rad', 'bw', 'anim')})
                    if i == 2 and vp['width'] == 1280:
                        if a.preview and lang in ('pt', 'en'): pg.screenshot(path=f'{a.preview}/loading_{lang}.png')
                        # window resized during a step: the overlay follows the canvas
                        pg.set_viewport_size({'width': 800, 'height': 600}); pg.wait_for_timeout(200); g2 = snap(pg)
                        check(f'{tag}: follows resize (800x600)', g2 and g2['vis'] and centred(g2) and g2['kw'] < g['kw'], g2 and (round(g2['cx'] - g2['kx'], 1), round(g2['cy'] - g2['ky'], 1)))
                        pg.set_viewport_size({'width': 1280, 'height': 720}); pg.wait_for_timeout(200)
                        g3 = snap(pg); check(f'{tag}: follows resize back', centred(g3) and abs(g3['kw'] - g['kw']) < 2)
                    release(held)
                pg.wait_for_function('SSRG.frame > 30', timeout=15000); pg.wait_for_timeout(200)
                g = snap(pg); viol = pg.evaluate('window.__viol')
                check(f'{tag}: hidden once the game draws', g and not g['vis'] and g['text'] == '' and pg.evaluate('SSRLOAD.finished'), g and g['text'])
                check(f'{tag}: never visible after a simulated frame', viol == 0, viol)
                check(f'{tag}: steps in order', pg.evaluate('SSRLOAD.history.filter((k, i, a) => a.indexOf(k) === i)') == ['load.rom', 'load.gfx', 'load.engine', 'load.sound'], pg.evaluate('SSRLOAD.history'))
                check(f'{tag}: no page errors', not errs, errs)
                if lang == 'pt' and vp['width'] == 1280:
                    # sound hint (autoplay blocked) comes after the loading message is gone: they never show together
                    pg.wait_for_timeout(1500); pg.evaluate("SSRG.audio && SSRG.audio.ac && SSRG.audio.ac.state === 'running' && SSRG.audio.ac.suspend()")
                    t0 = time.time()
                    while time.time() - t0 < 6 and not pg.evaluate("(() => { const e = document.getElementById('sndhint'); return !!e && getComputedStyle(e).display === 'block'; })()"): pg.wait_for_timeout(100)
                    both = pg.evaluate("(() => { const e = document.getElementById('sndhint'); return !!e && getComputedStyle(e).display === 'block' && SSRLOAD.visible; })()")
                    hint = pg.evaluate("(() => { const e = document.getElementById('sndhint'); return !!e && getComputedStyle(e).display === 'block'; })()")
                    check(f'{tag}: #sndhint shows and the loading message is not visible with it', hint and not both, (hint, both))
                pg.close()
        # ?sound=0: no sound step
        pg, held, errs = held_page(br, 'en', {'width': 1280, 'height': 720}, '&sound=0')
        for need in (1, 2, 4): wait_held(pg, held, need); release(held)
        pg.wait_for_function('SSRG.frame > 5', timeout=15000)
        check('sound=0: no sound step', 'load.sound' not in pg.evaluate('SSRLOAD.history'), pg.evaluate('SSRLOAD.history')); pg.close()
        # boot errors: same place, stay visible
        for lang in ('pt', 'en', 'es'):
            for what, url, tail in (('engine asset', 'assets/gfx_tiles.bin', 'assets/gfx_tiles.bin 404'), ('graphics', 'assets/gfx/tiles.bin', 'assets/gfx/tiles.bin 404')):
                pg, held, errs = held_page(br, lang, {'width': 1280, 'height': 720}, fail404=url)
                pg.wait_for_function('window.SSRLOAD', timeout=5000)
                wait_held(pg, held, 1); g0 = snap(pg)
                for need in (2, 4):
                    release(held)
                    t0 = time.time()
                    while time.time() - t0 < 5 and not held and not pg.evaluate('SSRLOAD.failed'): pg.wait_for_timeout(50)
                    if pg.evaluate('SSRLOAD.failed'): break
                release(held)
                try: pg.wait_for_function('SSRLOAD.failed', timeout=8000)
                except Exception: pass
                pg.wait_for_timeout(1500); g = snap(pg)
                check(f'{lang} {what} 404: error text', g and g['text'] == ERR[lang] + tail, g and g['text'])
                check(f'{lang} {what} 404: visible, centred, same place as the loading message', g and g['vis'] and centred(g) and g['inside'] and abs(g['kx'] - g0['kx']) < 1 and abs(g['ky'] - g0['ky']) < 1, g and (round(g['cx'] - g['kx'], 1), round(g['cy'] - g['ky'], 1)))
                check(f'{lang} {what} 404: game did not start, message not removed', pg.evaluate('SSRG.frame') == 0 and not pg.evaluate('SSRLOAD.finished'))
                check(f'{lang} {what} 404: same style', g and style_ok(g))
                if a.preview and what == 'graphics' and lang in ('pt', 'en'): pg.screenshot(path=f'{a.preview}/loading_error_{lang}.png')
                check(f'{lang} {what} 404: only the boot rejection as page error', all('404' in e for e in errs), errs)
                pg.close()
        br.close()
finally:
    srv.terminate()
print('FAILS:', fails if fails else 'none'); sys.exit(1 if fails else 0)
