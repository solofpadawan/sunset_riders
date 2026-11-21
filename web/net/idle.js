// Host idle auto-close (2026-11-12, Saulo). WEB ONLY, HOST ONLY: a room whose host forgot the tab open must not stay listed for hours (the Worker keeps the
// room alive as long as the host's heartbeat runs). Never runs in the desktop app (app: / Electron), for spectators, players or local play.
// The host leaves the room through the same path as "Sair da sala" (SSRNETPLAY.leave(): Worker 'leave' with keepalive + transport close), so the room
// disappears from ?a=list and the remote players get the existing "host left" behaviour.
// Closes after IDLE_MS with NO local input (key, pointer, touch, gamepad) AND no remote player input (a real change in a remote player's input byte,
// Session.noteRemote: neutral frames do not count), OR after IDLE_MS with the tab hidden (document.hidden) without interruption. A warning with a countdown
// is shown WARN_MS before; any local input (or the tab becoming visible, or remote input) cancels it. Coming back to a visible tab restarts both timers.
// Timing uses Date.now() from a Web Worker timer (setInterval fallback), NOT the game loop: requestAnimationFrame stops in a hidden tab and the page
// timers are throttled there (Chrome's intensive throttling can delay them by a minute). The Worker's timer is not throttled that way.
// ?idletest=1: IDLE_MS = 20 s, WARN_MS = 5 s (tests/debug). Nothing here touches the simulation, rollback, inputs, hashes or the Worker protocol.
(function () {
  'use strict';
  // ---- easy-to-adjust constants ----
  const IDLE_MS = 10 * 60 * 1000;   // inactivity (or hidden tab) before the room is closed
  const WARN_MS = 60 * 1000;        // warning shown this long before closing
  const CLOSED_MS = 12 * 1000;      // how long the "room closed" notice stays on screen
  const TEST = { IDLE_MS: 20 * 1000, WARN_MS: 5 * 1000 };  // ?idletest=1
  const PAD_POLL_MS = 250, TICK_MS = 1000;

  if (location.protocol === 'app:' || /Electron/i.test(navigator.userAgent || '')) return; // desktop app: no online play, nothing to close
  const q = new URLSearchParams(location.search);
  const T = q.get('idletest') === '1' ? TEST : { IDLE_MS, WARN_MS };
  const t = (k, o) => (window.t || ((x) => x))(k, o);

  const CSS = 'position:fixed;left:50%;top:22%;transform:translate(-50%,-50%);z-index:13;pointer-events:none;text-align:center;background:rgba(10,6,2,.88);color:#ffe9a8;border:2px solid #ffc861;border-radius:10px;padding:8px 16px;font:700 16px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5);max-width:90vw;letter-spacing:.02em';
  let el = null, sess = null, startAt = Date.now(), localAt = 0, hiddenAt = 0, closedUntil = 0, mode = 'none', warnSecs = 0;
  const hiddenNow = () => !!document.hidden;
  const net = () => window.SSRNETPLAY, session = () => { const N = net(); const s = N && N.session; return s && s.role === 'host' ? s : null; };

  function paint(text) {
    if (!el) { if (!text) return; el = document.createElement('div'); el.id = 'idlehint'; el.setAttribute('role', 'status'); el.style.cssText = CSS; document.body.appendChild(el); }
    if (!text) { el.style.display = 'none'; return; }
    el.textContent = text; el.style.display = 'block';
  }
  const touch = () => { localAt = Date.now(); if (mode === 'warn') tick(); }; // input during the warning cancels it right away
  // local activity: keyboard (also while typing in chat), pointer / touch, gamepad (polled)
  for (const ev of ['keydown', 'pointerdown', 'mousedown', 'touchstart', 'wheel']) addEventListener(ev, touch, true);
  setInterval(() => {
    if (!session() || hiddenNow()) return;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads || []) { if (p && p.connected && (p.buttons.some(b => b && b.pressed) || p.axes.some(a => Math.abs(a) > 0.5))) { touch(); break; } }
  }, PAD_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (hiddenNow()) hiddenAt = Date.now(); else { hiddenAt = 0; touch(); } // visible again: both timers restart
  });
  if (hiddenNow()) hiddenAt = Date.now();

  function closeRoom() {
    mode = 'closed'; paint(null);
    try { net().leave(); } catch (e) { console.warn('[idle] leave', e); }
    closedUntil = Date.now() + CLOSED_MS; paint(t('idle.closed'));
  }
  function tick() {
    const now = Date.now(), s = session();
    if (mode === 'closed' && s) { mode = 'none'; paint(null); } // a new room was opened meanwhile
    if (mode === 'closed') {
      if (now >= closedUntil || localAt > closedUntil - CLOSED_MS) { mode = 'none'; paint(null); } // notice goes away on its own or on any input
      return;
    }
    if (!s) { sess = null; if (mode !== 'none') { mode = 'none'; paint(null); } return; }
    if (s !== sess) { sess = s; startAt = now; localAt = 0; if (hiddenNow()) hiddenAt = now; } // a new room: timers start now
    const last = Math.max(startAt, localAt, s.localAt || 0, s.remoteAt || 0);
    let left = T.IDLE_MS - (now - last);                            // idle rule
    if (hiddenNow() && hiddenAt) left = Math.min(left, T.IDLE_MS - (now - hiddenAt)); // hidden-tab rule
    if (left <= 0) return closeRoom();
    if (left <= T.WARN_MS) { mode = 'warn'; warnSecs = Math.ceil(left / 1000); paint(t('idle.warn', { n: warnSecs })); }
    else if (mode === 'warn') { mode = 'none'; paint(null); } // activity (or the tab coming back) cancelled it
  }
  let w = null;
  try {
    w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},' + TICK_MS + ')'], { type: 'text/javascript' })));
    w.onmessage = tick; w.onerror = () => { try { w.terminate(); } catch (e) {} w = null; setInterval(tick, TICK_MS); };
  } catch (e) { w = null; setInterval(tick, TICK_MS); }
  window.SSRIDLE = { IDLE_MS: T.IDLE_MS, WARN_MS: T.WARN_MS, CLOSED_MS, tick, state: () => ({ mode, warnSecs, host: !!session(), hidden: hiddenNow(), hiddenAt, localAt, startAt }) };
})();
