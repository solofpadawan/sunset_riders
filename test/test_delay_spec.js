// Adaptive input delay ignores spectator links (they send no inputs) but follows a slow player. node test/test_delay_spec.js (no ROM, no network)
'use strict';
const assert = require('assert');
const { Session } = require('../web/net/session.js');
const STEP = 1000 / 59.1856;
const m = { save() { return {}; }, load() {} };
const mk = role => new Session({ m, step() {}, role, frame: 10, stepMs: STEP, maxRoll: 8 });
const link = () => ({ send() {}, onmsg: null, onclose: null, close() {} });
const host = mk('host');
const p = host.addLink(link()); p.slot = 1; p.rtt = 60;
const sp = host.addLink(link()); sp.spec = true; sp.rtt = 700;
host.followRtt(); assert.equal(host.rb.delay, 2, 'spectator RTT must not raise the host delay');
p.rtt = 500; host.followRtt(); assert.equal(host.rb.delay, 10, 'slow player raises the host delay');
const pinned = new Session({ m, step() {}, role: 'host', frame: 10, stepMs: STEP, maxRoll: 8, delayPinned: true, delay: 3 });
const q = pinned.addLink(link()); q.slot = 1; q.rtt = 900; pinned.followRtt(); assert.equal(pinned.rb.delay, 3, '?delay= stays pinned');
console.log(JSON.stringify({ ok: true, hostDelaySpecOnly: 2, hostDelaySlow: 10, pinned: 3 }));
