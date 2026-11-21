// Synthetic netplay tests for Sunset Riders. No ROM and no gameplay: a fake machine records the FrameInput
// bytes it was given. Two (and three) peers talk through an in-memory link with a virtual clock.
// This board has no separate start bit: fire is bit 4, jump bit 5, coin bit 6, service bit 7.
// node test/test_high_rtt.js
'use strict';
const assert = require('assert');
const { Rollback, INF } = require('../web/net/rollback.js');
const { Session, delayForRtt } = require('../web/net/session.js');
const IN = require('../web/input.js');

const STEP = 1000 / 59.1856;
const COIN = 64, SHOT = 16, JUMP = 32, LEFT = 1, RIGHT = 2;

function machine() {
  const m = {
    seq: [],
    save() { return { seq: this.seq.slice() }; },
    load(s) { this.seq = s.seq.slice(); },
  };
  const step = (fi) => { m.seq.push([fi[0] & 255, fi[1] & 255, fi[2] & 255, fi[3] & 255]); };
  return { m, step };
}
function rbOf(delay) {
  const box = machine();
  const rb = new Rollback(box.m, {
    step: box.step, slot: 0, delay, maxRoll: 8, hashEvery: 100000, frame: 0,
    join: [0, 0, INF, INF], leave: [INF, INF, INF, INF],
  });
  return { rb, box };
}
function contig(rb, s) {
  // Inputs older than confirmed-64 are discarded on purpose. A hole is a missing frame inside the live window.
  if (rb.join[s] === INF) return;
  const from = Math.max(rb.join[s], rb.confirmed - 63);
  for (let f = from; f <= rb.known[s]; f++) assert.ok(rb.inp[s].has(f), 'hole at ' + s + ':' + f);
}
function framesWith(rb, bit) {
  const out = [];
  for (const [f, v] of rb.inp[rb.slot]) if (v & bit) out.push(f);
  return out.sort((a, b) => a - b);
}
function snapshot(rb) { return new Map(rb.inp[rb.slot]); }
function sameMap(before, rb) {
  for (const [f, v] of before) assert.equal(rb.inp[rb.slot].get(f), v, 'rewrote ' + f);
}

function testStartupPrefill() {
  const { rb } = rbOf(2);
  rb.addLocal(COIN);
  for (let f = 0; f <= 2; f++) assert.equal(rb.inp[0].get(f), COIN, 'startup ' + f);
  assert.equal(rb.latchBtn, 0);
  contig(rb, 0);
}

function testNormalTapIsOneFrame() {
  const { rb, box } = rbOf(2);
  for (let i = 0; i < 40; i++) {
    rb.addRemote(1, i, Uint8Array.of(0));
    rb.addLocal(i === 10 ? COIN : 0);
    assert.ok(rb.advance(), 'unexpected stall at ' + i);
  }
  const coins = framesWith(rb, COIN);
  assert.deepEqual(coins.length, 1);
  assert.equal(box.m.seq.filter(b => b[0] & COIN).length, 1);
  const after = coins[0] + 1;
  if (rb.inp[0].has(after)) assert.equal(rb.inp[0].get(after) & COIN, 0);
}

function testTapDuringStall() {
  const { rb, box } = rbOf(2);
  const seen = [];
  for (let i = 0; i < 90; i++) {
    if (i >= 16) rb.addRemote(1, i - 16, Uint8Array.of(0));
    const frozen = !rb.canAdvance() && rb.known[0] >= rb.frame + rb.delay;
    let v = 0;
    if (frozen && seen.length < 3) {
      v = [COIN, SHOT, JUMP][seen.length];
      seen.push(rb.frame);
      const before = snapshot(rb);
      rb.addLocal(v);
      sameMap(before, rb);
    } else rb.addLocal(0);
    rb.advance();
  }
  assert.ok(seen.length === 3, 'stall never happened');
  const hits = [...rb.inp[0]].filter(([, v]) => v & (COIN | SHOT | JUMP));
  assert.equal(hits.length, 1, 'taps smeared or dropped: ' + JSON.stringify(hits));
  assert.equal(hits[0][1] & (COIN | SHOT | JUMP), COIN | SHOT | JUMP);
  assert.ok(hits[0][0] > seen[0], 'tap landed on a frame already scheduled');
  assert.ok(box.m.seq.some(b => (b[0] & (COIN | SHOT | JUMP)) === (COIN | SHOT | JUMP)));
  assert.equal(rb.latchBtn, 0);
  contig(rb, 0);
}

