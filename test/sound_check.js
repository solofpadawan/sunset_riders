// Lockstep the sound board against MAME's access log (run/trace_sound.lua -> /tmp/snd.log):
// feeds the logged 68000 port accesses, compares every Z80 I/O access (time, address, value) and every 68000 read value.
const fs = require('fs'), path = require('path');
const SB = require('../web/sim/sound.js');
const A = path.join(__dirname, '../web/assets/');
const b = new SB(fs.readFileSync(A + 'z80.bin'), fs.readFileSync(A + 'k053260.bin'));
const zq = [];
const ozr = b.zr.bind(b), ozw = b.zw.bind(b);
b.zr = a => { const v = ozr(a); if (a >= 0xf800) zq.push([b.at(), 'r', a, v]); return v; };
b.zw = (a, d) => { ozw(a, d); if (a >= 0xf800) zq.push([b.at(), 'w', a, d]); };
const lines = fs.readFileSync(process.env.LOG || '/tmp/snd.log', 'utf8').split('\n');
const maxFrame = +(process.env.FRAMES || 400);
let zi = 0, nz = 0, bad = 0, mbad = 0, nm = 0, dt = new Map();
const pend = [];  // MAME z accesses
function checkZ(force) {
  while (zq.length && pend.length) {
    const o = zq.shift(), m = pend.shift(); nz++;
    const d = m[0] - o[0]; dt.set(d, (dt.get(d) || 0) + 1);
    if (o[1] !== m[1] || o[2] !== m[2] || o[3] !== m[3]) {
      if (bad++ < 10) console.log('Z mismatch #' + nz, 'ours', o[0], o[1], o[2].toString(16), o[3], 'mame', m[0], m[1], m[2].toString(16), m[3]);
    }
  }
}
for (const L of lines) {
  if (!L) continue;
  const f = L.split(' '); if (+f[0] > maxFrame) break;
  const t = Math.round(+f[1] / 62.5), a = parseInt(f[4], 16), v = parseInt(f[5], 16) | 0;
  if (f[2] === 'z') { pend.push([t, f[3], a, v]); b.frameEnd(t); checkZ(); continue; }
  if (f[3] === 'w') { if (a === 0x5c0604) b.mainIrq(t); else b.mainWrite(t, (a >> 1) & 1, v); }
  else { const r = b.mainRead(t, (a >> 1) & 1); nm++; if (r !== v && mbad++ < 10) console.log('68k read mismatch', f[0], t, 'ours', r, 'mame', v); }
  checkZ();
}
b.frameEnd(Math.round(+lines[0].split(' ')[1] / 62.5)); checkZ();
console.log('z accesses compared', nz, 'mismatches', bad, '| 68k reads', nm, 'mismatches', mbad, '| leftover ours', zq.length, 'mame', pend.length);
console.log('time offsets (mame-ours):', [...dt.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8));
