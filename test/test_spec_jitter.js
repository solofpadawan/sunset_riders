// Spectator playout under a bad network (netsim on the host<->spectator link only): measures stalls / freezes / fps and the starvation of the REAL
// web/audio_worklet.js (SoundMixer, 48 kHz, fed exactly like game.js netAudio / netAudioResync). Host + --guests N bot players (links glat/gjit/gloss per direction).
// node test/test_spec_jitter.js [webdir=web] [--assets web/assets] [--secs 60] [--lat 100] [--jit 30] [--loss 3] [--spike 600] [--json out.json] [--label name]
//   lat/jit are per direction (RTT = 2*lat, RTT jitter = +-2*jit). A +500 ms spike lasting --spike ms every ~12 s. --tickjit P: rAF cadence jitter of every machine.
// --video out.rgba --vsecs N: also render the spectator's screen for the first N seconds (288x224 RGBA per 59.19 Hz tick, red square = this tick did not advance) for ffmpeg.
// A/B: `git archive 5b1644c web | tar -x -C /tmp/old` then run with /tmp/old/web (same --assets). VIRTUAL TIME: deterministic, independent of the box CPU load.
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');
const argv = process.argv.slice(2), opt = { secs: 60, lat: 100, jit: 30, loss: 3, spike: 600, json: '', label: '', guests: 2, glat: 40, gjit: 15, gloss: 1, tickjit: 0.1, assets: '', video: '', vsecs: 16 }; let webdir = 'web';
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith('--')) { const k = argv[i].slice(2); opt[k] = typeof opt[k] === 'number' ? +argv[++i] : argv[++i]; } else webdir = argv[i]; }
let VT = 1000; const timers = []; let tseq = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => VT }, configurable: true, writable: true });
globalThis.setTimeout = (fn, ms) => { const o = { t: VT + Math.max(0, ms || 0), fn, seq: tseq++ }; timers.push(o); return o; };
globalThis.clearTimeout = o => { const i = timers.indexOf(o); if (i >= 0) timers.splice(i, 1); };
function runTimers(upTo) { for (;;) { let b = -1; for (let i = 0; i < timers.length; i++) if (timers[i].t <= upTo && (b < 0 || timers[i].t < timers[b].t || (timers[i].t === timers[b].t && timers[i].seq < timers[b].seq))) b = i; if (b < 0) return; const o = timers.splice(b, 1)[0]; const keep = VT; VT = Math.max(VT, o.t); o.fn(); VT = Math.max(keep, VT); } }
let rs = 12345; Math.random = () => { rs |= 0; rs = rs + 0x6D2B79F5 | 0; let t = Math.imul(rs ^ rs >>> 15, 1 | rs); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const W = path.resolve(webdir), ROOT = path.resolve(__dirname, '..'), AS = path.resolve(opt.assets || path.join(ROOT, 'web/assets'));
const { Machine } = require(path.join(W, 'sim/ssr.js')), IN = require(path.join(W, 'input.js'));
const SSES = require(path.join(W, 'net/session.js')), { Session } = SSES, LINK = require(path.join(W, 'net/link.js'));
globalThis.btoa ??= s => Buffer.from(s, 'binary').toString('base64'); globalThis.atob ??= s => Buffer.from(s, 'base64').toString('binary');
const A = n => fs.readFileSync(path.join(AS, n)), STEP = 1000 / 59.1856;
function machine() { const m = new Machine(A('prog.bin'), A('eeprom.bin'), A('gfx_tiles.bin'), A('gfx_sprites.bin')); m.attachSound(A('z80.bin'), A('k053260.bin')); m.powerOn(); return m; }
const stepFn = m => (fi, f) => { IN.applyFrame(m, fi, 0); if (f > 1) m.step(); };
function bot(seed) { let x = seed * 2654435761 >>> 0, cur = 0, hold = 0, n = 0; return () => {
  n++; if (n % 600 === 30) return IN.COIN; if (n % 600 === 90 || n % 600 === 100) return IN.FIRE;
  if (--hold <= 0) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; cur = [0, IN.L, IN.R, IN.U, IN.D, IN.FIRE, IN.FIRE | IN.R, IN.JUMP, IN.L | IN.FIRE][(x >>> 16) % 9]; hold = 5 + ((x >>> 8) % 40); }
  return cur; }; }
