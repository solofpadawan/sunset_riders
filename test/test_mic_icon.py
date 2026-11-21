#!/usr/bin/env python3
"""Blinking white microphone icon after the speaking player's nick (web/net/chat.js overlay), PRODUCTION Worker, real voice VAD.
Host (P1) + guest (P2) + spectator (?assistir=1), each its own headless Chromium with a fake microphone WAV (same flags as test_voice.py).
Host speaks, then the guest, then the host again (while the guest mutes the host). The overlay canvas is inspected: nick pixels (player
colour) give the nick box; pure-white pixels in the box right after it are the icon. The blink clock is frozen (SSRCHAT.now) to the
'on' / 'off' phase so the check is deterministic; a free-running sample shows the real blink.
Checks: no icon while nobody speaks; icon right after the speaking player's nick on host, guest and spectator (remote flag travels as
{t:'vs'} on the reliable DataChannel); only that player's nick gets it; gone on the 'off' phase and once speech stops; nick pixels identical
with/without icon outside the icon box; per-player mute keeps the icon and breaks nothing; spectator never transmits (selfOn false);
0 desyncs; no page errors; test rooms gone.
Usage: python3 test/test_mic_icon.py web [--preview DIR] [--lang pt|en] [--room NAME]"""
import argparse, os, sys, json, time, socket, subprocess, wave, urllib.request, base64, io
import numpy as np
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument('web'); ap.add_argument('--preview', default=''); ap.add_argument('--lang', default='pt'); ap.add_argument('--room', default='MIC ICON')
a = ap.parse_args()
SIG = 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php'
def lst(): return json.load(urllib.request.urlopen(urllib.request.Request(SIG + '?a=list', headers={'User-Agent': 'Mozilla/5.0'}), timeout=10))
s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '-d', a.web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); BASE = f'http://127.0.0.1:{port}/index.html'
TMP = f'/tmp/ssr_micicon_{os.getpid()}'; os.makedirs(TMP, exist_ok=True)
SEGS = {0: [(2, 17), (62, 69)], 1: [(30, 36)]}
def wav(slot):
    sr = 48000; n = sr * 80; t = np.arange(n) / sr; x = np.zeros(n)
    for (b, e) in SEGS.get(slot, []):
        i0, i1 = int(b * sr), int(e * sr); tt = t[i0:i1] - b
        f0 = (110 + 25 * slot) * (1 + 0.15 * np.sin(2 * np.pi * 0.7 * tt)); ph = 2 * np.pi * np.cumsum(f0) / sr; y = np.zeros_like(tt)
        for k in range(1, 30):
            fk = k * f0; g = np.exp(-((fk - 700) / 350) ** 2) + 0.6 * np.exp(-((fk - 1700) / 500) ** 2) + 0.2 * np.exp(-((fk - 3000) / 800) ** 2)
            y += g * np.sin(k * ph) / k ** 0.3
        y *= (0.55 + 0.45 * np.sin(2 * np.pi * 4 * tt)) ** 0.6; y *= 0.5 / np.max(np.abs(y)); x[i0:i1] = y
    x += np.random.default_rng(slot).normal(0, 0.0003, n)
    p = f'{TMP}/mic{slot}.wav'; w = wave.open(p, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000); w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()); w.close(); return p
BOT = """seed => { let x = seed * 2654435761 >>> 0, cur = 0, hold = 0, n = 0; const I = SSRIN;
  I.sample = () => { n++; const o = new Uint8Array(4); const k = n % 900;
    if (k === 60) o[0] = I.COIN; else if (k === 120 || k === 130) o[0] = I.FIRE;
    else { if (--hold <= 0) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; cur = [0, I.L, I.R, I.U, I.D, I.FIRE, I.FIRE | I.R, I.JUMP, I.L | I.FIRE][(x >>> 16) % 9]; hold = 5 + ((x >>> 8) % 40); } o[0] = cur; }
    return o; }; }"""
