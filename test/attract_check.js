// Node check of web/sim/attract.js against the MAME attract recording (byte-exact video state per frame).
// Usage: node test/attract_check.js SEED END [--ram]   seeds the sim from recorded frame SEED (0 = power-on), steps to END.
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const HW = require(R('web/sim/hw.js')), { Sim } = require(R('web/sim/attract.js'));
const rom = fs.readFileSync(R('assets_extracted/prog.bin'));
const fds = fs.openSync(R('ref/attract/state.bin'), 'r'), fdw = fs.openSync(R('ref/attract/wram.bin'), 'r');
const fdp = fs.existsSync(R('ref/attract/spr.bin')) ? fs.openSync(R('ref/attract/spr.bin'), 'r') : null;
const rd = (fd, n, f) => { const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, (f - 1) * n); return new Uint8Array(b); };
const rec = f => HW.fromRecord(rd(fds, HW.REC, f), 0);
function seed(sim, f) {
  const r = rec(f); for (const [k] of HW.FIELDS) sim.v[k].set(r[k]);
  sim.ram.set(rd(fdw, 0x4000, f)); if (fdp) sim.spr.set(rd(fdp, 0x4000, f)); sim.frame = f; sim.mainD0 = r.k053244[6];
}
function diff(sim, f) {
  const r = rec(f), out = [];
  for (const [k] of HW.FIELDS) { const a = sim.v[k], b = r[k]; let n = 0, first = -1;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { n++; if (first < 0) first = i; }
    if (n) out.push(`${k}:${n}@0x${first.toString(16)}`); }
  return out;
}
// RAM bytes that legitimately differ: IRQ register save area / boot stack (they hold the interrupted main thread's
// registers), the 0x104bxx/0x104dxx stacks, and sound-queue bytes the sound CPU acknowledges asynchronously.
const ramNoise = a => (a >= 0x104700 && a < 0x104740) || (a >> 8) === 0x104b || (a >> 8) === 0x104d || a === 0x10401b || a === 0x10401f || (a >= 0x1044ec && a <= 0x1044f3);
module.exports = { Sim, rom, seed, diff, rec, rd, fdw };
if (require.main === module) {
  const S = +process.argv[2], E = +process.argv[3], ramchk = process.argv.includes('--ram');
  // S = 0: power-on run (no seed). Video is compared from frame 14 (earlier frames are mid-test), work RAM from 257
  // (before that it only holds boot test patterns and the boot stack).
  const sim = new Sim(rom); let ok = 0, firstBad = null, n = 0;
  if (S === 0) sim.powerOn(fs.readFileSync(R('assets_extracted/eeprom.bin'))); else seed(sim, S);
  for (let f = S + 1; f <= E; f++) {
    sim.step();
    if (S === 0 && f < 14) continue; n++;
    if (sim.unimpl) { console.log('UNIMPLEMENTED', sim.unimpl); break; }
    const d = diff(sim, f);
    if (ramchk && (S || f >= 257)) { const w = rd(fdw, 0x4000, f); const bad = []; for (let i = 0; i < 0x4000; i++) if (w[i] !== sim.ram[i] && !ramNoise(0x104000 + i) && bad.length < 8) bad.push((0x104000 + i).toString(16) + `:${sim.ram[i].toString(16)}/${w[i].toString(16)}`); if (bad.length) d.push('ram ' + bad.join(' ')); }
    if (d.length) { if (!firstBad) { firstBad = f; console.log('first divergence', f, d.join(' ')); } } else ok++;
  }
  console.log(`${ok}/${n} frames byte-exact` + (firstBad ? `, first divergence ${firstBad}` : ''));
}