function testHoldAndDirection() {
  const { rb } = rbOf(2);
  // Fill the horizon, then stall, then tap left and release, then tap right. Last direction wins on the next frame.
  for (let i = 0; i < 12; i++) { rb.addLocal(0); rb.advance(); }
  assert.ok(!rb.canAdvance());
  const before = snapshot(rb);
  rb.addLocal(LEFT);
  rb.addLocal(0);
  rb.addLocal(RIGHT);
  sameMap(before, rb);
  assert.equal(rb.latchDir, RIGHT);
  rb.addRemote(1, 0, Uint8Array.of(0));
  // Keep the remote caught up enough to open frames, and sample 0 so the latch is the only new edge.
  for (let i = 0; i < 20; i++) {
    rb.addRemote(1, i, Uint8Array.of(0));
    rb.addLocal(0);
    rb.advance();
  }
  const dirs = [...rb.inp[0]].filter(([, v]) => v & (LEFT | RIGHT));
  assert.deepEqual(dirs.map(([, v]) => v & (LEFT | RIGHT)), [RIGHT]);
  contig(rb, 0);
}

function testDelayChangeNoHoleNoOverwrite() {
  const { rb } = rbOf(2);
  for (let i = 0; i < 10; i++) { rb.addRemote(1, i, Uint8Array.of(0)); rb.addLocal(i === 4 ? COIN : LEFT); rb.advance(); }
  const coinFrames = framesWith(rb, COIN);
  assert.equal(coinFrames.length, 1);
  const before = snapshot(rb);
  const known = rb.known[0];
  rb.setDelay(9);
  rb.addLocal(LEFT | SHOT); // direction still held, shot is new, horizon jumps
  for (const [f, v] of before) assert.equal(rb.inp[0].get(f), v, 'delay up overwrote ' + f);
  contig(rb, 0);
  assert.ok(rb.known[0] > known);
  const shots = framesWith(rb, SHOT);
  assert.deepEqual(shots, [rb.known[0]], 'shot smeared across the new horizon ' + shots);
  // Intermediates keep the held direction and do not gain the shot.
  for (let f = known + 1; f < rb.known[0]; f++) {
    assert.equal(rb.inp[0].get(f) & SHOT, 0, 'smear ' + f);
    assert.equal(rb.inp[0].get(f) & LEFT, LEFT, 'hold cut ' + f);
  }
  assert.equal(rb.inp[0].get(rb.known[0]) & (LEFT | SHOT), LEFT | SHOT);
  const scheduled = snapshot(rb);
  rb.setDelay(0);
  assert.equal(rb.delay, 0);
  sameMap(scheduled, rb);
  contig(rb, 0);
  rb.addLocal(JUMP); // horizon is behind known: nothing new, press stays latched
  sameMap(scheduled, rb);
  assert.equal(rb.latchBtn & JUMP, JUMP);
  rb.setDelay(2);
  // Catch the frame cursor up without letting advance() stall forever on the remote.
  for (let i = 10; i < 40; i++) { rb.addRemote(1, i, Uint8Array.of(0)); rb.addLocal(0); rb.advance(); }
  assert.equal(framesWith(rb, JUMP).length, 1);
  sameMap(scheduled, rb);
  contig(rb, 0);
}

function testLatchSurvivesReload() {
  const { rb } = rbOf(2);
  for (let i = 0; i < 12; i++) { rb.addLocal(0); rb.advance(); }
  rb.addLocal(COIN);
  assert.equal(rb.latchBtn, COIN);
  const st = rb.exportState();
  rb.loadState(st.F, st.snap, st.join, st.leave, st.inputs, st.past);
  assert.equal(rb.latchBtn, COIN, 'reload dropped a press that had no frame yet');
  for (let i = 0; i < 20; i++) { rb.addRemote(1, i, Uint8Array.of(0)); rb.addLocal(0); rb.advance(); }
  assert.equal(framesWith(rb, COIN).length, 1);
  contig(rb, 0);
}