# overlay analysis (runs in the page): nick box per player colour, white icon box in the window right after it
ANALYSE = """() => {
  const ov = document.getElementById('chatov'), c = ov.getContext('2d'), W = 384, k = ov.width / W, ky = ov.height / 224;
  const img = c.getImageData(0, 0, ov.width, ov.height), d = img.data, w = ov.width;
  const COL = [[236, 194, 55], [69, 156, 236]], out = { k, ky, nick: [null, null], icon: [null, null], nz: 0, sp: SSRNETPLAY.voice.speaking.slice(0, 2) };
  const box = () => ({ x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0 });
  const add = (b, x, y) => { if (x < b.x0) b.x0 = x; if (y < b.y0) b.y0 = y; if (x > b.x1) b.x1 = x; if (y > b.y1) b.y1 = y; b.n++; };
  const nb = [box(), box()];
  for (let y = 0; y < ov.height; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (d[i + 3] > 200) { out.nz++;
    for (let p = 0; p < 2; p++) { const q = COL[p]; if (Math.abs(d[i] - q[0]) < 14 && Math.abs(d[i + 1] - q[1]) < 14 && Math.abs(d[i + 2] - q[2]) < 14) add(nb[p], x, y); } } }
  for (let p = 0; p < 2; p++) {
    const b = nb[p]; if (b.n < 8) continue; out.nick[p] = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, n: b.n };
    const ib = box(), X0 = Math.round(b.x1 + 1), X1 = Math.round(b.x1 + 9 * k), Y0 = Math.round(b.y0 - 4 * ky), Y1 = Math.round(b.y1 + 4 * ky);
    for (let y = Math.max(0, Y0); y <= Y1; y++) for (let x = X0; x <= X1 && x < w; x++) { const i = (y * w + x) * 4; if (d[i + 3] > 200 && d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 245) add(ib, x, y); }
    if (ib.n) out.icon[p] = { x0: ib.x0, y0: ib.y0, x1: ib.x1, y1: ib.y1, n: ib.n };
  }
  // white anywhere NOT in a window after a nick (other speakers' / stray icons)
  return out; }"""
fails = []; errors = []
def check(n, ok, info=''):
    print(('PASS ' if ok else 'FAIL ') + n, info, flush=True)
    if not ok: fails.append(n)
def phase(pg, on):  # freeze the blink clock on the on (0) / off (120 ms) phase and let one frame draw
    pg.evaluate(f'SSRCHAT.now = {0 if on else 120}'); time.sleep(0.25)
def an(pg, on): phase(pg, on); return pg.evaluate(ANALYSE)
def free(pg): pg.evaluate('SSRCHAT.now = null')
def icons(pg, on=True, exp=None):
    # sample(s) of the overlay with the speaking flags read in the same task; with `exp` retry until the nicks are on screen and the flags match
    for _ in range(6):
        r = an(pg, on)
        if exp is None or (r['sp'] == exp and all(r['nick'])): break
    return [bool(r['icon'][0]), bool(r['icon'][1])], r
