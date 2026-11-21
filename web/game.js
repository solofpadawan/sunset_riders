// Sunset Riders remake: the original 68000 program running on the emulated board (sim/ssr.js, byte-exact with MAME),
// drawn by render.js. Native 288x224, integer scaling, fixed step at the arcade refresh 6,000,000/(384*264) = 59.1856 Hz.
// Assets (program ROM, EEPROM, gfx) come from the user's own ROM zip via the gitignored extract tools; nothing here is
// ROM-derived. Inputs: input.js, one FrameInput (4 player bytes) per emulated frame, kept in a log so that the run can
// be replayed or rolled back (Machine.save/load) for netcode.
// Query: ?movie=assets/movie/ports.bin replays a MAME input movie; ?turbo=N runs N frames per tick; ?legacy=1 runs the
// old hand-ported attract (sim/attract.js); ?dump=f3800 renders a ref dump. ?pause=1 starts paused (window.SSRG.tick()).
// Sound: the sound board (Z80 program + K053260 samples from the user's ROMs) runs inside the machine; its register log
// is streamed to an AudioWorklet (audio_worklet.js). The AudioContext is created when the machine is ready and stays silent until a user gesture resumes it; a small 'Clique para ativar o som' / 'Click to enable sound' hint is shown only while the context is suspended or interrupted. First click or key resumes audio and hides the hint. ?sound=0 disables it.
'use strict';
const LOAD = window.SSRLOAD || { step() {}, done() {}, fail() {}, hold() {} }; // loading message (loading.js): presentation only
const W = 288, H = 224, HZ = 6000000 / (384 * 264), STEP = 1000 / HZ;
const cv = document.getElementById('screen'), ctx = cv.getContext('2d');
const img = ctx.createImageData(W, H), fb = new Uint32Array(img.data.buffer);
function fit() {
  if (window.SSRGFX) return SSRGFX.layout();
  const s = Math.max(1, Math.floor(Math.min(innerWidth / W, innerHeight / H)));
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
  cv.style.left = ((innerWidth - W * s) >> 1) + 'px'; cv.style.top = ((innerHeight - H * s) >> 1) + 'px';
}
addEventListener('resize', fit); fit();
SSRIN.attach(window);
const q = new URLSearchParams(location.search);
let frame = 0, acc = 0, last = performance.now(), state = null, info = null, m = null, movie = null, paused = !!q.get('pause');
const msDraw = [], msStep = [], inputLog = [];
const turbo = Math.max(1, +(q.get('turbo') || 1));
function stepOne() {
  frame++;
  let fi;
  if (movie) { // ports record k drives step k+1 (see test/movie_check.js)
    const k = frame - 1; fi = (k >= 1 && k * 5 <= movie.length) ? SSRIN.fromPorts(movie.subarray((k - 1) * 5, k * 5)) : new Uint8Array(4);
  } else fi = SSRIN.sample();
  inputLog.push(fi);
  SSRIN.applyFrame(m, fi, SSRIN.held[SSRIN.TEST_KEY]);
  if (frame > 1) m.step();
}
// netplay (net/ui.js): the session owns the stepping; it calls netStep(fi, f) for every (re)simulated frame
let net = null;
function netStep(fi, f) { SSRIN.applyFrame(m, fi, 0); if (f > 1) m.step(); frame = f; }
function tick() {
  if (!m) return;
  wkSync();
  const t0 = performance.now();
  if (net && net.active()) { const fi = SSRIN.sample(); net.tick(fi[0] | fi[1] | fi[2] | fi[3]); msStep.push(performance.now() - t0); if (msStep.length > 240) msStep.shift(); return; }
  for (let i = 0; i < turbo; i++) stepOne();
  msStep.push((performance.now() - t0) / turbo); if (msStep.length > 240) msStep.shift();
  feedAudio();
}
// ---- sound ----
let audio = null, pcm = null, pendingResync = null, unlockEl = null, waitHostEl = null, audioStarting = null;
function soundWanted() { return q.get('sound') !== '0' && !!pcm && !!m && !!m.snd; }
function unlockText() { try { if (typeof t === 'function') return t('sound.unlock'); } catch (e) {} return 'Click to enable sound'; }
function waitHostText() { try { if (typeof t === 'function') return t('spec.waitHost'); } catch (e) {} return 'Waiting for the host…'; }
function audioBlocked() {
  const ac = audio && audio.ac;
  if (!ac || !soundWanted()) return false;
  return ac.state === 'suspended' || ac.state === 'interrupted';
}
function hostWaiting() {
  const N = window.SSRNETPLAY && SSRNETPLAY.session;
  return !!(N && N.spec && N.specWaitingHost && N.specWaitingHost());
}
const HINT_CSS = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:13;pointer-events:none;text-align:center;background:rgba(10,6,2,.88);color:#ffe9a8;border:2px solid #ffc861;border-radius:10px;padding:8px 16px;font:700 16px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5);max-width:90vw;letter-spacing:.02em';
function placeHints() {
  // when both notices are on, keep them from covering each other (sound unlock stays readable, wait-host sits above)
  const hostOn = !!(waitHostEl && waitHostEl.style.display !== 'none');
  const sndOn = !!(unlockEl && unlockEl.style.display !== 'none');
  const both = hostOn && sndOn;
  if (waitHostEl) waitHostEl.style.top = both ? '38%' : '50%';
  if (unlockEl) unlockEl.style.top = both ? '62%' : '50%';
}
function syncUnlockHint() {
  const show = audioBlocked();
  if (!unlockEl) {
    if (!show) return;
    unlockEl = document.createElement('div');
    unlockEl.id = 'sndhint';
    unlockEl.setAttribute('role', 'status');
    unlockEl.style.cssText = HINT_CSS;
    document.body.appendChild(unlockEl);
  }
  unlockEl.textContent = unlockText();
  unlockEl.style.display = show ? 'block' : 'none';
  placeHints();
}
function syncWaitHostHint() {
  const show = hostWaiting();
  if (!waitHostEl) {
    if (!show) return;
    waitHostEl = document.createElement('div');
    waitHostEl.id = 'hosthint';
    waitHostEl.setAttribute('role', 'status');
    waitHostEl.style.cssText = HINT_CSS;
    document.body.appendChild(waitHostEl);
  }
  waitHostEl.textContent = waitHostText();
  waitHostEl.style.display = show ? 'block' : 'none';
  placeHints();
}
function ensureCtx() {
  if (!soundWanted()) return null;
  if (audio && audio.ac) return audio.ac;
  const ac = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  audio = { ac, ready: false };
  ac.addEventListener('statechange', syncUnlockHint);
  return ac;
}
function feedAudio() {
  if (!audio || !audio.ready || !m || !m.snd || (net && net.active())) return;
  const l = m.snd.takeLog(), a = Int32Array.from(l);
  audio.node.port.postMessage({ log: a, safe: m.snd.safeSamples() }, [a.buffer]);
}
async function startAudio() {
  if (!soundWanted()) return;
  const ac = ensureCtx(); if (!ac) return;
  if (ac.state === 'suspended' || ac.state === 'interrupted') { try { await ac.resume(); } catch (e) {} }
  if (!audio.ready) {
    if (!audioStarting) {
      audioStarting = (async () => {
        for (const f of ['sim/ym2151.js', 'sim/k053260.js', 'sim/mixer.js', 'audio_worklet.js']) await ac.audioWorklet.addModule(f + (window.SSR_BUILD ? '?v=' + window.SSR_BUILD : ''));
        if (audio.ready) return;
        const node = new AudioWorkletNode(ac, 'ssr-audio', { numberOfInputs: 0, outputChannelCount: [2] });
        const duck = ac.createGain(); duck.gain.value = 1; // master gain of the game sound: only the voice chat ducking (net/voice.js) moves it
        node.connect(duck); duck.connect(ac.destination);
        node.port.onmessage = e => { if (e.data.stats) audio.stats = e.data.stats; };
        node.port.postMessage({ pcm: pcm.slice().buffer });
        audio.node = node; audio.duck = duck; audio.ready = true; feedAudio();
        if (pendingResync) netAudioResync(pendingResync);
      })();
    }
    try { await audioStarting; } catch (e) { audioStarting = null; throw e; }
  }
  syncUnlockHint();
}
// spectator audio trim: the worklet may skip/repeat up to 3 chip samples per block (net/session.js SPEC_AUDIO) so the spectator's +-2 % playout never drains or overfills it; players / promoted spectators use the defaults
let wkSpec = false;
function wkSync() { const sp = !!(net && net.session && net.session.spec); if (!audio || !audio.ready || sp === wkSpec || !window.SSRSESSION) return; wkSpec = sp; audio.node.port.postMessage({ cfg: sp ? SSRSESSION.SPEC_AUDIO : SSRSESSION.PLAYER_AUDIO }); }
// netplay audio: only confirmed frames are heard (they are never rolled back), snap = state after the frame
function netAudio(snap) {
  if (!audio || !audio.ready || !snap || !snap.snd) return;
  const a = Int32Array.from(m.snd.takeLogUpTo(snap.snd.nlog));
  audio.node.port.postMessage({ log: a, safe: SoundBoard.samplesAt(snap.snd.zt), target: 6000 }, [a.buffer]);
}
// after a full-state load (joining a room / resync): restart the audio player from the snapshot's chip state
function netAudioResync(snap) {
  pendingResync = snap;
  if (!audio || !audio.ready || !snap || !snap.snd) return;
  audio.node.port.postMessage({ resync: { n: SoundBoard.samplesAt(snap.snd.zt), ym: snap.snd.ymRegs, k: snap.snd.k }, target: 6000 });
}
for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => { startAudio().catch(e => console.warn('audio', e)); });
try { if (window.i18next && i18next.on) i18next.on('languageChanged', () => { syncUnlockHint(); syncWaitHostHint(); }); } catch (e) {}
function draw() {
  if (!state) return;
  const t0 = performance.now(); info = SSRV.render(state, fb); ctx.putImageData(img, 0, 0); if (window.SSRGFX) SSRGFX.present(img);
  LOAD.done(); // first frame drawn: remove the loading message
  if (window.SSRCHAT) SSRCHAT.draw(m);
  syncWaitHostHint();
  msDraw.push(performance.now() - t0); if (msDraw.length > 240) msDraw.shift();
}
function loop(t) {
  acc += Math.min(250, t - last); last = t;
  if (!paused) while (acc >= STEP) { tick(); acc -= STEP; } else acc = 0;
  draw(); requestAnimationFrame(loop);
}
let romFiles = null; // set by romload.js when the server has no assets (public hosting): files built from the user's zip
const get = async n => {
  if (romFiles && romFiles[n.replace('assets/', '')]) return romFiles[n.replace('assets/', '')]; const r = await fetch(n); if (!r.ok) throw new Error(n + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); };
