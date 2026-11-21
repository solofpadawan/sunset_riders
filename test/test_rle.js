// Verifies web/sim/engine.js rleBlit (port of 68k 0x00c506) against MAME: REWARD poster blits at attract frame 3890.
// Needs ref/attract/state.bin (run/record_attract.lua) and assets_extracted/prog.bin (tools/extract_prog.py).
const fs = require('fs'), path = require('path'), R = p => path.join(__dirname, '..', p);
const HW = require(R('web/sim/hw.js')), E = require(R('web/sim/engine.js'));
const rom = fs.readFileSync(R('assets_extracted/prog.bin')), fd = fs.openSync(R('ref/attract/state.bin'), 'r');
const rec = f => { const b = Buffer.alloc(HW.REC); fs.readSync(fd, b, 0, HW.REC, (f - 1) * HW.REC); return HW.fromRecord(b, 0); };
const a = rec(3889), b = rec(3890), v = HW.newVideo(); v.k052109.set(a.k052109);
for (const s of [0xa465e, 0xa4742, 0xa456a]) E.rleBlit(rom, v, s); // order/streams from a bp trace on 0xc506
let bad = 0; for (let i = 0; i < 0x1c00; i++) if (v.k052109[i] !== b.k052109[i]) bad++;
for (let i = 0x2000; i < 0x6000; i++) if (v.k052109[i] !== b.k052109[i]) bad++;
console.log(bad ? `FAIL ${bad} tilemap bytes differ` : 'OK: 3 RLE blits reproduce all tilemap bytes of frame 3890 (control regs 0x1c00-0x1fff excluded)');
process.exit(bad ? 1 : 0);
