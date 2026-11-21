// In-game chat (pt34u). TAB opens a text field, Enter sends, TAB/Esc cancels. The line appears as a speech bubble above
// the sender's character on every screen. Online it travels over the reliable DataChannel (session.chat / 't:c'), never
// through the rollback inputs, so it cannot desync the game. Offline (no room) it shows over P1 (local only).
// Bubbles are drawn on an overlay canvas over #screen (not by render.js), anchored to the player object read from the
// K053245 object RAM (see NOTES.md "Player positions"): object 57+6p at 0x180000+128*(57+6p):
//   word 0 (+0x00): 0x89xx/0x99xx while the player object is active; word 6 (+0x0c) X (screen x ≈ X-106);
//   word 4 (+0x08) Y (feet y ≈ 266-Y, includes the jump height, which is word 2 (+0x04)).
(function (G) {
  'use strict';
  const W = 288, H = 224, MAXC = 60;
  const COL = ['#ffd23c', '#4aa8ff', '#5adc6a', '#ff6b5a'];
  const bubbles = [null, null, null, null], recent = [], specLines = []; // spectator lines: top of the screen, tagged with the name
  // ---- player positions (game pixels); null when not on screen ----
  function playerPos(m, p) {
    if (!m || !m.sprR) return null;
    const o = (57 + 6 * p) * 64, w0 = m.sprR(o);
    if (((w0 >> 8) & 0xef) !== 0x89) return null; // 0x89 active, 0x99 active + flag (seen after respawn); others = dying/inactive
    const x = m.sprR(o + 6) - 106, feet = 266 - m.sprR(o + 4);
    if (x < -8 || x > W + 8 || feet < 24 || feet > H + 40) return null;
    return { x, feet, head: feet - 58 };
  }
  // ---- overlay ----
  let ov = null, oc = null, field = null, open = false, scr = null, painted = false;
  let namesSig = '', namesCache = null, nickW = [0, 0, 0, 0], specTag = null;
  function setup() {
    scr = document.getElementById('screen');
    ov = Object.assign(document.createElement('canvas'), { id: 'chatov' });
    ov.style.cssText = 'position:absolute;pointer-events:none;z-index:5';
    scr.after(ov); oc = ov.getContext('2d');
    const css = `#chatin{position:fixed;left:50%;bottom:8%;transform:translateX(-50%);width:min(520px,80vw);z-index:11;display:none;
      font:600 18px system-ui,sans-serif;padding:8px 12px;border-radius:10px;border:3px solid #ffd23c;background:rgba(10,6,2,.92);color:#fff;outline:none}
      #chatin::placeholder{color:#a99}`;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
    field = Object.assign(document.createElement('input'), { id: 'chatin', maxLength: MAXC, autocomplete: 'off', spellcheck: false, placeholder: (G.t ? G.t('chat.placeholder') : 'Mensagem (Enter envia, Esc cancela)') });
    document.body.appendChild(field);
    field.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const t = field.value; close(); send(t); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(); }
      e.stopPropagation();
    });
    field.addEventListener('blur', () => { if (open) close(); });
    addEventListener('keydown', e => {
      if (e.code !== 'Tab' || open) return;
      if (e.target && e.target.tagName === 'INPUT') return; // the F7 panel's fields keep normal TAB
      e.preventDefault(); openField();
    });
  }
  function mySlot() { const N = G.SSRNETPLAY && G.SSRNETPLAY.session; return N ? N.slot : 0; }
  function openField() {
    open = true; G.SSRIN.block = true; for (const k in G.SSRIN.held) G.SSRIN.held[k] = 0;
    const s = Math.max(0, mySlot()); field.style.borderColor = COL[s]; field.value = '';
    field.style.display = 'block'; field.focus();
  }
  function close() { if (!open) return; open = false; G.SSRIN.block = false; field.style.display = 'none'; field.blur(); try { G.focus(); } catch (e) {} }
  const localRl = G.SSRSESSION ? new G.SSRSESSION.RateLimit() : null;
  // send a line: online through the session (it echoes a 'chat' event that calls show), offline as P1
  function send(text) {
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session;
    if (N) return N.chat(text);
    const x = G.SSRSESSION.sanitize(text); if (!x || !localRl.ok(performance.now())) return null;
    show(0, x); return x;
  }
  function show(slot, text, name) {
    const x = G.SSRSESSION.sanitize(text); if (!x || slot < -1 || slot > 3) return;
    if (slot === -1) {
      const n = G.SSRSESSION.localName(G.SSRSESSION.sanitize(name || (G.t ? G.t('chat.spectator') : 'Espectador')).slice(0, 20));
      specLines.push({ name: n, text: x, t0: performance.now(), dur: 5000 }); if (specLines.length > 3) specLines.shift();
      recent.push({ slot, name: n, text: x, t: Date.now() }); if (recent.length > 50) recent.shift(); return;
    }
    bubbles[slot] = { text: x, t0: performance.now(), dur: 4000 + Math.max(0, x.length - 20) * 60 };
    recent.push({ slot, text: x, t: Date.now() }); if (recent.length > 50) recent.shift();
  }
  function wrap(ctx, text, maxW) {
    const words = text.split(' '), lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
      while (ctx.measureText(cur).width > maxW && cur.length > 1) { let k = cur.length - 1; while (k > 1 && ctx.measureText(cur.slice(0, k)).width > maxW) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); }
    }
    if (cur) lines.push(cur); return lines;
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function sessionNames(N) {
    if (!N || !N.rb) { namesSig = ''; namesCache = null; return null; }
    const lang = (G.SSRI18N && G.SSRI18N.language) || '';
    let sig;
    if (N.role === 'host' && N.links) {
      sig = 'h|' + lang + '|' + (N.name || '');
      for (const l of N.links) if (l.slot > 0) sig += '|' + l.slot + ':' + (l.name || '');
    } else if (N.nameList) {
      sig = 'g|' + lang + '|' + N.nameList.join('|');
    } else {
      sig = 'f|' + lang + '|' + N.names().join('|');
    }
    if (sig !== namesSig) {
      namesSig = sig;
      namesCache = N.names().map(G.SSRSESSION.localName);
      nickW = [0, 0, 0, 0];
    }
    return namesCache;
  }
  function expire(now) {
    for (let p = 0; p < 4; p++) if (bubbles[p] && now - bubbles[p].t0 > bubbles[p].dur) bubbles[p] = null;
    for (let i = 0; i < specLines.length; i++) if (now - specLines[i].t0 > specLines[i].dur) specLines.splice(i--, 1);
  }
  function hintWants(m) {
    const H = G.SSRHINT; if (!H || H.off) return false;
    if (H.waitText && H.waitText()) return true;
    return !!(H.text && H.text(m));
  }
  function wantsDraw(m, now, names) {
    if (bubbles.some(Boolean) || specLines.length) return true;
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session;
    if (N && N.spec) return true;
    if (hintWants(m)) return true;
    if (names) for (let p = 0; p < 4; p++) if (names[p] && !bubbles[p] && playerPos(m, p)) return true;
    return false;
  }
  // wrap + measureText + tag size: reused until the text, name or on/off-screen mode changes; the frame only updates x/y
  function layoutBubble(c, b, p, name, onScreen) {
    const mode = onScreen ? 'on' : 'hud', nm = name || '';
    if (b.lay && b.lay.mode === mode && b.lay.text === b.text && b.lay.name === nm) return b.lay;
    c.font = '600 8px system-ui, sans-serif';
    const lh = 9.5, lines = wrap(c, b.text, onScreen ? 118 : 60);
    const tw = Math.max(...lines.map(l => c.measureText(l).width)), w = Math.ceil(tw) + 10, h = lines.length * lh + 7;
    c.font = '800 6px system-ui, sans-serif';
    const tag = 'P' + (p + 1) + (nm ? ' ' + nm : ''), tgw = c.measureText(tag).width + 5;
    return (b.lay = { mode, text: b.text, name: nm, lines, tw, w, h, lh, tag, tgw });
  }
  function draw(m) {
    if (!ov) return;
    const now = performance.now();
    expire(now);
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session, names = sessionNames(N);
    if (!wantsDraw(m, now, names)) {
      // keep hint.shown in sync when we skip SSRHINT.draw (chat open, player in, or SSRHINT.off)
      if (G.SSRHINT) { G.SSRHINT.shown = null; G.SSRHINT.waiting = null; }
      if (painted) { oc.setTransform(1, 0, 0, 1, 0, 0); oc.clearRect(0, 0, ov.width, ov.height); painted = false; }
      return;
    }
    if (!scr) scr = document.getElementById('screen');
    const cw = parseFloat(scr.style.width) || W, ch = parseFloat(scr.style.height) || H;
    const dpr = G.devicePixelRatio || 1, bw = Math.round(cw * dpr), bh = Math.round(ch * dpr);
    if (ov.width !== bw || ov.height !== bh) { ov.width = bw; ov.height = bh; }
    ov.style.left = scr.style.left; ov.style.top = scr.style.top; ov.style.width = cw + 'px'; ov.style.height = ch + 'px';
    const c = oc, k = bw / W, ky = bh / H; // 4:3 modes (gfx.js): non-square game pixels
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, bw, bh);
    c.setTransform(k, 0, 0, ky, 0, 0);
    drawSpec(c, now);
    if (G.SSRHINT) G.SSRHINT.draw(c, m, now); // coin hint (net/hint.js), also the spectator's free-slot notice
    const nk = []; if (names) for (let p = 0; p < 4; p++) if (names[p] && !bubbles[p]) drawNick(c, m, p, names[p], nk, now);
    painted = true;
    if (!bubbles.some(b => b)) return;
    const placed = [];
    for (let p = 0; p < 4; p++) {
      const b = bubbles[p]; if (!b) continue;
      const age = now - b.t0; if (age > b.dur) { bubbles[p] = null; continue; }
      const alpha = Math.min(1, age / 120, (b.dur - age) / 600);
      const pos = playerPos(m, p), tail = 6;
      const lay = layoutBubble(c, b, p, names && names[p], !!pos);
      const { lines, w, h, lh, tag, tgw } = lay;
      let ax, ay, up; // anchor (tail tip), bubble above (up=false) or below the HUD (up=true)
      if (pos) { ax = pos.x; ay = pos.head; up = false; if (ay - tail - h < 18) { ay = 18 + tail + h; } }
      else { ax = 72 * p + 30; ay = 20; up = true; }
      let bx = Math.round(Math.min(W - w - 2, Math.max(2, ax - w / 2))), by = Math.round(up ? ay + tail : ay - tail - h);
      // two players close together: push this bubble past the ones already drawn (the tail stretches)
      for (let tries = 0; tries < 4; tries++) {
        const hit = placed.find(r => bx < r.x + r.w + 1 && bx + w + 1 > r.x && by < r.y + r.h + 6 && by + h + 6 > r.y);
        if (!hit) break;
        by = up ? hit.y + hit.h + 8 : hit.y - h - 8;
        if (!up && by < 2) { by = hit.y + hit.h + 8; up = true; }
      }
      placed.push({ x: bx, y: by, w, h, p, ax, ay, up, lines, lh, alpha, tag, tgw });
    }
    // tails first, then the bodies, so a stretched tail never crosses another bubble's text
    for (const r of placed) {
      c.globalAlpha = r.alpha; c.lineWidth = 1.5; c.strokeStyle = COL[r.p]; c.fillStyle = 'rgba(255,255,255,0.96)';
      const tx = Math.min(r.x + r.w - 6, Math.max(r.x + 6, r.ax));
      c.beginPath();
      if (r.up && r.ay <= r.y) { c.moveTo(tx - 3.5, r.y + 2); c.lineTo(tx, r.ay); c.lineTo(tx + 3.5, r.y + 2); }
      else if (r.up) { c.moveTo(tx - 3.5, r.y + 2); c.lineTo(tx, r.y - 5); c.lineTo(tx + 3.5, r.y + 2); }
      else { c.moveTo(tx - 3.5, r.y + r.h - 2); c.lineTo(tx, r.ay); c.lineTo(tx + 3.5, r.y + r.h - 2); }
      c.fill(); c.stroke();
    }
    for (const r of placed) {
      const { x: bx, y: by, w, h, p, lines, lh } = r;
      c.globalAlpha = r.alpha; c.lineWidth = 1.5; c.strokeStyle = COL[p]; c.fillStyle = 'rgba(255,255,255,0.96)';
      rr(c, bx, by, w, h, 4); c.fill(); c.stroke();
      // open the tail into the body: cover the border stroke across the tail base (white, no stroke)
      const tx = Math.min(bx + w - 6, Math.max(bx + 6, r.ax)); c.beginPath();
      if (r.up) { c.moveTo(tx - 2.6, by + 1.6); c.lineTo(tx, by - 2.2); c.lineTo(tx + 2.6, by + 1.6); }
      else { c.moveTo(tx - 2.6, by + h - 1.6); c.lineTo(tx, by + h + 2.2); c.lineTo(tx + 2.6, by + h - 1.6); }
      c.closePath(); c.fill();
      c.font = '600 8px system-ui, sans-serif';
      c.fillStyle = '#1a1208'; c.textBaseline = 'top';
      lines.forEach((l, i) => c.fillText(l, bx + 5, by + 4 + i * lh));
      c.font = '800 6px system-ui, sans-serif'; const tag = r.tag, tgw = r.tgw;
      c.fillStyle = COL[p]; rr(c, bx - 1, by - 5, tgw, 7, 2); c.fill();
      c.fillStyle = '#000'; c.fillText(tag, bx + 1.5, by - 4.2);
    }
    c.globalAlpha = 1;
  }
  // White mic icon (procedural, no bitmap) just after the nick, vertically centred on the 6 px text
  // (baseline y, centre ~ y-3). Dark outline like the nick so it stays readable on any background.
  const MIC_BLINK_MS = 120, MIC_GAP = 2, MIC_W = 5;
  let nowOverride = null; // tests: fixed clock for the blink phase
  function micBlinkOn(t) { return ((t / MIC_BLINK_MS) | 0) % 2 === 0; }
  function drawMicIcon(c, left, y) {
    const cx = left + 2.3, cy = y - 3, hw = 1.15;
    const y0 = cy - 2.1, y1 = cy - 0.35;
    c.save();
    c.globalAlpha = 0.95;
    c.lineJoin = 'round'; c.lineCap = 'round';
    const head = () => { c.beginPath(); c.arc(cx, y0, hw, Math.PI, 0, false); c.arc(cx, y1, hw, 0, Math.PI, false); c.closePath(); };
    head(); c.lineWidth = 2.35; c.strokeStyle = 'rgba(0,0,0,.85)'; c.stroke();
    head(); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 0.35; c.strokeStyle = '#fff'; c.stroke();
    const stand = (w, col) => {
      c.lineWidth = w; c.strokeStyle = col;
      c.beginPath(); c.arc(cx, y1, 1.85, 0.12 * Math.PI, 0.88 * Math.PI, false); c.stroke();
      c.beginPath(); c.moveTo(cx, cy + 1.55); c.lineTo(cx, cy + 2.5);
      c.moveTo(cx - 1.25, cy + 2.5); c.lineTo(cx + 1.25, cy + 2.5); c.stroke();
    };
    stand(2.55, 'rgba(0,0,0,.85)'); stand(0.7, '#fff');
    c.restore();
  }
  // nickname over the head (player colour, dark outline); hidden while the player object is not active/on screen.
  // The name string, font, colour and position never change when a mic is shown: the icon is drawn to the right of the
  // already-placed text (collision still uses the nick width alone).
  function drawNick(c, m, p, name, nk, now) {
    const pos = playerPos(m, p); if (!pos) return;
    c.font = '700 6px system-ui, sans-serif'; c.textBaseline = 'bottom'; c.textAlign = 'center'; c.globalAlpha = 0.9;
    let w = nickW[p]; if (!w) w = nickW[p] = c.measureText(name).width;
    const x = Math.min(W - w / 2 - 2, Math.max(w / 2 + 2, pos.x)); let y = Math.max(26, pos.head - 2);
    for (let i = 0; i < 4; i++) { const hit = nk.find(r => Math.abs(r.x - x) < (r.w + w) / 2 + 2 && Math.abs(r.y - y) < 7); if (!hit) break; y = hit.y - 7; }
    nk.push({ x, y, w });
    c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineJoin = 'round'; c.strokeText(name, x, y);
    c.fillStyle = COL[p]; c.fillText(name, x, y); c.textAlign = 'left'; c.globalAlpha = 1;
    const vv = G.SSRNETPLAY && G.SSRNETPLAY.voice;
    if (vv && vv.speaking && vv.speaking[p] && micBlinkOn(nowOverride != null ? nowOverride : now)) drawMicIcon(c, x + w / 2 + MIC_GAP, y);
  }
  // spectator overlay: an "ASSISTINDO" tag (+ free slot notice) for the spectator itself, and the spectators' chat lines
  function drawSpec(c, now) {
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session;
    c.textBaseline = 'top';
    if (N && N.spec) {
      c.globalAlpha = 0.85; c.font = '800 7px system-ui, sans-serif';
      const t = G.t ? G.t('chat.watching') : 'ASSISTINDO';
      if (!specTag || specTag.t !== t) specTag = { t, w: c.measureText(t).width + 8 };
      const w = specTag.w; c.fillStyle = 'rgba(0,0,0,.6)'; rr(c, W - w - 3, H - 13, w, 10, 3); c.fill();
      c.fillStyle = '#9fe0ff'; c.fillText(t, W - w + 1, H - 11.5);
    }
    let y = 30;
    for (let i = 0; i < specLines.length; i++) {
      const l = specLines[i], age = now - l.t0; if (age > l.dur) { specLines.splice(i--, 1); continue; }
      c.globalAlpha = Math.min(1, age / 120, (l.dur - age) / 600);
      if (!l.lay || l.lay.text !== l.text || l.lay.name !== l.name) {
        c.font = '700 6px system-ui, sans-serif'; const tw = c.measureText(l.name).width;
        c.font = '600 7px system-ui, sans-serif'; const lines = wrap(c, l.text, 200), mw = Math.max(...lines.map(x => c.measureText(x).width));
        l.lay = { text: l.text, name: l.name, lines, tw, mw };
      }
      const tag = l.name, { lines, tw, mw } = l.lay;
      const w = Math.ceil(Math.max(mw, tw)) + 10, h = lines.length * 8.5 + 11, x = Math.round((W - w) / 2);
      c.fillStyle = 'rgba(15,25,40,.85)'; c.strokeStyle = '#9fe0ff'; c.lineWidth = 1; rr(c, x, y, w, h, 3); c.fill(); c.stroke();
      c.fillStyle = '#9fe0ff'; c.font = '700 6px system-ui, sans-serif'; c.fillText(tag, x + 5, y + 2);
      c.fillStyle = '#fff'; c.font = '600 7px system-ui, sans-serif'; lines.forEach((t, j) => c.fillText(t, x + 5, y + 10 + j * 8.5));
      y += h + 3;
    }
    c.globalAlpha = 1;
  }
  G.SSRCHAT = { specLines, show, send, draw, playerPos, recent, bubbles, get open() { return open; }, openField, close, COL, MIC_BLINK_MS, MIC_GAP, MIC_W, micBlinkOn, get now() { return nowOverride; }, set now(v) { nowOverride = v; } };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', setup); else setup();
})(window);
