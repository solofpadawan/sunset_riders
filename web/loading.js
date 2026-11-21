// Loading message (pt/en/es): one centred overlay on the game canvas (#screen = the game picture inside the bezel) that names the
// current boot step ("Starting the engine…", "Loading the ROM…", ...). It disappears at the first frame drawn by the game and a boot error
// replaces the step text in the same place and stays on screen. Presentation only: nothing here touches the machine, inputs, netplay,
// rollback or hashes, and the only per-frame cost is a rAF position check while the overlay is visible (never after the first frame).
// Hooks (game.js ready / draw, romload.js ask): SSRLOAD.step(key), .done(), .fail(err), .hold(bool) (hidden while the ROM prompt is up).
// Strings: i18n/en.js, pt.js ('load.*'); Spanish is built in below (?lang=es), the rest of the UI has no Spanish yet and falls back to English.
(function (G) {
  'use strict';
  const ES = { 'load.rom': 'Cargando la ROM…', 'load.gfx': 'Cargando los gráficos…', 'load.engine': 'Iniciando el motor…', 'load.sound': 'Preparando el sonido…', 'load.err': 'Error al cargar: {{msg}}' };
  const EN = { 'load.rom': 'Loading the ROM…', 'load.gfx': 'Loading the graphics…', 'load.engine': 'Starting the engine…', 'load.sound': 'Preparing the sound…', 'load.err': 'Loading error: {{msg}}' };
  function tr(key, o) {
    try { if (G.SSRI18N && G.SSRI18N.language === 'es' && ES[key]) return ES[key].replace(/\{\{\s*(\w+)\s*\}\}/g, (m, n) => (o && o[n] != null ? o[n] : m)); } catch (e) {}
    try { if (typeof G.t === 'function') { const v = G.t(key, o); if (v && v !== key) return v; } } catch (e) {}
    return (EN[key] || key).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, n) => (o && o[n] != null ? o[n] : m));
  }
  let el = null, cur = null, errMsg = null, shown = true, held = false, finished = false, raf = 0;
  const history = [];
  function text() { return errMsg != null ? tr('load.err', { msg: errMsg }) : cur ? tr(cur) : ''; }
  function place() {
    if (!el) return;
    const cv = document.getElementById('screen'), r = cv && cv.getBoundingClientRect();
    const ready = !!(r && cv.style.width && r.width > 0); // #screen is sized by game.js fit(): wait for it (no flash at the page corner)
    const vis = shown && !held && ready && !!el.textContent;
    el.style.visibility = vis ? 'visible' : 'hidden';
    if (!ready) return;
    el.style.left = (r.left + r.width / 2) + 'px'; el.style.top = (r.top + r.height / 2) + 'px'; el.style.maxWidth = Math.max(120, Math.floor(r.width * 0.9)) + 'px';
  }
  function tick() { raf = 0; if (!shown) return; place(); raf = requestAnimationFrame(tick); }
  function render() {
    if (!el) {
      el = document.createElement('div'); el.id = 'loadmsg'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:12;pointer-events:none;box-sizing:border-box;text-align:center;visibility:hidden;' +
        'color:#fff;font:600 15px system-ui,sans-serif;background:rgba(0,0,0,.6);padding:8px 16px;border-radius:8px;border:0;overflow-wrap:anywhere';
      document.body.appendChild(el);
    }
    el.textContent = shown ? text() : '';
    place();
    if (shown && !raf) raf = requestAnimationFrame(tick);
  }
  function step(key) { if (finished) return; cur = key; errMsg = null; shown = true; history.push(key); render(); }
  function done() { if (finished || errMsg != null) return; finished = true; shown = false; cur = null; if (el) { el.style.visibility = 'hidden'; el.textContent = ''; } if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function fail(e) { if (finished) return; errMsg = String((e && e.message) || e || 'error'); shown = true; render(); }
  function hold(v) { held = !!v; place(); }
  function lang() { if (shown) render(); }
  try { if (G.i18next && G.i18next.on) G.i18next.on('languageChanged', lang); } catch (e) {}
  addEventListener('resize', place); document.addEventListener('fullscreenchange', place);
  G.SSRLOAD = { step, done, fail, hold, place, history, get text() { return el ? el.textContent : ''; }, get visible() { return !!el && el.style.visibility === 'visible'; }, get failed() { return errMsg != null; }, get finished() { return finished; } };
})(window);
