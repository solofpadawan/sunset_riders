// Coin hint (pt63u): "Press 5 to insert a coin, then Z to join" at the bottom centre while the LOCAL player's slot is
// free. Overlay only (drawn by chat.js on #chatov): reads object RAM, never writes the sim, inputs, rollback or hashes.
// Language via i18next (web/i18n/: ?lang=, then navigator.languages). Wording follows the last used device (keyboard / gamepad).
// After a coin key press (local, not read from RAM) it switches to "Press Z to join" until the player is in.
(function (G) {
  'use strict';
  const W = 288, H = 224;
  const t = (k, o) => (G.t || (x => x))(k, o);
  const TXT = () => ({ kb: t('hint.kb'), pad: t('hint.pad'), kbJ: t('hint.kbJ'), padJ: t('hint.padJ'), vaga: t('hint.vaga'), vagaPad: t('hint.vagaPad') });
  let dev = 'kb', coined = false, coinT = 0, padSeen = false;
  addEventListener('keydown', e => {
    dev = 'kb';
    if (e.code === 'Digit5') { coined = true; coinT = performance.now(); }
  }, true);
  function pollPads() {
    const pads = (G.navigator && navigator.getGamepads) ? navigator.getGamepads() : [];
    let any = false;
    for (const p of pads || []) {
      if (!p || !p.connected) continue; any = true;
      const act = p.buttons.some(b => b && b.pressed) || p.axes.some(a => Math.abs(a) > 0.5);
      if (act) dev = 'pad';
      if (p.buttons[8] && p.buttons[8].pressed) { coined = true; coinT = performance.now(); }
    }
    if (any && !padSeen) dev = 'pad'; // a pad just appeared: use its wording until a key is pressed
    padSeen = any; if (!any && dev === 'pad') dev = 'kb';
  }
  function active(m, p) { if (!m || !m.sprR) return false; return ((m.sprR((57 + 6 * p) * 64) >> 8) & 0xef) === 0x89; }
  // text to show now, or null
  function text(m) {
    const N = G.SSRNETPLAY && G.SSRNETPLAY.session;
    if (!m || !m.sprR || (G.SSRCHAT && G.SSRCHAT.open) || G.SSRHINT.off) return null;
    pollPads();
    const pad = dev === 'pad', X = TXT();
    if (N && N.spec) return N.vaga && !N.watchOnly ? (pad ? X.vagaPad : X.vaga) : null;
    const slot = N ? N.slot : 0; if (slot < 0 || slot > 3) return null;
    if (active(m, slot)) { coined = false; return null; }
    if (coined && performance.now() - coinT > 60000) coined = false;
    return coined ? (pad ? X.padJ : X.kbJ) : (pad ? X.pad : X.kb);
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  // guest waiting for the host's state (pt77u: the game area was plain black while connecting).
  // Reads the language-independent phase SSRNETPLAY.state.wait (set by ui.js), not the translated message.
  function waitText() {
    const P = G.SSRNETPLAY, N = P && P.session; if (!N || N.role !== 'guest' || N.rb) return null;
    const w = (P.state && P.state.wait) || '';
    if (w === 'relay') return [t('hint.wait.relay'), ''];
    if (w === 'fail') return [t('hint.wait.fail'), t('hint.wait.fail2')];
    if (w === 'receiving') return [t('hint.wait.receiving'), ''];
    return [t('hint.wait.connecting'), ''];
  }
  function draw(c, m, now) {
    const wt = waitText(); G.SSRHINT.waiting = wt ? wt[0] : null;
    if (wt) { c.save(); c.globalAlpha = 1; c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.globalAlpha = 0.75 + 0.25 * Math.cos(now / 400); c.fillStyle = '#ffc861'; c.font = '700 11px system-ui, sans-serif'; c.fillText(wt[0], W / 2, H / 2 - 6);
      if (wt[1]) { c.globalAlpha = 0.9; c.fillStyle = '#f3e2c0'; c.font = '600 8px system-ui, sans-serif'; c.fillText(wt[1], W / 2, H / 2 + 10); }
      c.restore(); G.SSRHINT.shown = null; return; }
    const tx = text(m); G.SSRHINT.shown = tx; if (!tx) return;
    const a = 0.85 + 0.15 * Math.cos(now / 450); // gentle pulse
    c.save(); c.textBaseline = 'middle'; c.font = '700 7px system-ui, sans-serif';
    const w = Math.ceil(c.measureText(tx).width) + 12, h = 11, x = Math.round((W - w) / 2), y = H - h - G.SSRHINT.bottom;
    c.globalAlpha = 0.62; c.fillStyle = '#000'; rr(c, x, y, w, h, 3); c.fill();
    c.globalAlpha = a; c.fillStyle = '#ffe9a8'; c.fillText(tx, x + 6, y + h / 2 + 0.5);
    c.restore();
  }
  G.SSRHINT = { draw, text, get TXT() { return TXT(); }, get PT() { return !!(G.SSRI18N && G.SSRI18N.language === 'pt'); }, off: false, shown: null, waiting: null, waitText, bottom: 2, get dev() { return dev; }, set dev(v) { dev = v; }, get coined() { return coined; } };
  if (G.SSRGFX && G.SSRGFX.layout) G.SSRGFX.layout();
})(window);