async function startMachine() {
  LOAD.step('load.engine');
  const [rom, eeprom, tiles, sprites] = await Promise.all(['prog.bin', 'eeprom.bin', 'gfx_tiles.bin', 'gfx_sprites.bin'].map(n => get('assets/' + n)));
  m = new SSRM.Machine(rom, eeprom, tiles, sprites);
  if (q.get('sound') !== '0') {
    LOAD.step('load.sound');
    try { const [z80, k] = await Promise.all(['z80.bin', 'k053260.bin'].map(n => get('assets/' + n))); m.attachSound(z80, k); pcm = k; }
    catch (e) { console.warn('no sound assets', e.message); }
  }
  m.powerOn(); state = m.v;
  if (q.get('movie')) movie = await get(q.get('movie'));
}
// Legacy hand-port attract (kept for comparison only).
let sim = null, seed = null;
async function startLegacy() {
  LOAD.step('load.engine');
  const [rom, eeprom] = await Promise.all(['assets/prog.bin', 'assets/eeprom.bin'].map(get));
  sim = new SSRATT.Sim(rom); sim.powerOn(eeprom); seed = sim.save(); state = sim.v;
  m = { step() { if (sim.frame >= 4171 || sim.unimpl) sim.load(seed); sim.step(); }, inputs: new Uint8Array(6) };
}
async function dumpPath(name) {
  if (name.includes('/')) return 'assets/dumps/' + name;
  for (const d of ['dump', 'play']) if ((await fetch(`assets/dumps/${d}/${name}_pal.bin`, { method: 'HEAD' })).ok) return `assets/dumps/${d}/${name}`;
  throw new Error('no dump ' + name);
}
async function load(name) { state = await SSRV.loadDump(await dumpPath(name)); draw(); return info; }
const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
window.SSRG = {
  get frame() { return frame; }, get info() { return info; }, get machine() { return m; }, get inputLog() { return inputLog; },
  tick, draw, load, pause(v = true) { paused = v; },
  run(n) { for (let i = 0; i < n; i++) stepOne(); draw(); return frame; },
  msPerFrame: () => avg(msStep), get net() { return net; }, set net(v) { net = v; }, netStep, netAudio, netAudioResync, get frameNo() { return frame; }, set frameNo(v) { frame = v; }, msDraw: () => avg(msDraw), get audio() { return audio; }, get specAudio() { return wkSpec; }, startAudio,
  ready: (async () => {
    try {
      if (!q.get('dump') && !q.get('legacy') && window.SSRROM) {
        LOAD.step('load.rom');
        romFiles = await SSRROM.ensure();
        if (romFiles) { LOAD.step('load.gfx'); const g = SSRROM.gfx(romFiles); SSRV.setGfx(g.tiles, g.sprites); }
      }
      LOAD.step('load.gfx');
      await SSRV.loadGfx();
      if (q.get('dump')) await load(q.get('dump'));
      else if (q.get('legacy')) await startLegacy();
      else await startMachine();
      if (soundWanted()) { ensureCtx(); startAudio().catch(e => console.warn('audio', e)); }
      syncUnlockHint();
      requestAnimationFrame(loop);
    } catch (e) { LOAD.fail(e); throw e; } // boot error: shown where the loading message was, stays visible
  })(),
};
window.SSR = window.SSRG; // old name (debug scripts)
