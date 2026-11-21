// Sunset Riders (Konami GX064, MAME "ssriders") machine: 68000 + hardware glue, following MAME tmnt2.cpp
// (ssriders_main_map) and the Konami chip devices (k052109, k053244/5, k053251, eepromser ER5911-8bit).
// Deterministic and integer-only: one 68000 cycle counter drives everything (16 MHz, 270336 cycles per frame).
// The whole machine state (CPU registers + RAMs + chip registers) is save()/load()-able for rollback.
(function (G) {
  'use strict';
  const M68K = typeof require !== 'undefined' ? require('./m68k.js') : G.M68K;
  const HW = typeof require !== 'undefined' ? require('./hw.js') : G.SSRHW;
  const SND_OFS = 8;             // 68000 bus access time relative to now()
  const FRAME = 270336;          // 16 MHz / 59.185606 Hz = 384 x 264 pixels at 6 MHz -> 1024 cycles per line
  const VBLANK = 40 * 1024;      // screen vblank: lines 240..263 + 0..15 (visible area 16..239); a frame starts at line 240
  const RESET_CYC = 34;          // MAME: first instruction after reset starts at totalcycles 34
  const EE_WRITE_CYC = 28000;    // ER5911 write time 1750 us
  const EE_ERASEALL_CYC = 128000;// 8000 us

  function Machine(prog, eeprom, gfxTiles, gfxSprites) {
    this.rom = prog; this.tiles = gfxTiles || null; this.sprROM = gfxSprites || null;
    this.eeDefault = Uint8Array.from(eeprom);
    this.v = HW.newVideo();                  // pal (byte-swapped like the recorder), k052109 RAM, regs, k053251, k053244 regs, k053245 buffer, misc
    this.wram = new Uint8Array(0x4000);
    this.spr = new Uint16Array(0x2000);      // 0x180000 spriteram share (word)
    this.k245 = new Uint16Array(0x400);      // K053245 internal RAM (word)
    this.ram1c05 = new Uint8Array(0x80);
    this.ee = new Uint8Array(128);
    // scalar state, one Int32Array so it snapshots trivially
    this.s = new Int32Array(S_LEN);
    this.inputs = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]); // P1..P4, COINS, TEST (bit 7 = service/test switch); active low
    this.soundLog = [];                       // [cycle, addr, data] sound-latch writes (not part of the video state)
    this.z80ReplyCycle = 7168784;             // calibrated vs MAME: first 0x5c0601 poll (by instruction start cycle) that sees the sound CPU's boot answer 0x80
    this.snd = null;                          // SoundBoard (sound.js) once attachSound() is called; otherwise the reply is faked
    this.cpu = new M68K.CPU(this.makeBus());
    this.cpu.ephase = () => this.ephase();
    this.unmapped = null;
  }
  // scalar slots
  const S_CYC0 = 0, S_FRAME = 1, S_IRQCTL = 2, S_RMRD = 3, S_ROMSUB = 4, S_ROMBANK245 = 5, S_DIMC = 6, S_DIMV = 7,
    EE_STATE = 8, EE_DI = 9, EE_CS = 10, EE_CLK = 11, EE_CSRISE = 12, EE_ACC = 13, EE_BITS = 14, EE_CMD = 15, EE_ADDR = 16,
    EE_SHIFT = 17, EE_LOCKED = 18, EE_DONE = 19, S_WATCHDOG = 20, S_CRB = 21 /*21..24 charrombank, 25..28 charrombank_2*/, EE_BUSY = 29, S_LEN = 30;
  const ST_RESET = 0, ST_START = 1, ST_CMD = 2, ST_READ = 3, ST_DATA = 4, ST_DONE = 5;
  const C_READ = 1, C_WRITE = 2, C_LOCK = 3, C_UNLOCK = 4, C_ERASEALL = 5, C_INVALID = 0;
  const ADDR_BITS = 9, DATA_BITS = 8; // MAME er5911 8-bit: 9 command-address bits, cells masked to 7 bits

  // Absolute cycle count, wrapping int32 (it overflows after ~7900 frames): only use it for differences.
  Machine.prototype.now = function () { return (this.s[S_CYC0] + FRAME - this.cpu.R[24]) | 0; };
  // Absolute cycle count mod 10 (68000 E clock phase). S_CYC0 = (S_FRAME-1)*FRAME during run(); FRAME % 10 = 6.
  // sound board: Z80 program + K053260 sample ROM (MAME-exact 68000 <-> Z80 communication)
  Machine.prototype.attachSound = function (z80rom, pcmrom) {
    const SB = typeof require !== 'undefined' ? require('./sound.js') : G.SoundBoard;
    this.snd = new SB(z80rom, pcmrom);
  };
  // absolute 68000 time (cycles since power-on), exact beyond 2^31
  Machine.prototype.absNow = function () { return (this.s[S_FRAME] - 1) * FRAME + FRAME - this.cpu.R[24] + SND_OFS; };
  Machine.prototype.ephase = function () { return ((((this.s[S_FRAME] - 1) % 10) * 6 + FRAME - this.cpu.R[24]) % 10 + 20) % 10; };

  Machine.prototype.powerOn = function () {
    const v = this.v; for (const [k] of HW.FIELDS) v[k].fill(0); v.misc[0] = 0x10;
    this.wram.fill(0); this.spr.fill(0); this.k245.fill(0); this.ram1c05.fill(0); this.ee.set(this.eeDefault);
    this.s.fill(0); this.s[EE_LOCKED] = 1; this.s[EE_DONE] = 0; this.s[EE_BUSY] = 0; this.soundLog.length = 0; if (this.snd) this.snd.reset();
    const R = this.cpu.R; R.fill(0);
    this.cpu.reset();
    // frame 1 = time 0; reset itself costs RESET_CYC cycles before the first instruction
    this.s[S_CYC0] = -FRAME; this.s[S_FRAME] = 1; R[24] = -RESET_CYC;
  };
  // Advance to the next vblank (= next recorded frame): run the CPU to the boundary, then the vblank IRQ fires.
  Machine.prototype.step = function () {
    const R = this.cpu.R, s = this.s;
    s[S_CYC0] += FRAME; R[24] += FRAME;
    this.cpu.run();
    if (this.snd) this.snd.frameEnd(this.absNow());
    s[S_FRAME]++;
    this.eeReady(); // settle the busy flag every frame so the wrapping clock never confuses it
    // vblank start: K052109 asserts IRQ (68000 level 4, held) when irq_control bit 2 is set
    if ((s[S_IRQCTL] & 4) && R[26] !== 4) {
      R[26] = 4;
      // MAME's 68000 samples IPL as the final prefetch starts (4 cycles before the instruction ends) and the vblank
      // IRQ is asserted ~1 cycle before the frame boundary (fit to traces): if the
      // instruction crossing the boundary ends less than 3 cycles after it, one more instruction runs first.
      if (-R[24] < 3) R[28] = 1;
    }
  };
  Machine.prototype.frame = function () { return this.s[S_FRAME]; };

  // ---------------- EEPROM (ER5911, 128 x 8) ----------------
  Machine.prototype.eeReady = function () { const s = this.s; if (s[EE_BUSY] && ((this.now() - s[EE_DONE]) | 0) >= 0) s[EE_BUSY] = 0; return s[EE_BUSY] ? 0 : 1; };
  Machine.prototype.eeDO = function () { return this.s[EE_STATE] === ST_READ ? (this.s[EE_SHIFT] >>> 31) & 1 : 1; };
  Machine.prototype.eeEvent = function (ev) { // ev: 1 cs rise, 2 cs fall, 3 clk rise
    const s = this.s;
    if (ev === 2) { s[EE_STATE] = ST_RESET; return; }
    switch (s[EE_STATE]) {
      case ST_RESET: if (ev === 1) s[EE_STATE] = ST_START; break;
      case ST_START: if (ev === 3 && s[EE_DI] && this.eeReady() && ((this.now() - s[EE_CSRISE]) | 0) > 0) { s[EE_ACC] = 0; s[EE_BITS] = 0; s[EE_STATE] = ST_CMD; } break;
      case ST_CMD:
        if (ev !== 3) break;
        s[EE_ACC] = (s[EE_ACC] << 1) | s[EE_DI];
        if (++s[EE_BITS] === 2 + ADDR_BITS) {
          let a = s[EE_ACC] & ((1 << ADDR_BITS) - 1), cmd = C_INVALID;
          switch (s[EE_ACC] >> ADDR_BITS) {
            case 0: cmd = [C_LOCK, C_INVALID, C_ERASEALL, C_UNLOCK][a >> (ADDR_BITS - 2)]; a = 0; break;
            case 1: case 3: cmd = C_WRITE; break;
            case 2: cmd = C_READ; break;
          }
          s[EE_ADDR] = a; s[EE_CMD] = cmd; s[EE_BITS] = 0;
          if (cmd === C_READ) { s[EE_SHIFT] = 0; s[EE_STATE] = ST_READ; }
          else if (cmd === C_WRITE) { s[EE_SHIFT] = 0; s[EE_STATE] = ST_DATA; }
          else if (cmd === C_LOCK) { s[EE_LOCKED] = 1; s[EE_STATE] = ST_RESET; }
          else if (cmd === C_UNLOCK) { s[EE_LOCKED] = 0; s[EE_STATE] = ST_RESET; }
          else if (cmd === C_ERASEALL) { if (s[EE_LOCKED]) s[EE_STATE] = ST_RESET; else { this.ee.fill(0xff); s[EE_DONE] = this.now() + EE_ERASEALL_CYC; s[EE_BUSY] = 1; s[EE_STATE] = ST_DONE; } }
          else throw new Error('EEPROM invalid command');
        }
        break;
      case ST_READ:
        if (ev !== 3) break;
        if (s[EE_BITS]++ === 0) s[EE_SHIFT] = this.ee[s[EE_ADDR] & 127] << 24;
        else s[EE_SHIFT] = (s[EE_SHIFT] << 1) | 1;
        break;
      case ST_DATA:
        if (ev !== 3) break;
        s[EE_SHIFT] = (s[EE_SHIFT] << 1) | s[EE_DI];
        if (++s[EE_BITS] === DATA_BITS) {
          if (s[EE_LOCKED]) s[EE_STATE] = ST_RESET;
          else { this.ee[s[EE_ADDR] & 127] = s[EE_SHIFT] & 0xff; s[EE_DONE] = this.now() + EE_WRITE_CYC; s[EE_BUSY] = 1; s[EE_STATE] = ST_DONE; }
        }
        break;
    }
  };
  Machine.prototype.eepromOut = function (d) { // ssriders_eeprom_w low byte; ioport fields in mask order: DI, CS, CLK
    const s = this.s;
    s[EE_DI] = d & 1;
    const cs = (d >> 1) & 1; if (cs !== s[EE_CS]) { s[EE_CS] = cs; if (cs) s[EE_CSRISE] = this.now(); this.eeEvent(cs ? 1 : 2); }
    const clk = (d >> 2) & 1; if (clk !== s[EE_CLK]) { s[EE_CLK] = clk; if (clk) this.eeEvent(3); }
    s[S_DIMC] = d & 0x18; this.v.misc[0] = d & 0x18;
    s[S_ROMBANK245] = ((d >> 5) & 1) << 2;
  };

  // ---------------- K052109 ----------------
  Machine.prototype.k109r = function (o) {
    if (!this.s[S_RMRD]) return this.v.k052109[o];
    const s = this.s; let code = (o & 0x1fff) >> 5; const color = s[S_ROMSUB];
    const bank = (s[S_CRB + ((color & 0x0c) >> 2)] >> 2) | (s[S_CRB + 4 + ((color & 0x0c) >> 2)] >> 2);
    code |= ((color & 0x03) << 8) | ((color & 0x10) << 6) | ((color & 0x0c) << 9) | (bank << 13); // tmnt2 tile_callback
    if (!this.tiles) throw new Error('char ROM read needs gfx_tiles.bin');
    return this.tiles[((code << 5) + (o & 0x1f)) & 0xfffff];
  };
  Machine.prototype.k109w = function (o, d) {
    const v = this.v, r = v.k052109_regs, s = this.s;
    v.k052109[o] = d;
    if ((o & 0x1fff) < 0x1800) return;
    if (o === 0x1c00) r[8] = d;
    else if (o === 0x1c80) r[10] = d;
    else if (o === 0x1d00) {
      if ((~d & s[S_IRQCTL]) & 4) this.cpu.R[26] = 0; // clear the vblank IRQ
      s[S_IRQCTL] = d;
    }
    else if (o === 0x1d80) { r[0] = s[S_CRB] = d & 15; r[1] = s[S_CRB + 1] = d >> 4; }
    else if (o === 0x1e00 || o === 0x3e00) { r[11] = s[S_ROMSUB] = d; }
    else if (o === 0x1e80) r[9] = d & 7;
    else if (o === 0x1f00) { r[2] = s[S_CRB + 2] = d & 15; r[3] = s[S_CRB + 3] = d >> 4; }
    else if (o === 0x3d80) { r[4] = s[S_CRB + 4] = d & 15; r[5] = s[S_CRB + 5] = d >> 4; }
    else if (o === 0x3f00) { r[6] = s[S_CRB + 6] = d & 15; r[7] = s[S_CRB + 7] = d >> 4; }
  };

  // ---------------- K053244/K053245 ----------------
  Machine.prototype.k244buf = function (clear) {
    const b = this.v.k053245_buf;
    if (clear) { b.fill(0); return; }   // MAME clears every 8th word; the recorder zeroes it all (matches what is drawn)
    for (let i = 0; i < 0x400; i++) { b[2 * i] = this.k245[i] >> 8; b[2 * i + 1] = this.k245[i] & 0xff; }
  };
  Machine.prototype.k244r = function (o) {
    if (o === 6) this.k244buf(false); else if (o === 7) this.k244buf(true);
    else if (o >= 0x0c) {
      const g = this.v.k053244, a = ((this.s[S_ROMBANK245] << 19) | ((g[11] & 7) << 18) | (g[8] << 10) | (g[9] << 2) | ((o & 3) ^ 1)) & 0x1fffff;
      if (!this.sprROM) throw new Error('sprite ROM read needs gfx_sprites.bin');
      return this.sprROM[a];
    }
    return 0;
  };
  Machine.prototype.k244w = function (o, d) { this.v.k053244[o] = d; if (o === 6) this.k244buf(false); else if (o === 7) this.k244buf(true); };
  Machine.prototype.sprW = function (off, d, mask) { // k053245_scattered_word_w
    this.spr[off] = (this.spr[off] & ~mask) | (d & mask);
    if (!(off & 0x31)) { const o = ((off & 0xe) >> 1) | ((off & 0x1fc0) >> 3); this.k245[o] = (this.k245[o] & ~mask) | (d & mask); }
  };
  Machine.prototype.sprR = function (off) { return (off & 0x31) ? this.spr[off] : this.k245[((off & 0xe) >> 1) | ((off & 0x1fc0) >> 3)]; };

  // ---------------- protection (ssriders_protection_r/w) ----------------
  Machine.prototype.protR = function () {
    const rw = this.rw16; let data = rw(0x105a0a); const cmd = rw(0x1058fc);
    switch (cmd) {
      case 0x100b: return 0x64;
      case 0x6003: return data & 0xf;
      case 0x6004: return data & 0x1f;
      case 0x6000: return data & 1;
      case 0x0000: case 0x6007: return data & 0xff;
      case 0x8abc:
        data = -rw(0x105818);
        data = ((((data / 8) | 0) - 4) & 0x1f) * 0x40;
        data += ((((rw(0x105cb0) + rw(0x1040c8) - 6) / 8) | 0) + 12) & 0x3f;
        return data & 0xffff;
      default: return 0xffff;
    }
  };
  Machine.prototype.protW = function () {
    let hw = 1;
    for (let lp = 1; lp < 0x100; lp <<= 1)
      for (let i = 0; i < 128; i++)
        if ((this.rw16(0x180006 + 128 * i) >> 8) === lp) { const o = 8 * i; this.k245[o] = (this.k245[o] & 0xff00) | (hw & 0xff); hw++; }
  };

  // ---------------- bus ----------------
  Machine.prototype.makeBus = function () {
    const self = this, rom = this.rom, wram = this.wram, v = this.v;
    // 16-bit device read; mask: 0xff00 upper byte only, 0x00ff lower only, 0xffff word
    function ioR(a, mask) {
      if (a >= 0x140000 && a < 0x141000) { const o = a - 0x140000; return (v.pal[o ^ 1] << 8) | v.pal[o]; }
      if (a >= 0x180000 && a < 0x184000) return self.sprR((a - 0x180000) >> 1);
      if (a >= 0x600000 && a < 0x604000) { const o = (a - 0x600000) >> 1; return (mask & 0xff00) ? self.k109r(o) << 8 : self.k109r(o + 0x2000); }
      if (a >= 0x1c0000 && a < 0x1c0008) return 0xff00 | self.inputs[(a - 0x1c0000) >> 1]; // TODO: unused upper byte
      if (a === 0x1c0100) return 0xff00 | self.inputs[4];
      if (a === 0x1c0102) {
        const now = self.now(), vb = (((now - self.s[S_CYC0]) | 0) % FRAME) < VBLANK ? 1 : 0; // cycles since the last frame boundary
        return (self.inputs[5] & 0x80) | 0x70 | ((vb ^ 1) << 3) | /* bit 3 = NVBLK, active low */ (self.eeReady() << 1) | self.eeDO();
      }
      if (a === 0x1c0400) return 0;
      if (a >= 0x1c0500 && a < 0x1c0580) { const o = a - 0x1c0500; return (self.ram1c05[o] << 8) | self.ram1c05[o + 1]; }
      if (a === 0x1c0800) return self.protR();
      if (a >= 0x5a0000 && a < 0x5a0020) { // noA1
        const o = ((a - 0x5a0000) >> 1) & ~1; let r = 0;
        if (mask & 0x00ff) r |= self.k244r(o + 1); if (mask & 0xff00) r |= self.k244r(o) << 8; return r;
      }
      if (a >= 0x5c0600 && a < 0x5c0604) { // K053260 main_read (odd bytes): sound CPU -> main latches
        if (self.snd) return self.snd.mainRead(self.absNow(), (a >> 1) & 1);
        if (a === 0x5c0600) return self.s[S_FRAME] > 100 || self.now() >= self.z80ReplyCycle ? 0x80 : 0;
        return 0;
      }
      self.unmapped = self.unmapped || ('read ' + a.toString(16) + ' pc ' + self.cpu.R[27].toString(16));
      return 0;
    }
    function ioW(a, d, mask) { // d positioned as a 16-bit word
      if (a >= 0x140000 && a < 0x141000) { const o = a - 0x140000; if (mask & 0xff00) v.pal[o ^ 1] = d >> 8; if (mask & 0xff) v.pal[o] = d & 0xff; return; }
      if (a >= 0x180000 && a < 0x184000) { self.sprW((a - 0x180000) >> 1, d, mask); return; }
      if (a >= 0x600000 && a < 0x604000) { const o = (a - 0x600000) >> 1; if (mask & 0xff00) self.k109w(o, d >> 8); else self.k109w(o + 0x2000, d & 0xff); return; }
      if (a === 0x1c0200) { if (mask & 0xff) self.eepromOut(d & 0xff); return; }
      if (a === 0x1c0300) { if (mask & 0xff) { self.s[S_RMRD] = (d >> 3) & 1; self.s[S_DIMV] = (d & 0x70) >> 4; v.misc[1] = (d & 0x70) >> 4; } return; }
      if (a === 0x1c0400) { self.s[S_WATCHDOG] = self.s[S_FRAME]; return; }
      if (a >= 0x1c0500 && a < 0x1c0580) { const o = a - 0x1c0500; if (mask & 0xff00) self.ram1c05[o] = d >> 8; if (mask & 0xff) self.ram1c05[o + 1] = d & 0xff; return; }
      if (a === 0x1c0800) return;
      if (a === 0x1c0802) { self.protW(); return; }
      if (a >= 0x5a0000 && a < 0x5a0020) { const o = ((a - 0x5a0000) >> 1) & ~1; if (mask & 0xff00) self.k244w(o, d >> 8); if (mask & 0xff) self.k244w(o + 1, d & 0xff); return; }
      if (a >= 0x5c0600 && a < 0x5c0606) {
        if (mask & 0xff) {
          self.soundLog.push(self.now(), a, d & 0xff);
          if (self.snd) { if (a === 0x5c0604) self.snd.mainIrq(self.absNow()); else self.snd.mainWrite(self.absNow(), (a >> 1) & 1, d & 0xff); }
        }
        return;
      }
      if (a >= 0x5c0700 && a < 0x5c0720) { if (mask & 0xff) v.k053251[((a - 0x5c0700) >> 1) & 15] = d & 0x3f; return; }
      self.unmapped = self.unmapped || ('write ' + a.toString(16) + ' pc ' + self.cpu.R[27].toString(16));
    }
    function rw(a) {
      a &= 0xfffffe;
      if (a < 0xc0000) return (rom[a] << 8) | rom[a + 1];
      if (a >= 0x104000 && a < 0x108000) { a -= 0x104000; return (wram[a] << 8) | wram[a + 1]; }
      return ioR(a, 0xffff);
    }
    function rb(a) {
      a &= 0xffffff;
      if (a < 0xc0000) return rom[a];
      if (a >= 0x104000 && a < 0x108000) return wram[a - 0x104000];
      const w = ioR(a & ~1, a & 1 ? 0x00ff : 0xff00); return a & 1 ? w & 0xff : w >> 8;
    }
    function ww(a, d) {
      a &= 0xfffffe;
      if (a >= 0x104000 && a < 0x108000) { a -= 0x104000; wram[a] = d >> 8; wram[a + 1] = d; return; }
      if (a < 0xc0000) return;
      ioW(a, d & 0xffff, 0xffff);
    }
    function wb(a, d) {
      a &= 0xffffff;
      if (a >= 0x104000 && a < 0x108000) { wram[a - 0x104000] = d; return; }
      if (a < 0xc0000) return;
      ioW(a & ~1, (a & 1) ? d & 0xff : (d & 0xff) << 8, a & 1 ? 0x00ff : 0xff00);
    }
    const rl = a => ((rw(a) << 16) | rw(a + 2)) >>> 0;
    const wl = (a, d) => { ww(a, d >>> 16); ww(a + 2, d & 0xffff); };
    this.rw16 = rw;
    return { rb, rw, rl, wb, ww, wl };
  };

  // ---------------- snapshots ----------------
  Machine.prototype.save = function () {
    const v = {}; for (const [k] of HW.FIELDS) v[k] = this.v[k].slice();
    return { R: this.cpu.R.slice(), v, wram: this.wram.slice(), spr: this.spr.slice(), k245: this.k245.slice(), ram1c05: this.ram1c05.slice(),
      ee: this.ee.slice(), s: this.s.slice(), inputs: this.inputs.slice(), nsnd: this.soundLog.length, snd: this.snd ? this.snd.save() : null };
  };
  Machine.prototype.load = function (st) {
    this.cpu.R.set(st.R); for (const [k] of HW.FIELDS) this.v[k].set(st.v[k]);
    this.wram.set(st.wram); this.spr.set(st.spr); this.k245.set(st.k245); this.ram1c05.set(st.ram1c05); this.ee.set(st.ee); this.s.set(st.s);
    this.inputs.set(st.inputs); this.soundLog.length = Math.min(this.soundLog.length, st.nsnd);
    if (this.snd && st.snd) this.snd.load(st.snd);
  };
  // spriteram as the recorder sees it (0x180000-0x183fff read through the scattered handler), big-endian bytes
  Machine.prototype.sprBytes = function () {
    const o = new Uint8Array(0x4000); for (let i = 0; i < 0x2000; i++) { const w = this.sprR(i); o[2 * i] = w >> 8; o[2 * i + 1] = w & 0xff; } return o;
  };

  const api = { Machine, FRAME, VBLANK };
  if (typeof module !== 'undefined') module.exports = api; else G.SSRM = api;
})(typeof window !== 'undefined' ? window : globalThis);
