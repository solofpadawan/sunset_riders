// Netplay overlay (text via i18next, web/i18n/). F7 (or the multiplayer button) opens it. "Create room" makes this browser the host
// (player 1) with the room name the player typed and shows the invite link (?sala=NAME) with copy and WhatsApp buttons;
// opening the link joins as P2/P3/P4. Room names: 3-16 chars A-Z 0-9 '-' (ROOM_RE, same rule as the Worker); the fields
// normalize while typing (normRoom). Empty/short name = "Create room" disabled (no random name from the UI);
// SSRNETPLAY.host() called without a name (tests/console only) still picks a random 4-char code. In the game every player inserts a coin (5) and presses fire, like the arcade.
// Query: ?sala=NAME join, ?net=peerjs use the PeerJS cloud instead of signal.php, ?signal=URL other signal.php,
// ?turn=turn:host:port,user,pass add a TURN server, ?delay=N pins the input delay (otherwise it follows the RTT, floor 2), ?netsim=lat,jit,loss (tests),
// ?lang=xx force the UI language (web/i18n/init.js).
(function () {
  'use strict';
  const q = new URLSearchParams(location.search), G = window.SSRG;
  const KIND = q.get('net') === 'peerjs' ? 'peerjs' : 'php', SIGNAL = q.get('signal') || SSRNET.DEFAULT_SIGNAL;
  const ICE = SSRNET.ICE.slice(), EXTRA = [];
  if (q.get('turn')) { const [urls, username, credential] = q.get('turn').split(','); EXTRA.push({ urls, username, credential }); }
  // ?noturn=1: only ?turn= servers (tests); ?direct=N: seconds before the relay-only retry (default 15)
  const iceAll = async () => ICE.concat(EXTRA, q.get('noturn') ? [] : await SSRNET.getTurn(SIGNAL));
  const DIRECT_S = +(q.get('direct') || 15), RELAY_S = +(q.get('relayt') || 20);
  const t = (k, o) => (window.t || (x => x))(k, o);
  const SIM = SSRLINK.parseSim(q.get('netsim'));
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => ALPHA[b % ALPHA.length]).join('');
  // room names: uppercase, accents removed, whitespace runs -> '-', anything else dropped, max 16 (Worker: /^[A-Z0-9-]{3,16}$/)
  const ROOM_RE = /^[A-Z0-9-]{3,16}$/, ROOM_MAX = 16;
  const normRoom = x => String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').slice(0, ROOM_MAX);
  // normalize an <input> in place keeping the caret where the user is typing
  function normField(el) { const v = el.value, c = el.selectionStart == null ? v.length : el.selectionStart, nv = normRoom(v);
    if (nv !== v) { const nc = Math.min(normRoom(v.slice(0, c)).length, nv.length); el.value = nv; try { el.setSelectionRange(nc, nc); } catch (e) {} } return nv; }
  // create-room field state: '' (empty) | 'short' | 'ok'
  const nameState = n => !n ? 'empty' : ROOM_RE.test(n) ? 'ok' : 'short';
  function nameMsg(n) { const k = nameState(n); return k === 'short' ? `<span style="color:#ffb0a0">${t('net.room.short')}</span>` : k === 'empty' ? t('net.room.empty') : t('net.room.hint'); }
  const css = `#np{position:fixed;right:12px;top:12px;width:min(380px,92vw);box-sizing:border-box;background:rgba(20,12,4,.93);color:#f3e2c0;font:14px system-ui,sans-serif;
    border:2px solid #c8892e;border-radius:10px;padding:12px;z-index:10;display:none;max-height:calc(100vh - 48px);overflow:auto}#np h3{margin:0 0 8px;font-size:16px;color:#ffc861}
    #np button{background:#c8892e;color:#1a0f02;border:0;border-radius:6px;padding:6px 10px;margin:3px 3px 3px 0;font:600 13px/16px system-ui,sans-serif;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center;gap:5px;box-sizing:border-box;vertical-align:middle;white-space:nowrap}
    #np input{width:100%;box-sizing:border-box;padding:6px;border-radius:6px;border:1px solid #c8892e;background:#000;color:#fff;margin:4px 0}
    #np .slot{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #4a3010}#np small{color:#b9a27a}
    #np table{width:100%;border-collapse:collapse;font-size:12px;margin-top:4px}#np td,#np th{padding:2px 3px;text-align:left;border-bottom:1px solid #4a3010}#np td:first-child b{white-space:nowrap}
    #np th{color:#ffc861;font-weight:600}#np td button{padding:3px 8px;margin:0;font-size:12px;line-height:14px}
    #np button svg{flex:none}
    #np td .bstack{display:flex;flex-direction:column;align-items:stretch;gap:3px;width:max-content;margin:0 auto}#np td button:disabled,#np button:disabled{background:#6b5a40;cursor:default}
    #np label{display:block;margin:2px 0}#np label input{width:auto;margin:0 4px 0 0}
    #np .spk{display:inline-block;width:16px;height:16px;vertical-align:-3px;margin-right:4px;opacity:.22;color:#b9a27a}#np .spk.on,#npvh .spk.on{opacity:1;color:#7dff7d}
    #np .vmute{padding:1px 4px;margin:0 0 0 4px;background:transparent;color:#ffc861;border:1px solid #6b5a40;line-height:0}#np .vmute.m{color:#ff8a7a;border-color:#ff8a7a}#np .vmute svg{width:14px;height:14px}
    #np .vc{margin-top:8px;padding-top:6px;border-top:1px solid #4a3010}#np .vc h4{margin:0 0 4px;font-size:13px;color:#ffc861}
    #np .mic{display:inline-flex;align-items:center;gap:6px}#np .mic svg{width:16px;height:16px}#np .mic.on{background:#4fb35a;color:#06210a}#np .mic.tx{background:#7dff7d}
    #np .vc input[type=range]{width:100%;padding:0;margin:2px 0}
    #nphint{position:fixed;z-index:12;display:none;pointer-events:none;text-align:center;white-space:nowrap;font-family:Georgia,'Times New Roman',serif;font-weight:700}
    #nphint.bz{transform:translate(-50%,-50%);color:#ffe6a0;letter-spacing:.04em;
      text-shadow:2px 0 #000,-2px 0 #000,0 2px #000,0 -2px #000,2px 2px #000,-2px 2px #000,2px -2px #000,-2px -2px #000,0 0 5px #000}
    #nphint.fb{left:50%;top:10px;transform:translateX(-50%);max-width:90vw;white-space:normal;background:rgba(10,6,2,.88);color:#ffe9a8;border:2px solid #ffc861;border-radius:10px;padding:7px 14px;font:700 16px system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5)}
    #npvh{position:fixed;left:12px;top:12px;z-index:8;display:none;flex-direction:column;gap:4px;pointer-events:none;font:600 14px system-ui,sans-serif}
    #npvh div{background:rgba(10,6,2,.78);color:#f3e2c0;border-radius:14px;padding:3px 10px 3px 6px;border:1px solid #7dff7d}#npvh .spk{display:inline-block;width:16px;height:16px;vertical-align:-3px;margin-right:4px}
    #bar{position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:9;display:flex;gap:6px;align-items:center}
    #npb{background:#c8892e;color:#1a0f02;border:0;border-radius:6px;padding:5px 9px;font:600 12px system-ui;cursor:pointer}`;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
  const box = Object.assign(document.createElement('div'), { id: 'np' }); document.body.appendChild(box);
  const bar = Object.assign(document.createElement('div'), { id: 'bar' });
  const btn = Object.assign(document.createElement('button'), { id: 'npb', type: 'button', textContent: t('net.btn') });
  bar.appendChild(btn); document.body.appendChild(bar);
  if (window.SSRGFX && SSRGFX.layout) SSRGFX.layout();
  const show = v => { box.style.display = v ? 'block' : 'none'; if (v) refreshList(); };
  btn.onclick = () => show(box.style.display !== 'block');
  addEventListener('keydown', e => { if (e.code === 'F7') { e.preventDefault(); show(box.style.display !== 'block'); } });
  const nickKey = 'ssr_nick', getNick = () => { try { return localStorage.getItem(nickKey) || ''; } catch (e) { return ''; } };
  // st.wait = guest wait phase for hint.js ('connecting' | 'relay' | 'receiving' | 'fail' | null), independent of the language
  const st = { s: null, t: null, room: null, role: null, msg: '', wait: null, log: [], rooms: null, pub: true, autoWatch: false, name: '', code: '', busy: false };
  const pubKey = 'ssr_public', getPub = () => { try { return localStorage.getItem(pubKey) !== '0'; } catch (e) { return true; } };
  const escH = x => String(x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  // what the game is showing, from work RAM: 0x104001 = 1 attract / 2 game, 0x104003 = attract step (5 = demo),
  // 0x104300 = stage index (0 = stage 1). See NOTES.md "Room list".
  // stageName is the room-list protocol value sent to the signal server (kept pt-BR so older clients still match);
  // stageLabel/hostLabel translate those protocol values for display in the local language.
  function stageName(m) { const w = m && m.wram; if (!w) return ''; if (w[1] === 2) return 'Fase ' + (w[0x300] + 1); return w[1] === 1 && w[3] === 5 ? 'Demo' : 'Tela de título'; }
  function stageLabel(x) { x = String(x || ''); let r = /^Fase (\d+)$/.exec(x); if (r) return t('net.stage.n', { n: +r[1] });
    if (x === 'Tela de título') return t('net.stage.title'); if (x === 'Demo') return t('net.stage.demo'); return x; }
  const hostLabel = x => x ? SSRSESSION.localName(x) : x;
  // meta for signal.php: public rooms are listed; private ones send pv:1 (never listed, only counted in the owner's usage stats)
  function meta() { const s = st.s; if (!s || st.role !== 'host') return null;
    return { n: getNick() || 'Jogador 1', p: 1 + s.links.filter(l => l.slot > 0).length, s: s.spectators().length, st: stageName(G.machine),
      pv: st.pub ? 0 : 1, pl: s.names().filter(x => x), sp: s.spectators() }; }
  const EYE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
  // public room list (only while the panel is open and we are not in a room)
  function listHtml() {
    if (st.rooms === null) return '<small>' + t('net.rooms.loading') + '</small>';
    const rows = st.rooms.filter(r => r.room !== st.room);
    if (!rows.length) return '<small>' + t('net.rooms.empty') + '</small>';
    let h = `<table><tr><th>${t('net.th.room')}</th><th>${t('net.th.host')}</th><th>${t('net.th.players')}</th><th>${t('net.th.spec')}</th><th>${t('net.th.stage')}</th><th></th></tr>`;
    for (const r of rows) {
      const full = r.p >= 4, specFull = r.s >= SSRSESSION.MAXSPEC, rr = escH(r.room);
      // [Join] (players) + [eye Watch] (spectator, never takes a player slot); a full room only offers Watch; nothing left = "Full"
      const bj = full ? '' : `<button data-r="${rr}">${t('net.join')}</button>`;
      const bw = specFull ? `<button disabled class="eye" title="${t('net.watchNone')}" aria-label="${t('net.watchNone')}">${EYE}${t('net.watch')}</button>` : `<button data-r="${rr}" data-d="1" class="eye">${EYE}${t('net.watch')}</button>`;
      const b = `<div class="bstack">${bj}${bw}</div>`; // stacked, same width (the wider one), centred in the cell
      h += `<tr><td><b>${escH(r.room)}</b></td><td>${escH(hostLabel(r.host) || '?')}</td><td>${r.p | 0}/4</td><td>${r.s | 0}/${SSRSESSION.MAXSPEC}</td><td>${escH(stageLabel(r.st))}</td><td>${b}</td></tr>`;
    }
    return h + '</table>';
  }
  function bindList(el) { for (const b of el.querySelectorAll('button[data-r]')) b.onclick = () => join(b.dataset.r, false, false, !!b.dataset.d).catch(err); }
  async function refreshList() {
    if (KIND !== 'php' || st.s || box.style.display !== 'block') return;
    const r = await SSRNET.listRooms(SIGNAL); if (r) st.rooms = r; else if (st.rooms === null) st.rooms = [];
    const el = box.querySelector('#np-list'); if (el && !st.s) { el.innerHTML = listHtml(); bindList(el); }
  }
  setInterval(refreshList, 5000);
  const ctl = { active: () => !!(st.s && (st.s.rb || st.role === 'guest')), tick: fi => { const s = st.s; if (s.spec && s.vaga && !st.watchOnly && (fi & SSRIN.COIN)) s.promote(); return s.tick(s.spec ? 0 : fi); }, get session() { return st.s; }, get state() { return st; }, get voice() { return st.s && st.s.voice; } };
  function link() {
    const u = new URL(location.href); u.search = ''; u.searchParams.set('sala', st.room);
    if (KIND === 'peerjs') u.searchParams.set('net', 'peerjs');
    if (q.get('signal')) u.searchParams.set('signal', SIGNAL);
    return u.toString();
  }
  // ---- voice chat UI (net/voice.js) ----
  const SPK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 4V5L7 9H3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const SPKX = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 4V5L7 9H3z"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const MIC = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const vh = Object.assign(document.createElement('div'), { id: 'npvh' }); document.body.appendChild(vh);
  const voice = () => st.s && st.s.voice;
  // invite-link hint: only for whoever opened ?sala= (not the host, not join-by-field/list). Small DOM banner over the game,
  // pointer-events none, never touches input/sim; fades after 8 s or when TAB is pressed (the key still reaches the chat).
  const hb = Object.assign(document.createElement('div'), { id: 'nphint' }); document.body.appendChild(hb);
  let hintTimer = 0, hintShown = false;
  // Placement: on the wooden/leather bar of the bezel right BELOW the CRT screen (between the lower corner stars), i.e. outside the game
  // picture and clear of the coin hint. If the Multijogador button occupies the same strip, sit in the gap above it when there is
  // room; otherwise use the fallback. Fallback (bezel off ?gfx=crt|orig, no WebGL layout, a screen so small that the bar text would
  // be < 11 px, or a collision with the button): a framed banner at the top centre of the page.
  function placeHint() {
    if (hb.style.display !== 'block') return;
    const GF = window.SSRGFX, R = GF && GF.mode === 'bezel' && GF.rects ? GF.rects() : null;
    if (R && R.a && R.g) { const k = R.a.w / GF.BZ.w, fs = Math.round(21 * k * 10) / 10;
      if (fs >= 11) {
        hb.className = 'bz'; hb.style.left = (R.g.x + R.g.w / 2) + 'px'; hb.style.top = (R.a.y + 1049 * k) + 'px'; hb.style.fontSize = fs + 'px'; hb.style.maxWidth = (R.g.w * 0.92) + 'px';
        const barEl = document.getElementById('bar');
        if (barEl && barEl.offsetHeight) {
          const br = barEl.getBoundingClientRect(), hintH = Math.max(hb.offsetHeight || 0, fs);
          const cx = R.a.y + 1049 * k;
          if (cx - hintH / 2 < br.bottom && cx + hintH / 2 > br.top) {
            const gameBottom = R.g.y + R.g.h, gap = br.top - gameBottom;
            if (gap >= hintH + 2) hb.style.top = (gameBottom + gap / 2) + 'px';
            else { hb.className = 'fb'; hb.style.left = hb.style.top = hb.style.fontSize = hb.style.maxWidth = ''; }
          }
        }
        return;
      } }
    hb.className = 'fb'; hb.style.left = hb.style.top = hb.style.fontSize = hb.style.maxWidth = '';
  }
  addEventListener('resize', () => { if (hb.style.display === 'block') placeHint(); });
  function hideHint() { clearTimeout(hintTimer); hintTimer = 0; hb.style.display = 'none'; }
  function showHint(watching) { if (hintShown) return; hintShown = true; hb.textContent = t(watching ? 'voice.hintBarWatch' : 'voice.hintBar'); hb.style.display = 'block'; placeHint(); hintTimer = setTimeout(hideHint, 8000); }
  addEventListener('keydown', e => { if (e.code === 'Tab' && hb.style.display === 'block') hideHint(); }, true);
  function voiceHtml() {
    const s = st.s, v = voice(); if (!v) return '';
    let h = `<div class="vc"><h4>${t('voice.title')}</h4>`;
    if (s.spec) h += `<small>${t('voice.specOnly')}</small>`;
    else if (s.slot >= 0) {
      h += `<button id="np-mic" class="mic${v.micOn ? ' on' : ''}${v.selfOn ? ' tx' : ''}">${MIC}<span>${v.micOn ? (v.selfOn ? t('voice.micSending') : t('voice.micOn')) : t('voice.micOff')}</span></button>`;
      h += `<br><small>${v.micOn ? t('voice.hintOn') : t('voice.hintOff')}</small>`;
    }
    h += `<label for="np-vvol"><small>${t('voice.volume')}: <span id="np-vvol-n">${Math.round(v.vol * 100)}%</span></small></label><input type="range" id="np-vvol" min="0" max="100" step="5" value="${Math.round(v.vol * 100)}">`;
    if (v.err) h += `<div style="color:#ffb0a0">${t('voice.err.' + v.err)}</div>`;
    return h + '</div>';
  }
  // live update of the speaker icons / HUD without re-rendering the panel (keeps sliders and focus alone)
  function voiceChanged(kind) {
    const v = voice(); if (!v) return;
    if (kind === 'speak' || kind === 'mute') {
      for (const el of box.querySelectorAll('[data-vs]')) el.classList.toggle('on', !!v.speaking[+el.dataset.vs]);
      const nm = st.s.names(), items = [];
      for (let p = 0; p < 4; p++) if (v.speaking[p]) { const n = p === st.s.slot ? t('net.slot.you') : (SSRSESSION.localName(nm[p]) || t('net.playerN', { n: p + 1 })); items.push(`<div data-hv="${p}"><span class="spk on">${SPK}</span>${escH(n)}</div>`); }
      const mb = box.querySelector('#np-mic'); if (mb && v.micOn) { mb.classList.toggle('tx', v.selfOn); mb.querySelector('span').textContent = v.selfOn ? t('voice.micSending') : t('voice.micOn'); }
      vh.innerHTML = items.join(''); vh.style.display = items.length ? 'flex' : 'none';
    }
    if (kind === 'mic' || kind === 'mute') { if (box.style.display === 'block') { const a = document.activeElement; if (!(a && a.id === 'np-vvol')) render(); } }
  }
  function render() {
    const s = st.s, nk = getNick().replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'); let h = `<h3>${t('net.title')}</h3>`;
    h += `<small>${t('net.nick.label')}</small><input id="np-nick" maxlength="${SSRSESSION.NICK_MAX}" placeholder="${t('net.nick.placeholder')}" value="${nk}">`;
    if (!s) {
      const can = nameState(st.name) === 'ok' && !st.busy;
      h += `<small>${t('net.room.label')}</small><input id="np-room" maxlength="${ROOM_MAX}" autocomplete="off" spellcheck="false" placeholder="${t('net.room.placeholder')}" value="${escH(st.name)}">
        <small id="np-room-msg">${nameMsg(st.name)}</small><br>
        <button id="np-create"${can ? '' : ' disabled'}>${t('net.create')}</button><label><input type="checkbox" id="np-pub"${getPub() ? ' checked' : ''}>${t('net.publicLabel')}</label><small>${t('net.code.or')}</small><input id="np-code" maxlength="${ROOM_MAX}" autocomplete="off" spellcheck="false" placeholder="${t('net.code.placeholder')}" value="${escH(st.code)}">
        <button id="np-join">${t('net.join')}</button>`;
      if (KIND === 'php') h += `<div style="margin-top:8px"><small>${t('net.rooms.open')}</small><div id="np-list">${listHtml()}</div></div>`;
    } else if (st.full) {
      if (st.watchOnly) h += `<div>${t('net.err.specFull', { room: escH(st.room), max: SSRSESSION.MAXSPEC })}</div><br><button id="np-leave">${t('net.leave')}</button>`;
      else h += `<div>${t('net.roomFull', { room: st.room })}</div>`;
      if (!st.watchOnly) h += st.full === 'watch' ? `<small>${t('net.roomFullWatch')}</small><br>
        <button id="np-watch">${t('net.watch')}</button><button id="np-leave">${t('net.leave')}</button>` : `<small>${t('net.roomFullNoWatch', { max: SSRSESSION.MAXSPEC })}</small><br><button id="np-leave">${t('net.leave')}</button>`;
    } else {
      if (st.role === 'host') {
        const L = link();
        h += `<div><small>${st.pub ? t('net.pubStatus') : t('net.privStatus')}</small></div>`;
        h += `<div>${t('net.invite', { room: st.room })}</div><input id="np-link" readonly value="${L}">
          <button id="np-copy">${t('net.copy')}</button><a href="https://wa.me/?text=${encodeURIComponent(t('net.waText', { link: L }))}" target="_blank" rel="noopener"><button>${t('net.whatsapp')}</button></a>`;
        const pend = st.t && st.t.pending ? st.t.pending() : 0;
        if (pend) h += `<div style="color:#9fe0ff">${t('net.pendingJoin')}</div>`;
      } else h += `<div>${t('net.roomOnly', { room: st.room })}</div>`;
      const peers = s.peers(), me = s.slot;
      h += '<div style="margin-top:8px">';
      for (let p = 0; p < 4; p++) {
        let who = '<small>' + t('net.slot.free') + '</small>';
        const nm = SSRSESSION.localName(s.names()[p]), esc1 = x => String(x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
        if (p === me) who = t('net.slot.you') + (nm ? ` <small>(${esc1(nm)})</small>` : '');
        else if (st.role === 'host') { const L = peers.find(x => x.slot === p); if (L) who = `${esc1(nm || t('net.slot.connected'))} <small data-rtt="${p}">${L.rtt} ms</small>`; }
        else if (s.rb && s.rb.join[p] !== SSRROLL.INF && s.rb.leave[p] === SSRROLL.INF) who = p === 0 ? `${esc1(nm || t('net.slot.host'))} <small data-rtt="0">${peers[0] ? peers[0].rtt : '?'} ms</small>` : esc1(nm || t('net.slot.connected'));
        let vi = '', vm = '';
        const vv = voice(), occupied = p === me || who.indexOf('<small>' + t('net.slot.free')) !== 0;
        if (vv && occupied) { vi = `<span class="spk${vv.speaking[p] ? ' on' : ''}" data-vs="${p}">${SPK}</span>`;
          if (p !== me) { const mu = vv.mute[p], nn = esc1(nm || t('net.playerN', { n: p + 1 })); vm = `<button class="vmute${mu ? ' m' : ''}" data-vm="${p}" title="${mu ? t('voice.unmute', { name: nn }) : t('voice.mute', { name: nn })}" aria-label="${mu ? t('voice.unmute', { name: nn }) : t('voice.mute', { name: nn })}" aria-pressed="${mu}">${mu ? SPKX : SPK}</button>`; } }
        h += `<div class="slot"><span>${vi}${t('net.playerN', { n: p + 1 })}</span><span>${who}${vm}</span></div>`;
      }
      const sp = s.spectators(), esc = x => String(x).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
      h += `<div class="slot"><span>${t('net.specs', { n: sp.length, max: SSRSESSION.MAXSPEC })}</span><span><small>${sp.length ? sp.map(x => esc(SSRSESSION.localName(x))).join(', ') : t('net.specs.none')}</small></span></div>`;
      if (s.spec) h += `<div style="margin-top:6px;color:#9fe0ff">${t('net.watching')}</div>` + (s.vaga ? `<div style="color:#8f8">${t(st.watchOnly ? 'net.slotFreeWatch' : 'net.slotFree')}</div><button id="np-promote">${t('net.promote')}</button>` : '');
      h += `</div>${voiceHtml()}<small>${t('net.help')}</small><br><button id="np-leave">${t('net.leaveRoom')}</button>`;
    }
    if (st.msg) h += `<div style="margin-top:6px;color:#ffb0a0">${st.msg}</div>`;
    box.innerHTML = h;
    const $ = id => box.querySelector('#' + id);
    const doCreate = () => { if (nameState(st.name) !== 'ok' || st.busy) { if ($('np-room')) $('np-room').focus(); return; }
      host($('np-pub') ? $('np-pub').checked : undefined, st.name).catch(err); };
    const doJoin = () => join(normRoom($('np-code').value)).catch(err);
    if ($('np-room')) { const el = $('np-room');
      el.oninput = () => { st.name = normField(el); const c = $('np-create'); if (c) c.disabled = !(nameState(st.name) === 'ok' && !st.busy); const m = $('np-room-msg'); if (m) m.innerHTML = nameMsg(st.name); };
      el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doCreate(); } }; }
    if ($('np-code')) { const el = $('np-code'); el.oninput = () => { st.code = normField(el); }; el.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doJoin(); } }; }
    if ($('np-create')) $('np-create').onclick = doCreate;
    if ($('np-join')) $('np-join').onclick = doJoin;
    if ($('np-copy')) $('np-copy').onclick = () => { navigator.clipboard.writeText(link()).then(() => { st.msg = t('net.copied'); render(); }, () => { $('np-link').select(); }); };
    if ($('np-leave')) $('np-leave').onclick = leaveClick;
    if ($('np-mic')) $('np-mic').onclick = () => { const v = voice(); if (v) v.toggleMic().catch(e => console.warn(e)); };
    if ($('np-vvol')) $('np-vvol').oninput = e => { const v = voice(); if (v) { v.setVolume(e.target.value / 100); $('np-vvol-n').textContent = e.target.value + '%'; } };
    for (const b of box.querySelectorAll('button[data-vm]')) b.onclick = () => { const v = voice(), sl = +b.dataset.vm; if (v) v.setMute(sl, !v.mute[sl]); };
    if ($('np-pub')) $('np-pub').onchange = e => { try { localStorage.setItem(pubKey, e.target.checked ? '1' : '0'); } catch (x) {} };
    if ($('np-list')) bindList($('np-list'));
    if ($('np-nick')) $('np-nick').onchange = e => { const n = SSRSESSION.cleanNick(e.target.value); try { localStorage.setItem(nickKey, n); } catch (x) {} e.target.value = n; if (st.s) st.s.setName(n); };
    if ($('np-watch')) $('np-watch').onclick = () => { st.full = null; st.msg = t('net.watchingRecv'); st.s.watch(); render(); };
    if ($('np-retry')) $('np-retry').onclick = () => { const r = st.retry, d = st.retryWatch; endSession(); join(r, false, false, d).catch(err); };
    if ($('np-promote')) $('np-promote').onclick = () => { st.s.promote(); render(); };
  }
  function err(e) { st.msg = t('net.err.prefix') + (e && e.message || e); console.warn(e); render(); }
  // signal server errors that the player can act on (Worker / signal.php error strings)
  function roomErr(e, room) { const m = e && e.message;
    if (m === 'room taken') return t('net.err.roomTaken', { room: escH(room) });
    if (m === 'bad room') return t('net.err.serverName', { room: escH(room) });
    if (m === 'no such room') return t('net.err.noRoom', { room: escH(room) });
    return null; }
  function makeSession(role, extra) {
    const m = G.machine;
    // ?delay=N pins the input delay (tests); otherwise it starts at 2 and follows the measured RTT (Session.followRtt)
    const rawDelay = q.get('delay'), delayPinned = rawDelay != null && rawDelay !== '' && Number.isFinite(+rawDelay);
    const delayOpt = delayPinned ? Math.max(0, Math.min(30, +rawDelay | 0)) : 2;
    const s = new SSRSESSION.Session(Object.assign({ m, step: G.netStep, role, name: getNick(), delay: delayOpt, delayPinned, onAudio: G.netAudio,
      onEvent: e => { if (e.t === 'chat') { if (window.SSRCHAT) SSRCHAT.show(e.slot, e.text, e.name); return; }
        if (e.t === 'vaga' && e.v) show(true); st.log.push(e); if (e.t === 'state') { G.netAudioResync(e.snap); st.msg = ''; st.wait = null; } if (e.t === 'hostgone') { st.msg = t('net.hostGone'); endSession(); }
        if (e.t === 'full' && st.autoWatch && e.watch) { st.autoWatch = false; st.msg = t('net.watchingRecv'); st.s.watch(); render(); return; }
        if (e.t === 'full') { st.msg = ''; st.full = e.watch ? 'watch' : 'nowatch'; show(true); } render(); } }, extra));
    if (window.SSRVOICE && SSRVOICE.supported && q.get('net') !== 'peerjs') new SSRVOICE.Voice(s, { onchange: voiceChanged });
    // online highscore (web only; players of a Cloudflare Worker match, never spectators / PeerJS / app:): net/highscore.js
    if (window.SSRHS && location.protocol !== 'app:' && KIND === 'php' && !(extra && extra.watch)) SSRHS.attach(s, () => ({ t: st.t, room: st.room, signal: SIGNAL, nick: getNick() }));
    return s;
  }
  // host(pub, name): name = the typed room name (normalized + validated); omitted only by tests/console -> random code
  async function host(pub, name) {
    const room = name === undefined ? code() : normRoom(name);
    if (!ROOM_RE.test(room)) throw new Error(t('net.err.badName'));
    if (st.busy || st.s) return;
    st.pub = pub === undefined ? getPub() : !!pub;
    st.busy = true;
    try {
      await G.ready; st.room = room; st.role = 'host'; st.msg = t('net.opening'); render();
      st.t = await SSRNET.open(KIND, { room: st.room, role: 'host', signal: SIGNAL, ice: await iceAll(), sim: SIM, meta, simnat: +(q.get('simnat') || 0) });
    } catch (e) {
      // e.g. 409 'room taken': back to the create form with the name kept, so the player can pick another one
      st.room = null; st.role = null; st.t = null; st.busy = false;
      const m = roomErr(e, room); if (!m) throw e;
      console.warn('[ssr-net] host', room, e.message); st.msg = m; render();
      const f = box.querySelector('#np-room'); if (f) { f.focus(); f.select(); }
      return;
    }
    st.busy = false;
    st.s = makeSession('host', { frame: G.frameNo + 1 }); G.net = ctl;
    st.t.onlink = l => { st.s.addLink(l); render(); };
    st.msg = ''; render();
  }
  // join(room, watch, viaLink, direct): direct = spectator from the start (list "Watch" button, ?assistir=1): never takes a player slot
  async function join(room, watch, viaLink, direct) {
    room = normRoom(room);
    if (!ROOM_RE.test(room)) throw new Error(t('net.err.badName'));
    st.autoWatch = !!watch && !direct; st.watchOnly = !!direct; st.viaLink = !!viaLink;
    await G.ready; st.room = room; st.role = 'guest'; st.msg = t('net.connecting'); st.wait = 'connecting'; render(); show(true);
    st.s = makeSession('guest', direct ? { watch: true } : undefined); G.net = ctl;
    const ice = await iceAll(), gen = st.gen = (st.gen || 0) + 1, hasTurn = ice.some(x => /^turns?:/.test([].concat(x.urls)[0]));
    // attempt 1: direct + STUN + TURN (policy all); attempt 2 (if no link after DIRECT_S): fresh connection, relay only
    for (const [policy, secs] of KIND === 'php' ? [['all', DIRECT_S]].concat(hasTurn ? [['relay', RELAY_S]] : []) : [['all', 0]]) {
      if (policy === 'relay') { try { fetch(SIGNAL + '?a=ice&relay=1&room=' + room, { cache: 'no-store' }).catch(() => {}); } catch (e) {} st.msg = t('net.relay'); st.wait = 'relay'; render(); }
      console.log('[ssr-net] guest attempt', policy, 'room', room);
      const ok = await new Promise(async res => {
        let tp; try { tp = await SSRNET.open(KIND, { room, role: 'guest', signal: SIGNAL, ice, sim: SIM, policy, simnat: +(q.get('simnat') || 0) }); } catch (e) { const m = roomErr(e, room); res(m ? Object.assign(new Error(m), { friendly: true }) : e); return; }
        if (st.gen !== gen || !st.s) { tp.close(); res(false); return; }
        st.t = tp; let done = false;
        tp.onlink = l => { done = true; st.s.addLink(l); if (viaLink) showHint(!!direct); st.msg = t('net.receiving'); st.wait = 'receiving'; render(); res(true); };
        if (secs) setTimeout(() => { if (!done) { console.log('[ssr-net] guest: no connection after', secs, 's (' + policy + ')'); tp.onlink = null; tp.close(); if (st.t === tp) st.t = null; res(false); } }, secs * 1000);
      });
      if (ok === true) return;
      if (ok instanceof Error) { endSession(); if (ok.friendly) { st.msg = ok.message; render(); return; } throw ok; }
      if (st.gen !== gen || !st.s) return; // left meanwhile
    }
    st.msg = t('net.fail') + `<br><button id="np-retry">${t('net.retry')}</button>`; st.wait = 'fail';
    st.retry = room; st.retryWatch = !!direct; render();
  }
  function endSession() { st.watchOnly = false; hideHint(); if (st.s && st.s.voice) st.s.voice.stop(); vh.style.display = 'none'; vh.innerHTML = ''; st.gen = (st.gen || 0) + 1; st.full = null; st.wait = null; const lv = st.t ? st.t.close() : null; st.t = null; st.s = null; G.net = null; st.role = null; return lv; }
  // host leaving mid-match: send the score report first (same last-confirmed numbers the guests will send on hostgone), while
  // session / transport / match_id are still available. Guests who click leave must not report (they are omitted from the others' bodies).
  function flushHostScore() { if (st.s && st.s.role === 'host' && typeof st.s.flushScore === 'function') { try { st.s.flushScore(); } catch (e) { console.warn('ssr-score', e); } } }
  // "Sair da sala": a player keeps the current behaviour. A SPECTATOR (Assistir) is left with a frozen game (the last snapshot), so after leaving
  // properly (Worker 'leave' + links closed, so the host sees the spectator go) the page reloads for that user only, without ?sala= / ?assistir=
  // (they would rejoin) and keeping every other parameter (lang, voice, mute...). location.replace so Back does not return to the ?sala= link
  // and rejoin. The reload does not open F7 (nothing joins).
  function reloadUrl() { const u = new URL(location.href); u.searchParams.delete('sala'); u.searchParams.delete('assistir'); return u.toString(); }
  let leaving = false;
  async function leaveReload(grace) {
    if (leaving) return; leaving = true;
    flushHostScore();
    const url = reloadUrl(), lv = endSession(); st.msg = ''; render();
    try { await Promise.race([Promise.resolve(lv), new Promise(r => setTimeout(r, 1500))]); } catch (e) {}
    await new Promise(r => setTimeout(r, grace)); // let the closed peer connections / DataChannels reach the other side
    location.replace(url);
  }
  function leaveSpectator() { return leaveReload(200); }
  // The "Sair da sala" BUTTON (player, host or spectator, web only): leave cleanly then reload for this user only (same as the spectator).
  // SSRNETPLAY.leave() itself keeps its old behaviour for players (in place), which the host idle auto-close (idle.js) and the tests rely on.
  function leaveClick() {
    if (st.s && location.protocol !== 'app:') return leaveReload(st.s.spec === true ? 200 : 400);
    return leave();
  }
  function leave() {
    if (st.s && st.s.spec === true && location.protocol !== 'app:') return leaveSpectator();
    flushHostScore();
    endSession(); st.msg = ''; st.rooms = null; render(); refreshList();
  }
  addEventListener('beforeunload', () => { if (st.t) st.t.close(); });
  // during a match, refresh only RTT and speaker icons (do not rebuild innerHTML every second; events still call render())
  function refreshLive() {
    const s = st.s; if (!s || box.style.display !== 'block') return;
    const peers = s.peers();
    for (const el of box.querySelectorAll('[data-rtt]')) {
      const p = +el.dataset.rtt; let ms = '?';
      if (st.role === 'host') { const L = peers.find(x => x.slot === p); if (L) ms = L.rtt; }
      else if (p === 0) ms = peers[0] ? peers[0].rtt : '?';
      el.textContent = ms + ' ms';
    }
    const v = voice();
    if (v) {
      for (const el of box.querySelectorAll('[data-vs]')) el.classList.toggle('on', !!v.speaking[+el.dataset.vs]);
      const mb = box.querySelector('#np-mic');
      if (mb && v.micOn) { mb.classList.toggle('tx', v.selfOn); const sp = mb.querySelector('span'); if (sp) sp.textContent = v.selfOn ? t('voice.micSending') : t('voice.micOn'); }
    }
  }
  setInterval(() => { if (st.s && box.style.display === 'block' && !st.full) refreshLive(); }, 1000);
  render();
  window.SSRNETPLAY = Object.assign(ctl, { host, join, leave, link, refreshList, stageName, stageLabel, hostLabel, normRoom, ROOM_RE, roomList: () => st.rooms, signal: SIGNAL, kind: KIND, placeHint });
  Object.defineProperty(window.SSRNETPLAY, 'hint', { get: () => (hb.style.display === 'block' ? hb.textContent : null) });
  if (q.get('sala')) join(normRoom(q.get('sala')), false, true, /^(1|true|sim|yes)$/i.test(q.get('assistir') || '')).catch(err);
})();