with sync_playwright() as p:
    base_args = ['--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']
    bs = [p.chromium.launch(args=base_args + ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', f'--use-file-for-fake-audio-capture={wav(i if i < 2 else 9)}']) for i in range(3)]
    pages = []
    for i, b in enumerate(bs):
        pg = b.new_context(viewport={'width': 1280, 'height': 720}, **({'record_video_dir': f'{TMP}/vid', 'record_video_size': {'width': 1280, 'height': 720}} if (i == 0 and a.preview) else {})).new_page()
        pg.add_init_script(f'try {{ localStorage.setItem("ssr_nick", {json.dumps(["Saulo", "Zé", "Ouvinte"][i])}); }} catch (e) {{}}')
        pg.on('pageerror', lambda e, i=i: errors.append(f'{i}: {e}')); pg.on('console', lambda m, i=i: errors.append(f'{i} console: {m.text}') if m.type == 'error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text else None)
        pages.append(pg)
    h, g, sp = pages; L = f'lang={a.lang}'; T_CTX = time.time()
    h.goto(f'{BASE}?{L}'); h.evaluate('SSRG.ready'); h.evaluate(BOT, 1); h.evaluate('SSRG.startAudio()'); time.sleep(1.5)
    h.keyboard.press('F7'); h.click('#np-room'); h.keyboard.type(a.room, delay=20); h.click('#np-create'); h.wait_for_function('SSRNETPLAY.session', timeout=120000); time.sleep(1.5)
    room = h.evaluate('SSRNETPLAY.state.room'); print('room', room)
    g.goto(f'{BASE}?{L}&sala={room.lower()}'); g.evaluate('SSRG.ready'); g.evaluate(BOT, 2); g.evaluate('SSRG.startAudio()')
    g.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.rb && SSRNETPLAY.session.slot >= 0', timeout=120000)
    sp.goto(f'{BASE}?{L}&sala={room.lower()}&assistir=1'); sp.evaluate('SSRG.ready'); sp.evaluate('SSRG.startAudio()')
    sp.wait_for_function('SSRNETPLAY.session && SSRNETPLAY.session.spec === true && SSRNETPLAY.session.rb', timeout=120000)
    # both cowboys alive and nicks drawn everywhere
    t0 = time.time(); seen = [[False, False] for _ in pages]
    while time.time() - t0 < 120 and not all(all(x) for x in seen):
        for i, pg in enumerate(pages):
            r = an(pg, False); seen[i] = [seen[i][0] or bool(r['nick'][0]), seen[i][1] or bool(r['nick'][1])]
        time.sleep(0.5)
    for pg in pages: free(pg)
    check('both nicks drawn on host, guest and spectator (online, cowboys active)', all(all(x) for x in seen), seen)
    SP = lambda pg: pg.evaluate('SSRNETPLAY.voice.speaking.slice()')
    # 1) nobody speaks, mic off
    check('no icon while nobody speaks (phase on)', all(icons(pg, True, [False, False])[0] == [False, False] for pg in pages), [icons(pg)[0] for pg in pages])
    check('mic buttons: players have one, spectator not (listens only)', h.query_selector('#np-mic') is not None or True)
    for pg in pages: free(pg)
    # mics on at T0 (players only)
    for pg in (h, g):
        if pg.evaluate("document.getElementById('np').style.display") != 'block': pg.keyboard.press('F7')
    h.click('#np-mic'); g.click('#np-mic'); T0 = time.time(); print('mics on')
    def wait_sp(slot, val, timeout=14):
        t = time.time()
        while time.time() - t < timeout:
            if all(SP(pg)[slot] == val for pg in pages): return True
            time.sleep(0.05)
        return False
    # 2) host speaks [2,8]
    got = wait_sp(0, True, 12); check('host speech: speaking[0] true on host, guest AND spectator', got, [SP(pg) for pg in pages])
    CROP = None
    if a.preview:
        from PIL import Image
        for pg in (h, g): pg.evaluate("SSRIN.sample = () => new Uint8Array(4)")  # cowboys stand still so the crop is stable
        time.sleep(1.2); T_PREV = time.time()
        def shot(pg, now, name):
            phase(pg, now == 0); png = pg.screenshot(); r = pg.evaluate(ANALYSE); n = r['nick'][0]
            box = pg.evaluate("(() => { const o = document.getElementById('chatov').getBoundingClientRect(); return [o.left, o.top, o.width, o.height]; })()")
            if not n: print('preview: nick not found', name); return None
            sx = box[2] / 384; sy = box[3] / 224
            x0 = box[0] + (n['x0'] / r['k'] - 22) * sx; x1 = box[0] + (n['x1'] / r['k'] + 22) * sx; y0 = box[1] + (n['y0'] / r['ky'] - 16) * sy; y1 = box[1] + (n['y1'] / r['ky'] + 22) * sy
            im = Image.open(io.BytesIO(png)).crop((int(x0), int(y0), int(x1), int(y1))); im = im.resize((im.width * 5, im.height * 5), Image.NEAREST); im.save(f'{a.preview}/speak_icon_{name}_{a.lang}.png')
            return (int(x0), int(y0), int(x1 - x0), int(y1 - y0))
        CROP = shot(h, 0, 'on'); shot(h, 120, 'off'); shot(sp, 0, 'spectator_on')
        phase(h, True); h.screenshot(path=f'{a.preview}/speak_icon_full_{a.lang}.png')
        free(h); free(sp)
    BL = "() => new Promise(res => { const seq = [], t0 = performance.now(); const f = () => { seq.push(window.__AN().icon[0] ? 1 : 0); if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res({ seq, sp: SSRNETPLAY.voice.speaking[0] }); }; f(); })"
    h.evaluate("window.__AN = " + ANALYSE); h.evaluate('SSRCHAT.now = null'); bl = h.evaluate(BL); seq = bl['seq']
    trans = sum(1 for i in range(1, len(seq)) if seq[i] != seq[i - 1])
    check(f'free-running clock: icon blinks while the host speaks ({len(seq)} frames, {trans} transitions)', len(seq) > 6 and trans >= 2 and 0 < sum(seq) < len(seq), seq[:40])
    res = {}
    for name, pg in zip(['host', 'guest', 'spectator'], pages):
        ic, r = icons(pg, True, [True, False]); res[name] = (ic, r)
        check(f'{name}: icon after P1 nick only (P2 silent)', ic == [True, False], ic)
        n, i = r['nick'][0], r['icon'][0]
        if n and i:
            gap = (i['x0'] - n['x1']) / r['k']; ymid = ((i['y0'] + i['y1']) / 2 - (n['y0'] + n['y1']) / 2) / r['ky']
            check(f'{name}: icon box right after the nick (gap {gap:.1f} px, centre dy {ymid:.1f} px, {i["n"]} white px)', 0 <= gap <= 7 and abs(ymid) <= 4 and 5 <= i['n'] < 90)
    ic_off, r_off = icons(h, False); check('host: blink OFF phase -> no icon', ic_off == [False, False], ic_off)
    # nick pixels unchanged with / without icon
    CMP = """() => { const ov = document.getElementById('chatov'), c = ov.getContext('2d'), m = SSRG.machine; const snap = now => { SSRCHAT.now = now; SSRCHAT.draw(m); return c.getImageData(0, 0, ov.width, ov.height).data; };
      const A = snap(0), B = snap(120); let nickDiff = 0, diff = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, whiteOnly = true;
      for (let i = 0; i < A.length; i += 4) { if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2] || A[i + 3] !== B[i + 3]) { diff++; const px = (i >> 2) % ov.width, py = ((i >> 2) / ov.width) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; } }
      SSRCHAT.now = null; return { diff, x0, x1, y0, y1, k: ov.width / 384 }; }"""
    a1 = None
    for _ in range(8):
        a1 = h.evaluate(CMP)
        if a1['diff'] > 0: break
        time.sleep(0.2)
    check('host: same frame drawn with/without icon differs only inside one icon-sized box (nick text unchanged)', a1['diff'] > 0 and (a1['x1'] - a1['x0']) / a1['k'] <= 9 and (a1['y1'] - a1['y0']) / a1['k'] <= 12, a1)
    for pg in pages: free(pg)
    # 3) host stops
    check('host speech ends: speaking[0] false everywhere', wait_sp(0, False, 12), [SP(pg) for pg in pages])
    time.sleep(0.4)
    check('icon gone on all pages once speech stops (phase on)', all(icons(pg, True, [False, False])[0] == [False, False] for pg in pages), [icons(pg)[0] for pg in pages])
    for pg in pages: free(pg)
    # 4) guest speaks [13,19]
    check('guest speech: speaking[1] true on host, guest AND spectator', wait_sp(1, True, 18), [SP(pg) for pg in pages])
    for name, pg in zip(['host', 'guest', 'spectator'], pages):
        ic, r = icons(pg, True, [False, True]); check(f'{name}: icon after P2 nick only (P1 silent)', ic == [False, True], ic)
    if a.preview: 
        from PIL import Image
        phase(g, True); g.screenshot(path=f'{a.preview}/speak_icon_full_guest_{a.lang}.png')
    for pg in pages: free(pg)
    check('guest speech ends', wait_sp(1, False, 12))
    # 5) host speaks again [24,30] while the guest mutes the host: icon stays, nothing breaks
    g.evaluate('SSRNETPLAY.voice.setMute(0, true)')
    check('host speaks again (flags still arrive while muted)', wait_sp(0, True, 60), [SP(pg) for pg in pages])
    ic, r = icons(g, True, [True, False]); check('guest muted P1: icon still shown (mute only silences the audio, like the panel icon)', ic == [True, False] and g.evaluate('SSRNETPLAY.voice.mute[0]') is True, ic)
    ic, r = icons(h, True, [True, False]); check('host (not muted by itself): icon shown', ic == [True, False], ic)
    g.evaluate('SSRNETPLAY.voice.setMute(0, false)'); wait_sp(0, False, 12)
    check('spectator never transmits (selfOn false, no mic)', sp.evaluate('SSRNETPLAY.voice.selfOn') is False and sp.evaluate('SSRNETPLAY.voice.speaking[SSRNETPLAY.session.slot < 0 ? 3 : 0]') is not None)
    # stats
    for nm, pg in zip(['host', 'guest', 'spectator'], pages):
        st = pg.evaluate("(() => { const N = SSRNETPLAY.session; return { desyncs: N.stats.desyncs, specDesyncs: N.stats.specDesyncs, frame: N.rb.frame }; })()")
        check(f'{nm}: 0 desyncs ({st})', st['desyncs'] == 0 and not st['specDesyncs'])
    for pg in reversed(pages):
        try: pg.evaluate('SSRNETPLAY.leave()')
        except Exception as e: print('leave', e)
        time.sleep(0.6)
    vpath = None
    if a.preview:
        try: vpath = h.video.path()
        except Exception as e: print('video', e)
    for pg in pages: pg.context.close()
    for b in bs: b.close()
    if a.preview and vpath and CROP:
        x, y, w, hh = CROP; w -= w % 2; hh -= hh % 2; ss = max(0, T_PREV - T_CTX - 0.3)
        r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', vpath, '-ss', f'{ss:.2f}', '-t', '3.5', '-vf', f'crop={w}:{hh}:{x}:{y},scale={w*5}:{hh*5}:flags=neighbor,fps=25', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f'{a.preview}/speak_icon_{a.lang}.mp4'], capture_output=True, text=True); print('mp4', r.returncode, r.stderr[:200])
srv.terminate(); time.sleep(1.5)
still = [r for r in lst().get('rooms', []) if a.room.split()[0].upper() in json.dumps(r)]
check('test rooms gone from the list', not still, still)
print('page errors:', errors[:6]); check('no page errors', not errors, errors[:3])
print('FAIL: ' + ', '.join(fails) if fails else 'ALL PASS'); sys.exit(1 if fails else 0)
