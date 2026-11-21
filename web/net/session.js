// Netplay session (star topology: every guest talks only to the host, who relays inputs). Transport-agnostic: a link
// is { send(obj, reliable), onmsg(obj), onclose(), close() } (see link.js); the game loop calls tick(localInput).
// Host: slot 0, owns the roster (join/leave frame per slot) and the reference state hashes; a guest that joins
// (or desyncs) gets the host's confirmed snapshot. Guests keep their frame near the host's estimated frame.
(function (G) {
  'use strict';
  const NODE = typeof require !== 'undefined';
  const RB = NODE ? require('./rollback.js') : G.SSRROLL, SNAP = NODE ? require('./snap.js') : G.SSRSNAP;
  const { Rollback, INF } = RB, NS = 4, MAXSPEC = 4;
  const now = () => performance.now();
  // Chat (outside the simulation: never touches the rollback inputs, snapshots or hashes). Plain text only, 60 chars.
  const CHAT_MAX = 60, CHAT_GAP = 700, CHAT_WIN = 10000, CHAT_PER_WIN = 5;
  function sanitize(t) { return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX).trim(); }
  const NICK_MAX = 12;
  // Default display names via i18next (web/i18n/) when loaded; node tests (no i18n) keep the pt-BR fallback.
  // These names are display-only (never part of inputs, snapshots or hashes).
  function i18nName(key, fallback, opts) {
    try { const I = G && G.SSRI18N; if (I && I.tOr) return I.tOr(key, fallback, opts); } catch (e) {}
    return fallback;
  }
  // Default names are minted by the host in ITS language and sent to everyone ('who', room list). For display, map
  // the known defaults (any loaded language) to this browser's language; real nicknames pass through unchanged.
  function localName(x) {
    const s = String(x == null ? '' : x); let r;
    if ((r = /^(?:Jogador|Player) ([1-4])$/.exec(s))) return i18nName('net.playerN', s, { n: +r[1] });
    if ((r = /^(?:Espectador|Spectator) (\d{1,3})$/.exec(s))) return i18nName('net.spectatorN', s, { n: +r[1] });
    if (s === 'Espectador' || s === 'Spectator') return i18nName('net.spectator', s);
    if (s === 'Você' || s === 'You') return i18nName('net.you', s);
    return s;
  }
  function cleanNick(t) { return sanitize(t).replace(/[^\p{L}\p{N} _.!?'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NICK_MAX).trim(); }
  function RateLimit() { this.t = []; }
  RateLimit.prototype.ok = function (t) { this.t = this.t.filter(x => t - x < CHAT_WIN); if (this.t.length >= CHAT_PER_WIN || (this.t.length && t - this.t[this.t.length - 1] < CHAT_GAP)) return false; this.t.push(t); return true; };
  const b64 = { enc(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
    dec(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } };
  // Frames of input delay that cover `rttMs` without living past maxRoll.
  // Host inputs travel one hop (rtt/2). A guest's inputs are relayed, so with 3 or 4 players they travel a full rtt.
  // Delay is local scheduling only: peers do not have to share the number. ?delay= pins it and this is not used.
  function delayForRtt(rttMs, stepMs, maxRoll, players, role) {
    const relay = role !== 'host' && players >= 3;
    const travel = rttMs * (relay ? 1 : 0.5);
    // +1 fits the average one-way trip inside maxRoll. Two more frames (~34 ms) cover delivery
    // jitter from timers and WebRTC: at 500 ms that slack is otherwise only ~20 ms, and a
    // +-20 ms shuffle stalls the host even though the mean RTT already selected delay 8.
    let need = Math.ceil(travel / stepMs - maxRoll + 1) + 2;
    if (need < 2) need = 2;
    if (need > 24) need = 24;
    return need;
  }
  function Session(o) {
    this.m = o.m; this.step = o.step; this.role = o.role; this.STEP = o.stepMs || 1000 / 59.1856;
    this.delay = o.delay == null ? 2 : Math.max(0, Math.min(30, o.delay | 0));
    this.delayPinned = !!o.delayPinned; this.delayDropAt = -1e9;
    this.maxRoll = o.maxRoll ?? 8; this.hashEvery = o.hashEvery ?? 60; this.joinLead = o.joinLead ?? 30;
    this.name = cleanNick(o.name || ''); this.links = []; this.rb = null; this.slot = -1; this.ev = o.onEvent || (() => {}); this.audio = o.onAudio || null;
    this.chatRl = [new RateLimit(), new RateLimit(), new RateLimit(), new RateLimit()];
    this.hashes = new Map(); this.stats = { resyncs: 0, desyncs: 0, hashChecks: 0, sent: 0, recv: 0, bytesState: 0, specDesyncs: 0, specHashChecks: 0 };
    // spectators (pt40u): no input slot (slot -1), simulate only fully confirmed frames; host caps them at MAXSPEC
    this.localAt = 0; this.remoteAt = 0; // Date.now() of the last non-empty local input / last REAL change in a remote player's input (host idle auto-close, web/net/idle.js)
    this.watchOnly = !!o.watch; this.wasSpec = !!o.watch; this.onConfirmed = null; // wasSpec: ever a spectator (never reports a highscore); onConfirmed(f, snap): observer of confirmed frames (net/highscore.js)
    // guest that asked to spectate from the start (hello.watch): no slot, no coin-to-join prompt
    this.spec = false; this.vaga = false; this.specList = []; this.specRl = new RateLimit(); this.nextSid = 1;
    if (this.role === 'host') this.startRb(o.frame, 0, [o.frame, INF, INF, INF], [INF, INF, INF, INF]);
  }
  const P = Session.prototype;
  P.startRb = function (F, slot, join, leave) {
    this.slot = slot;
    this.rb = new Rollback(this.m, { step: this.step, slot, delay: this.delay, maxRoll: this.maxRoll, hashEvery: this.hashEvery, frame: F, join, leave,
      onHash: (f, h) => this.onHash(f, h), onAudio: s => this.audio && this.audio(s), onConfirm: (f, snap) => this.onConfirmed && this.onConfirmed(f, snap) });
  };
  P.addLink = function (link) {
    const L = { link, slot: -1, spec: false, sid: 0, rl: null, hc: 0, dc: 0, ack: [-1, -1, -1, -1], rtt: 0, f: 0, fT: 0, lastPing: 0, echo: 0, echoT: 0, lastState: -1e9, name: '' };
    this.links.push(L);
    if (this.voice) this.voice.onLink && this.voice.onLink(L);
    link.onmsg = msg => this.onMsg(L, msg);
    link.onclose = () => this.drop(L);
    if (this.role === 'guest') link.send(this.watchOnly ? { t: 'hello', name: this.name || '', watch: 1 } : { t: 'hello', name: this.name || '' }, true);
    return L;
  };
  P.drop = function (L) {
    const i = this.links.indexOf(L); if (i < 0) return; this.links.splice(i, 1);
    if (this.voice) try { this.voice.onDrop(L); } catch (e) { console.warn('voice', e); }
    if (this.role === 'host' && L.slot > 0 && this.rb) {
      const rb = this.rb, leave = rb.leave.slice(); leave[L.slot] = Math.max(rb.known[L.slot] + 1, rb.join[L.slot]); rb.setRoster(rb.join, leave);
    }
    if (this.role === 'host' && L.spec) { this.ev({ t: 'specleft', name: L.name }); this.sendWho(); return; }
    this.ev({ t: this.role === 'host' ? 'left' : 'hostgone', slot: L.slot });
    if (this.role === 'host') this.sendWho();
  };
  // host: spectator names to everyone (reliable, on change)
  // nicknames per slot (host: own name + links; guest: from the host's 'who')
  P.names = function () {
    if (this.role !== 'host') return this.nameList || ['', '', '', ''];
    const n = [this.name || i18nName('net.defaultHost', 'Jogador 1'), '', '', '']; for (const l of this.links) if (l.slot > 0) n[l.slot] = l.name || i18nName('net.playerN', 'Jogador ' + (l.slot + 1), { n: l.slot + 1 }); return n;
  };
  P.setName = function (x) { this.name = cleanNick(x); if (this.role === 'host') this.sendWho(); else if (this.links[0]) this.links[0].link.send({ t: 'nick', name: this.name }, true); };
  P.spectators = function () { return this.role === 'host' ? this.links.filter(l => l.spec).map(l => l.name) : this.specList; };
  P.sendWho = function () { const sp = this.spectators(); const pl = this.names(); for (const L of this.links) L.link.send({ t: 'who', sp, pl }, true); this.ev({ t: 'who' }); };
  // host: give link L a player slot s (new guest or promoted spectator)
  P.seat = function (L, s) {
    const rb = this.rb, join = rb.join.slice(), leave = rb.leave.slice(), was = L.spec;
    L.slot = s; L.spec = false; L.ack = [-1, -1, -1, -1]; L.inHi = -1; L.inLast = 0; join[s] = rb.frame + this.joinLead; leave[s] = INF; rb.setRoster(join, leave);
    rb.inp[s].clear(); rb.known[s] = join[s] - 1;
    this.sendState(L); this.ev({ t: was ? 'promoted' : 'joined', slot: s, name: L.name }); if (was) this.sendWho();
  };
  // guest: room was full, watch instead / spectator: take a free player slot
  P.watch = function () { const L = this.links[0]; if (L) L.link.send({ t: 'hello', name: this.name || '', watch: 1 }, true); };
  P.promote = function () { const L = this.links[0]; if (L && this.spec && this.vaga) { this.vaga = false; L.link.send({ t: 'promote' }, true); return true; } return false; };
  P.freeSlot = function () { for (let s = 1; s < NS; s++) if (!this.links.some(l => l.slot === s) && (this.rb.join[s] === INF || this.rb.leave[s] !== INF)) return s; return -1; };
  P.sendState = function (L) {
    const st = this.rb.exportState(), bin = SNAP.pack(st.snap);
    this.stats.bytesState += bin.length; L.lastState = now();
    L.link.send({ t: 'state', slot: L.slot, F: st.F, join: st.join, leave: st.leave, inputs: st.inputs, snap: b64.enc(bin), hf: this.rb.frame }, true);
  };
  P.onMsg = function (L, msg) {
    this.stats.recv++;
    const t = now();
    if (msg.p !== undefined) { L.echo = msg.p; L.echoT = t; if (msg.e) { const r = t - msg.e - (msg.ed || 0); L.rtt = L.rtt ? L.rtt * 0.9 + r * 0.1 : r; } }
    if (msg.f !== undefined) { L.f = msg.f; L.fT = t; }
    switch (msg.t) {
      case 'i': {
        if (msg.a) L.ack = msg.a;
        if (!this.rb) return;
        if (this.role === 'host') { if (L.slot > 0 && msg.d && msg.d[L.slot]) { this.noteRemote(L, msg.d[L.slot][0], msg.d[L.slot][1]); this.rb.addRemote(L.slot, msg.d[L.slot][0], msg.d[L.slot][1]); } }
        else { if (msg.v !== undefined && this.spec) { const v = !!msg.v; if (v !== this.vaga) { this.vaga = v; this.ev({ t: 'vaga', v }); } }
          if (msg.r) this.rb.setRoster(msg.r[0], msg.r[1]); for (const s in msg.d) if (+s !== this.slot) this.rb.addRemote(+s, msg.d[s][0], msg.d[s][1]); }
        break;
      }
      case 'hello': { // host: a guest wants in
        if (this.role !== 'host') return;
        if (L.slot > 0 || L.spec) return;
        L.name = cleanNick(msg.name); const s = this.freeSlot();
        if (s >= 0 && !msg.watch) { this.seat(L, s); this.sendWho(); break; }
        const nspec = this.links.filter(l => l.spec).length;
        if (!msg.watch || nspec >= MAXSPEC) { L.link.send({ t: 'full', watch: nspec < MAXSPEC ? 1 : 0 }, true); return; }
        L.spec = true; L.sid = this.nextSid++; L.rl = new RateLimit(); if (!L.name) L.name = i18nName('net.spectatorN', 'Espectador ' + L.sid, { n: L.sid }); L.autoName = !msg.name;
        this.sendState(L); this.ev({ t: 'spectator', name: L.name }); this.sendWho();
        break;
      }
      case 'promote': { // host: a spectator takes a free slot (first come first served)
        if (this.role !== 'host' || !L.spec) return;
        const s = this.freeSlot(); if (s < 0) return; // the 'v' flag in the next input message tells it the slot is gone
        this.seat(L, s); break;
      }
      case 'who': if (this.role !== 'host') { this.specList = (msg.sp || []).map(x => sanitize(x).slice(0, 20)).slice(0, MAXSPEC); this.nameList = [0, 1, 2, 3].map(i => cleanNick((msg.pl || [])[i])); this.ev({ t: 'who' }); } break;
      case 'nick': if (this.role === 'host') { const n = cleanNick(msg.name); L.name = n || (L.spec ? i18nName('net.spectatorN', 'Espectador ' + L.sid, { n: L.sid }) : ''); this.sendWho(); } break;
      case 'state': { // guest: (re)load the host's state
        const snap = SNAP.unpack(b64.dec(msg.snap));
        if (!this.rb) this.startRb(msg.F, msg.slot, msg.join, msg.leave);
        if (this.rb.slot !== msg.slot && msg.slot >= 0) this.rb.inp[msg.slot].clear(); // promoted: drop the old player's relayed inputs
        this.slot = this.rb.slot = msg.slot; this.spec = msg.slot < 0; if (this.spec) this.wasSpec = true; if (!this.spec) this.vaga = false;
        this.rb.loadState(msg.F, snap, msg.join, msg.leave, msg.inputs);
        L.f = msg.hf; L.fT = t;
        if (this.spec) this.specPlayoutReset(true); else this.pb = null; // spectator: rebuffer from the new state (keeps the learned cushion); a promoted spectator plays normally
        this.stats.resyncs++; this.ev({ t: 'state', slot: msg.slot, F: msg.F, snap });
        break;
      }
      case 'h': { // host: a guest's hash of a confirmed frame
        if (this.role !== 'host') return;
        const mine = this.hashes.get(msg.f);
        if (mine === undefined) { (L.pend || (L.pend = [])).push([msg.f, msg.h]); return; }
        this.checkHash(L, msg.f, msg.h, mine);
        break;
      }
      case 'vs': if (this.voice) this.voice.onMsg(L, msg); break; // voice activity flag (web voice chat, net/voice.js); ignored when voice is off/unknown
      case 'full': this.ev({ t: 'full', watch: !!msg.watch }); break;
      case 'c': { // chat: guest -> host (slot taken from the link, not the message) -> relayed to every other guest
        const x = sanitize(msg.x); if (!x) return;
        if (this.role === 'host') {
          if (L.spec) { // spectator line: tagged with its name, never on a character
            if (!L.rl.ok(t)) return;
            for (const o of this.links) if (o !== L && (o.slot > 0 || o.spec)) o.link.send({ t: 'c', s: -1, n: L.name, x }, true);
            this.ev({ t: 'chat', slot: -1, name: L.name, text: x }); return;
          }
          if (L.slot < 1 || !this.chatRl[L.slot].ok(t)) return;
          for (const o of this.links) if (o !== L && (o.slot > 0 || o.spec)) o.link.send({ t: 'c', s: L.slot, x }, true);
          this.ev({ t: 'chat', slot: L.slot, text: x });
        } else {
          const s = msg.s | 0;
          if (s === -1) { if (L === this.links[0]) this.ev({ t: 'chat', slot: -1, name: sanitize(msg.n).slice(0, 20) || i18nName('net.spectator', 'Espectador'), text: x }); }
          else if (s >= 0 && s < NS && s !== this.slot) this.ev({ t: 'chat', slot: s, text: x });
        }
        break;
      }
    }
  };
  P.checkHash = function (L, f, h, mine) {
    if (L.spec) this.stats.specHashChecks++; else this.stats.hashChecks++;
    L.hc++; if (h === mine) return;
    L.dc++; if (L.spec) this.stats.specDesyncs++; else this.stats.desyncs++; this.ev({ t: 'desync', slot: L.slot, spec: L.spec, f });
    if (now() - L.lastState > 2000) this.sendState(L);
  };
  P.onHash = function (f, h) {
    if (this.role === 'host') {
      this.hashes.set(f, h); this.hashes.delete(f - 60 * this.hashEvery);
      for (const L of this.links) if (L.pend) { L.pend = L.pend.filter(([pf, ph]) => { if (pf === f) { this.checkHash(L, pf, ph, h); return false; } return pf > f; }); }
    } else { const L = this.links[0]; if (L) L.link.send({ t: 'h', f, h }, false); this.lastHash = [f, h]; }
  };
  // estimated current frame of the host (guest side)
  // host: a remote player's input counts as ACTIVITY only when a byte differs from the previous frame's byte of that player (a real press/release or direction
  // change, not a run of neutral frames). Frames are deduplicated (the same range is resent until acked), so a resend never counts again. Never used by the sim.
  P.noteRemote = function (L, f0, bytes) {
    let hi = L.inHi === undefined ? -1 : L.inHi, last = L.inLast | 0;
    for (let i = 0; i < bytes.length; i++) {
      if (f0 + i <= hi) continue;
      hi = f0 + i; if ((bytes[i] & 255) !== last) { last = bytes[i] & 255; this.remoteAt = Date.now(); }
    }
    L.inHi = hi; L.inLast = last;
  };
  P.hostFrame = function () { const L = this.links[0]; return L ? L.f + (now() - L.fT + L.rtt / 2) / this.STEP : 0; };
  P.livePlayers = function () {
    if (!this.rb) return 1;
    let n = 0;
    for (let s = 0; s < NS; s++) if (this.rb.join[s] !== INF && this.rb.leave[s] === INF) n++;
    return Math.max(1, n);
  };
  // Raise delay when the measured RTT no longer fits in delay+maxRoll. One step down per second, so a noisy
  // sample cannot open a hole or rewrite frames already scheduled (setDelay only moves the horizon).
  P.followRtt = function () {
    if (this.delayPinned || !this.rb) return;
    let rtt = 0;
    // spectators send no inputs and simulate only confirmed frames: a far-away viewer must not raise a player's delay
    for (const L of this.links) if (!L.spec && L.rtt > rtt) rtt = L.rtt;
    if (!(rtt > 0)) return;
    const need = delayForRtt(rtt, this.STEP, this.maxRoll, this.livePlayers(), this.role);
    if (need === this.rb.delay) return;
    if (need > this.rb.delay) { this.rb.setDelay(need); this.delay = need; return; }
    if (now() - this.delayDropAt < 1000) return;
    this.delayDropAt = now();
    this.rb.setDelay(this.rb.delay - 1);
    this.delay = this.rb.delay;
  };
  // one real-time tick: returns the number of frames simulated
  P.tick = function (local) {
    if (local) this.localAt = Date.now(); // any non-empty local input (keyboard / pad), for the host idle auto-close
    if (!this.rb) { this.sendAll(); return 0; }
    if (this.spec) return this.specTick();
    this.followRtt();
    let n = 1;
    if (this.role === 'guest') {
      const d = this.hostFrame() - this.rb.frame;
      n = d > 8 ? Math.min(12, Math.floor(d)) : d > 1.5 ? 2 : d < -1.5 ? 0 : 1;
      // Don't spend the rest of the tick on advances the rollback window will reject.
      // One attempt still runs when the window is shut, so confirm() can move.
      if (n > 0) {
        const can = this.rb.maxRoll - (this.rb.frame - this.rb.confirmed) + 1;
        n = Math.min(n, Math.max(1, can));
      }
    }
    let done = 0;
    for (let i = 0; i < n; i++) {
      this.rb.addLocal(local);
      const c = this.rb.confirmed;
      if (this.rb.advance()) done++;
      else if (this.rb.confirmed === c) break; // window still shut; more tries this tick only recount the stall
    }
    if (!n) this.rb.addLocal(local);
    this.sendAll(); return done;
  };
  // ---- spectator playout (jitter) buffer. SPECTATORS ONLY: players and the host never run this (no input delay / rollback / RTT / hash change).
  // A spectator only simulates frames whose inputs are all known (host-confirmed), so any network jitter used to turn straight into a stall.
  // Now the view runs `c` frames behind the newest known frame: avail = known - frame + 1 is the cushion, and a small controller keeps it near `c`:
  //  - start (join / resync / after an underrun): hold until `need` frames are buffered (a few hundred ms), then play at 1 frame per tick;
  //  - speed trim: the smoothed cushion (EMA ~0.5 s) is compared with `c`; outside a dead band the playout runs a little faster / slower by an
  //    accumulator (+-2 % at most -> an extra frame or a held frame every ~1-2 s, never a burst), which also keeps the audio buffer steady;
  //  - target `c`: an underrun (avail 0) grows it by 4 at once (and rebuffers), a near miss (avail <= 1) by 1; when the minimum cushion of a whole
  //    window stayed above SAFE frames it shrinks by 1 (at most one step per window, ~4 s). c stays in [MIN, MAX] = [9, 30] frames (~150-500 ms);
  //  - a huge surplus (tab was in the background, the input burst after a stall) is drained fast but bounded (<= 6 frames per tick).
  const PB = { START: 14, MIN: 9, MAX: 30, SAFE: 4, GROW_UNDERRUN: 4, WIN_MS: 4000, DEAD: 1.5, KP: 0.01, UP: 0.02, DOWN: 0.02, EMA: 0.03, BURST_OVER: 16, PREBUF_MAX_MS: 1500 };
  // SPECTATOR-ONLY overlay: after this long with avail=0 (view not advancing), show "Aguardando o host…" / "Waiting for the host…".
  // Hidden as soon as frames arrive again. Not a playout-buffer constant: does not change c, speed, prebuffer or underrun behaviour.
  const WAIT_HOST_MS = 3000;
  P.specPlayoutReset = function (keepTarget) {
    const old = this.pb, c = keepTarget && old ? old.c : PB.START, t = now();
    this.pb = { c, playing: false, need: Math.min(c, Math.max(PB.SAFE + 2, Math.ceil(c * 0.9))), since: t, acc: 0, ema: c, min: Infinity, winT: t, grows: old ? old.grows : 0, shrinks: old ? old.shrinks : 0, underruns: old ? old.underruns : 0, nearMiss: old ? old.nearMiss : 0, holds: old ? old.holds : 0, extras: old ? old.extras : 0, bursts: old ? old.bursts : 0, prebuf: old ? old.prebuf : 0, avail: 0, starveSince: 0, waitHost: false };
    return this.pb;
  };
  P.specBuf = function () { const b = this.pb; return b ? { c: b.c, cMs: Math.round(b.c * this.STEP), avail: b.avail, ema: +b.ema.toFixed(1), playing: b.playing, grows: b.grows, shrinks: b.shrinks, underruns: b.underruns, nearMiss: b.nearMiss, holds: b.holds, extras: b.extras, bursts: b.bursts, prebuf: b.prebuf, waitHost: !!b.waitHost, starveMs: b.starveSince ? Math.round(now() - b.starveSince) : 0 } : null; };
  P.specWaitingHost = function () { return !!(this.spec && this.pb && this.pb.waitHost); };
  P.specTick = function () {
    const rb = this.rb; let k = INF; for (let s = 0; s < NS; s++) k = Math.min(k, rb.knownTo(s));
    const pb = this.pb || this.specPlayoutReset(false), t = now();
    const avail = Math.min(k - rb.frame + 1, 1e6); pb.avail = avail;
    // spectator-only notice: no new confirmed frames (avail=0, not advancing) for WAIT_HOST_MS -> show "Waiting for the host"
    if (avail > 0) { pb.starveSince = 0; pb.waitHost = false; }
    else { if (!pb.starveSince) pb.starveSince = t; pb.waitHost = (t - pb.starveSince >= WAIT_HOST_MS); }
    let n = 0;
    if (!pb.playing) { // (re)buffering: nothing to simulate until the cushion is there (or the wait got too long and something is available)
      if (avail >= pb.need || (avail >= 1 && t - pb.since > PB.PREBUF_MAX_MS)) { pb.playing = true; pb.acc = 0; pb.ema = avail; pb.min = Infinity; pb.winT = t; } else pb.prebuf++;
    }
    if (pb.playing) {
      if (avail <= 0) { // underrun: the only thing counted as a stall
        rb.stats.stalls++; pb.underruns++; pb.grows++; pb.c = Math.min(PB.MAX, pb.c + PB.GROW_UNDERRUN);
        pb.playing = false; pb.since = t; pb.need = Math.min(pb.c, Math.max(PB.SAFE + 2, Math.ceil(pb.c * 0.6))); pb.winT = t; pb.min = Infinity;
        rb.confirm(); this.sendAll(); return 0;
      }
      if (avail <= 1 && pb.min > 1) { pb.nearMiss++; if (pb.c < PB.MAX) { pb.c++; pb.grows++; } }
      pb.min = Math.min(pb.min, avail); pb.ema += (avail - pb.ema) * PB.EMA;
      if (t - pb.winT >= PB.WIN_MS) { // window over: shrink one step when the cushion never got near empty
        if (pb.min > PB.SAFE && pb.c > PB.MIN) { pb.c--; pb.shrinks++; }
        pb.winT = t; pb.min = Infinity;
      }
      const e = pb.ema - pb.c;
      if (avail - pb.c > PB.BURST_OVER) { n = Math.min(6, avail - pb.c - 8); pb.bursts++; pb.acc = 0; } // far ahead: drain quickly (bounded)
      else {
        const sp = Math.abs(e) <= PB.DEAD ? 1 : 1 + Math.max(-PB.DOWN, Math.min(PB.UP, PB.KP * (e - Math.sign(e) * PB.DEAD)));
        pb.acc += sp; n = Math.floor(pb.acc); pb.acc -= n;
        if (n > 1) pb.extras++; else if (n < 1) pb.holds++;
      }
      n = Math.max(0, Math.min(n, avail));
    }
    let done = 0; for (let i = 0; i < n; i++) { rb.sim(rb.frame++); rb.stats.frames++; done++; }
    rb.confirm(); this.sendAll(); return done;
  };
  P.sendAll = function () {
    const t = now(), rb = this.rb;
    for (const L of this.links) {
      const msg = { t: 'i', f: rb ? rb.frame : 0, p: t };
      if (L.echoT) { msg.e = L.echo; msg.ed = t - L.echoT; }
      if (rb) {
        msg.a = rb.known.slice(); msg.d = {};
        if (this.spec) { L.link.send(msg, false); this.stats.sent++; continue; } // a spectator has no inputs to send
        if (this.role === 'host' && L.spec) msg.v = this.freeSlot() >= 0 ? 1 : 0;
        for (let s = 0; s < NS; s++) {
          if (this.role === 'host' ? s === L.slot : s !== this.slot) continue;
          if (rb.join[s] === INF) continue;
          const f0 = Math.max(L.ack[s] + 1, rb.join[s]);
          if (f0 <= rb.known[s]) msg.d[s] = [f0, rb.range(s, f0, 48)];
        }
        if (this.role === 'host') msg.r = [rb.join, rb.leave];
      }
      L.link.send(msg, false); this.stats.sent++;
    }
  };
  // send a chat line from this player; returns the sanitized text (null if empty, not in a slot yet or rate limited)
  P.chat = function (text) {
    const x = sanitize(text); if (!x) return null;
    if (this.spec) {
      if (!this.specRl.ok(now()) || !this.links[0]) return null;
      this.links[0].link.send({ t: 'c', s: -1, x }, true); this.ev({ t: 'chat', slot: -1, name: this.name || i18nName('net.you', 'Você'), text: x, self: true }); return x;
    }
    if (this.slot < 0 || !this.chatRl[this.slot].ok(now())) return null;
    const msg = { t: 'c', s: this.slot, x };
    for (const L of this.links) if (this.role === 'guest' || L.slot > 0 || L.spec) L.link.send(msg, true);
    this.ev({ t: 'chat', slot: this.slot, text: x, self: true });
    return x;
  };
  P.peers = function () { return this.links.map(L => ({ slot: L.slot, spec: L.spec, name: L.name, rtt: Math.round(L.rtt), hc: L.hc, dc: L.dc })); };
  // audio worklet settings for a spectator (game.js posts them): the worklet may trim its output rate by up to ~2 % (3 chip samples per block, default 1 = ~0.7 %),
  // so the +-2 % playout trim and an occasional held/extra frame never drain or overfill its buffer. Players keep the worklet defaults.
  const SPEC_AUDIO = { nudge: 3 }, PLAYER_AUDIO = { nudge: 1 };
  const api = { SPEC_AUDIO, PLAYER_AUDIO, PB, WAIT_HOST_MS, Session, b64, sanitize, cleanNick, localName, RateLimit, CHAT_MAX, MAXSPEC, NICK_MAX, delayForRtt };
  if (NODE) module.exports = api; else G.SSRSESSION = api;
})(typeof window !== 'undefined' ? window : globalThis);
