// Online highscore report (bar board, Worker games4me-netplay /scores/report; contract: highscores/DESIGN.md section 7). WEB ONLY.
// What it does: while a netplay session runs it watches the CONFIRMED frames (Rollback.onConfirm, read-only: nothing here touches the
// machine, the inputs, the rollback or the hashes), reads each player's score from the emulated work RAM and, when the game ends,
// sends ONE report per match to the Worker. Offline play, PeerJS, plain signal.php, spectators and the desktop app (app:) never report.
// RAM (68000 address space, work RAM 0x104000..0x107fff; wram[a - 0x104000]); player slot s = 0..3 (P1..P4), struct at 0x104200 + 0x40*s:
//   +0x00 byte  energy (0 = dead / empty slot)       +0x10 byte  active flag (0x81 playing, 0x01 hit/dead; 0 = slot never used)
//   +0x06 long  score, packed BCD (0x00012340 = $12340 as the HUD shows it), cleared by the game when the game ends
//   0x104001 byte game mode: 0 boot, 1 attract/title/hi-score screens, 2 game running. The only code that goes 2 -> 1 is the end-of-game
//   routine at 0x604e (game over of everyone, and the end sequence): that transition is the "game ended" event. If the host leaves
//   mid-match (before that flip), the remaining guests and the leaving host report right away from the last confirmed scores,
//   including the host's slot; a guest that already left is still omitted. See NOTES.md.
// Per match the tracker keeps, for every slot, "was occupied" (energy or active flag seen non-zero) and the highest score seen in game mode (the
// game zeroes the scores at the end, so the last values are taken from the frames before). It is armed only if it saw a non-game frame first
// (a guest that joins in the middle of a game never saw the beginning and does not report; the host and the early guests do).
(function (G) {
  'use strict';
  const NODE = typeof module !== 'undefined' && module.exports;
  const GAME = 'sunsetriders_web', NS = 4, SCORE_MAX = 99999999, BASE = 0x200, STRIDE = 0x40, A_ENERGY = 0, A_ACTIVE = 0x10, A_SCORE = 6, A_MODE = 1;
  const MATCH_RE = /^[0-9a-f]{32}$/, SEAT_INF = 0x7fffffff; // SEAT_INF = Rollback.INF: still connected <=> join != INF and leave == INF
  // packed BCD long -> integer; -1 if any nibble is not a decimal digit
  function bcd32(w, a) { let v = 0; for (let i = 0; i < 4; i++) { const b = w[a + i], hi = b >> 4, lo = b & 15; if (hi > 9 || lo > 9) return -1; v = v * 100 + hi * 10 + lo; } return v; }
  // Board nick: always derived from the player's normal nick (ssr_nick / Session.names()). No extra field and no player action.
  // Fold: NFD, strip accents, uppercase, drop anything outside A-Z0-9, cut to 8. If shorter than 3 characters, append
  // 'P' + the 1-based slot (P1..P4) and then 'X' until the result is 3 characters (empty nick in slot 0 -> P1X; "Zé" in
  // slot 1 -> ZEP2; "AB" in slot 0 -> ABP1). A report is never blocked for lack of a nick.
  const fold = x => String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const boardNickOf = (x, slot) => {
    let n = fold(x).slice(0, 8);
    if (n.length >= 3) return n;
    n = (n + 'P' + ((slot | 0) + 1)).slice(0, 8);
    while (n.length < 3) n += 'X';
    return n;
  };

  function Tracker() { this.reset(); }
  Tracker.prototype.reset = function () { this.armed = false; this.inGame = false; this.occ = [0, 0, 0, 0]; this.max = [0, 0, 0, 0]; this.ended = 0; };
  // current max scores of occupied slots, without ending the game. null if this tracker is not in a running game (never started, or already ended).
  Tracker.prototype.current = function () {
    if (!this.inGame) return null;
    const scores = [];
    for (let s = 0; s < NS; s++) if (this.occ[s]) scores.push({ slot: s, score: this.max[s] });
    return { scores };
  };
  // one confirmed frame (work RAM after it). Returns { scores: [{slot, score}] } once, on the frame that leaves game mode after a full game seen.
  Tracker.prototype.observe = function (w) {
    if (!w || w.length < 0x1000) return null;
    if (w[A_MODE] !== 2) {
      const was = this.inGame; this.inGame = false;
      if (was && w[A_MODE] !== 1) { this.occ = [0, 0, 0, 0]; this.max = [0, 0, 0, 0]; this.armed = true; return null; } // left game mode for the service / test screen (3) or a reset (0): not a game over
      if (was) { const scores = []; for (let s = 0; s < NS; s++) if (this.occ[s]) scores.push({ slot: s, score: this.max[s] }); this.ended++; this.occ = [0, 0, 0, 0]; this.max = [0, 0, 0, 0]; this.armed = true; return { scores }; }
      this.armed = true; return null;
    }
    if (!this.inGame) { if (!this.armed) return null; this.inGame = true; this.occ = [0, 0, 0, 0]; this.max = [0, 0, 0, 0]; }
    for (let s = 0; s < NS; s++) {
      const b = BASE + STRIDE * s;
      if (w[b + A_ENERGY] || w[b + A_ACTIVE]) this.occ[s] = 1;
      const v = bcd32(w, b + A_SCORE); if (v > this.max[s] && v <= SCORE_MAX) this.max[s] = v;
    }
    return null;
  };

  const done = new Set();            // match ids already reported by this page: ONE report per match_id (a different body from the same peer would be 409)
  const ev = [];                     // test / debug log of what happened
  const note = (type, info) => { const e = Object.assign({ type, at: Date.now() }, info || {}); ev.push(e); if (ev.length > 50) ev.shift(); try { console.log('[ssr-score]', type, info ? JSON.stringify(info) : ''); } catch (x) {} return e; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const enabled = () => typeof location !== 'undefined' && location.protocol !== 'app:';

  // POST once, retrying the IDENTICAL body on network errors / 429 / 5xx (safe: the Worker is idempotent); 4xx is final. Never throws.
  async function post(url, body) {
    const text = JSON.stringify(body); let last = '';
    for (const wait of API.RETRY_MS) {
      if (wait) await sleep(wait);
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text, cache: 'no-store', keepalive: true });
        let j = null; try { j = await r.json(); } catch (e) {}
        if (r.ok || (r.status >= 400 && r.status < 500 && r.status !== 429)) { const status = j && (j.status || j.error) || ('HTTP ' + r.status); return { ok: r.ok, http: r.status, status }; }
        last = 'HTTP ' + r.status;
      } catch (e) { last = (e && e.message) || 'network'; }
    }
    return { ok: false, http: 0, status: 'failed', error: last };
  }

  // slots still connected at this moment (rollback roster). null = session has no roster (unit stubs): do not filter.
  function seatedSlots(s) {
    const rb = s && s.rb, j = rb && rb.join, lv = rb && rb.leave;
    if (!j || !lv) return null;
    const out = [];
    for (let sl = 0; sl < NS; sl++) if (j[sl] !== SEAT_INF && lv[sl] === SEAT_INF) out.push(sl);
    return out;
  }

  function finish(s, ctx, res) {
    const c = ctx() || {}, t = c.t, mid = t && t.match_id;
    if (!t || !MATCH_RE.test(mid || '')) return note('skip', { why: 'no match_id (not the Cloudflare Worker)' });
    if (s.spec || s.wasSpec || s.watchOnly) return note('skip', { why: 'spectator' });
    const role = s.role === 'host' ? 'host' : 'guest', slot = role === 'host' ? 0 : s.slot;
    if (!(slot >= 0 && slot < NS)) return note('skip', { why: 'no player slot' });
    // only slots still connected when the game ends (a peer that already left is omitted from EVERY remaining report, so fingerprints still agree)
    const seated = seatedSlots(s);
    const alive = seated ? res.scores.filter(x => seated.indexOf(x.slot) >= 0) : res.scores;
    if (alive.length < 2) return note('skip', { why: 'fewer than 2 players still connected', n: alive.length });
    if (!alive.some(x => x.slot === slot)) return note('skip', { why: 'my slot did not play', slot });
    // nick always comes from the session roster (Session.names(), already exchanged in hello / {t:'nick'} / who.pl)
    const names = typeof s.names === 'function' ? s.names() : [];
    const nickAt = (sl, fallback) => {
      const raw = names[sl] != null && String(names[sl]) !== '' ? names[sl] : (fallback || '');
      return boardNickOf(raw, sl);
    };
    const nick = nickAt(slot, c.nick);
    if (done.has(mid)) return note('skip', { why: 'already reported', match_id: mid });
    done.add(mid);
    const scores = alive.map(x => ({ slot: x.slot, score: x.score, nick: nickAt(x.slot, x.slot === slot ? c.nick : '') })); // every still-connected occupied slot carries a derived nick
    const body = { game: GAME, match_id: mid, room: String(t.room || c.room || '').toUpperCase(), peer_id: t.id, role, nick, my_slot: slot, scores };
    const url = API.url(t, c);
    note('report', { body });
    post(url, body).then(r => note('result', r), e => note('result', { ok: false, status: 'error', error: String(e && e.message || e) }));
  }

  // If the host leaves mid-match, treat that as the end: report the last CONFIRMED max scores (the host's last confirmed
  // frame is what every guest has been observing, so their numbers agree). Include the host's slot (the host never gets a
  // leave frame on the roster — the session just ends). Do nothing if the match already ended normally (mode 2->1 already
  // reported, or tracker not in a game). A guest clicking leave does not call this.
  function flushOnHostLeft(s, ctx, tr) {
    if (!s || !tr) return note('skip', { why: 'host left but no tracker' });
    if (s.spec || s.wasSpec || s.watchOnly) return note('skip', { why: 'spectator' });
    if (!tr.inGame) return note('skip', { why: 'host left, no match in progress' });
    const res = tr.current();
    if (!res || !res.scores.length) return note('skip', { why: 'host left, no match in progress' });
    note('gameover', { frame: s.rb && s.rb.confirmed, scores: res.scores, why: 'host-left' });
    try { return finish(s, ctx, res); } catch (e) { return note('error', { error: String(e && e.message || e) }); }
  }

  // attach(session, ctx): ctx() -> { t: transport, room, signal: signaling URL in use, nick: the player's normal nick (ssr_nick) }. Players (host / guest) of a Worker match only.
  function attach(s, ctx) {
    if (!enabled() || !s) return null;
    const tr = new Tracker();
    s.onConfirmed = (f, snap) => { const res = tr.observe(snap && snap.wram); if (res) { note('gameover', { frame: f, scores: res.scores }); try { finish(s, ctx, res); } catch (e) { note('error', { error: String(e && e.message || e) }); } } };
    // guests: hostgone arrives while the session and ctx() transport are still intact (ui.js endSession runs after this)
    const prev = s.ev;
    s.ev = e => { if (e && e.t === 'hostgone') { try { flushOnHostLeft(s, ctx, tr); } catch (err) { note('error', { error: String(err && err.message || err) }); } } if (typeof prev === 'function') prev(e); };
    // host: 'Sair da sala' / SSRNETPLAY.leave() calls this before endSession, inside the existing leave wait
    s.flushScore = () => flushOnHostLeft(s, ctx, tr);
    return tr;
  }
  const API = {
    GAME, NS, SCORE_MAX, MATCH_RE, SEAT_INF, bcd32, fold, boardNickOf, seatedSlots, Tracker, attach, post, finish, flushOnHostLeft, events: ev, done,
    RETRY_MS: [0, 1500, 5000],
    // same Worker that issued the match_id (the signaling URL actually in use; ?signal= overrides it), path /scores/report
    url: (t, c) => { try { return new URL((c && c.signal) || (G.SSRNET && G.SSRNET.DEFAULT_SIGNAL) || '').origin + '/scores/report'; } catch (e) { return 'https://games4me-netplay.games4me.workers.dev/scores/report'; } },
    ADDR: { mode: 0x104001, slot0: 0x104200, stride: STRIDE, energy: A_ENERGY, active: A_ACTIVE, score: A_SCORE },
  };
  if (NODE) module.exports = API; else G.SSRHS = API;
})(typeof window !== 'undefined' ? window : globalThis);
