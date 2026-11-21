// Attract-mode simulation for ssriders: a re-implementation (not an emulation) of the 68000 attract code paths.
// Every routine below is a hand port of the original routine at the address in its name; data (scroll scripts, tile
// block tables, palettes, maps) is read from the user's own program ROM (assets/prog.bin). State lives in plain typed
// arrays laid out like the original work RAM so it is integer-only, deterministic and snapshot-able (Online 2P rule),
// and so it can be checked byte for byte against MAME work-RAM traces.
'use strict';
(function (G) {
  const HW = typeof module !== 'undefined' ? require('./hw.js') : G.SSRHW;
  const ENG = typeof module !== 'undefined' ? require('./engine.js') : G.SSRENG;
  const s8 = x => (x << 24) >> 24, s16 = x => (x << 16) >> 16;

  class Sim {
    constructor(rom) {
      this.rom = rom;
      this.ram = new Uint8Array(0x4000);   // 0x104000-0x107fff work RAM
      this.spr = new Uint8Array(0x4000);   // 0x180000-0x183fff sprite/object RAM
      this.v = HW.newVideo();              // chip state consumed by render.js
      this.frame = 0;
      this.late = 0; this.d0 = 0;
      this.mainD0 = 0;                     // low byte of main-loop d0 (leaks into a K053244 register via the IRQ)
      this.unimpl = null;                  // first unported path hit (string), sim stops advancing
      this.post = 0;                       // 1 while the power-on self test (no IRQ yet) is running
    }
    // ---- power-on (0x001000 reset vector, service switch off -> 0x001102) ----
    // The boot code runs with interrupts masked, so it is ported as straight-line work scheduled at the frames where
    // MAME's recording shows its effects (measured: test screen complete at 14, ROM-check text 116/117, logo screen 171,
    // RAM clear/init 254-256, first vblank IRQ 257). Frames 1-13 (VRAM/palette tests in progress) are approximated.
    powerOn(eeprom) {
      this.ram.fill(0); this.spr.fill(0); this.v = HW.newVideo(); this.frame = 0; this.late = 0; this.d0 = 0; this.mainD0 = 0;
      this.unimpl = null; this.post = 1; this.eeprom = eeprom;
    }
    movepL(a, d) { for (let k = 0; k < 4; k++) this.w8(a + 2 * k, d >>> (24 - 8 * k)); }
    // 0x001a5c / 0x001b30 memory tests: they leave the incrementing 00 01 02 03 / 04 05 06 07 ... pattern behind
    memPattern_1ab6(a, n) {
      let d1 = 0x10203;
      for (let i = 0; i < n; i += 4) {
        this.w32(a + i, d1); d1 = (d1 + 0x4040404) >>> 0; if ((d1 & 0xffff) === 0x303) d1 = 0x10203;
      }
    }
    // 0x0017ea: test screen palette + clear the first 0x1000 bytes of the K052109 (attr 0x10)
    testScreen_17ea() {
      let a = 0x140000; const cp = src => { for (let i = 0; i < 32; i++) this.w8(a++, this.rom[src + i]); };
      cp(0xe1c0); cp(0xe1e0); for (let k = 0; k < 6; k++) cp(0xe1c0);
      for (a = 0x140100; a < 0x141000; a++) this.w8(a, 0);
      for (let i = 0, p = 0x600000; i < 0x200; i++, p += 8) { this.movepL(p, 0); this.movepL(p + 1, 0x10101010); }
    }
    // 0x001870: test-screen text: [offset.w][attr.w] chars; '/' = next string, '?' = end; returns cells written
    text_1870(a5) {
      let n = 0;
      for (;;) {
        let a4 = 0x600000 + this.r16(a5); const at = (this.r16(a5 + 2) << 5) & 0xff; a5 += 4;
        for (;;) {
          const c = this.rom[a5++];
          if (c === 0x3f) return n;
          if (c === 0x2f) break;
          this.w8(a4, at); this.w8(a4 + 1, (c - 0x30) & 0xff); a4 += 2; n++;
        }
      }
    }
    // 0x00118c: clear 0x600000-0x602fff and the scroll registers
    vramClear_118c() {
      for (let p = 0x600000; p < 0x603000; p += 8) { this.movepL(p, 0); this.movepL(p + 1, 0x10101010); }
      for (const a of [0x603900, 0x603402, 0x603400, 0x603018, 0x603403, 0x603401, 0x603019]) this.w8(a, 0);
    }
    // 0x001346: fill the first 32 tilemap rows with the 2c 2d / 2e 2f pattern
    fill_1346() {
      let a = 0x600000;
      for (let r = 0; r < 16; r++) { for (let k = 0; k < 16; k++, a += 8) { this.movepL(a + 0x80, 0); this.movepL(a + 0x81, 0x2e2f2e2f); this.movepL(a, 0); this.movepL(a + 1, 0x2c2d2c2d); } a += 0x80; }
    }
    post_frame(f) {
      if (f === 1) { // 0x001000-0x0010ea chip setup
        this.w8(0x603a00, 0);
        for (const [a, d] of [[0x5c0717, 0], [0x5c0719, 4], [0x5c0705, 0x24], [0x5c0709, 0x2c], [0x5c0707, 0x34], [0x5c070b, 0x2a], [0x5c070d, 0x32], [0x5c0713, 4], [0x5c0715, 0x25]]) this.w8(a, d);
        this.w16(0x1040a4, 0); this.w8(0x603e00, 0); this.w8(0x603b00, 0); this.w8(0x1c0301, 0);
        this.w8(0x5a0008, 0xf4); this.w8(0x5a000d, 0);
        for (const a of [0x603900, 0x603402, 0x603400, 0x603403, 0x603401, 0x603018, 0x603019]) this.w8(a, 0);
        this.w8(0x5a0000, 3); this.w8(0x5a0001, 0xa3); this.w8(0x5a0004, 2); this.w8(0x5a0005, 0xf9);
        this.w8(0x603d00, 0); this.w8(0x5a0009, 0);   // 0x00113e (d7 = 0: no flip DIP)
      }
      if (f === 14) { // 0x00189a: palette + 3 VRAM bank tests, then the test screen
        this.memPattern_1ab6(0x140000, 0x1000);
        for (const b of [0x600000, 0x601000, 0x602000]) this.memPattern_1ab6(b, 0x1000);
        this.testScreen_17ea(); this.text_1870(0x1cd4);
      }
      if (f === 25) { this.memPattern_1ab6(0x104000, 0x4000); this.memPattern_1ab6(0x180000, 0x4000); } // 0x001916 WRAM/obj RAM tests
      if (f === 116) this.testScreen_17ea();   // 0x0019b0 ROM check passed: screen cleared...
      if (f === 117) this.text_1870(0x1ce6);   // ...and its text lands in the next sampled frame
      if (f === 171) { // 0x001156
        this.w8(0x1041b0, 0); this.w8(0x5a000d, 0xff);   // d0 = $ffff left by the 0x001a36 delay loop
        this.vramClear_118c(); this.clearDown(0x184000, 0x4000); this.palLoad_d04e(0xd1aa); this.fill_1346();
      }
      if (f === 254) { // 0x00139e: RAM clear and game init
        this.clearDown(0x104a00, 0xa00); this.clearDown(0x108000, 0x3200);
        this.w16(0x1058fc, 0);
        this.w32(0x104014, 0x104540); this.w32(0x104010, 0x104540); for (let i = 0; i < 0x1c0; i++) this.w8(0x104540 + i, 0xff);
        this.w32(0x10401c, 0x1044c0); this.w32(0x104018, 0x1044c0); for (let i = 0; i < 0x80; i++) this.w8(0x1044c0 + i, 0xff);
        for (let k = 0; k < 10; k++) { const src = this.r32(0xac54 + 4 * (9 - k)); for (let i = 0; i < 8; i++) this.w8(0x104400 + 8 * k + i, this.rom[src + i]); } // 0x00ac1c
        this.w32(0x104120, this.r32(0xac80));
        for (let i = 0; i < 0x80; i++) this.w8(0x104380 + i, this.eeprom ? this.eeprom[i] : 0); // 0x019434 EEPROM read
      }
      if (f === 256) { // 0x001410
        const d6 = this.r8(0x104382), d7 = this.r8(0x104383), d4 = (d6 + this.r8(0x104381)) & 0xff;
        for (const b of [0x104020, 0x104025, 0x10402a, 0x10402f]) { this.w8(b + 1, d4); this.w8(b + 2, d7); this.w8(b + 3, d6); this.w8(b + 4, d7); }
        this.w8(0x104050, 0); this.w8(0x104051, 0xa1); this.w8(0x104052, 0);
        this.w8(0x1040a0, 0); this.w8(0x1c0301, 0); this.w8(0x1040ad, 0x10);
        this.w8(0x5a0000, 3); this.w8(0x5a0001, 0xa3); this.w8(0x5a0004, 2); this.w8(0x5a0005, 0xf9);
        let d1 = 0, d2 = 0;
        if (this.r8(0x10439e)) { this.w8(0x5a0000, 0); this.w8(0x5a0001, 0x5d); this.w8(0x5a0004, 3); this.w8(0x5a0005, 0xf9); d1 = 1; d2 = 3; }
        this.w8(0x603d00, d1); this.w8(0x1040a7, d1); this.w8(0x5a0009, d2); this.w8(0x1040ac, d2);
        this.w8(0x1040a1, this.r8(0x1040a1) | 4); this.w8(0x603a00, this.r8(0x1040a1));
        this.post = 0; this.mainD0 = 0;
      }
    }
    // ---- bus (memory map of ssriders_main_map) ----
    r8(a) {
      if (a < 0xc0000) return this.rom[a];
      if (a >= 0x104000 && a < 0x108000) return this.ram[a - 0x104000];
      if (a >= 0x180000 && a < 0x184000) return this.spr[a - 0x180000];
      if (a >= 0x600000 && a < 0x608000) { const o = HW.vramOff(a - 0x600000); return a & 1 ? this.v.k052109[o + 0x2000] : this.v.k052109[o]; }
      if (a >= 0x140000 && a < 0x141000) return this.v.pal[(a - 0x140000) ^ 1];
      if ((a & ~1) === 0x1c0800) { const w = this.prot_1c0800(); return a & 1 ? w & 0xff : w >> 8; }
      throw new Error('r8 ' + a.toString(16));
    }
    w8(a, d) {
      d &= 0xff;
      if (a >= 0x104000 && a < 0x108000) { this.ram[a - 0x104000] = d; return; }
      if (a >= 0x180000 && a < 0x184000) { this.spr[a - 0x180000] = d; return; }
      if (a >= 0x600000 && a < 0x608000) { HW.vramWriteB(this.v, a - 0x600000, d); this.k052109Reg(HW.vramOff(a - 0x600000) + (a & 1 ? 0x2000 : 0), d); return; }
      if (a >= 0x140000 && a < 0x141000) { this.v.pal[(a - 0x140000) ^ 1] = d; return; }
      if (a >= 0x5c0700 && a < 0x5c0720) { if (a & 1) this.v.k053251[(a - 0x5c0700) >> 1] = d & 0x3f; return; }
      if (a >= 0x5a0000 && a < 0x5a0020) { if (!(a & 2)) this.v.k053244[((a & 0x1c) >> 1) | (a & 1)] = d; return; } // K053244 without A1
      if (a === 0x1c0301) { this.dim(d); return; }
      if (a === 0x1c0201 || a === 0x60b801 || (a >= 0x5c0600 && a < 0x5c0608)) return; // EEPROM/coin latch, watchdog-ish, sound latch: no video state
      throw new Error('w8 ' + a.toString(16));
    }
    r16(a) { return (this.r8(a) << 8) | this.r8(a + 1); }
    r32(a) { return ((this.r16(a) << 16) | this.r16(a + 2)) >>> 0; }
    w16(a, d) { this.w8(a, d >> 8); this.w8(a + 1, d); }
    w32(a, d) { this.w16(a, d >>> 16); this.w16(a + 2, d & 0xffff); }
    add32(a, d) { this.w32(a, (this.r32(a) + d) >>> 0); }
    // K052109 control registers (k052109_device::write), recorded as charrombank[4], charrombank_2[4], addrmap, tileflip, scrollctrl, romsubbank
    k052109Reg(o, d) {
      const r = this.v.k052109_regs;
      if (o === 0x1d80) { r[0] = d & 15; r[1] = d >> 4; } else if (o === 0x1f00) { r[2] = d & 15; r[3] = d >> 4; }
      else if (o === 0x3d80) { r[4] = d & 15; r[5] = d >> 4; } else if (o === 0x3f00) { r[6] = d & 15; r[7] = d >> 4; }
      else if (o === 0x1c00) r[8] = d; else if (o === 0x1e80) r[9] = d & 7; else if (o === 0x1c80) r[10] = d; else if (o === 0x1e00 || o === 0x3e00) r[11] = d;
    }
    // 0x1c0800 read: ssriders protection (ssriders_protection_r); only the command the attract code uses is modelled
    prot_1c0800() {
      const d = this.r16(0x105a0a), c = this.r16(0x1058fc);
      if (c === 0x6003) return d & 0xf;
      if (c === 0x6004) return d & 0x1f;
      if (c === 0x6000) return d & 1;
      if (c === 0x6007 || c === 0) return d & 0xff;
      this.stop('protection cmd ' + c.toString(16)); return 0;
    }
    stop(what) { if (!this.unimpl) this.unimpl = `${what} @frame ${this.frame}`; }

    // ---- snapshot (rollback-ready) ----
    save() { const v = {}; for (const [k] of HW.FIELDS) v[k] = this.v[k].slice(); return { ram: this.ram.slice(), spr: this.spr.slice(), v, frame: this.frame, mainD0: this.mainD0, late: this.late, d0: this.d0, post: this.post, unimpl: this.unimpl }; }
    load(s) { this.ram.set(s.ram); this.spr.set(s.spr); for (const [k] of HW.FIELDS) this.v[k].set(s.v[k]); this.frame = s.frame; this.mainD0 = s.mainD0; this.late = s.late || 0; this.d0 = s.d0 | 0; this.post = s.post | 0; this.unimpl = s.unimpl; }

    // ---- one vblank IRQ (0x001ef2) ----
    step() {
      this.frame++;
      if (this.unimpl) return;
      if (this.post) return this.post_frame(this.frame);
      // 0x001f4a: move.b d0,$5a000c starts the K053245 sprite DMA; d0 is whatever the interrupted main loop left there
      this.v.k053244[6] = this.late ? 0 : this.mainD0;   // a late scene job is interrupted inside its RLE loop (d0 = 0 there)
      for (let i = 0; i < 0x400; i++) { const off = ((i & 7) << 1) | ((i & 0x3f8) << 3); this.v.k053245_buf[2 * i] = this.spr[off * 2]; this.v.k053245_buf[2 * i + 1] = this.spr[off * 2 + 1]; }
      const r = this.r8(0x1040a1) & 0xfb; this.w8(0x1040a1, r); this.w8(0x603a00, r);
      this.w8(0x1040a1, r | 4); this.w8(0x603a00, r | 4);
      this.w16(0x104176, this.r16(0x104176) + 1);
      this.inputs_1ff2();
      this.scrollOut_20b2();
      if (this.r8(0x104001) === 0) this.boot_2254(); else this.attract_23ba();
      if (this.late && !this.unimpl) { const r = this.late; this.late = 0; this.callRoutine(r); this.w8(0x1060ac, 0); this.mainD0 = this.d0; }
      if (!this.unimpl) this.runJobs();
    }
    // 0x001ff2: input history. No buttons are pressed in the attract run; 0x1c0103 reads back 0xf3 (service off, EEPROM
    // ready, outside vblank), so the inverted copy is 0x0c. Before the first IRQ these bytes are all zero.
    inputs_1ff2() {
      for (const [d, s] of [[0x104057, 0x104056], [0x104056, 0x104055], [0x104055, 0x104054], [0x104073, 0x104072], [0x104072, 0x104071], [0x104071, 0x104070]]) this.w8(d, this.r8(s));
      this.w32(0x104064, this.r32(0x104060)); this.w32(0x104060, this.r32(0x10405c)); this.w32(0x10405c, this.r32(0x104058));
      this.w8(0x104054, 0); this.w32(0x104058, 0); this.w8(0x104070, 0x0c);
    }
    // 0x002208: 32 per-row scroll entries: $106121+1 rows from a5, $106163+1 rows from a6, the rest from a4
    rows_2208(a3, a4, a5, a6) {
      let n = 32;
      for (const [src, cnt] of [[a5, this.r8(0x106121) + 1], [a6, this.r8(0x106163) + 1], [a4, 32]])
        for (let i = 0; i < cnt; i++) { this.w8(a3 + 2, this.r8(src)); this.w8(a3, this.r8(src + 1)); a3 += 0x20; if (--n === 0) return; }
    }
    // 0x0020b2: latch scroll buffers to the K052109 (row-scroll path when $106118/$106119 bit 2 is set)
    scrollOut_20b2() {
      if (this.r8(0x106118) & 4) {
        this.rows_2208(0x603400, 0x1040c8, 0x106132, 0x10616c);
        this.w32(0x10613a, this.r32(0x106136)); this.w32(0x106174, this.r32(0x106170));
        this.w32(0x106136, this.r32(0x106132)); this.w32(0x106170, this.r32(0x10616c));
      } else { this.w8(0x603402, this.r8(0x1040c8)); this.w8(0x603400, this.r8(0x1040c9)); }
      this.w32(0x104080, this.r32(0x1040e0)); this.w32(0x1040e0, this.r32(0x1040c8));
      this.w8(0x603018, this.r8(0x1040cd));
      this.w32(0x104084, this.r32(0x1040e4)); this.w32(0x1040e4, this.r32(0x1040cc));
      if (this.r8(0x106119) & 4) {
        this.rows_2208(0x603401, 0x1040d0, 0x10613e, 0x106178);
        this.w32(0x106146, this.r32(0x106142)); this.w32(0x106180, this.r32(0x10617c));
        this.w32(0x106142, this.r32(0x10613e)); this.w32(0x10617c, this.r32(0x106178));
      } else { this.w8(0x603403, this.r8(0x1040d0)); this.w8(0x603401, this.r8(0x1040d1)); }
      this.w32(0x104088, this.r32(0x1040e8)); this.w32(0x1040e8, this.r32(0x1040d0));
      this.w8(0x603019, this.r8(0x1040d5));
      this.w32(0x10408c, this.r32(0x1040ec)); this.w32(0x1040ec, this.r32(0x1040d4));
      this.w32(0x104090, this.r32(0x1040f0)); this.w32(0x1040f0, this.r32(0x1040d8));
      this.w32(0x104094, this.r32(0x1040f4)); this.w32(0x1040f4, this.r32(0x1040dc));
    }
    // 0x0023ba: attract main state ($104003)
    // 0x002254: game mode 0 (after power-on): one-time screen/flip setup, then a short wait before the attract mode
    boot_2254() {
      const st = this.r8(0x104003);
      if (st === 0) { // 0x00227a
        this.w16(0x1040a4, 0); this.w8(0x603e00, 0); this.w8(0x603b00, 0); this.flip_233c(); this.w8(0x10418c, 0);
        this.soundPush_b1b2(this.r8(0x104394) ? 0xfb : 0xfa);
        this.w8(0x104164, 1); this.w8(0x104003, 1); this.w8(0x104136, this.r8(0x104136) + 1); this.job_2666(1); return;
      }
      if (st === 1) { if (!this.r8(0x104136)) { this.w8(0x104004, 1); this.w8(0x104003, 2); } return; } // 0x0022d2
      if (st === 2) { // 0x0022f6
        this.w8(0x104004, this.r8(0x104004) - 1);
        if (this.r8(0x104004) && !this.r8(0x10404c)) {
          const d0 = (this.r8(0x104058) | this.r8(0x104059) | this.r8(0x10405a) | this.r8(0x10405b)) & 0x30;
          if (!d0 || !this.r8(0x104380)) return;
        }
        this.w8(0x104001, this.r8(0x104001) + 1); this.w8(0x104003, 0); return;
      }
      return this.stop('boot state ' + st);
    }
    // 0x00233c: screen flip from the EEPROM setting
    flip_233c() {
      let d7 = this.r8(0x1040a7) & 0xfe, d6 = this.r8(0x1040ac) & 0xfc;
      this.w8(0x5a0000, 3); this.w8(0x5a0001, 0xa3); this.w8(0x5a0004, 2); this.w8(0x5a0005, 0xf9);
      if (this.r8(0x10439e)) { d7 ^= 1; d6 ^= 3; this.w8(0x5a0000, 0); this.w8(0x5a0001, 0x5d); this.w8(0x5a0004, 3); this.w8(0x5a0005, 0xf9); }
      this.w8(0x1040a7, d7); this.w8(0x603d00, d7); this.w8(0x1040ac, d6); this.w8(0x5a0009, d6);
    }
    attract_23ba() {
      const st = this.r8(0x104003);
      if (st === 0) { this.w8(0x104003, 1); this.w8(0x104005, 0); this.w8(0x104007, 0); this.w8(0x104009, 0); return; } // 0x00296a
      if (st === 1) return this.warn_2984();
      if (st === 2) { if (this.r8(0x10404c)) return this.stop('2d1e coin'); this.w8(0x104003, 3); this.w8(0x104005, 0); this.w8(0x104007, 0); return; }
      if (st === 3) return this.intro_2d3a();
      if (st === 4) return this.title_2dec();
      if (st === 5) return this.reward_30de();
      return this.stop('attract state ' + st);
    }
    // 0x002984: attract state 1 (sub 0 only: no credits and free-play off goes straight to the intro)
    warn_2984() {
      if (this.r8(0x104005)) return this.stop('2984 sub ' + this.r8(0x104005));
      const k = this.r8(0x104007);
      if (k === 0) { // 0x0029c4
        if (this.r8(0x104136)) return;
        this.clearObjs_62e8(); this.w8(0x104136, this.r8(0x104136) + 1); this.job_2666(7); this.w8(0x104007, 1); this.sound_b1aa(0); return;
      }
      if (this.r8(0x104136)) return; // 0x0029f4
      this.w8(0x5c0713, 4); this.w8(0x5c0715, 0x25); this.w8(0x5c070b, 0x26);
      const r = this.r8(0x1040a0) & 0x0f; this.w8(0x1040a0, r); this.dim(r);
      this.scrollReset_24ba(); this.flip_233c();
      if (this.r8(0x104044) | this.r8(0x104046) | this.r8(0x104048) | this.r8(0x10404a) | this.r8(0x104380)) return this.stop('2a72 credits/free play');
      this.w8(0x104003, 2); this.w8(0x104005, 0); this.w8(0x104007, 0);
    }
    // 0x002dec: state 4 = title (logo halves slide in and zoom, KONAMI text, colour cycle)
    title_2dec() {
      if (this.r8(0x10404c)) return this.stop('2dec coin');
      const sub = this.r8(0x104005);
      if (sub === 0) { this.w8(0x104005, 1); this.w8(0x104136, this.r8(0x104136) + 1); this.job_2666(7); this.clearObjs_62e8(); return; }
      if (sub === 1) {
        if (this.r8(0x104136)) return;
        const r = this.r8(0x1040a0) & 0x0f; this.w8(0x1040a0, r); this.dim(r);
        this.scrollReset_24ba(); this.palLoad_d04e(0xdde0); this.sprLinks_630a();
        this.w8(0x104005, 2); this.w16(0x104006, 0); return;
      }
      if (sub === 2) {
        this.palRun_cea4(false);
        if (this.r8(0x104160)) { this.w8(0x104004, 1); this.w8(0x104005, 3); return; }
        const k = this.r8(0x104007);
        if (k === 0) { this.objSpawn_34a0(0x2f2e); this.w8(0x104007, 1); return; }
        if (k === 1) { // 0x2f4c: logo halves slide apart until the left one reaches x=0x80
          this.w16(0x18000c, this.r16(0x18000c) - 2); this.w16(0x18008c, this.r16(0x18008c) + 2);
          if (this.r16(0x18000c) === 0x80) { this.w8(0x104007, 2); this.w8(0x104006, 0); }
          return;
        }
        if (k === 2) { // 0x2f74: zoom-in curve (tables 0x3012 / 0x3042, zoom factors 0x134c0)
          const t = this.r8(0x104006) * 2, d4 = this.r16(0x3012 + t), d5 = this.r16(0x3042 + t);
          const d2 = ((d4 * 0x40) >>> 5) & 0xffff, d3 = ((d5 * 0x35) >>> 5) & 0xffff;
          this.w16(0x18000c, 0x100 - d2); this.w16(0x180008, 0xc5 - d3);
          this.w16(0x18008c, 0x100 + d2); this.w16(0x180088, 0xc5 - d3);
          const zx = this.r16(0x134c0 + 2 * d4), zy = this.r16(0x134c0 + 2 * d5);
          this.w16(0x180014, zx); this.w16(0x180094, zx); this.w16(0x180010, zy); this.w16(0x180090, zy);
          const n = this.r8(0x104006) + 1; this.w8(0x104006, n); if (n >= 0x18) this.w8(0x104007, 3);
          return;
        }
        if (k === 3) { // 0x3072: colour cycles, full logo objects, text jobs
          this.palStart_cde0(0x1116a); this.objSpawn_34a0(0x30a8);
          for (let a = 0x30d4; ; a += 2) { const w = this.r16(a); if (w === 0xffff) break; this.job_2666(w); }
          this.w8(0x104004, 0xff); this.w8(0x104005, 3); this.w16(0x104006, 0); return;
        }
        return this.stop('2ef6 k ' + k);
      }
      if (sub === 3) {
        this.palRun_cea4(false);
        const t = (this.r8(0x104004) - 1) & 0xff; this.w8(0x104004, t); if (t) return;
        this.w8(0x104005, 4); this.w8(0x104136, this.r8(0x104136) + 1); this.job_2666(7); this.clearObjs_62e8(); return;
      }
      if (sub === 4) {
        if (this.r8(0x104136)) return;
        this.w8(0x104003, this.r8(0x104003) + 1); for (const a of [0x104005, 0x104007, 0x104009]) this.w8(a, 0);
        this.scrollReset_24ba(); return;
      }
      return this.stop('2dec sub ' + sub);
    }
    // 0x1c0301 write: shadow/brightness control (recorded as misc[1] = (d >> 4) & 7)
    dim(d) { this.v.misc[1] = (d >> 4) & 7; }
    // 0x002d3a: state 3 = intro film
    intro_2d3a() {
      if (this.r8(0x10404c) || this.r8(0x104161)) return this.stop('2d3a coin/skip');
      if (this.r8(0x104005) !== 0 || this.r8(0x104007) !== 0) return this.stop('2d3a sub');
      this.film_5b46c();
      if (this.r8(0x106157)) return;
      this.w8(0x104003, this.r8(0x104003) + 1);
      for (const a of [0x104005, 0x104007, 0x104009, 0x10400b, 0x10400d, 0x10400f]) this.w8(a, 0);
    }
    // 0x05b46c: intro film step table at 0x05b48e indexed by $10400b
    film_5b46c() {
      const i = this.r8(0x10400b), h = this.r32(0x5b48e + 4 * i), f = this.FILM[h];
      if (!f) return this.stop('film step ' + i + ' handler ' + h.toString(16));
      f.call(this);
      if (this.unimpl) return;
      this.scrollInt_5c078();
      this.objects_5bf3c();
    }
    // 0x05beb4: periodic sound cue (only the timer matters for video)
    cue_5beb4() { const c = (this.r8(0x10400c) - 1) & 0xff; this.w8(0x10400c, c); if (!c) { this.sound(0x69); this.w8(0x10400c, 0x24); } }
    // 0x00b18c: push a sound command onto the ring buffer 0x1044c0-0x10453f (write ptr 0x104018)
    sound(code) {
      const d7 = code & 0xff;
      if (this.r8(0x104001) === 3 || this.r8(0x10418c)) this.soundPush_b1b2(d7);
      else if (d7 < 0x80) this.sound_b1aa(d7);
    }
    // 0x00b1aa: same, skipping the demo/priority filter
    sound_b1aa(d7) { if (this.r8(0x104391)) this.soundPush_b1b2(d7); }
    soundPush_b1b2(d7) {
      let a6 = this.r32(0x104018); this.w8(a6++, d7);
      if (a6 > 0x10453f) a6 = 0x1044c0;
      this.w32(0x104018, a6);
    }
    // pan steps 0x05bd8a..0x05be50: (time, next velocity A, next velocity B, next timer)
    panStep(next) {
      this.cue_5beb4(); this.streams_5c0f4();
      const t = (this.r8(0x10400a) - 1) & 0xff; this.w8(0x10400a, t); if (t) return;
      this.w16(0x106014, 0); this.w16(0x106018, 0);
      this.w32(0x1040f8, next[0]); this.w32(0x1040fc, next[1]); this.w8(0x10400a, next[2]);
      this.w8(0x10400b, this.r8(0x10400b) + 1);
    }
    // 0x05c0f4 / 0x05c10a: timed tilemap stream lists (A at $106032 vs $106012, B at $106036 vs $10601a)
    streams_5c0f4() { this.stream(0x106032, 0x106012, 0x1040f8); this.stream(0x106036, 0x10601a, 0x104100); }
    stream(a2, posA, velA) {
      let a1 = this.r32(a2); const d1 = this.r32(a1); a1 += 4;
      if (d1 === 0xffffffff) return;
      const d0 = this.r32(posA);
      if (this.r16(velA) & 0x8000) { if (d0 > d1) return; } else if (d0 < d1) return;
      const a4 = this.r32(a1), lim = this.r32(a1 + 4), a5 = this.r32(a1 + 8), d2 = this.r8(a1 + 12), d1b = this.r8(a1 + 13), d3 = s16(this.r16(a1 + 14)), a6 = this.r32(a1 + 16);
      this.w32(a2, a1 + 20);
      this.blockBlit_5a666(a4, lim, a5, d2, d1b, d3, a6);
    }
    // 0x05a666: draw rows of 4x4-tile blocks (32 bytes each in table a5) from block map a6
    blockBlit_5a666(a4, lim, a5, d2, d1, d3, a6) {
      this.d0 = lim & 0xff;
      d1 = (d1 - 1) & 0xff; d2 = (d2 - 1) & 0xff;
      for (let c = d1; c >= 0; c--) {   // dbra on word: d1 < 0x100 here
        let p = a4;
        for (let b = d2; b >= 0; b--) {
          let src = a5 + (this.r8(a6++) << 5);
          for (let r = 0; r < 4; r++) { for (let k = 0; k < 8; k++) this.w8(p++, this.r8(src++)); p += 0x78; }
          p -= 0x1f8;
        }
        a4 += 0x200; if (a4 >= lim) a4 -= 0x1000;
        a6 = (a6 + d3) >>> 0; // a6 already advanced by the map reads above; then skip d3
      }
    }
    // 0x05c078: integrate scroll velocities, then 0x04e530 / 0x04e7b0 build the scroll buffers
    scrollInt_5c078() {
      this.add32(0x106012, this.r32(0x1040f8)); this.add32(0x106186, this.r32(0x1040fc));
      this.add32(0x10601a, this.r32(0x104100)); this.add32(0x10618a, this.r32(0x104104));
      for (const [vel, pos] of [[0x10612a, 0x106122], [0x10612c, 0x106164], [0x10612e, 0x106126], [0x106130, 0x106168]])
        this.add32(pos, (s16(this.r16(vel)) << 8) >>> 0);
      const K = 0x15a0000;
      this.w32(0x1040c8, (this.r32(0x106012) - K) >>> 0); this.w32(0x106132, (this.r32(0x106122) - K) >>> 0);
      this.w32(0x10616c, (this.r32(0x106164) - K) >>> 0); this.w32(0x106016, this.r32(0x106186));
      this.mode_4e5a2(); if (this.unimpl) return;
      this.w16(0x10614a, this.r16(0x10614a) + this.r16(0x106152));
      let d1 = (this.r32(0x106016) + this.r32(0x10614a)) >>> 0; this.w32(0x106016, d1);
      this.w32(0x1040cc, (-((d1 + 0x80000) >>> 0)) >>> 0);
      this.w32(0x1040d0, (this.r32(0x10601a) - K) >>> 0); this.w32(0x10613e, (this.r32(0x106126) - K) >>> 0);
      this.w32(0x106178, (this.r32(0x106168) - K) >>> 0); this.w32(0x10601e, this.r32(0x10618a));
      this.w16(0x10614e, this.r16(0x10614e) + this.r16(0x106154));
      d1 = (this.r32(0x10601e) + this.r32(0x10614e)) >>> 0; this.w32(0x10601e, d1);
      this.w32(0x1040d4, (-((d1 + 0x80000) >>> 0)) >>> 0);
    }
    // 0x04e5a2: vertical wobble modes indexed by $106184 (only mode 0 = off is ported)
    mode_4e5a2() {
      if (this.r8(0x10619d)) return this.stop('4e5a2 10619d');
      const m = this.r8(0x106184), h = this.r32(0x4e5ce + 4 * m);
      if (h !== 0x4e5de) return this.stop('4e5a2 mode ' + m);
      this.w32(0x10614a, 0); this.w16(0x106152, 0); this.w32(0x10614e, 0); this.w16(0x106154, 0);
    }
    // 0x05bf3c: film objects in sprite RAM (0x180000 + 0x80*n while $2 != 0)
    objects_5bf3c() {
      for (let a = 0x180000; a < 0x181c80; a += 0x80) if (this.r8(a + 2)) {
        this.objScroll_14346(a); this.objMove_5bf64(a); this.objAnim_5bfb0(a); this.objPos_5c02a(a);
      }
    }
  }
  // film step handlers, keyed by 68k address
  Sim.prototype.FILM = {
    0x5bd42() { // pan setup: velocities, stream lists 0x070436 / 0x0707da
      if (this.r8(0x1060ac)) return;
      this.w32(0x1040f8, 0xfffb6db0); this.w32(0x1040fc, 0x4925); this.w32(0x106032, 0x70436); this.w32(0x106036, 0x707da);
      this.w8(0x10400a, 0x38); this.w8(0x10400b, this.r8(0x10400b) + 1); this.w8(0x10400c, 1);
    },
    0x5bd8a() { this.panStep([0xfffb13b0, 0x4ec5, 0x34]); },
    0x5bdcc() { this.panStep([0xfffaaaa8, 0x5558, 0x30]); },
    0x5be0e() { this.panStep([0xfffa2e88, 0x5d18, 0x2c]); },
    0x5be50() { this.panStep([0xfff99998, 0x6668, 0x28]); },
    0x5be90() {
      this.cue_5beb4(); this.streams_5c0f4();
      const t = (this.r8(0x10400a) - 1) & 0xff; this.w8(0x10400a, t); if (t) return;
      this.fadeStart_ce6a(0x10f70); this.w8(0x106157, 0);
    },
  };
  Object.assign(Sim.prototype, {
    // ---- palette colour-cycle engine: 64 slots of 10 bytes at 0x104740 {flags.b, timer.b, script.l, colour addr.l} ----
    palAddr_ce32(a6) { // -> [colour address, bank bits]
      const b = this.r8(a6), d6 = b & 0x30, base = this.r32(0xce52 + (d6 >> 2));
      return [base + ((this.r16(a6) & 0xfff) << 1), d6];
    },
    // 0x00cde0: start the cycles listed at a6 (count.w, then script pointers) in free slots
    palStart_cde0(a6) {
      let n = this.r16(a6); a6 += 2; if (!n) return;
      let a4 = 0x104736;
      for (let i = 0; i < n; i++) {
        let sc = this.r32(a6 + 4 * i);
        do { a4 += 10; if (a4 >= 0x1049c0) return; } while (this.r8(a4 + 1));
        const [a5, d6] = this.palAddr_ce32(sc); sc += 2;
        let d7; for (;;) { d7 = this.r16(sc); sc += 2; if (!(d7 & 0x4000)) break; sc = this.r32(sc); }
        d7 &= 0xff; if (!d6) d7 |= 0x2000;
        this.w16(a4, d7); this.w16(a5, this.r16(sc)); sc += 2;
        this.w32(a4 + 2, sc); this.w32(a4 + 6, a5);
      }
    },
    // 0x00ce6a: stop the cycles on the colours listed at a6
    fadeStart_ce6a(a6) {
      const n = this.r16(a6); a6 += 2;
      for (let i = 0; i < n; i++) {
        const [a5] = this.palAddr_ce32(this.r32(a6 + 4 * i));
        for (let a4 = 0x104740; a4 < 0x1049c0; a4 += 10)
          if (this.r8(a4 + 1) && this.r32(a4 + 6) === a5) { this.w8(a4 + 1, 0); this.w32(a4 + 6, 0); this.w32(a4 + 2, 0); break; }
      }
    },
    // 0x00cea4 (all slots) / 0x00cf2e (only flag-5 slots): advance the cycles
    palRun_cea4(onlyF5) {
      this.w8(0x10419a, 0);
      for (let a4 = 0x104740; a4 < 0x104740 + 640; a4 += 10) {
        if (onlyF5 && !(this.r8(a4) & 0x20)) continue;
        let t = this.r8(a4 + 1); if (!t) continue;
        t = (t - 1) & 0xff; this.w8(a4 + 1, t); if (t) continue;
        let a6 = this.r32(a4 + 2); const a5 = this.r32(a4 + 6), d4 = this.r8(a6);
        for (;;) {
          const d4 = this.r8(a6); this.w8(0x10419a, this.r8(0x10419a) | (d4 & 15));
          if (d4 & 0x80) { this.w8(a4 + 1, 0); break; }
          if (d4 & 0x40) { a6 = this.r32(a6 + 2); continue; }
          if (d4 & 0x20) break;
          if (d4 & 0x10) this.w8(a4, this.r8(a4) ^ 0x10);
          this.w8(a4 + 1, this.r8(a6 + 1)); this.w16(a5, this.r16(a6 + 2));
          a6 += (this.r8(a4) & 0x10) ? -4 : 4; this.w32(a4 + 2, a6 >>> 0); break;
        }
      }
    },
    // ---- main-loop job queue (0x002666 push, consumer at 0x001578); jobs run to completion before the next IRQ ----
    job_2666(w) {
      let a = this.r32(0x104010); this.w16(a, w); a += 2; if (a > 0x1046ff) a = 0x104540; this.w32(0x104010, a);
    },
    runJobs() {
      for (let guard = 0; guard < 64; guard++) {
        let a = this.r32(0x104014); const w = this.r16(a); if (w & 0x8000) return;
        this.w16(a, 0xffff); a += 2; if (a > 0x1046ff) a = 0x104540; this.w32(0x104014, a);
        const d7 = w & 0xff, idx = (w & 0x3f00) >> 8, h = this.r32(0x158e + 4 * idx), f = this.JOBS[h];
        if (!f) return this.stop('job ' + idx + ' handler ' + h.toString(16));
        f.call(this, d7); if (this.unimpl) return;
      }
    },
    // 0x006354-style block clears: n*256 bytes below `top`
    clearDown(top, bytes) { for (let a = top - bytes; a < top; a++) this.w8(a, 0); },
    // 0x0062e8: clear object work RAM (0x104a00 / 0x106000 areas) and all of sprite RAM
    clearObjs_62e8() { this.clearDown(0x104a00, 11 * 64); this.clearDown(0x106000, 13 * 256); this.w16(0x1058fc, 0); this.clearDown(0x184000, 0x4000); },
    // 0x0034a0: spawn objects/sprites from a table {count.w, then per object: b0, pad, w4, w18, w8, wc, w10, w14}
    objSpawn_34a0(a6) {
      const n = this.r16(a6); a6 += 2;
      for (let i = 0, a4 = 0x180000; i < n; i++, a4 += 0x80) {
        this.w8(a4, this.r8(a6)); a6 += 2;
        for (const o of [4, 0x18, 8, 0xc, 0x10, 0x14]) { this.w16(a4 + o, this.r16(a6)); a6 += 2; }
      }
    },
    // 0x00630a: sprite slot n gets list link n
    sprLinks_630a() { for (let i = 0; i < 128; i++) this.w8(0x180001 + 0x80 * i, i); },
    // 0x0024ba: reset scroll buffers and K052109 scroll registers
    scrollReset_24ba() {
      const d0 = 0x60000, d1 = 0, d2 = 0x60000, d3 = 0;
      this.w8(0x603900, 0);
      for (const a of [0x1040c8, 0x1040d8, 0x1040e0, 0x1040f0, 0x104080, 0x104090]) this.w32(a, d0);
      for (const a of [0x1040cc, 0x1040dc, 0x1040e4, 0x1040f4, 0x104084, 0x104094]) this.w32(a, d1);
      for (const a of [0x1040d0, 0x1040e8, 0x104088]) this.w32(a, d2);
      for (const a of [0x1040d4, 0x1040ec, 0x10408c]) this.w32(a, d3);
      for (const a of [0x1040f8, 0x1040fc, 0x104100, 0x104104, 0x104108, 0x10410c]) this.w32(a, 0);
      for (let a = 0x104110; a <= 0x10411a; a += 2) this.w16(a, 0);
      this.w8(0x603400, (d0 >>> 16) & 0xff); this.w8(0x603402, (d0 >>> 24) & 1);
      this.w8(0x603018, (d1 >>> 16) & 0xff);
      this.w8(0x603401, (d2 >>> 16) & 0xff); this.w8(0x603403, (d2 >>> 24) & 1);
      this.w8(0x603019, (d3 >>> 16) & 0xff);
    },
    // 0x00d04e: load palette blocks selected by the bit mask at a6
    palLoad_d04e(a6) { this.palLoad_d050(this.r16(a6), a6 + 2); },
    // 0x00d050: palette blocks for mask m, block pointers from a6
    palLoad_d050(m, a6) {
      const blk = (dst, n) => { const a5 = this.r32(a6); a6 += 4; let p = a5; for (let i = 0; i <= n; i++) { const a3 = this.r32(p); p += 4; for (let k = 0; k < 32; k++) this.w8(dst++, this.r8(a3 + k)); } };
      if (m & 1) blk(0x140000, 7); if (m & 2) blk(0x140800, 7); if (m & 4) blk(0x140a00, 7); if (m & 8) blk(0x140400, 31);
      if (m & 16) for (let a = 0x140c00; a < 0x141000; a += 4) this.w32(a, 0x1f001f); // 0x00d120
    },
  });
  // main-loop jobs keyed by handler address (table 0x00158e)
  Sim.prototype.JOBS = {
    0x86a8(d7) { this.w8(0x104130, d7); },   // text colour attribute
    0x86b0(d7) { this.w8(0x104131, d7); },
    0x863a(d7) { // print text string d7 from table 0x00999a ('/' = new address, '[' = special glyph, '?' = end)
      const raw = d7 & 0x80; let a6 = this.r32(0x999a + 4 * (raw ? d7 & 0x7f : d7)); const col = this.r8(0x104130);
      let a4 = this.r32(a6); a6 += 4;
      for (;;) {
        const c = this.r8(a6++);
        if (c === 0x3f) return;
        if (c === 0x2f) { a4 = this.r32(a6); a6 += 4; continue; }
        if (raw) { this.w8(a4++, col); this.w8(a4++, 0x10); continue; }
        if (c === 0x5b) { this.w8(a4++, col | 1); this.w8(a4++, 0xed); continue; }
        this.w8(a4++, col); this.w8(a4++, c - 0x30);
      }
    },
    0x8476(d7) { // clear tilemaps: bit0 FIX (codes 0, colour 0x90 rows), bit1 layer A, bit2 layer B
      const fill = (end, n, b1, b2) => { for (let a = end - n; a < end; a += 2) { this.w8(a, b1); this.w8(a + 1, b2); } };
      if (d7 & 1) {
        fill(0x601000, 0x1000, 0, 0x10);
        for (let r = 0, a = 0x600000; r < 32; r++, a += 0x80)
          for (const o of [0, 8, 0x10, 0x64, 0x6c, 0x74]) for (let k = 0; k < (o === 0x10 || o === 0x74 ? 4 : 4); k++) { this.w8(a + o + 2 * k, 0); this.w8(a + o + 2 * k + 1, 0x90); }
        for (let r = 0, a = 0x600000; r < 32; r++, a += 0x80) for (const o of [0x18, 0x7c]) for (let k = 0; k < 2; k++) { this.w8(a + o + 2 * k, 0); this.w8(a + o + 2 * k + 1, 0x90); }
      }
      if (d7 & 2) fill(0x602000, 0x1000, 0, 0x10);
      if (d7 & 4) fill(0x603000, 0x1000, 0, 0x10);
      if (d7 & 7) this.mainD0 = 0xff;   // each clear loop ends with dbra d0 -> $ffff
      this.w8(0x104136, this.r8(0x104136) - 1);
    },
  };

  // ---- attract state 5: the REWARD poster (0x0030de) ----
  Object.assign(Sim.prototype, {
    reward_30de() {
      if (this.r8(0x10404c)) return this.stop('30de coin');
      const sub = this.r8(0x104005);
      if (sub === 0) return this.rewardInit_3122();
      if (sub === 1) { for (let i = 0; i < 4; i++) this.w8(0x1041a4 + i, i); this.w8(0x104005, 2); return this.players_411e(); }
      if (sub === 2) { this.reward_4bcc(); return this.players_411e(); }
      if (sub === 3) { this.reward_4e42(); return this.players_411e(); }
      return this.stop('30de sub ' + sub);
    },
    // 0x00411e: per-player coin/start handling; with no credits (0x10418c clear) it does nothing
    players_411e() { if (this.r8(0x10418c)) this.stop('411e credits'); },
    rewardInit_3122() {
      this.clearObjs_62e8();
      for (let a = 0x104300; a < 0x104380; a++) this.w8(a, 0);              // 0x0063ba
      for (const b of [0x104200, 0x104240, 0x104280, 0x1042c0]) {            // 0x0063c6..0x006408
        this.w8(b, 0); this.w8(b + 1, 0); for (let a = b + 0xb; a < b + 0xb + 0x35; a++) this.w8(a, 0);
      }
      for (const a of [0x107000, 0x107400, 0x107800, 0x107c00]) this.w32(a, a + 4);
      const d7 = this.r8(0x104195), a6 = this.r32(0x324a + 4 * d7);
      this.w8(0x104300, this.r8(a6)); this.w8(0x104171, 1); this.w8(0x104170, this.r8(a6 + 1)); this.w8(0x104172, this.r8(a6 + 1));
      this.w8(0x104200, this.r8(a6 + 2)); this.w8(0x104240, this.r8(a6 + 3)); this.w8(0x104280, this.r8(a6 + 4)); this.w8(0x1042c0, this.r8(a6 + 5));
      for (let i = 0; i < 4; i++) this.w8(0x1041a4 + i, this.r8(a6 + 6 + i));
      this.w8(0x104173, 0);
      for (let i = 0; i < 4; i++) this.w32(0x10417c + 4 * i, this.r32(0x3266 + 16 * d7 + 4 * i));
      for (let i = 0; i < 4; i++) this.w8(0x104178 + i, 1);
      this.w16(0x104176, 0); this.w16(0x104192, 0);
      this.w8(0x104005, this.r8(0x104005) + 1); this.w8(0x104007, 0);
    },
    reward_4bcc() {
      const k = this.r8(0x104007);
      if (k === 0) { this.w8(0x104007, 1); this.w8(0x104009, 0); this.sound(0x8e); return; }
      if (k === 2) { // 0x004df2
        this.w8(0x104005, this.r8(0x104005) + 1); this.w8(0x104007, 0); this.w8(0x104009, 0);
        for (const a of [0x104303, 0x104305]) this.w8(a, 0); for (let a = 0x105ca0; a < 0x105ca8; a++) this.w8(a, 0); return;
      }
      if (k !== 1) return this.stop('4bcc k ' + k);
      const j = this.r8(0x104009);
      if (j === 0) { this.w8(0x104136, this.r8(0x104136) + 1); this.job_2666(7); this.clearObjs_62e8(); this.w8(0x104009, 1); return; }
      if (j === 1) { // 0x004c52
        if (this.r8(0x104136)) return;
        this.w8(0x5c0713, 4); this.w8(0x5c0715, 0x25); this.w8(0x5c070b, 0x26);
        const r = this.r8(0x1040a0) & 0x0f; this.w8(0x1040a0, r); this.dim(r);
        this.scrollReset_24ba(); this.w8(0x105800, 0); this.w8(0x104009, 2); return;
      }
      if (j === 2) { // 0x004c98
        if (!this.palStep_cfc2(0xd3c2, 0xd000)) return;
        let d7 = this.r8(0x104300); if (d7 >= 5) d7 = 4;
        this.job_2666(0x1400 + d7); this.w8(0x1060ac, 1);                     // 0x05adba
        this.sprLinks_630a();
        const o = s8(this.r8(0x4cf4 + this.r8(0x104300)));                     // 0x004ccc
        if (o >= 0) this.objSpawn_34a0(this.r32(0x4cfc + 4 * o));
        this.w8(0x104009, 3); return;
      }
      if (j === 3) { // 0x004d62
        if (this.r8(0x1060ac)) return;
        this.w8(0x104009, 4); this.w16(0x10400a, 0x110);
        return this.fadeInit_cca0(this.r32(0xd8e2 + 4 * this.r8(0x104300)));
      }
      if (j === 4) { // 0x004d94
        const t = this.r16(0x10400a);
        if (t <= 0x100) this.fadeStep_cd40();
        if (t <= 0xd0 && this.r8(0x10418c)) return this.stop('4d94 credits');
        const n = (t - 1) & 0xffff; this.w16(0x10400a, n); if (n) return;
        this.sound(0xfd); this.w8(0x104007, 2); this.w8(0x104009, 0); this.w16(0x10400a, 0); return;
      }
      return this.stop('4c08 j ' + j);
    },
    // 0x00cfc2 / 0x00d008: load one more palette group per call (mask table at mt); true once all four are in
    palStep_cfc2(tab, mt) {
      const a6 = this.r32(tab + ((this.r8(0x104300) << 2) & 0xff)), i = this.r8(0x105800);
      this.w8(0x105800, i + 1);
      this.palLoad_d050(this.r16(mt + 2 * i), a6 + 4 * i);
      return this.r8(0x105800) >= 4;
    },
    // 0x00cca0: set up a palette fade toward the target colour blocks listed at a6 (state in 0x105300, 6 x 0xc4 bytes)
    fadeInit_cca0(a6) {
      this.w16(0x105802, 0); for (let i = 0; i < 6; i++) this.w32(0x105300 + 0xc4 * i, 0);
      let n = this.r16(a6); a6 += 2; if (!n) return;
      const sh = this.r16(a6); a6 += 2; this.w16(0x105802, 1 << sh);
      let a3 = a6, a4 = 0x105300;
      for (let e = 0; e < n; e++) {
        const w = this.r16(a3); a3 += 2;
        let a5 = this.r32(0xce52 + ((w & 0x300) >> 6)) + ((w & 0xff) << 5);
        let src = this.r32(a3); a3 += 4;
        this.w32(a4, a5); a4 += 4;
        for (let c = 0; c < 16; c++) {
          const d4 = this.r16(src), d5 = this.r16(a5); src += 2; a5 += 2;
          for (const f of [x => (x << 8) & 0x1f00, x => (x << 3) & 0x1f00, x => (x >> 2) & 0x1f00]) {
            const cur = f(d5); this.w16(a4, cur); this.w16(a4 + 2, (f(d4) - cur) >> sh); a4 += 4;
          }
        }
      }
    },
    // 0x00cd40: one fade step; returns true (carry) when the fade has finished
    fadeStep_cd40() {
      if (!this.r16(0x105802)) return true;
      let a4 = 0x105300;
      while (a4 < 0x105798) {
        let a5 = this.r32(a4); a4 += 4;
        if (!a5) { a4 += 0xc0; continue; }
        for (let c = 0; c < 16; c++) {
          const comp = () => { const v = (this.r16(a4) + this.r16(a4 + 2)) & 0xffff; this.w16(a4, v); a4 += 4; return v; };
          let d6 = comp() >> 8; d6 |= (comp() & 0x1f00) >> 3; d6 |= ((comp() & 0x1f00) << 2) & 0xffff;
          this.w16(a5, d6); a5 += 2;
        }
      }
      const n = (this.r16(0x105802) - 1) & 0xffff; this.w16(0x105802, n); return !n;
    },
    reward_4e42() {
      const c = this.r8(0x104172); if (c) { this.w8(0x104173, this.r8(0x104173) | c); this.w8(0x104172, 0); } // 0x004398
      const k = this.r8(0x104007);
      if (k === 0) { // 0x004e7a
        if (this.r8(0x104136)) return;
        this.w8(0x104136, this.r8(0x104136) + 1); this.job_2666(7); this.clearObjs_62e8();
        for (const a of [0x104308, 0x104318, 0x10432b, 0x104317, 0x104068, 0x10406c, 0x104069, 0x10406d, 0x10406a, 0x10406e, 0x10406b, 0x10406f]) this.w8(a, 0);
        this.w8(0x104007, 1); this.sound(0); return;
      }
      if (k === 1) { if (this.r8(0x104136)) return; this.w8(0x104007, 2); this.palLoad_d04e(0xd1bc); this.w8(0x105800, 0); return; }
      if (k === 2) { if (this.palStep_cfc2(0xd18a, 0xd046)) { this.w8(0x104007, 3); this.flip_233c(); } return; }
      if (k === 3) { // 0x004f26: stage-intro setup
        if (this.r8(0x104136)) return;
        this.w8(0x104007, 4);
        this.palStart_cde0(0x10da4);
        { const a6 = this.r32(0xd16a + 4 * this.r8(0x104300)); if (this.r16(a6)) this.palStart_cde0(a6); } // 0x00cdc4
        this.w8(0x5c0713, 4); this.w8(0x5c0715, 0x25); this.w8(0x5c070b, 0x26);
        const r = this.r8(0x1040a0) & 0x0f; this.w8(0x1040a0, r); this.dim(r);
        this.scrollReset_24ba(); this.stageInit_4da90();
        { // 0x011c88 -> 0x01277c
          this.w16(0x104314, 0); this.w16(0x104326, this.r16(0x106032));
          const v = this.r8(0x104300); this.w32(0x105a00, this.r32(0x16d9c + 8 * v)); this.w32(0x105a04, this.r32(0x16da0 + 8 * v));
          this.w8(0x105a08, this.r8(0x16ddc + 2 * v)); this.w8(0x105a09, this.r8(0x16ddd + 2 * v));
        }
        if (this.r8(0x10418c)) return this.stop('5004 credits');
        return;
      }
      return this.stop('4e42 k ' + k);
    },
    // 0x00233c: screen flip / K053244 setup
    flip_233c() {
      let d7 = this.r8(0x1040a7) & 0xfe, d6 = this.r8(0x1040ac) & 0xfc;
      if (this.r8(0x10439e)) { d7 ^= 1; d6 ^= 3; this.w8(0x5a0000, 0); this.w8(0x5a0001, 0x5d); this.w8(0x5a0004, 3); this.w8(0x5a0005, 0xf9); }
      else { this.w8(0x5a0000, 3); this.w8(0x5a0001, 0xa3); this.w8(0x5a0004, 2); this.w8(0x5a0005, 0xf9); }
      this.w8(0x1040a7, d7); this.w8(0x603d00, d7); this.w8(0x1040ac, d6); this.w8(0x5a0009, d6);
    },
    // 0x04da90: per-stage scroll/layer variables from table 0x06917a
    stageInit_4da90() {
      for (let a = 0x106000; a < 0x106800; a++) this.w8(a, 0);
      this.scrollReset_24ba();
      let a6 = this.r32(0x6917a + 4 * this.r8(0x104300));
      const b = a => { this.w8(a, this.r8(a6)); a6 += 1; }, w = a => { this.w16(a, this.r16(a6)); a6 += 2; }, l = a => { this.w32(a, this.r32(a6)); a6 += 4; };
      b(0x106008); b(0x10600c); w(0x10600a); w(0x10600e); b(0x106010); b(0x106009); this.w8(0x106196, this.r8(0x106009));
      w(0x106044); for (const a of [0x10608a, 0x10608e, 0x10603a, 0x10603e, 0x106092, 0x106096, 0x10604c, 0x106050, 0x106082, 0x106086]) l(a);
      w(0x106012); w(0x106016); this.w16(0x106186, this.r16(0x106016)); w(0x10601a); w(0x10601e); this.w16(0x10618a, this.r16(0x10601e));
      for (const a of [0x1060a2, 0x1060ae, 0x1060a6, 0x1060b2]) l(a);
      w(0x106032); w(0x106036); b(0x5c0709); b(0x5c0707); b(0x603b00); b(0x603e00);
      for (let a = 0x1060f8; a <= 0x1060ff; a++) b(a);
      for (const a of [0x10610c, 0x106110, 0x1060ee, 0x1060f2, 0x1060e6, 0x1060ea]) l(a);
      const v = this.r8(0x104300), h = this.r32(0x4dade + 4 * v);
      if (h !== 0x4db4a) return this.stop('4dac8 variant ' + v);
      for (const a of [0x1060ad, 0x10619c, 0x106043, 0x106042]) this.w8(a, 0);
    },
    // 0x05ae4e: clear scroll state and the K052109 rowscroll tables
    scrollClear_5ae4e() {
      this.w8(0x603900, 0); this.w8(0x106118, this.r8(0x106118) & 0xfb); this.w8(0x106119, this.r8(0x106119) & 0xfb);
      for (const a of [0x106132, 0x10613e, 0x106136, 0x106142, 0x10613a, 0x106146, 0x10612a]) this.w32(a, 0);
      for (let r = 0; r < 32; r++) for (const o of [0x603400, 0x603401]) { this.w8(o + 0x20 * r, 0); this.w8(o + 0x20 * r + 2, 0); }
    },
  });
  Object.assign(Sim.prototype.JOBS, {
    0x5a432(d7) { // REWARD poster d7: layer setup, three RLE tilemap blits, FIX border
      this.w8(0x5c0709, 0x34); this.w8(0x5c0707, 0x2c); this.w8(0x603b00, 0x10); this.w8(0x603e00, 0x32); this.w8(0x5c0713, 4); this.w8(0x5c0715, 0x25);
      this.scrollClear_5ae4e(); this.scrollReset_24ba();
      this.w16(0x105a0a, d7); this.w16(0x1058fc, 0x6003);
      const i = this.r16(0x1c0800) * 12; let a6 = 0x5a4d0 + i;
      { // 0x05abbc: blank the FIX columns
        let p, rows; if (i & 0x80) { rows = 0x1b; p = 0x60011c; } else { rows = 0x17; p = 0x60021c; }
        for (let r = 0; r <= rows; r++) { for (let k = 0; k <= 0x23; k++) { this.w8(p++, 0); this.w8(p++, 0x10); } p += 0x38; }
        this.w8(0x1060ac, 0);
      }
      const l0 = this.r32(a6), l1 = this.r32(a6 + 4), l2 = this.r32(a6 + 8);
      for (const src of [l2, l0, l1]) ENG.rleBlit(this.rom, this.v, src);
      for (let r = 0, a = 0x600000; r < 32; r++, a += 0x80) // 0x05aec2
        for (const [o, n] of [[0, 4], [8, 4], [0x10, 4], [0x18, 2], [0x64, 4], [0x6c, 4], [0x74, 4], [0x7c, 2]]) for (let k = 0; k < n; k++) { this.w8(a + o + 2 * k, 0); this.w8(a + o + 2 * k + 1, 0x90); }
      this.w8(0x1060ac, 0);
      this.mainD0 = (0x80 - (this.r8(l1 + 4) << 1)) & 0xff;   // d0 left by the last 0x00c506 blit (row skip)
    },
  });

  // ---- intro film (state 3) steps before the final pan ----
  Object.assign(Sim.prototype, {
    stepInc() { this.w8(0x10400b, this.r8(0x10400b) + 1); },
    dec8(a) { const t = (this.r8(a) - 1) & 0xff; this.w8(a, t); return t; },
    // 0x05bed0: load palette group d7 one block row per frame; true while not done (carry)
    palGroup_5bed0(d7) {
      const n = this.r8(0x105800); const a6 = this.r32(0x6d6c0 + 4 * d7) + 6 * s8(n);
      this.w8(0x105800, n + 1); this.palLoad_d04e(a6 >>> 0); return this.r8(0x105800) < 4;
    },
    // 0x05b808 / 0x05b80e: next scene, FIX blank job, step++
    nextScene_5b808() { this.w8(0x106157, this.r8(0x106157) + 1); this.blank_5b80e(); },
    blank_5b80e() { this.job_2666(0x1600); this.w8(0x1060ac, 1); this.stepInc(); },
    // 0x05b676: clear tilemaps (job 6) once the queue is idle
    clear_5b676() { this.w8(0x104136, this.r8(0x104136) + 1); this.job_2666(6); this.stepInc(); },
    waitDraw_5b81e() { if (this.r8(0x1060ac) || this.r8(0x104136)) return; this.clear_5b676(); },
    // 0x05b832: palette group for scene $106157, then scene setup job 0x15
    scene_5b832() {
      const d7 = this.r8(0x106157); if (this.palGroup_5bed0(d7)) return;
      this.w16(0x105a0a, d7); this.w16(0x1058fc, 0x6007);
      this.job_2666(0x1500 | (this.r16(0x1c0800) & 0xff)); this.w8(0x1060ac, 1); this.stepInc();
    },
    // 0x00c370: block blit {a4.l, limit.l, blocks.l, w.b, h.b, block bytes...} of 4x4-tile blocks, row wrap 0x80
    blit_c370(a6) {
      this.d0 = this.r8(a6 + 7);
      let a4 = this.r32(a6); const d0 = this.r32(a6 + 4), a5 = this.r32(a6 + 8); a6 += 12;
      let d2 = this.r8(a6++), d1 = this.r8(a6++);
      for (let r = d1 - 1; r >= 0; r--) {
        const row = a4;
        for (let c = d2 - 1; c >= 0; c--) {
          let src = a5 + (this.r8(a6++) << 5);
          for (let k = 0; k < 4; k++) { for (let b = 0; b < 8; b++) this.w8(a4++, this.r8(src++)); a4 += 0x78; }
          a4 -= 0x200; a4 = (a4 & ~0x7f) + ((a4 + 8) & 0x7f);
        }
        a4 = row + 0x200; if (a4 >= d0) a4 -= 0x1000;
      }
    },
    // 0x00c75c / 0x00c7bc: tile animation script {flags|time.w, frame offset.w} relative to the base at a6-4
    anim_c75c(a6) {
      const a5 = this.r32(a6 - 4); this.w32(0x105902, a5);
      let d7;
      for (;;) { d7 = this.r16(a6); a6 += 2; if (d7 & 0x8000) { a6 = (a5 + s16(this.r16(a6))) >>> 0; continue; } break; }
      if (d7 & 0x2000) { this.sound(this.r16(a6)); a6 += 2; }
      this.w16(0x105900, d7 & 0xff);
      this.blit_c370((a5 + s16(this.r16(a6))) >>> 0);
      this.w32(0x105906, a6 + 2);
    },
    anim_c7bc() {
      this.w8(0x10419c, 0);
      if (!this.r8(0x105901) || this.dec8(0x105901)) return;
      let a6 = this.r32(0x105906); const a5 = this.r32(0x105902); let d4;
      for (;;) {
        d4 = this.r16(a6); a6 += 2; this.w8(0x10419c, this.r8(0x10419c) | ((d4 >> 8) & 0xf));
        if (d4 & 0x8000) { this.w8(0x105901, 0); return; }
        if (d4 & 0x4000) { a6 = (a5 + s16(this.r16(a6))) >>> 0; continue; }
        break;
      }
      if (d4 & 0x2000) { this.sound(this.r16(a6)); a6 += 2; }
      if (d4 & 0x1000) { const r = this.r32(a6); a6 += 4; this.callRoutine(r); if (this.unimpl) return; }
      this.w8(0x105901, d4 & 0xff);
      this.blit_c370((a5 + s16(this.r16(a6))) >>> 0);
      a6 = (this.r8(0x105900) & 0x10) ? a6 - 4 : a6 + 2; this.w32(0x105906, a6 >>> 0);
    },
    callRoutine(r) { const f = this.ROUT[r]; if (!f) return this.stop('routine ' + r.toString(16)); f.call(this); },
    animWait() { return this.r8(0x105901) !== 0; },
    // 0x05c152: timed event list {time.w, routine.l} indexed by $10400d
    events_5c152(a6) {
      if (this.dec8(0x10400c)) return;
      const e = a6 + 6 * this.r8(0x10400d), w = this.r16(e); if (w === 0xffff) return;
      this.w8(0x10400c, w & 0xff); this.callRoutine(this.r32(e + 2)); this.w8(0x10400d, this.r8(0x10400d) + 1);
    },
    // 0x05c292: palette fade-in setup into $105300 (6 slots of 0xc4 bytes)
    fadeSetup_5c292(a6) {
      for (let i = 0; i < 6; i++) this.w32(0x105300 + 0xc4 * i, 0);
      let n = this.r16(a6); a6 += 2; if (!n) return;
      const d1 = this.r16(a6); a6 += 2; this.w16(0x105802, 1 << d1);
      let a3 = a6, a4 = 0x105300;
      const ch = (x, f) => f(x) & 0x1f00;
      for (; n > 0; n--) {
        let d7 = this.r16(a3); let a5 = this.r32(0x5c358 + ((d7 & 0x700) >> 6)); a3 += 2;
        this.w16(0x105a0a, d7); this.w16(0x1058fc, 0x6007); a5 = (a5 + s16((this.r16(0x1c0800) << 5) & 0xffff)) >>> 0;
        let p = this.r32(a3); a3 += 4; this.w32(a4, a5); a4 += 4;
        for (let k = 0; k < 16; k++) {
          const d6 = this.r16(p), d5 = this.r16(a5); p += 2; a5 += 2;
          for (const f of [x => x << 8, x => x << 3, x => x >> 2]) {
            const t = ch(d6, f), s = ch(d5, f); this.w16(a4, s); this.w16(a4 + 2, (s16((t - s) & 0xffff) >> d1) & 0xffff); a4 += 4;
          }
        }
      }
    },
    // 0x05c370: object choreography for the stagecoach scene, indexed by $10400d
    coach_5c370() {
      const k = this.r8(0x10400d), a6 = 0x180180;
      if (k === 0) { if (!this.dec8(0x10400c)) { this.w8(a6 + 0x2a, 0); this.w8(a6 + 0xaa, 0); this.w8(0x10400d, k + 1); } return; }
      if (k === 1) {
        if (s16(this.r16(a6 + 0x54)) > 0x70) return;
        this.w16(a6 + 0x78, 0); this.w32(a6 + 0x7c, 0); this.w16(a6 + 0xf8, 0); this.w32(a6 + 0xfc, 0);
        this.w16(a6 + 0x40, this.r16(a6 + 0x50));
        this.objSpawn_5bf08(0x70c3c, a6, 4);
        this.w16(a6 + 0x54, 0x70); this.w16(a6 + 0xd4, 0x70); this.w16(a6 + 0x50, this.r16(a6 + 0x40)); this.w16(a6 + 0xd0, this.r16(a6 + 0x40));
        this.w16(a6 + 0x7c, 0x240); this.w16(a6 + 0xfc, 0x240); this.w16(a6 + 0x7e, 0xffc0); this.w16(a6 + 0xfe, 0xffc0);
        this.w8(0x10400d, k + 1); return;
      }
      if (k === 2) {
        if (s16(this.r16(a6 + 0x54)) > 0x70) return;
        this.w16(a6 + 0x54, 0x70); this.w16(a6 + 0xd4, 0x70);
        this.w16(a6 + 0x78, 0); this.w32(a6 + 0x7c, 0); this.w16(a6 + 0xf8, 0); this.w32(a6 + 0xfc, 0);
        this.w8(0x10400d, k + 1);
      }
    },
    // 0x05bf00 / 0x05bf08: spawn film objects {count-1.w, then x.w, y.w, anim.l per object}
    objSpawn_5bf00(a3) { this.objSpawn_5bf08(a3, 0x180000, 1); },
    objSpawn_5bf08(a3, a4, d6) {
      let d7 = this.r16(a3); a3 += 2;
      for (;;) {
        this.w16(a4 + 0x50, this.r16(a3)); this.w16(a4 + 0x54, this.r16(a3 + 2)); this.w8(a4 + 2, 1);
        const a6 = this.r32(a3 + 4); a3 += 8;
        this.objAnimParse_5bfbc(a4, a6); this.w8(a4 + 1, d6); d6++; this.objPos_5c02a(a4);
        a4 += 0x80; if (a4 >= 0x181c80) return;
        if (--d7 < 0) return;
      }
    },
    // 0x014346: objects flagged on $2 bit 4 follow the scroll deltas
    objScroll_14346(a) {
      const f = this.r8(a + 2); if (!(f & 0x10)) return;
      const [dy, dx] = f & 0x20 ? [0x104116, 0x104114] : [0x104112, 0x104110];
      this.w16(a + 0x54, this.r16(a + 0x54) + this.r16(dy)); this.w16(a + 0x50, this.r16(a + 0x50) - this.r16(dx));
    },
    // 0x05bf64: velocity (+78 x, +7c y; +7a/+7e acceleration, every 10th frame when +2a is set)
    objMove_5bf64(a) {
      let d6 = 1, acc = true;
      if (this.r8(a + 0x2a)) { d6 = 10; if (this.dec8(a + 0x32)) acc = false; else this.w8(a + 0x32, 10); }
      if (acc) { this.w16(a + 0x78, this.r16(a + 0x78) + this.r16(a + 0x7a)); this.w16(a + 0x7c, this.r16(a + 0x7c) + this.r16(a + 0x7e)); }
      this.add32(a + 0x50, ((Math.trunc(s16(this.r16(a + 0x78)) / d6) << 16 >> 16) << 8) >>> 0);
      this.add32(a + 0x54, ((Math.trunc(s16(this.r16(a + 0x7c)) / d6) << 16 >> 16) << 8) >>> 0);
    },
    objAnim_5bfb0(a) { if (this.dec8(a + 0x17)) return; this.objAnimParse_5bfbc(a, this.r32(a + 0x1c)); },
    // 0x05bfbc: animation script {flags.b, time.b, frame.w}; frames are 8-byte records at $10615c
    objAnimParse_5bfbc(a4, a6) {
      let d0, d1;
      for (;;) { d0 = this.r8(a6); d1 = this.r8(a6 + 1); a6 += 2; if (d0 & 0x40) { a6 = this.r32(a6); continue; } break; }
      if (d0 & 0x20) { this.sound(this.r16(a6)); a6 += 2; }
      this.w8(a4 + 0x16, d0); this.w8(a4 + 0x17, d1); this.d0 = d0;
      if (d0 & 0x80) return;
      const a5 = (this.r32(0x10615c) + s16((this.r16(a6) << 3) & 0xffff)) >>> 0; a6 += 2;
      this.w8(a4, this.r8(a5)); if (this.r8(a5 + 1) === 0x20) this.w8(a4 + 0xf, 0x20);
      this.w16(a4 + 4, this.r16(a5 + 2)); this.w16(a4 + 0x18, this.r16(a5 + 4));
      this.w16(a4 + 0x58, s8(this.r8(a5 + 6)) & 0xffff); this.w16(a4 + 0x5a, s8(this.r8(a5 + 7)) & 0xffff);
      this.w32(a4 + 0x1c, a6 >>> 0);
    },
    // 0x05c02a: zoom from +f, screen position = world + offset * zoom / 32
    objPos_5c02a(a) {
      const z = this.r8(a + 0xf), d = this.r16(0x134c0 + 2 * z); this.w16(a + 0x10, d); this.w16(a + 0x14, d);
      const off = o => { let d3 = this.r16(o); if (z !== 0x20) d3 = ((s16(d3) * z) >>> 5) & 0xffff; return d3; };
      this.w16(a + 0xc, this.r16(a + 0x50) + off(a + 0x58));
      this.w16(a + 8, this.r16(a + 0x54) + off(a + 0x5a));
    },
  });
  Object.assign(Sim.prototype.JOBS, {
    // 0x05a520: film scene d7 setup (table 0x05a938, 0x18 bytes per scene)
    0x5a520(d7) {
      if (d7 !== 0x13) this.clearDown(0x184000, 0x4000);
      this.scrollClear_5ae4e(); this.scrollReset_24ba(); this.w8(0x10619d, 0); this.w8(0x106184, 0);
      for (const a of [0x106014, 0x10601c, 0x106188, 0x10618c]) this.w16(a, 0);
      for (const a of [0x1040f8, 0x104100, 0x1040fc, 0x104104]) this.w32(a, 0);
      this.w16(0x105a0a, d7); this.w16(0x1058fc, 0x6004);
      const a6 = 0x5a938 + this.r16(0x1c0800) * 0x18;
      this.w16(0x106012, this.r16(a6)); this.w16(0x10601a, this.r16(a6 + 2)); this.w16(0x106186, this.r16(a6 + 4)); this.w16(0x10618a, this.r16(a6 + 6));
      const b0 = this.r8(a6 + 8), b1 = this.r8(a6 + 9);
      this.w8(0x5c0709, b0 & 0x7f); this.w8(0x5c0707, b1 & 0x7f);
      this.w8(0x603b00, this.r8(a6 + 10)); this.w8(0x603e00, this.r8(a6 + 11));
      const l0 = this.r32(a6 + 12), l1 = this.r32(a6 + 16), rout = this.r32(a6 + 20);
      this.scrollInt_5c078(); if (this.unimpl) return;
      this.w8(0x603402, this.r8(0x1040c8)); this.w8(0x603400, this.r8(0x1040c9)); this.w8(0x603018, this.r8(0x1040cd));
      this.w8(0x603403, this.r8(0x1040d0)); this.w8(0x603401, this.r8(0x1040d1)); this.w8(0x603019, this.r8(0x1040d5));
      this.sceneBlit_5a640(l0, b0 & 0x80); this.sceneBlit_5a640(l1, b1 & 0x80);
      // scenes 7 and 0x0e take ~275k cycles, longer than a frame (~270k): the job is still running at the next IRQ,
      // so its done flag (and main-loop d0) only appear after that IRQ (measured with MAME totalcycles)
      // (the scene routine runs after that IRQ as well)
      if (d7 === 7 || d7 === 0x0e) { this.late = rout; return; }
      this.callRoutine(rout); if (this.unimpl) return;
      this.w8(0x1060ac, 0); this.mainD0 = this.d0;
    },
    // 0x05aba4: blank the FIX layer (d7 = 0 full, bit 7 tall, else short)
    0x5aba4(d7) { this.fixBlank_5aba4(d7); this.mainD0 = this.d0; },
  });
  Object.assign(Sim.prototype, {
    sceneBlit_5a640(a6, blk) {
      if (a6 === 0xffffffff) return;
      if (!blk) { ENG.rleBlit(this.rom, this.v, a6); this.d0 = (0x80 - (this.r8(a6 + 4) << 1)) & 0xff; return; }
      this.blockBlit_5a666(this.r32(a6), this.r32(a6 + 4), this.r32(a6 + 8), this.r8(a6 + 12), this.r8(a6 + 13), s16(this.r16(a6 + 14)), this.r32(a6 + 16));
    },
    fixBlank_5aba4(d7) {
      this.d0 = 0;
      let rows, cols, p, d1;
      if (!d7) { rows = 0x1b; cols = 0x27; p = 0x600118; d1 = 0x90; }
      else if (!(d7 & 0x80)) { rows = 0x17; cols = 0x23; p = 0x60021c; d1 = 0x10; }
      else { rows = 0x1b; cols = 0x23; p = 0x60011c; d1 = 0x10; }
      for (let r = 0; r <= rows; r++) { for (let k = 0; k <= cols; k++) { this.w8(p++, 0); this.w8(p++, d1); } p += (0x3f - cols) * 2; }
      this.w8(0x1060ac, 0);
    },
  });
  // scene routines (0x05a938 table +0x14) and timed film events, keyed by 68k address
  Sim.prototype.ROUT = {
    0x5a6be() {}, 0x5a806() {},
    0x5a6c0() { this.palLoad_d04e(0x6d82c); this.fixBlank_5aba4(0x81); this.w8(0x1061ab, 0); },
    0x5a6dc() { this.w32(0x104100, 0x8000); this.w32(0x104104, 0x8000); },
    0x5a6f2() { this.anim_c75c(0x6fcb6); },
    0x5a6fe() { this.anim_c75c(0x6fcc0); },
    0x5a70a() { this.palBlank_5a914(); this.anim_c75c(0x6fcd2); },
    0x5a71a() { this.objSpawn_5bf00(0x70bf0); },
    0x5a726() { this.objSpawn_5bf00(0x70c12); },
    0x5a732() { this.palBlank_5a914(); this.anim_c75c(0x6fd00); },
    0x5a742() { this.palBlank_5a914(); this.w8(0x10400c, 4); this.w8(0x10400d, 0); this.anim_c75c(0x6fd1c); this.objSpawn_5bf00(0x70c4e); },
    0x5a76c() { this.palBlank_5a914(); this.w8(0x10400c, 0x1e); this.w8(0x10400d, 0); this.anim_c75c(0x6fd52); this.objSpawn_5bf00(0x70cc0); },
    0x5a796() { this.anim_c75c(0x6fd88); },
    0x5a7a2() {
      this.w8(0x603900, (this.r8(0x603900) & 0xfc) | 2); this.w8(0x106118, this.r8(0x106118) | 4);
      this.w32(0x106122, this.r32(0x106012)); this.w32(0x106164, this.r32(0x106012));
      this.w16(0x10612e, 0); this.w16(0x106130, 0); this.w8(0x106121, 0x13); this.w8(0x106163, 1);
      this.w32(0x1040f8, 0x60000); this.w16(0x10612a, 0x100); this.w16(0x10612c, 0x300);
    },
    0x5c20a() { this.w8(0x5c0713, 4); this.w8(0x5c0715, 0x25); },
    0x5c21c() { for (let a = 0x140c00; a < 0x141000; a += 4) this.w32(a, 0); this.w8(0x5c0713, 0xc); this.w8(0x5c0715, 0x36); },
    0x5c236() { this.w8(0x5c0713, 4); this.w8(0x5c0715, 0x36); },
    0x5c248() { for (let a = 0x140c00; a < 0x141000; a += 4) this.w32(a, 0x7fff7fff); this.w8(0x5c0713, 0xc); this.w8(0x5c0715, 0x36); },
    0x5c262() { this.w8(0x5c0713, 4); this.w8(0x5c0715, 0x3f); },
  };
  Object.assign(Sim.prototype.FILM, {
    0x5b656() { this.sound(0x5c); this.w32(0x10615c, 0x7086e); this.w8(0x106157, 1); this.blank_5b80e(); },
    0x5b81e() { this.waitDraw_5b81e(); },
    0x5b68e() { if (this.r8(0x104136)) return; this.w8(0x105800, 0); this.stepInc(); },
    0x5b832() { this.scene_5b832(); },
    0x5b868() { if (this.r8(0x1060ac)) return; this.job_2666(0x1601); this.w8(0x1060ac, 1); this.stepInc(); },
    0x5b6da() { if (this.r8(0x1060ac)) return; this.fadeInit_cca0(0x6d83a); this.stepInc(); },
    0x5b6f6() { if (this.fadeStep_cd40()) { this.w8(0x10400a, 0x38); this.stepInc(); } },
    0x5b70e() {
      if (this.dec8(0x10400a)) return;
      this.sound_b1aa(0x93); this.w32(0x1040f8, 0xfffccc00); this.w32(0x104100, 0xfffccc00);
      this.w32(0x106032, 0x7039e); this.w32(0x106036, 0x703ea); this.w8(0x10400a, 0x5a); this.stepInc();
    },
    0x5b758() {
      this.streams_5c0f4(); if (this.dec8(0x10400a)) return;
      this.w32(0x1040f8, 0); this.w32(0x104100, 0); this.w16(0x106014, 0); this.w16(0x10601c, 0); this.w8(0x10400a, 0x1e); this.stepInc();
    },
    0x5b7bc() { if (this.dec8(0x10400a)) return; this.anim_c75c(0x6fc9c); this.stepInc(); },
    0x5b7d8() { this.anim_c7bc(); if (this.unimpl || this.animWait()) return; this.w8(0x10400a, 0x1c); this.stepInc(); },
    0x5b7fa() { this.coach_5c370(); this.FILM[0x5b800].call(this); },
    0x5b800() { if (this.dec8(0x10400a)) return; this.nextScene_5b808(); },
    0x5b880() { if (this.r8(0x1060ac)) return; this.w32(0x1040fc, 0x5c00); this.w32(0x104104, 0x5c00); this.w8(0x10400a, 0x5a); this.stepInc(); },
    0x5b8ac() { if (this.dec8(0x10400a)) return; this.w32(0x1040fc, 0); this.w32(0x104104, 0); this.w8(0x10400a, 0x3c); this.stepInc(); },
    0x5b8d0() { if (this.r8(0x1060ac)) return; this.w8(0x10400a, 0x78); this.stepInc(); },
    0x5b8e8() { if (this.r8(0x1060ac)) return; this.sound(0x5a); this.w8(0x10400a, 0xb4); this.stepInc(); },
    0x5b90a() { if (this.r8(0x1060ac)) return; this.stepInc(); },
    0x5b91a() { this.anim_c7bc(); if (this.unimpl || this.animWait()) return; this.nextScene_5b808(); },
    0x5b922() { this.anim_c7bc(); if (this.unimpl) return; this.events_5c152(0x5c18c); if (this.unimpl || this.animWait()) return; this.nextScene_5b808(); },
    0x5b944() { if (this.r8(0x1060ac)) return; this.stepInc(); this.w8(0x10400d, 0); this.w8(0x10400c, 6); },
    0x5b962() { if (this.r8(0x1060ac)) return; this.w32(0x1040f8, 0xffffa400); this.w32(0x104100, 0x200000); this.w8(0x10400a, 0x5a); this.stepInc(); },
    0x5b98e() { if (this.dec8(0x10400a)) return; this.w32(0x1040f8, 0); this.w32(0x104100, 0); this.nextScene_5b808(); },
    0x5b9a6() {
      if (this.r8(0x1060ac)) return;
      this.w8(0x10400a, 0xb4); this.w8(0x10400d, 0); this.w8(0x10400c, 0x78);
      const a6 = 0x180180; this.w16(a6 + 0x78, 0x180); this.w16(a6 + 0xf8, 0x180); this.w16(a6 + 0x7e, 0xffc0); this.w16(a6 + 0xfe, 0xffc0);
      this.stepInc(); this.w8(a6 + 0x2a, 1); this.w8(a6 + 0xaa, 1); this.w8(a6 + 0x32, 10); this.w8(a6 + 0xb2, 10);
    },
    0x5ba02() { if (this.r8(0x1060ac)) return; this.w8(0x10400a, 0x42); this.stepInc(); },
    0x5ba1a() { if (this.dec8(0x10400a)) return; this.anim_c75c(0x6fcee); this.stepInc(); },
    0x5ba36() { this.animFade(0, 0x6ee64); },
    0x5ba5c() { this.animFade(0x5c1ac, 0x6ee7a); },
    0x5ba8e() { this.animFade(0x5c1e4, 0x6eea2); },
    0x5bb8c() { this.animFade(0, 0x6eeca); },
    0x5bac0() { this.title_901e(0x71072); },
    0x5baea() { this.title_901e(0x7107e); },
    0x5bb14() { this.title_901e(0x7108a); },
    0x5bbb2() { this.title_901e(0x71094); },
    0x5bb3e() {
      if (this.dec8(0x10400a)) return;
      this.textErase_934a(0x7108a); this.fadeSetup_5c292(0x6ebbc); this.stepInc(); this.w8(0x10400a, 0x1e);
    },
    0x5bb74() { if (this.fadeStep_cd40()) { this.w8(0x10400a, 0x1e); this.stepInc(); } },
    0x5bbdc() {
      if (this.r8(0x1060ac)) return;
      this.palStart_cde0(0x10f70); this.w8(0x10400a, this.r8(0x104160) ? 0xf0 : 0x78); this.stepInc();
    },
    0x5bc10() {
      this.palRun_cea4(false); if (this.dec8(0x10400a)) return;
      this.w32(0x104100, 0x6d40); this.w8(0x10400a, 0x96); this.objSpawn_5bf00(0x70ce2);
      for (let i = 0; i < 12; i++) { this.w16(0x180078 + 0x80 * i, 0xfeb8); this.w8(0x18000f + 0x80 * i, 0x10); }
      this.stepInc();
    },
    0x5bcb4() {
      this.palRun_cea4(false); if (this.dec8(0x10400a)) return;
      this.w32(0x104100, 0); this.w16(0x10601c, 0); this.w16(0x10400c, this.r8(0x104160) ? 0x10e : 0x5a);
      for (let i = 0; i < 12; i++) this.w16(0x180078 + 0x80 * i, 0);
      this.stepInc();
    },
    0x5bd24() {
      this.palRun_cea4(false); const t = (this.r16(0x10400c) - 1) & 0xffff; this.w16(0x10400c, t); if (t) return;
      this.fadeStart_ce6a(0x10f70); this.nextScene_5b808();
    },
  });
  Object.assign(Sim.prototype, {
    animFade(ev, pal) {
      this.anim_c7bc(); if (this.unimpl) return;
      if (ev) { this.events_5c152(ev); if (this.unimpl) return; }
      if (this.animWait()) return; this.fadeSetup_5c292(pal); this.stepInc();
    },
    title_901e(a6) { if (!this.fadeStep_cd40()) return; this.text_901e(a6, 0x91b0); this.w8(0x10400a, 0xb4); this.stepInc(); },
    // 0x05a914: palette 0x140c00: 0x200 bytes black, then 0x100 bytes 0x7fff
    palBlank_5a914() { this.d0 = 0xff; for (let a = 0x140c00; a < 0x140e00; a += 4) this.w32(a, 0); for (let a = 0x140e00; a < 0x140f00; a += 4) this.w32(a, 0x7fff7fff); },
    // 0x00901e: text {dest.l, attr, chars..., '/' = new string, '?' = end}; font a5 = 0x91b0. d5 is left over from
    // the IRQ code (0x23 on every call, read with MAME), so the 2-cell-wide glyph path (8 bytes per glyph) is used.
    text_901e(a6, a5) {
      for (;;) {
        let a4 = this.r32(a6); a6 += 4; const d4 = (this.r8(a6++) << 5) & 0xff;
        for (;;) {
          const c = this.r8(a6++);
          if (c === 0x3f) return;
          if (c === 0x2f) break;
          let d6 = (c - 0x30) & 0xff;
          if (d6 === 0xfe) continue;
          const half = d6 === 0xfc; if (half) d6 = 0x2f;   // 0xfc: one cell of glyph 0x2f
          const g = a5 + (d6 << 3);
          for (let k = 0; k < (half ? 1 : 2); k++) {
            const o = g + 4 * k;
            this.w8(a4 + 0x80, this.r8(o + 2) | d4); this.w8(a4 + 0x81, this.r8(o + 3));
            this.w8(a4, this.r8(o) | d4); this.w8(a4 + 1, this.r8(o + 1)); a4 += 2;
          }
        }
      }
    },
    // 0x00934a: erase the cells a 0x901e string covered (same d5 = 0x23 width)
    textErase_934a(a6) {
      for (;;) {
        let a4 = this.r32(a6); a6 += 5;
        for (;;) {
          const c = this.r8(a6++);
          if (c === 0x3f) return;
          if (c === 0x2f) break;
          for (let k = 0; k < 2; k++) { this.w8(a4 + 0x80, 0); this.w8(a4 + 0x81, 0x10); this.w8(a4, 0); this.w8(a4 + 1, 0x10); a4 += 2; }
        }
      }
    },
  });
  const api = { Sim };
  if (typeof module !== 'undefined') module.exports = api; else G.SSRATT = api;
})(typeof window !== 'undefined' ? window : globalThis);
