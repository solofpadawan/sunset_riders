// Full-machine sound check: replay the input movie in ssr.js with the sound board attached and compare every Z80 write
// to the sound chips (time, address, data) and every 68000 sound-port access with MAME (run/trace_sound.lua + SSR_MOVIE).
// Usage: node test/sound_machine_check.js [LOG=/tmp/snd_movie.log] [FRAMES=3000]
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const { Machine } = require(R('web/sim/ssr.js')); const IN = require(R('web/input.js'));
const A = n => fs.readFileSync(R('assets_extracted/' + n));
const LOG = process.argv[2] || '/tmp/snd_movie.log', F = +(process.argv[3] || 3000);
const m = new Machine(A('prog.bin'), A('eeprom.bin'), A('gfx_tiles.bin'), A('gfx_sprites.bin'));
m.attachSound(A('z80.bin'), A('k053260.bin')); m.powerOn();
const ports = fs.readFileSync(R('ref/movie/ports.bin'));
const ours = [], b = m.snd, ozw = b.zw.bind(b), omw = b.mainWrite.bind(b), omi = b.mainIrq.bind(b), omr = b.mainRead.bind(b);
b.zw = (a, d) => { if (a >= 0xf800) ours.push(b.at() + ' z w ' + a.toString(16) + ' ' + d.toString(16)); ozw(a, d); };
b.mainWrite = (t, p, d) => { ours.push(t + ' m w ' + (0x5c0600 + 2 * p).toString(16) + ' ' + d.toString(16)); omw(t, p, d); };
b.mainIrq = t => { ours.push(t + ' m w 5c0604 x'); omi(t); };
for (let f = 1; f <= F; f++) {
  const k = f - 1; if (k >= 1 && k * 5 <= ports.length) IN.applyFrame(m, IN.fromPorts(ports.subarray((k - 1) * 5, k * 5)));
  if (f > 1) m.step();
}
// MAME side (writes only)
const mame = [];
const fd = fs.openSync(LOG, 'r'), buf = Buffer.alloc(1 << 24); let carry = '', n;
while ((n = fs.readSync(fd, buf, 0, buf.length)) > 0) {
  const ls = (carry + buf.toString('latin1', 0, n)).split('\n'); carry = ls.pop();
  for (const L of ls) { const f = L.split(' '); if (f[3] !== 'w') continue; if (+f[0] >= F) break;
    const t = Math.round(+f[1] / 62.5), a = parseInt(f[4], 16), v = parseInt(f[5], 16);
    mame.push(t + ' ' + f[2] + ' w ' + f[4] + ' ' + (a === 0x5c0604 ? 'x' : (v & 0xff).toString(16))); }
}
const split = (L, w) => L.filter(x => x.split(' ')[1] === w);
let bad = 0, mwOff = new Map();
for (const w of ['z', 'm']) {
  const o = split(ours, w), q = split(mame, w); let wb = 0;
  for (let i = 0; i < Math.min(o.length, q.length); i++) if (o[i] !== q[i]) {
    const a = o[i].split(' '), c = q[i].split(' ');
    if (w === 'm' && a.slice(1).join() === c.slice(1).join()) { const d = c[0] - a[0]; mwOff.set(d, (mwOff.get(d) || 0) + 1); continue; }
    if (wb++ < 6) console.log(w, '#' + i, 'ours', o[i], '| mame', q[i]);
  }
  console.log(w, 'writes: ours', o.length, 'mame', q.length, 'mismatches', wb); bad += wb;
}
console.log('68k write time offsets (mame-ours)', [...mwOff]);
process.exit(bad ? 1 : 0);
