// Online highscore: the score RAM addresses and the game-ended event (web/net/highscore.js), checked
//  (1) on synthetic work-RAM frames (Tracker rules: armed only after a non-game frame, occupancy, max score, BCD, one event), and
//  (2) on a REAL power-on run of the machine (web/sim/ssr.js with the user's ROM in web/assets, 2 players walking until the game is over):
//      the BCD score long at 0x104206 + 0x40*slot matches what the game holds, the game mode byte 0x104001 goes 2 -> 1 exactly once and the
//      Tracker reports it with both occupied slots and the highest scores (the game itself zeroes the scores one frame before the flip).
// Usage: node test/highscore_check.js [--no-rom]
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const HS = require(R('web/net/highscore.js'));
let fails = 0; const ok = (n, c, i) => { console.log((c ? 'PASS ' : 'FAIL ') + n, i === undefined ? '' : i); if (!c) fails++; };
const mk = () => new Uint8Array(0x4000);
const setBcd = (w, s, v) => { const b = 0x206 + 0x40 * s, d = String(v).padStart(8, '0'); for (let i = 0; i < 4; i++) w[b + i] = (d.charCodeAt(2 * i) - 48) << 4 | (d.charCodeAt(2 * i + 1) - 48); };
const occ = (w, s) => { w[0x200 + 0x40 * s] = 0x15; w[0x210 + 0x40 * s] = 0x81; };
// ---- (1) tracker rules
ok('bcd32 reads 0x00012340 as 12340', HS.bcd32(Uint8Array.of(0, 1, 0x23, 0x40), 0) === 12340);
ok('bcd32 rejects a non-decimal nibble', HS.bcd32(Uint8Array.of(0, 1, 0x2a, 0x40), 0) === -1);
ok('board nick folds accents / case / symbols, cuts to 8, pads short ones with P{slot+1} and X',
  HS.boardNickOf('Chicão!') === 'CHICAO' && HS.boardNickOf('ab', 0) === 'ABP1' && HS.boardNickOf('Anfitriao') === 'ANFITRIA'
  && HS.boardNickOf('João da Silva') === 'JOAODASI' && HS.boardNickOf('João Silva') === 'JOAOSILV' && HS.boardNickOf('R2-D2') === 'R2D2'
  && HS.boardNickOf('12345678') === '12345678' && HS.boardNickOf('Zé', 1) === 'ZEP2' && HS.boardNickOf('', 0) === 'P1X'
  && HS.boardNickOf('A', 2) === 'AP3' && HS.boardNickOf('AB', 2) === 'ABP3');
{
  const t = new HS.Tracker(), w = mk(); let r;
  w[1] = 2; occ(w, 0); setBcd(w, 0, 100); ok('mid-game start (never saw the beginning): not armed, no event', t.observe(w) === null && t.armed === false);
  w[1] = 2; for (let i = 0; i < 3; i++) t.observe(w); w[1] = 1; ok('mid-game start: the later end is NOT reported', t.observe(w) === null);
  w[1] = 2; occ(w, 0); occ(w, 1); setBcd(w, 0, 1200); setBcd(w, 1, 500); r = t.observe(w);
  ok('after a non-game frame the next game is tracked', r === null && t.inGame);
  setBcd(w, 0, 3400); setBcd(w, 1, 700); t.observe(w); setBcd(w, 0, 0); setBcd(w, 1, 0); t.observe(w); // the game zeroes the scores before the flip
  w[1] = 1; r = t.observe(w);
  ok('end event: highest scores of every occupied slot, empty slots omitted', r && JSON.stringify(r.scores) === JSON.stringify([{ slot: 0, score: 3400 }, { slot: 1, score: 700 }]), JSON.stringify(r));
  ok('one event only', t.observe(w) === null && t.ended === 1);
  w.fill(0); w[1] = 2; occ(w, 1); occ(w, 0); setBcd(w, 0, 900); t.observe(w); w[1] = 3; ok('game mode -> 3 (service / test screen) is not a game over', t.observe(w) === null);
  w.fill(0); w[1] = 2; occ(w, 2); setBcd(w, 2, 99999999); t.observe(w); w[1] = 1; r = t.observe(w);
  ok('next game (same tracker): slot 2 alone, 99,999,999 accepted', r && r.scores.length === 1 && r.scores[0].score === 99999999);
  w.fill(0); w[1] = 2; occ(w, 3); w[0x206 + 0x40 * 3 + 2] = 0x1f; t.observe(w); w[1] = 1; r = t.observe(w);
  ok('invalid BCD sample is ignored (score stays 0), slot still occupied', r && r.scores[0].slot === 3 && r.scores[0].score === 0);
}
// ---- (1b) finish() / attach() / post() with a stubbed session and fetch (nothing leaves this process)
globalThis.location = { protocol: 'https:' };
const sess = (o) => Object.assign({ role: 'host', slot: 0, spec: false, wasSpec: false, watchOnly: false }, o);
const MID = '0123456789abcdef0123456789abcdef', TR = { match_id: MID, id: 'peer123abc', room: 'SALA-1' };
const two = { scores: [{ slot: 0, score: 1200 }, { slot: 1, score: 340 }] };
let calls = []; globalThis.fetch = async (url, o) => { calls.push({ url, o, body: JSON.parse(o.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, status: 'pending' }) }; };
const last = () => HS.events[HS.events.length - 1], tick = () => new Promise(r => setTimeout(r, 20));
async function stubs() {
  HS.RETRY_MS.splice(0, 3, 0, 5, 5);
  const fin = async (s, t, nick, res) => { calls = []; HS.finish(s, () => ({ t, room: 'SALA-1', signal: 'https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php', nick }), res || two); await tick(); await tick(); return calls.slice(); };
  let c = await fin(sess(), TR, 'Chico');
  ok('finish: host posts one body to the Worker /scores/report', c.length === 1 && c[0].url === 'https://games4me-netplay.games4me.workers.dev/scores/report' && c[0].o.method === 'POST' && /json/.test(c[0].o.headers['Content-Type']));
  const b = c[0] && c[0].body;
  ok('finish: body fields (game, match_id, room, peer_id, role, nick, my_slot, scores)', b && b.game === 'sunsetriders_web' && b.match_id === MID && b.room === 'SALA-1' && b.peer_id === 'peer123abc' && b.role === 'host' && b.nick === 'CHICO' && b.my_slot === 0 && JSON.stringify(b.scores) === JSON.stringify([{ slot: 0, score: 1200, nick: 'CHICO' }, { slot: 1, score: 340, nick: 'P2X' }]), JSON.stringify(b));
  c = await fin(sess(), TR, 'Chico'); ok('finish: a second game of the same match_id does not post again', c.length === 0 && last().why === 'already reported');
  const T2 = Object.assign({}, TR, { match_id: 'fedcba9876543210fedcba9876543210' });
  c = await fin(sess({ role: 'guest', slot: 1 }), T2, 'Rita9'); ok('finish: guest = role guest, my_slot = session.slot', c.length === 1 && c[0].body.role === 'guest' && c[0].body.my_slot === 1 && c[0].body.nick === 'RITA9' && c[0].body.scores[1].nick === 'RITA9' && c[0].body.scores[0].nick === 'P1X');
  const T3 = n => Object.assign({}, TR, { match_id: n.padStart(32, 'a') });
  { // nicks reused from the session roster (Session.names()): every occupied slot carries a derived board nick
    const three = { scores: [{ slot: 0, score: 900 }, { slot: 1, score: 500 }, { slot: 2, score: 100 }] };
    const sg = Object.assign(sess({ role: 'guest', slot: 2 }), { names: () => ['Chico', 'Rita9', 'Zeca'] });
    c = await fin(sg, T3('c1'), 'Zeca', three);
    ok('finish: nicks of all slots derived from the session names (own slot uses its own)', c.length === 1 && JSON.stringify(c[0].body.scores) === JSON.stringify([{ slot: 0, score: 900, nick: 'CHICO' }, { slot: 1, score: 500, nick: 'RITA9' }, { slot: 2, score: 100, nick: 'ZECA' }]) && c[0].body.nick === 'ZECA' && c[0].body.my_slot === 2, JSON.stringify(c[0] && c[0].body));
    const sh = Object.assign(sess(), { names: () => ['Chico', 'ab', 'João Silva!'] });
    c = await fin(sh, T3('c2'), 'Chico', three);
    ok('finish: accented / short peer nicks are folded or padded, never left out', c.length === 1 && JSON.stringify(c[0].body.scores) === JSON.stringify([{ slot: 0, score: 900, nick: 'CHICO' }, { slot: 1, score: 500, nick: 'ABP2' }, { slot: 2, score: 100, nick: 'JOAOSILV' }]), JSON.stringify(c[0] && c[0].body));
  }
  { // a player who already left is omitted from every remaining report (rollback roster), so fingerprints still agree
    const three = { scores: [{ slot: 0, score: 900 }, { slot: 1, score: 500 }, { slot: 2, score: 100 }] };
    const INF = HS.SEAT_INF;
    const rbLeft = { join: [0, 0, 0, INF], leave: [INF, INF, 80, INF] }; // slot 2 left mid-match
    const names3 = () => ['Chico', 'Rita', 'Zé', ''];
    const sh = Object.assign(sess(), { names: names3, rb: rbLeft });
    const sg = Object.assign(sess({ role: 'guest', slot: 1 }), { names: names3, rb: rbLeft });
    c = await fin(sh, T3('e1'), 'Chico', three);
    const want = [{ slot: 0, score: 900, nick: 'CHICO' }, { slot: 1, score: 500, nick: 'RITA' }];
    ok('finish: leaver (slot 2) omitted from the host report, remaining nicks kept', c.length === 1 && JSON.stringify(c[0].body.scores) === JSON.stringify(want) && c[0].body.nick === 'CHICO', JSON.stringify(c[0] && c[0].body));
    const c2 = await fin(sg, T3('e11'), 'Rita', three);
    ok('finish: the other remaining player sends the same slot:score set (no leaver)', c2.length === 1 && JSON.stringify(c2[0].body.scores) === JSON.stringify(want) && c2[0].body.nick === 'RITA' && c2[0].body.my_slot === 1, JSON.stringify(c2[0] && c2[0].body));
    const sLeft = Object.assign(sess({ role: 'guest', slot: 2 }), { names: names3, rb: rbLeft });
    c = await fin(sLeft, T3('e13'), 'Zé', three);
    ok('finish: the player who already left does not report', c.length === 0 && /my slot/.test(last().why), last());
    c = await fin(Object.assign(sess(), { rb: { join: [0, 0, INF, INF], leave: [INF, 50, INF, INF] } }), T3('e2'), 'Chico');
    ok('finish: after the only guest leaves, fewer than 2 connected -> no report', c.length === 0 && /fewer/.test(last().why), last());
  }
  { // host leaves mid-match: remaining guests AND the host report the last confirmed scores, INCLUDING the host's slot
    const INF = HS.SEAT_INF, names3 = () => ['Chico', 'Rita', 'Zé', ''];
    const rbAll = { join: [0, 0, 0, INF], leave: [INF, INF, INF, INF] };
    const mkTr = () => {
      const tr = new HS.Tracker(), w = mk();
      w[1] = 1; tr.observe(w);
      w[1] = 2; occ(w, 0); occ(w, 1); occ(w, 2); setBcd(w, 0, 900); setBcd(w, 1, 500); setBcd(w, 2, 100); tr.observe(w);
      return tr;
    };
    const flush = async (s, mid, tr, nick, rb) => {
      calls = [];
      HS.flushOnHostLeft(Object.assign(s, { names: names3, rb: rb || rbAll }), () => ({ t: T3(mid), room: 'SALA-1', signal: 'https://games4me-netplay.games4me.workers.dev/x/signal.php', nick }), tr);
      await tick(); await tick(); return calls.slice();
    };
    let tr = mkTr();
    ok('tracker.current: in-game max scores of occupied slots, does not end the game', tr.inGame && JSON.stringify(tr.current().scores) === JSON.stringify([{ slot: 0, score: 900 }, { slot: 1, score: 500 }, { slot: 2, score: 100 }]));
    c = await flush(sess(), 'f1', tr, 'Chico');
    const wantAll = [{ slot: 0, score: 900, nick: 'CHICO' }, { slot: 1, score: 500, nick: 'RITA' }, { slot: 2, score: 100, nick: 'ZEP3' }];
    ok('flushOnHostLeft: host includes its own slot and both guests', c.length === 1 && JSON.stringify(c[0].body.scores) === JSON.stringify(wantAll) && c[0].body.role === 'host' && c[0].body.nick === 'CHICO', JSON.stringify(c[0] && c[0].body));
    const cG = await flush(sess({ role: 'guest', slot: 1 }), 'f11', mkTr(), 'Rita');
    ok('flushOnHostLeft: a guest sends the same slot:score set including the host', cG.length === 1 && JSON.stringify(cG[0].body.scores) === JSON.stringify(wantAll) && cG[0].body.nick === 'RITA' && cG[0].body.my_slot === 1, JSON.stringify(cG[0] && cG[0].body));
    const trE = mkTr(), wE = mk(); wE[1] = 1; trE.observe(wE);
    calls = []; HS.flushOnHostLeft(Object.assign(sess(), { names: names3, rb: rbAll }), () => ({ t: T3('f12'), room: 'SALA-1', signal: 'https://games4me-netplay.games4me.workers.dev/x/signal.php', nick: 'Chico' }), trE);
    await tick();
    ok('flushOnHostLeft: after a normal end (mode 2->1) does nothing extra', calls.length === 0 && /no match in progress/.test(last().why), last());
    const trD = mkTr();
    await fin(Object.assign(sess(), { names: names3, rb: rbAll }), T3('f2'), 'Chico', trD.current());
    c = await flush(sess(), 'f2', trD, 'Chico');
    ok('flushOnHostLeft: after this match was already reported, skip (already reported)', c.length === 0 && last().why === 'already reported', last());
    const rbLeft = { join: [0, 0, 0, INF], leave: [INF, INF, 80, INF] };
    c = await flush(sess(), 'f3', mkTr(), 'Chico', rbLeft);
    ok('flushOnHostLeft: a guest who already left is still omitted, the host is kept', c.length === 1 && JSON.stringify(c[0].body.scores) === JSON.stringify([{ slot: 0, score: 900, nick: 'CHICO' }, { slot: 1, score: 500, nick: 'RITA' }]), JSON.stringify(c[0] && c[0].body));
  }
  c = await fin(sess({ role: 'guest', slot: 1 }), T3('1'), 'Rita', { scores: [{ slot: 0, score: 5 }] }); ok('finish: fewer than 2 players -> no report', c.length === 0 && /fewer/.test(last().why));
  c = await fin(sess({ role: 'guest', slot: 2 }), T3('2'), 'Rita'); ok('finish: my slot did not play -> no report', c.length === 0 && /my slot/.test(last().why));
  c = await fin(sess({ role: 'guest', slot: 1, spec: true }), T3('3'), 'Rita'); ok('finish: spectator -> no report', c.length === 0 && last().why === 'spectator');
  c = await fin(sess({ role: 'guest', slot: 1, wasSpec: true }), T3('4'), 'Rita'); ok('finish: promoted spectator (was one) -> no report', c.length === 0 && last().why === 'spectator');
  c = await fin(sess({ watchOnly: true }), T3('5'), 'Rita'); ok('finish: watch-only -> no report', c.length === 0);
  c = await fin(sess(), { id: 'x', room: 'R' }, 'Chico'); ok('finish: transport without match_id (PeerJS / signal.php) -> no report', c.length === 0 && /match_id/.test(last().why));
  c = await fin(sess(), Object.assign({}, TR, { match_id: 'XYZ' }), 'Chico'); ok('finish: malformed match_id -> no report', c.length === 0);
  c = await fin(sess(), T3('6'), 'Anfitriao'); ok('finish: 9-char nick is cut to 8 (ANFITRIA), report is still sent', c.length === 1 && c[0].body.nick === 'ANFITRIA' && c[0].body.scores[0].nick === 'ANFITRIA', JSON.stringify(c[0] && c[0].body));
  c = await fin(sess(), T3('7'), 'ab'); ok('finish: short nick is padded (ABP1 for slot 0), report is still sent', c.length === 1 && c[0].body.nick === 'ABP1' && c[0].body.scores[0].nick === 'ABP1' && c[0].body.scores[1].nick === 'P2X', JSON.stringify(c[0] && c[0].body));
  // retries of the identical body
  let n = 0; globalThis.fetch = async (url, o) => { calls.push({ url, o, body: JSON.parse(o.body) }); n++; if (n === 1) throw new Error('offline'); if (n === 2) return { ok: false, status: 503, json: async () => ({}) }; return { ok: true, status: 200, json: async () => ({ ok: true, status: 'accepted' }) }; };
  c = await fin(sess(), T3('8'), 'Chico'); await new Promise(r => setTimeout(r, 120));
  ok('post: network error then 503 then ok -> 3 attempts, identical body, result accepted', calls.length === 3 && calls[0].o.body === calls[1].o.body && calls[1].o.body === calls[2].o.body && last().type === 'result' && last().status === 'accepted', calls.length + ' ' + JSON.stringify(last()));
  calls = []; globalThis.fetch = async (url, o) => { calls.push(o); return { ok: false, status: 400, json: async () => ({ ok: false, error: 'bad nick' }) }; };
  await fin(sess(), T3('9'), 'Chico'); await new Promise(r => setTimeout(r, 60)); ok('post: a 4xx answer (bad nick) is final, not retried', calls.length === 1 && last().status === 'bad nick');
  calls = []; globalThis.fetch = async (url, o) => { calls.push(o); throw new Error('down'); };
  await fin(sess(), T3('a'), 'Chico'); await new Promise(r => setTimeout(r, 120)); ok('post: network down -> 3 tries then gives up quietly (never throws)', calls.length === 3 && last().status === 'failed');
  // attach(): app: protocol and the observer
  globalThis.location = { protocol: 'app:' }; const s1 = sess(); ok('attach: app: (Electron) attaches nothing', HS.attach(s1, () => ({})) === null && !s1.onConfirmed);
  globalThis.location = { protocol: 'https:' }; const s2 = sess(); ok('attach: web attaches an observer on the session', !!HS.attach(s2, () => ({})) && typeof s2.onConfirmed === 'function');
  const s3 = sess(); calls = []; globalThis.fetch = async (url, o) => { calls.push(o); return { ok: true, status: 200, json: async () => ({ ok: true, status: 'accepted' }) }; };
  HS.attach(s3, () => ({ t: Object.assign({}, TR, { match_id: 'b'.repeat(32) }), room: 'SALA-1', signal: 'https://games4me-netplay.games4me.workers.dev/x/signal.php', nick: 'Chico' }));
  const w = mk(); w[1] = 1; s3.onConfirmed(1, { wram: w }); w[1] = 2; occ(w, 0); occ(w, 1); setBcd(w, 0, 100); s3.onConfirmed(2, { wram: w }); w[1] = 1; s3.onConfirmed(3, { wram: w }); await tick(); await tick();
  ok('attach: observer reports once at the game end (confirmed frames 1..3)', calls.length === 1 && JSON.parse(calls[0].body).scores.length === 2);
  s3.onConfirmed(4, {}); s3.onConfirmed(5, null); ok('attach: a confirmed frame without a snapshot is ignored', true);
}
// ---- (2) real machine
(async () => { await stubs(); realMachine(); })();
function realMachine() {
if (process.argv.includes('--no-rom') || !fs.existsSync(R('web/assets/prog.bin'))) { console.log('SKIP real machine run (no ROM assets)'); process.exit(fails ? 1 : 0); }
const { Machine } = require(R('web/sim/ssr.js')), IN = require(R('web/input.js')), A = n => fs.readFileSync(R('web/assets/' + n));
const m = new Machine(A('prog.bin'), A('eeprom.bin'), A('gfx_tiles.bin'), A('gfx_sprites.bin')); m.powerOn();
const w = m.wram, tr = new HS.Tracker(); let ev = [], flips = 0, prevMode = 0, bestSeen = [0, 0, 0, 0], zeroFrame = -1, flipFrame = -1, p1At5 = -1;
for (let f = 0; f < 14000 && !ev.length; f++) {
  const fi = new Uint8Array(4);
  for (let p = 0; p < 2; p++) { let b = 0;
    if (f > 600 && f < 640 && f % 6 < 2) b |= IN.COIN; if (f > 660 && f < 700 && f % 6 < 2) b |= IN.FIRE;
    if (f > 720) { b |= IN.R; if (((f >> 5) + p) % 4 === 0) b |= IN.U; if (((f >> 6) + p) % 5 === 0) b |= IN.D; if (f % 90 < 3) b |= IN.JUMP; }
    fi[p] = b; }
  IN.applyFrame(m, fi, false); m.step();
  for (let s = 0; s < 4; s++) { const v = HS.bcd32(w, 0x206 + 0x40 * s); if (w[1] === 2 && v > bestSeen[s]) bestSeen[s] = v; if (s === 0 && v === 0 && bestSeen[0] > 0 && zeroFrame < 0) zeroFrame = f; }
  if (prevMode === 2 && w[1] === 1) { flips++; flipFrame = f; } prevMode = w[1];
  const r = tr.observe(w); if (r) ev.push(r);
}
console.log('real run: scores seen (RAM, BCD)', bestSeen.join(','), '| scores zeroed at frame', zeroFrame, '| mode 2 -> 1 at frame', flipFrame);
ok('real run: the game ended once (mode 2 -> 1) and the tracker saw it', flips === 1 && ev.length === 1);
ok('real run: P1 scored in RAM (BCD, multiple of 10)', bestSeen[0] > 0 && bestSeen[0] % 10 === 0, bestSeen[0]);
ok('real run: reported slots = the two players who coined in (slot 0 and 1 only)', ev[0] && ev[0].scores.map(x => x.slot).join() === '0,1', JSON.stringify(ev[0]));
ok('real run: reported scores = highest RAM scores seen', ev[0] && ev[0].scores[0].score === bestSeen[0] && ev[0].scores[1].score === bestSeen[1]);
ok('real run: the game zeroes the scores right at the end (so the max over the game is needed)', zeroFrame >= 0 && flipFrame - zeroFrame <= 3, `${zeroFrame}/${flipFrame}`);
process.exit(fails ? 1 : 0);
}