function testFormula() {
  assert.equal(delayForRtt(60, STEP, 8, 2, 'host'), 2);
  assert.equal(delayForRtt(60, STEP, 8, 2, 'guest'), 2);
  assert.equal(delayForRtt(400, STEP, 8, 2, 'host'), 7);
  assert.equal(delayForRtt(500, STEP, 8, 2, 'guest'), 10);
  assert.equal(delayForRtt(500, STEP, 8, 3, 'host'), 10);
  assert.equal(delayForRtt(500, STEP, 8, 3, 'guest'), 24);
  assert.equal(delayForRtt(5000, STEP, 8, 3, 'guest'), 24);
  assert.equal(delayForRtt(500, STEP, 8, 4, 'guest'), 24);
}

function pairLink(clock, latency) {
  const q = [];
  const a = { onmsg: null, onclose: null, close() {} };
  const b = { onmsg: null, onclose: null, close() {} };
  a.send = (obj) => q.push({ at: clock.t + latency, obj, to: b });
  b.send = (obj) => q.push({ at: clock.t + latency, obj, to: a });
  return {
    a, b,
    flush() {
      q.sort((x, y) => x.at - y.at);
      while (q.length && q[0].at <= clock.t) {
        const m = q.shift();
        if (m.to.onmsg) m.to.onmsg(m.obj);
      }
    },
  };
}

function runPeers(opts) {
  const latency = opts.rtt / 2;
  const clock = { t: 0 };
  const prev = performance.now;
  performance.now = () => clock.t;
  const players = opts.players || 2;
  const boxes = [];
  const sessions = [];
  const links = [];
  try {
    for (let p = 0; p < players; p++) {
      const box = machine();
      boxes.push(box);
      const pinned = opts.pinned !== false;
      const delay = opts.delays ? opts.delays[p] : (opts.delay == null ? 2 : opts.delay);
      sessions.push(new Session({
        m: box.m, step: box.step, role: p === 0 ? 'host' : 'guest', frame: 0,
        delay, delayPinned: pinned, maxRoll: 8, hashEvery: 60, stepMs: STEP,
      }));
    }
    for (let g = 1; g < players; g++) {
      const link = pairLink(clock, latency);
      sessions[0].addLink(link.a);
      sessions[g].addLink(link.b);
      links.push(link);
    }
    const flush = () => { for (const l of links) l.flush(); };
    let stalls = sessions.map(() => 0);
    const N = opts.ticks || 700;
    const taps = opts.taps || [];
    for (let i = 0; i < N; i++) {
      clock.t += STEP;
      flush();
      if (opts.onTick) opts.onTick(i, sessions, clock);
      for (let p = 0; p < players; p++) {
        let v = 0;
        for (const tap of taps) if (tap.p === p && tap.at === i) v |= tap.bit;
        if (opts.hold && opts.hold.p === p && i >= opts.hold.from && i < opts.hold.to) v |= opts.hold.bit;
        const before = sessions[p].rb ? sessions[p].rb.frame : -1;
        sessions[p].tick(v);
        if (sessions[p].rb && sessions[p].rb.frame === before) stalls[p]++;
      }
      flush();
    }
    let mismatch = 0, compared = 0;
    const conf = Math.min(...sessions.map(s => s.rb ? s.rb.confirmed : 0));
    for (let f = 0; f < conf; f++) {
      const a = boxes[0].m.seq[f];
      if (!a) { mismatch++; continue; }
      for (let p = 1; p < players; p++) {
        const b = boxes[p].m.seq[f];
        if (!b || a.some((x, k) => x !== b[k])) mismatch++;
      }
      compared++;
    }
    return {
      stalls, mismatch, compared, conf,
      delay: sessions.map(s => s.rb && s.rb.delay),
      pinned: sessions.map(s => s.delayPinned),
      frames: sessions.map(s => s.rb && s.rb.frame),
      desync: sessions.reduce((n, s) => n + s.stats.desyncs, 0),
      resyncs: sessions[1] ? sessions[1].stats.resyncs : 0,
      seq: boxes.map(b => b.m.seq),
      sessions,
    };
  } finally {
    performance.now = prev;
  }
}

