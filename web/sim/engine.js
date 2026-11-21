// Reimplementations of the ssriders 68000 video primitives, reading data from the user's own program ROM
// (assets/prog.bin, gitignored, built by tools/extract_prog.py). Addresses refer to that ROM.
'use strict';
(function (G) {
  const HW = typeof module !== 'undefined' ? require('./hw.js') : G.SSRHW;
  const rd8 = (rom, a) => rom[a], rd16 = (rom, a) => (rom[a] << 8) | rom[a + 1], rd32 = (rom, a) => ((rom[a] << 24) | (rom[a + 1] << 16) | (rom[a + 2] << 8) | rom[a + 3]) >>> 0;
  // 0x00c506: RLE tilemap blit. Stream: dest.l, width.b, rows.b, then opcodes. Returns stream end.
  function rleBlit(rom, v, src) {
    let p = src; let a4 = rd32(rom, p) - 0x600000; p += 4;
    let d2 = rom[p++], d1 = rom[p++];
    const d0 = (-((d2 << 1) - 0x80)) << 16 >> 16;
    d1 = (d1 - 1) & 0xff; d2 = (d2 - 1) & 0xff; let d3 = -1, d4 = 0, d5 = 0, d6 = 0;
    const put = (hi, lo) => { HW.vramWriteB(v, a4, hi); HW.vramWriteB(v, a4 + 1, lo); a4 += 2; };
    // run(kind): returns false when the blit ends
    for (;;) {
      const op = rom[p++];
      if (op === 0) return p;
      if (op === 4) { d4 = rom[p++]; continue; }
      let mk;
      if (op === 1) { d6 = rom[p++]; d4 = rom[p++]; d5 = rom[p++]; mk = () => put(d4, d5); }
      else if (op === 2) { d6 = rom[p++]; mk = () => put(d4, rom[p++]); }
      else if (op === 3) { d6 = rom[p++]; mk = () => { const h = rom[p++]; put(h, rom[p++]); }; }
      else if (op === 5) { d5 = rom[p++]; d6 = rom[p++]; mk = () => { put(d4, d5); d5 = (d5 + 1) & 0xff; }; }
      else throw new Error('rle op ' + op + ' at ' + (p - 1).toString(16));
      let next = false;
      for (;;) {
        if (d3 < 0) d3 = d2;
        mk(); d6 = (d6 - 1) & 0xff;
        if (d6 === 0) {
          const borrow = d3 === 0; d3 = d3 - 1; // sub.w #1 ; bcc next opcode
          if (!borrow) { next = true; break; }
          a4 += d0; d1 = d1 - 1; if (d1 < 0) return p; // dbra d1 (byte-sized count from moveq/move.b, d1>=0)
          d3 = -1; next = true; break;
        }
        d3 -= 1;
        if (d3 !== -1) continue;
        a4 += d0; d1 -= 1; if (d1 < 0) return p;
      }
      if (next) continue;
    }
  }
  // 0x00d0ac: copy 32-colour (64-byte) blocks from a pointer list into palette RAM.
  // pal is stored little-endian per word (renderer convention); ROM words are big-endian.
  function palBlocks(rom, v, listAddr, palByteOff, nBlocks) {
    let a5 = listAddr, o = palByteOff;
    for (let i = 0; i < nBlocks; i++) {
      const a3 = rd32(rom, a5); a5 += 4;
      for (let j = 0; j < 64; j += 2) { v.pal[o + j] = rom[a3 + j + 1]; v.pal[o + j + 1] = rom[a3 + j]; }
      o += 64;
    }
  }
  const api = { rd8, rd16, rd32, rleBlit, palBlocks };
  if (typeof module !== 'undefined') module.exports = api; else G.SSRENG = api;
})(typeof window !== 'undefined' ? window : globalThis);