// ---- the real audio worklet (+ mixer), fed like game.js does (confirmed frames only), consumed in real time at 48 kHz
const ctxo = { AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null, postMessage() {} }; } }, registerProcessor: (n, c) => { ctxo.Proc = c; }, sampleRate: 48000, Float32Array, Math, Int32Array, Uint8Array, Object, console };
vm.createContext(ctxo);
for (const f of ['sim/ym2151.js', 'sim/k053260.js', 'sim/mixer.js', 'audio_worklet.js']) vm.runInContext(fs.readFileSync(path.join(W, f), 'utf8'), ctxo);
const wk = new ctxo.Proc(); wk.port.onmessage({ data: { pcm: A('k053260.bin').buffer.slice(A('k053260.bin').byteOffset, A('k053260.bin').byteOffset + A('k053260.bin').length) } });
const aud = { starvedBlocks: 0, starvedRuns: 0, silent: 0, blocks: 0, t0: 0, fillMin: 1e9, fillMax: 0, msgs: 0 }; let lastStarved = false;
const outs = [[new Float32Array(128), new Float32Array(128)]];
function wkRun(t) {
  if (!aud.t0) aud.t0 = t; const want = Math.floor((t - aud.t0) * 48 / 128);
  while (aud.blocks < want) {
    const s0 = wk.st.starved; wk.process(null, outs); aud.blocks++;
    const starved = wk.st.starved > s0; if (starved) { aud.starvedBlocks++; if (!lastStarved) aud.starvedRuns++; } lastStarved = starved;
    if (wk.safe && wk.mx && wk.started) { const b = wk.safe - wk.mx.an * wk.mx.div; aud.fillMin = Math.min(aud.fillMin, b); aud.fillMax = Math.max(aud.fillMax, b); }
  }
}
const netAudio = snap => { if (!snap || !snap.snd) return; const a = Int32Array.from(smach.snd.takeLogUpTo(snap.snd.nlog)); wk.port.onmessage({ data: { log: a, safe: SoundBoard.samplesAt(snap.snd.zt), target: 6000 } }); aud.msgs++; };
const netAudioResync = snap => { if (!snap || !snap.snd) return; wk.port.onmessage({ data: { resync: { n: SoundBoard.samplesAt(snap.snd.zt), ym: snap.snd.ymRegs, k: snap.snd.k }, target: 6000 } }); };
const specSim = { lat: opt.lat, jit: opt.jit, loss: opt.loss }, specSim2 = { lat: opt.lat, jit: opt.jit, loss: opt.loss };
const hm = machine(); for (let f = 2; f <= 600; f++) hm.step();
const IGN = () => {};
const host = new Session({ m: hm, step: stepFn(hm), role: 'host', frame: 601, name: 'Host', onEvent: IGN });
const peers = [{ s: host, input: bot(1) }];
for (let i = 0; i < opt.guests; i++) { const m = machine(), s = new Session({ m, step: stepFn(m), role: 'guest', name: 'G' + i, onEvent: IGN }); const gs = () => ({ lat: opt.glat, jit: opt.gjit, loss: opt.gloss }), [a, b] = LINK.pair(gs(), gs()); host.addLink(a); s.addLink(b); peers.push({ s, input: bot(i + 2) }); }
const smach = machine(); let specCfgSent = false;
const spec = new Session({ m: smach, step: stepFn(smach), role: 'guest', name: 'Olho', watch: true, onAudio: netAudio, onEvent: e => { if (e.t === 'state') netAudioResync(e.snap); } });
const [sa, sb] = LINK.pair(specSim, specSim2); host.addLink(sa); spec.addLink(sb);
let SSRV = null, fbV = null, vfd = null, lastRendered = -1;
if (opt.video) { SSRV = vm.runInThisContext(fs.readFileSync(path.join(W, 'render.js'), 'utf8') + '\nSSRV;'); SSRV.setGfx(A('gfx/tiles.bin'), A('gfx/sprites.bin')); fbV = new Uint32Array(288 * 224); vfd = fs.openSync(opt.video, 'w'); }
function recVideo(t, done) {
  if (!vfd || !started || t - M.t0 > opt.vsecs * 1000) return;
  if (spec.rb.frame !== lastRendered) { SSRV.render(smach.v, fbV); lastRendered = spec.rb.frame; }
  const o = fbV.slice(); if (done === 0) for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) o[y * 288 + x] = 0xff2020ff;
  fs.writeSync(vfd, Buffer.from(o.buffer));
}
const M = { ticks: 0, frames: 0, zero: 0, runs3: 0, longest: 0, adv: [], t0: 0 }; let run = 0, lastAdvT = 0, started = false, spikes = 0, nextSpike = 0, waitHostSeen = 0, maxStarveMs = 0;
const gapsMs = [];
function onSpecTick(t, done) {
  if (!started) { if (!spec.spec || !spec.rb || !spec.rb.frame) return; if (SSES.SPEC_AUDIO && !specCfgSent) { specCfgSent = true; wk.port.onmessage({ data: { cfg: SSES.SPEC_AUDIO } }); } started = true; M.t0 = t; lastAdvT = t; nextSpike = t + 8000; Object.assign(aud, { starvedBlocks: 0, starvedRuns: 0, fillMin: 1e9, fillMax: 0 }); aud.warm = wk.st.starved; }
  M.ticks++; M.adv.push([+(t - M.t0).toFixed(1), done]);
  const b = spec.specBuf && spec.specBuf();
  if (b) { if (b.waitHost) waitHostSeen++; if (b.starveMs > maxStarveMs) maxStarveMs = b.starveMs; }
  if (done > 0) { M.frames += done; if (run * STEP > 50) M.runs3++; if (run) M.zero += run; M.longest = Math.max(M.longest, t - lastAdvT); gapsMs.push(t - lastAdvT); lastAdvT = t; run = 0; } else run++;
}
for (;;) {
  VT += STEP; runTimers(VT); const t = VT;
  if (started && opt.spike > 0) {
    if (t >= nextSpike && !specSim.spike) { specSim.spike = specSim2.spike = t + opt.spike; specSim.lat = specSim2.lat = opt.lat + 500; spikes++; }
    if (specSim.spike && t >= specSim.spike) { specSim.spike = specSim2.spike = 0; specSim.lat = specSim2.lat = opt.lat; nextSpike = t + 12000; }
  }
  for (const p of peers) { if (opt.tickjit > 0) { if (p.owe) { p.owe = 0; p.s.tick(p.input()); } else if (Math.random() < opt.tickjit) { p.owe = 1; continue; } } p.s.tick(p.input()); }
  const d = spec.tick(0); onSpecTick(VT, d || 0); recVideo(VT, d || 0);
  wkRun(VT);
  if (started && VT - M.t0 > opt.secs * 1000) break;
  if (VT > (opt.secs + 120) * 1000) { console.log('spectator never started'); process.exit(2); }
}
function pct(a, p) { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; }
const zeroAfter = M.adv.filter(([t, n]) => t >= 4000 && n === 0).length, secs = (VT - M.t0) / 1000, st = spec.rb.stats, pb = spec.specBuf ? spec.specBuf() : null;
const res = { label: opt.label || webdir, secs: +secs.toFixed(1), net: { rttMs: 2 * opt.lat, rttJitterMs: 2 * opt.jit, loss: opt.loss, spikes, spikeMs: opt.spike },
  fps: +(M.frames / secs).toFixed(2), hostFps: +(host.rb.stats.frames / secs).toFixed(1), specStallsStat: st.stalls, zeroTicks: M.zero, zeroTicksAfter4s: zeroAfter, freezes50ms: M.runs3, longestGapMs: +M.longest.toFixed(0), p99GapMs: +pct(gapsMs, 0.99).toFixed(0),
  audio: { starvedBlocks: aud.starvedBlocks, starvedRuns: aud.starvedRuns, skips: wk.st.skips, nudges: wk.st.nudges, fillMin: aud.fillMin, fillMax: aud.fillMax, totalBlocks: aud.blocks },
  resyncs: spec.stats.resyncs, specDesyncs: host.stats.specDesyncs, specHashChecks: host.stats.specHashChecks, hostDesyncs: host.stats.desyncs, specLagFrames: host.rb.frame - spec.rb.frame, playout: pb, waitHostSeen, maxStarveMs };
console.log(JSON.stringify(res, null, 1));
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(Object.assign({ adv: M.adv }, res)));
if (waitHostSeen) { console.error('wait-host notice appeared under jitter-only conditions', { waitHostSeen, maxStarveMs }); process.exit(1); }
process.exit(0);
