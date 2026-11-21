// Stall budget with two rAF clocks. No ROM and no signal server.
// The counters are the ones the game reports: rb.stats.stalls, rb.delay, rb.frame.
// node test/test_stall_budget.js
'use strict';
const assert = require('assert');
const { Session, delayForRtt } = require('../web/net/session.js');
const STEP = 1000 / 59.1856;

function machine() {
  const m = { seq: [], save() { return { seq: this.seq.slice() }; }, load(s) { this.seq = s.seq.slice(); } };
  return { m, step: (fi) => { m.seq.push([fi[0] & 255, fi[1] & 255, fi[2] & 255, fi[3] & 255]); } };
}
function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function run(opts) {
  const latency = opts.rtt / 2;
  let nowT = 0;
  const prev = performance.now;
  performance.now = () => nowT;
  const q = [];
  const rng = mulberry(opts.seed || 1);
  const a = { onmsg: null, onclose: null, close() {} };
  const b = { onmsg: null, onclose: null, close() {} };
  const delayOf = () => { let d = latency; if (opts.jit) d += (rng() * 2 - 1) * opts.jit; return d < 1 ? 1 : d; };
  a.send = (obj) => q.push({ at: nowT + delayOf(), obj, to: b });
  b.send = (obj) => q.push({ at: nowT + delayOf(), obj, to: a });
  const boxes = [machine(), machine()];
  const sessions = [0, 1].map(p => new Session({
    m: boxes[p].m, step: boxes[p].step, role: p === 0 ? 'host' : 'guest', frame: 0,
    delay: opts.delay == null ? 2 : opts.delay, delayPinned: !!opts.pinned,
    maxRoll: 8, hashEvery: 60, stepMs: STEP,
  }));
  sessions[0].addLink(a); sessions[1].addLink(b);
  const peers = [0, 1].map(() => ({ acc: 0, last: 0, next: 0 }));
  let guard = 0;
  const target = opts.frames || 1600;
  while (sessions[0].rb.frame < target && guard++ < 250000) {
    q.sort((x, y) => x.at - y.at);
    const nextMsg = q.length ? q[0].at : 1e18;
    let nextRaf = 1e18, who = 0;
    for (let p = 0; p < 2; p++) if (peers[p].next < nextRaf) { nextRaf = peers[p].next; who = p; }
    if (nextMsg <= nextRaf) {
      nowT = q[0].at;
      const m = q.shift();
      if (m.to.onmsg) m.to.onmsg(m.obj);
      continue;
    }
    nowT = nextRaf;
    const p = peers[who];
    p.acc += Math.min(250, p.last ? nowT - p.last : STEP);
    p.last = nowT;
    let spins = 0;
    while (p.acc >= STEP && spins++ < 20) { sessions[who].tick(0); p.acc -= STEP; }
    p.next = nowT + 16.7;
  }
  performance.now = prev;
  const snap = s => ({
    frame: s.rb.frame, confirmed: s.rb.confirmed, delay: s.rb.delay,
    stalls: s.rb.stats.stalls, simFrames: s.rb.stats.frames,
    rollbacks: s.rb.stats.rollbacks, resyncs: s.stats.resyncs, desyncs: s.stats.desyncs,
    rtt: Math.round(s.links[0].rtt),
  });
  let mismatch = 0;
  const conf = Math.min(sessions[0].rb.confirmed, sessions[1].rb.confirmed);
  for (let f = 0; f < conf; f++) {
    const x = boxes[0].m.seq[f], y = boxes[1].m.seq[f];
    if (!x || !y || x.some((v, k) => v !== y[k])) mismatch++;
  }
  return { host: snap(sessions[0]), guest: snap(sessions[1]), mismatch };
}

function main() {
  assert.equal(delayForRtt(500, STEP, 8, 2, 'host'), 10);
  const steady = run({ rtt: 500, frames: 1600, seed: 1 });
  const pinned8 = run({ rtt: 500, jit: 20, pinned: true, delay: 8, frames: 1600, seed: 2 });
  const adapt = run({ rtt: 500, jit: 20, frames: 1600, seed: 2 });
  assert.equal(steady.mismatch, 0);
  assert.equal(steady.host.desyncs, 0);
  assert.ok(steady.host.stalls < 15, 'steady host stalls ' + steady.host.stalls);
  assert.equal(steady.host.delay, 10);
  assert.ok(pinned8.host.stalls > 40, 'delay 8 at ±20 ms should stall, got ' + pinned8.host.stalls);
  assert.ok(pinned8.guest.stalls > pinned8.host.stalls, 'guest counter ' + pinned8.guest.stalls);
  assert.equal(adapt.mismatch, 0);
  assert.equal(adapt.host.desyncs, 0);
  assert.ok(adapt.host.delay >= 10, 'adapt delay ' + adapt.host.delay);
  assert.ok(adapt.host.stalls < 20, 'adapt host stalls ' + adapt.host.stalls);
  assert.ok(Math.abs(adapt.host.frame - adapt.guest.frame) <= 3);
  assert.ok(adapt.host.stalls < pinned8.host.stalls / 3, adapt.host.stalls + ' vs ' + pinned8.host.stalls);
  console.log(JSON.stringify({
    ok: true, synthetic: true, rom: false, realtime: false,
    note: 'rb.stats.stalls with two 16.7 ms clocks. Not a ROM session.',
    formula500: delayForRtt(500, STEP, 8, 2, 'host'),
    steady, pinned8, adapt,
  }));
}
main();
