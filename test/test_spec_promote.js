// A spectator with the playout buffer is promoted to a player when a slot frees up: it must switch cleanly to normal play
// (slot >= 0, no playout state, advances with the host, 0 desyncs both ways), and its audio worklet config goes back to the player default. Virtual time.
// node test/test_spec_promote.js [--assets web/assets]
'use strict';
const path = require('path'), fs = require('fs');
let VT = 1000; const timers = []; let tseq = 0;
Object.defineProperty(globalThis, 'performance', { value: { now: () => VT }, configurable: true, writable: true });
globalThis.setTimeout = (fn, ms) => { const o = { t: VT + Math.max(0, ms || 0), fn, seq: tseq++ }; timers.push(o); return o; };
function runTimers(upTo) { for (;;) { let b = -1; for (let i = 0; i < timers.length; i++) if (timers[i].t <= upTo && (b < 0 || timers[i].t < timers[b].t || (timers[i].t === timers[b].t && timers[i].seq < timers[b].seq))) b = i; if (b < 0) return; const o = timers.splice(b, 1)[0]; const keep = VT; VT = Math.max(VT, o.t); o.fn(); VT = Math.max(keep, VT); } }
const R = p => path.join(__dirname, '..', p), ai = process.argv.indexOf('--assets'), AS = ai > 0 ? path.resolve(process.argv[ai + 1]) : R('web/assets');
const { Machine } = require(R('web/sim/ssr.js')), IN = require(R('web/input.js'));
const SSES = require(R('web/net/session.js')), { Session } = SSES, LINK = require(R('web/net/link.js'));
globalThis.btoa ??= s => Buffer.from(s, 'binary').toString('base64'); globalThis.atob ??= s => Buffer.from(s, 'base64').toString('binary');
const A = n => fs.readFileSync(path.join(AS, n)), STEP = 1000 / 59.1856;
const machine = () => { const m = new Machine(A('prog.bin'), A('eeprom.bin'), A('gfx_tiles.bin'), A('gfx_sprites.bin')); m.attachSound(A('z80.bin'), A('k053260.bin')); m.powerOn(); return m; };
const stepFn = m => (fi, f) => { IN.applyFrame(m, fi, 0); if (f > 1) m.step(); };
function bot(seed) { let x = seed * 2654435761 >>> 0, cur = 0, hold = 0, n = 0; return () => { n++; if (n % 600 === 30) return IN.COIN; if (n % 600 === 90 || n % 600 === 100) return IN.FIRE;
  if (--hold <= 0) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; cur = [0, IN.L, IN.R, IN.U, IN.D, IN.FIRE, IN.FIRE | IN.R, IN.JUMP, IN.L | IN.FIRE][(x >>> 16) % 9]; hold = 5 + ((x >>> 8) % 40); } return cur; }; }
const hm = machine(); for (let f = 2; f <= 600; f++) hm.step();
const host = new Session({ m: hm, step: stepFn(hm), role: 'host', frame: 601, name: 'Host', onEvent: () => {} });
const peers = [{ s: host, input: bot(1) }]; const guests = [];
for (let i = 0; i < 3; i++) { const m = machine(), s = new Session({ m, step: stepFn(m), role: 'guest', name: 'G' + i, onEvent: () => {} }); const [a, b] = LINK.pair(null, null); host.addLink(a); s.addLink(b); peers.push({ s, input: bot(i + 2) }); guests.push({ s, a, b }); }
const sm = machine(); const spec = new Session({ m: sm, step: stepFn(sm), role: 'guest', name: 'Olho', watch: true, onEvent: () => {} });
const sim = () => ({ lat: 60, jit: 25, loss: 2 }); const [sa, sb] = LINK.pair(sim(), sim()); host.addLink(sa); spec.addLink(sb);
let T = 0, left = false, promoted = false, tPromote = 0, frameAtPromote = 0, pbBefore = null; const specPeer = { s: spec, input: bot(9) };
for (let i = 0; i < 59.18 * 45; i++) {
  VT += STEP; T = VT - 1000; runTimers(VT);
  for (const p of peers) p.s.tick(p.input());
  if (spec.spec) spec.tick(0); else spec.tick(specPeer.input());
  if (!left && T > 10000 && spec.spec && spec.pb && spec.pb.playing) { pbBefore = spec.specBuf(); guests[2].b.close(); left = true; }
  if (left && !promoted && spec.spec && spec.vaga) { promoted = spec.promote(); tPromote = T; frameAtPromote = spec.rb.frame; }
}
const after = { slot: spec.slot, spec: spec.spec, pb: spec.pb, frame: spec.rb.frame, lag: host.rb.frame - spec.rb.frame };
const ok = left && promoted && after.slot >= 0 && !after.spec && !after.pb && after.lag < 40 && spec.rb.frame > frameAtPromote + 500 && host.stats.desyncs === 0 && host.stats.specDesyncs === 0 && pbBefore && pbBefore.playing && spec.stats.resyncs >= 2 && SSES.PLAYER_AUDIO.nudge === 1;
console.log(JSON.stringify({ ok: !!ok, playoutBeforePromotion: pbBefore, promotedAt: +(tPromote / 1000).toFixed(1), after: { slot: after.slot, spec: after.spec, pb: after.pb, lag: after.lag }, framesSincePromote: spec.rb.frame - frameAtPromote, desyncs: host.stats.desyncs, specDesyncs: host.stats.specDesyncs, hashChecks: host.stats.hashChecks, resyncs: spec.stats.resyncs }));
process.exit(ok ? 0 : 1);