function bits(seq, slot, bit) {
  const out = [];
  seq.forEach((row, f) => { if (row && (row[slot] & bit)) out.push(f); });
  return out;
}

function testPeers() {
  const low = runPeers({ rtt: 80, pinned: true, delay: 2, taps: [{ p: 0, at: 250, bit: COIN }, { p: 1, at: 280, bit: JUMP }] });
  assert.equal(low.mismatch, 0);
  assert.equal(low.desync, 0);
  assert.deepEqual(low.delay, [2, 2]);
  assert.equal(low.stalls[0], 0);
  assert.ok(bits(low.seq[0], 0, COIN).length >= 1, 'low rtt dropped host coin');
  assert.deepEqual(bits(low.seq[0], 0, COIN), bits(low.seq[1], 0, COIN));
  assert.deepEqual(bits(low.seq[0], 1, JUMP), bits(low.seq[1], 1, JUMP));

  const pinnedHi = runPeers({
    rtt: 450, pinned: true, delay: 2,
    taps: [{ p: 0, at: 220, bit: COIN }, { p: 0, at: 221, bit: SHOT }, { p: 1, at: 260, bit: JUMP }],
    hold: { p: 0, bit: LEFT, from: 400, to: 406 },
  });
  assert.equal(pinnedHi.mismatch, 0, 'pinned high rtt desynced inputs');
  assert.equal(pinnedHi.desync, 0);
  assert.deepEqual(pinnedHi.delay, [2, 2]);
  assert.ok(pinnedHi.stalls[0] > 40, 'expected the delay=2 window to stall at 450 ms, got ' + pinnedHi.stalls[0]);
  assert.ok(bits(pinnedHi.seq[0], 0, COIN).length >= 1, 'latched coin missing');
  assert.ok(bits(pinnedHi.seq[0], 0, SHOT).length >= 1, 'latched shot missing');
  assert.ok(bits(pinnedHi.seq[0], 1, JUMP).length >= 1, 'guest jump missing');
  assert.deepEqual(bits(pinnedHi.seq[0], 0, COIN), bits(pinnedHi.seq[1], 0, COIN));
  assert.deepEqual(bits(pinnedHi.seq[0], 1, JUMP), bits(pinnedHi.seq[1], 1, JUMP));
  assert.ok(bits(pinnedHi.seq[0], 0, LEFT).length >= 1, 'hold missing');

  const adapt = runPeers({
    rtt: 450, pinned: false,
    taps: [{ p: 0, at: 300, bit: COIN }, { p: 1, at: 330, bit: JUMP }, { p: 0, at: 360, bit: SHOT }],
  });
  assert.equal(adapt.mismatch, 0);
  assert.equal(adapt.desync, 0);
  assert.ok(adapt.delay[0] >= 8 && adapt.delay[0] <= 11, 'host delay ' + adapt.delay[0]);
  assert.ok(adapt.delay[1] >= 8 && adapt.delay[1] <= 11, 'guest delay ' + adapt.delay[1]);
  assert.ok(adapt.stalls[0] < pinnedHi.stalls[0] / 3, 'adapt stalls ' + adapt.stalls[0] + ' vs pinned ' + pinnedHi.stalls[0]);
  assert.ok(bits(adapt.seq[0], 0, COIN).length >= 1);
  assert.deepEqual(bits(adapt.seq[0], 0, COIN), bits(adapt.seq[1], 0, COIN));
  assert.deepEqual(bits(adapt.seq[0], 0, SHOT), bits(adapt.seq[1], 0, SHOT));
  assert.deepEqual(bits(adapt.seq[0], 1, JUMP), bits(adapt.seq[1], 1, JUMP));

  const calm = runPeers({ rtt: 60, pinned: false, taps: [{ p: 0, at: 200, bit: COIN }] });
  assert.deepEqual(calm.delay, [2, 2]);
  assert.equal(calm.mismatch, 0);
  assert.equal(calm.stalls[0], 0);
  assert.ok(bits(calm.seq[0], 0, COIN).length >= 1);

  const explicit = runPeers({ rtt: 60, pinned: true, delay: 8, taps: [{ p: 1, at: 200, bit: SHOT }] });
  assert.deepEqual(explicit.delay, [8, 8], 'explicit ?delay drifted');
  assert.equal(explicit.mismatch, 0);
  assert.deepEqual(bits(explicit.seq[0], 1, SHOT), bits(explicit.seq[1], 1, SHOT));

  // Peers may schedule at different delays. The simulated bytes still have to match, with no holes.
  const uneven = runPeers({
    rtt: 120, pinned: true, delays: [2, 10],
    taps: [{ p: 0, at: 240, bit: COIN }, { p: 1, at: 240, bit: JUMP }],
    onTick(i, sessions) {
      if (i === 180) {
        const rb = sessions[0].rb;
        const before = snapshot(rb);
        rb.setDelay(14);
        sessions[0].delay = 14;
        rb.addLocal(0);
        sameMap(before, rb);
        contig(rb, 0);
      }
    },
  });
  assert.equal(uneven.mismatch, 0, 'uneven delay desynced');
  assert.equal(uneven.desync, 0);
  assert.equal(uneven.delay[0], 14);
  assert.equal(uneven.delay[1], 10);
  contig(uneven.sessions[0].rb, 0);
  contig(uneven.sessions[1].rb, 1);
  assert.deepEqual(bits(uneven.seq[0], 0, COIN), bits(uneven.seq[1], 0, COIN));

  const three = runPeers({
    rtt: 400, pinned: false, players: 3, ticks: 800,
    taps: [{ p: 0, at: 350, bit: COIN }, { p: 1, at: 380, bit: JUMP }, { p: 2, at: 410, bit: SHOT }],
  });
  assert.equal(three.mismatch, 0, '3p desynced');
  assert.equal(three.desync, 0);
  assert.ok(three.delay[1] > three.delay[0], 'relay guest delay ' + three.delay + ' should exceed host');
  assert.ok(three.delay[2] > three.delay[0]);
  assert.deepEqual(bits(three.seq[0], 0, COIN), bits(three.seq[1], 0, COIN));
  assert.deepEqual(bits(three.seq[0], 0, COIN), bits(three.seq[2], 0, COIN));
  assert.deepEqual(bits(three.seq[0], 1, JUMP), bits(three.seq[2], 1, JUMP));
  assert.deepEqual(bits(three.seq[0], 2, SHOT), bits(three.seq[1], 2, SHOT));
  for (const s of three.sessions) if (s.rb && s.slot >= 0) contig(s.rb, s.slot);

  return { low, pinnedHi, adapt, calm, explicit, uneven, three };
}

function main() {
  testStartupPrefill();
  testNormalTapIsOneFrame();
  testTapDuringStall();
  testHoldAndDirection();
  testDelayChangeNoHoleNoOverwrite();
  testLatchSurvivesReload();
  testFormula();
  const peers = testPeers();
  console.log(JSON.stringify({
    ok: true,
    synthetic: true,
    rom: false,
    pinned450: { stalls: peers.pinnedHi.stalls, delay: peers.pinnedHi.delay, frames: peers.pinnedHi.frames, compared: peers.pinnedHi.compared },
    adapt450: { stalls: peers.adapt.stalls, delay: peers.adapt.delay, frames: peers.adapt.frames, compared: peers.adapt.compared },
    calm60: { stalls: peers.calm.stalls, delay: peers.calm.delay },
    low80: { stalls: peers.low.stalls, delay: peers.low.delay },
    explicit8: { delay: peers.explicit.delay },
    uneven: { delay: peers.uneven.delay, mismatch: peers.uneven.mismatch },
    three400: { stalls: peers.three.stalls, delay: peers.three.delay, frames: peers.three.frames, compared: peers.three.compared },
  }));
}
main();
