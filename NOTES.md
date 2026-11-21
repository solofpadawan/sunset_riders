# Sunset Riders (Konami 1991, arcade) - HTML5/JS/Canvas remake

## Goals
- Faithful gameplay, timing and audio vs the original; optional visual enhancements (toggle, never changing logic).
- Verification frame-by-frame against MAME (Lua scripts: per-frame RAM/sprite/scroll/sound-register traces + screenshots), like the openMSX Tcl traces used in kv2/ and hinotori/.
- Headless Chrome/Playwright regression tests (test/), pixel-diff vs MAME shots.
- ROMs and anything extracted from them (gfx, samples, reference audio) are NEVER in git nor in shareable zips. roms/, ref/, web/assets/ are gitignored; extraction is done by a script the user runs locally on his own ROM set.

## Deploy rule
- Real folder (not symlink) in XAMPP htdocs:
  - Saulo-PC: C:\xampp\htdocs\sunsetriders_web -> http://localhost/sunsetriders_web/
  - Yoda-PC: D:\xampp\htdocs\sunsetriders_web -> http://localhost:8080/sunsetriders_web/
- index.html opens the game directly. Preview on the box first; deploy ONLY when Saulo asks. Cache-bust with ?v=<stamp>.

## Hardware (MAME src/mame/konami/tmnt2.cpp, ssriders_state; copy in ref/mame_tmnt2.cpp)
- 68000 @ 16 MHz (32 MHz/2), Z80 @ 8 MHz sound, YM2151 @ 3.579545 MHz + K053260 PCM; EEPROM settings.
- Video: K052109 tilemaps, K053245 sprites (not K051960), K053251 priority/mixer; IRQ4 at vblank from K052109.
- Screen: set_raw(24 MHz/4, 384, 16, 304, 264, 16, 240) => visible 288x224, refresh 6e6/(384*264) = 59.185606 Hz.
- Sets (MAME has no box install; list from source): parent ssriders (4P EAC); clones ssriderseaa (4P EAA), ssridersebd (2P EBD),
  ssridersebc (2P EBC), ssridersuda (4P UDA), ssridersuac (4P UAC), ssridersuab (4P UAB), ssridersubc (2P UBC),
  ssridersadd (4P ADD), ssridersabd (2P ABD), ssridersjad (4P JAD), ssridersjac (4P JAC), ssridersjbd (2P JBD);
  bootlegs ssridersb, ssriders2 (not working).
- ROMs (parent ssriders):
  - 68000 program: 064eac02.8e + 064eac03.8g (16-bit interleaved, 0x00000-0x7FFFF), 064eab04.10e + 064eab05.10g (0x80000-0xBFFFF)
  - Z80 sound program: 064e01.2f (64 KB)
  - Tiles K052109: 064e12.16k + 064e11.12k (32-bit word interleave, 1 MB)
  - Sprites K053245: 064e09.7l + 064e07.3l (2 MB)
  - K053260 samples: 064e06.1d (1 MB)
  - default EEPROM ssriders_eac.nv
  Only the program ROMs differ between regional versions; gfx/sound shared.

## Plan
0. Tooling: install MAME on the box (apt/build), Lua trace scripts in run/ (inputs replay, RAM, sprite list, K052109 scroll, YM2151/K053260 writes per frame).
1. tools/extract.py (run locally): ROM zip -> web/assets (tile/sprite atlases decoded 4bpp + palettes from RAM dumps, K053260 samples).
2. Sound: Z80 + YM2151 + K053260 emulation in an AudioWorklet running the original driver (as kv2/hinotori), music/SFX test page.
3. Title / attract / Konami logo / character select.
4. Player movement, shooting, jump/slide, climbing - frame-exact vs MAME traces.
5. Stage 1 (Simon Greedwell): layers + scroll, enemies, items, boss; HUD, death/continue.
6. One stage per session; 2P later; enhancements last; itch build packaging (no ROM content -> needs a user-supplied ROM loader).

## MAME on the box
- MAME 0.276 (Debian trixie contrib package `mame`, /usr/games/mame). Driver konami/tmnt2.cpp, all 15 ssriders* sets listed (`mame -listfull 'ssriders*'`).
  apt note: box sources switched to https://mirrors.edge.kernel.org/debian with `main contrib` (deb.debian.org returned 500/SSL errors).
- Refresh caveat: 0.276 -listxml reports ssriders at 60.000000 Hz (older screen config); MAME master uses set_raw -> 59.185606 Hz
  (ref/mame_tmnt2.cpp). Use 59.1856 in the remake; for frame-exact compares build/patch MAME master or note the drift.
- Headless Lua run (verified with romless `pong`, run/smoke.lua prints LUA_OK):
  `mame ssriders -rompath /workspace/sunsetriders/roms -video none -sound none -nothrottle -skip_gameinfo -autoboot_script run/<script>.lua`
  (scripts use emu.register_frame_done + manager.machine:exit(); add -seconds_to_run N as a safety net). ALSA warnings are harmless.
- ROM zip goes in roms/ssriders.zip (gitignored); check with `mame -verifyroms ssriders -rompath roms`.

## ROM + attract reference shots
- roms/ssriders.zip (parent EAC) uploaded by Saulo, verifyroms OK. gitignored, never shipped.
- run/shots.lua: frame-counted snapshots (default 60..3600; override with SSR_FRAMES="3700 3800 ..."):
  `SSR_FRAMES="3800" mame ssriders -rompath roms -video none -sound none -nothrottle -skip_gameinfo -snapshot_directory /tmp/snap -snapname '%g/%i' -autoboot_script run/shots.lua`
  then rename %i to frame numbers (ref/shots/fNNNN.png, gitignored). Runs ~10x realtime.
- Attract timeline (MAME 0.276 = 60 Hz frames from power-on): 60 ROM RAM CHECK; ~300 desert intro; 600/1500 Cormano close-ups;
  900 showdown; 1800-2400 character intros (Steve/Billy/Bob/Cormano); 3000 sunset riders; 3600 logo zoom-in; 3700-3800 title
  (logo + KONAMI + (c)KONAMI 1991) -> ref/shots/title.png = frame 3800; 3900-4100 REWARD poster Simon Greedwell; 4200+ stage 1 demo play.

## MAME master build (use this for frame-exact work)
- /opt/mame-master/src/ssr (symlink /usr/local/bin/mame-ssr), MAME 0.289 from git 5c60f61d (2026-11-01), driver-only build:
  `make SUBTARGET=ssr SOURCES=src/mame/konami/tmnt2.cpp USE_QTDEBUG=0 NO_USE_PORTAUDIO=1 NO_USE_PIPEWIRE=1 TOOLS=0 REGENIE=1 -j7` (~13 min, log /opt/mame-master/build.log).
- -listxml ssriders: 288x224, refresh 59.185606, pixclock 6 MHz, htotal 384, vtotal 264. Boots ssriders headless with Lua (same run/shots.lua);
  frame 3800 is the same title screen as 0.276 (ref/shots/master_f3800.png). Use `mame-ssr` instead of `mame` for all traces.
- apt: debian.sources now uses mirrors.edge.kernel.org (main contrib) + security.debian.org for trixie-security.

## Graphics extraction + verification (gfx pipeline)
All outputs are gitignored (`web/assets/`, `ref/`). Only the scripts are committed.

- `python3 tools/extract_gfx.py`: reads `roms/ssriders.zip` and decodes the GFX ROMs the same way MAME does.
  - K052109 tiles: 064e12.16k + 064e11.12k, ROM_LOAD32_WORD (e12 = bytes 0-1, e11 = bytes 2-3). 8x8 4bpp, planes {24,16,8,0}. 32768 tiles.
  - K053245 sprites: 064e09.7l + 064e07.3l, same interleave. 16x16 4bpp: +32 bytes = right half, +64 = bottom half. 16384 sprites.
  - Writes to `web/assets/gfx/`: `tiles.png` / `sprites.png` (indexed atlases), `tiles.bin` / `sprites.bin` (1 byte per pixel), `gfx.json`.
- `mame-ssr ssriders -rompath roms -video none -sound none -nothrottle -skip_gameinfo -snapshot_directory /tmp/sd -snapname '%g/%i' -autoboot_script run/dump_vram.lua`
  - Set the frames with `SSR_FRAMES="3800 4300"` and the output folder with `SSR_OUT` (default ref/dump).
  - Writes per frame: palette, K052109 RAM and regs, K053251, K053244 regs, the K053245 buffer (latched at the reg 6 write) and a MAME snapshot. Copy the snapshot to `ref/dump/fNNNN_mame.png`.
  - Gotcha: the palette file holds **little-endian** 16-bit xBGR555 words (because of the `^1` in the dump).
  - Gotcha: the `:spriteram` share is stale, because the ssriders protection writes K053245 RAM directly. Read the chip RAM through `prog:read_u16(0x180000+...)` instead.
- `python3 tools/render_frame.py ref/dump/fNNNN`: rebuilds the frame using our decoded gfx.
  - Covers K052109 scroll (plain, rowscroll, colscroll), K053251 colorbases and layer sort, and K053245 sprites (zoom, mirror, pmask).
  - Compares against the MAME snapshot and writes `ref/preview/fNNNN_recon.png` and `_sbs.png` (MAME | ours | diff).
- **Result: f3800 (title), f4300, f4600 and f5000 (stage 1 demo) all match MAME 100% pixel for pixel.**
  - Key details: the sprite pmask always includes bit 31, so the first sprite drawn wins (sprites are drawn from pri_code 127 down to 0).
  - Zoom uses MAME drawgfxzoom stepping: dx = (16<<16)/dstw, src = i*dx with no bias, and flip is applied in source space.
- `python3 tools/preview_atlas.py ref/dump/f4300`: writes palette-coloured atlas previews to `ref/preview/`.
- Open / not yet exercised:
  - Shadow/highlight sprites. ssriders uses highlight (`set_shadow_mode(~dim_c bit4)`) and `DRAWMODE_SHADOW_PRI`; the renderer's factor is a guess.
  - Palette dimming via 0x1c0300 / K053251 pri 5-6 (saloon spotlights).
  - Mixed row+col scroll mode is not implemented.
  - The K053251 pri values seen so far: F=36, A/B=44/52 (they swap between scenes).

## Shadows, highlights, dimming + gameplay driving
- **How gameplay is driven:** `run/dump_vram.lua` now accepts a few options:
  - `SSR_PLAY=<lua>`: a script that returns `function(frame, set, prog)`.
  - `SSR_SCAN=1`: prints a line whenever renderer-relevant features change (k053251 regs 5 and 6, dim_c, dim_v, scrollctrl, shadow sprites).
  - `SSR_LAST=N`: keep running past the last dump frame.
  - It also taps 0x1c0200 and 0x1c0300 and writes `fNNNN_misc.bin` = [dim_c, dim_v].
  - `run/play_stage.lua`: pure input injection. In this 4-player set, Coin 1 gives a credit and P1 Button 1 starts and shoots; Button 2 jumps. Running right on its own gets stuck at the stage 1 crates.
  - `run/play_skip.lua`: coin, start, shoot and run, plus known mamecheat.co.uk pokes. It writes `pb@104315=0` (infinite time) every frame. It also does "Finish this Stage Now": when `pb@104005==4` (in a stage) for 700 frames (`SSR_SKIPEVERY`), it writes 5.
  - The run is deterministic, so the same frame numbers reproduce. Run used:
    `SSR_OUT=ref/play SSR_FRAMES="1700 2300 2800 5233 7090 7300 7600 8000 8176 8600" SSR_PLAY=run/play_skip.lua mame-ssr ... -autoboot_script run/dump_vram.lua`
  - Then copy the snapshots to `ref/play/fNNNN_mame.png`.
- **Scan findings (frames 1-23000):**
  - k053251 reg5 is always 0x26, never 0x3e, so dimming is always armed.
  - Fades step dim_v 1→7 and back.
  - Saloon (around f7084-8176, the stage 2 boss-ish scene): reg6 = 0x20 and dim_c = 0x00. That means highlight mode, factor 8 (the bank darkens to 0.6), and shadow-bit sprites form the spotlights.
  - scrollctrl only takes 0x00, 0x02 (A rowscroll, 32 rows) and 0x10 (B rowscroll, 32 rows). No mixed row+col mode was seen.
- **What render_frame.py implements (MAME-exact):**
  - Pens are kept in 0..6143: base, then the shadow group (+2048), then the highlight group (+4096).
  - `set_shadow_mode(BIT(~dim_c,4))`. The sprite shadow drawmode is SHADOW_PRI when highlighting, otherwise SHADOW.
  - It follows PIXEL_OP_REBASE_TRANSTABLE16_PRIORITY exactly, including the pri bits 0xc0/0x80.
  - Contrast is `clamp(int(float(c8) * group_c * entry_c))`, with group_c = {1, 0.6f, 1/0.6f}.
  - entry_c comes from ssriders screen_update dimpal/brt: brt = 1-(1-0.6f)*factor/8, factor = dim_v | ((~dim_c&0x10)>>1).
- **Regression:** `python3 tools/check_recon.py` re-renders every `ref/dump` and `ref/play` frame and compares it with MAME. It exits 1 if any frame is below 100%.
  - Current result: **14/14 pixel-exact.** That covers title, attract, rowscroll A and B, fades at dim_v 4/5/7, saloon highlights (f7600: 9850 highlight px), and shadow mode (f8176: 5797 px).
- **Still open:**
  - Mixed row+col scroll is not implemented and was never observed.
  - Later stages were not specifically verified (the skip loop may cycle through only some stages).
  - Sprite ROM bankselect (1c0200 bit5, test only) and flipscreen are untested.

## Web renderer (web/render.js)
- `web/render.js` (`SSRV`) is a JS port of `tools/render_frame.py`:
  - K052109 layers with row and column scroll
  - K053245 sprites with zoom, flip, mirror and priority
  - K053251 priority and colorbases
  - shadow/highlight pen groups
  - ssriders palette dimming, using Math.fround to match MAME's float32 contrast
  - Internally it draws a 384x264 pen bitmap (0..6143), then crops it to the 288x224 visible area. That goes through a 6144-entry RGBA LUT into ImageData (Uint32), then putImageData.
- Assets are gitignored:
  - `web/assets/gfx/{tiles,sprites}.bin` come from `tools/extract_gfx.py`.
  - `web/assets/dumps/<dump|play>/fNNNN_*` plus `index.json` come from `tools/copy_dumps.py`.
- `web/game.js` loads gfx and the `dump/f3800` state, then draws a static title screen. This is temporary until attract logic exists.
  - Debug mode: `index.html?dump=f3800` or `?dump=play/f7600`.
  - Test hooks: `SSR.load(name)`, `SSR.info`, `SSR.msPerFrame()`.
- Test: `python3 test/test_recon_web.py` (Playwright headless Chromium; install it once with `python3 -m playwright install chromium`).
  - It renders every dump in the browser and pixel-compares it with the MAME snapshot. It times render() 20 times per frame.
  - It screenshots index.html at 3x into `ref/preview/web_title.png`.
  - Result: **14/14 at 100%**, about 0.7-1.8 ms per render in headless Chromium on the box.

## Online 2P (future phase)
- **Goal:** Saulo sends an invite link (e.g. over WhatsApp) and a friend joins as P2 in online co-op. This comes after local 2P works.
- **Plan:**
  - WebRTC P2P (DataChannel).
  - Input-only rollback netcode (GGPO-style) over the deterministic simulation.
  - Minimal signaling: PeerJS cloud or a tiny PHP/JS script on XAMPP. Room id in the URL hash (`#join=<id>`).
  - STUN, plus a TURN fallback for symmetric NATs.
  - Needs public hosting (itch.io, or a public XAMPP).
- **Architecture rules (from now on):**
  - Game logic is a pure, deterministic fixed-step sim at 59.1856 Hz. No Math.random or Date in logic.
  - RNG is seeded and mirrors the arcade's RNG. State is integer or fixed point only.
  - Inputs are fed per frame through one input struct per player (bitmask).
  - Sim state is serializable (snapshot save/load) for rollback. Keep it in typed arrays or plain objects with no closures.
  - Rendering is separate from the sim. The sim produces VRAM, sprite and palette state; render.js only reads it.

## Attract sim: reverse-engineering log (in progress)
- Recording: `run/record_attract.lua` (SSR_LAST, SSR_SNAP) -> ref/attract/state.bin (30766 B/frame, layout in tools/attract_state.py) + wram.bin (0x104000-0x107fff). Frame n = nth frame_done after power-on.
- Program image: `tools/extract_prog.py` (gitignored output). Correct layout: 8e/8g at 0x00000, 10e/10g at **0x80000** (an earlier prog.bin put them at 0x100000; addresses >= 0x80000 from before are invalid).
- k052109 bus on ssriders is plain `k052109_word_w` (no A12 swizzle): word offset o, UDS byte -> ram[o], LDS byte -> ram[o+0x2000].
- 0x00c506 RLE tilemap blit: stream = dest.l, cols.b, rows.b, ops {0 end, 1 n hi lo run, 2 n lo.. (fixed hi), 3 n (hi lo).., 4 set hi, 5 lo0 n incrementing lo}; row skip 0x80-2*cols bytes. Ported to web/sim/engine.js `rleBlit`, verified exact (test/test_rle.js: REWARD poster streams 0xa465e, 0xa4742, 0xa456a at frame 3890).
- 0x00d04e/0x00d0ac palette loader: mask word selects banks (0x140000/0x800/0xa00: 8 blocks; 0x400/0xc00: 32 blocks), each block = 32 colours copied from a ROM pointer list. Ported as `palBlocks` (not yet verified per frame).
- 0x00c616 object/script engine indexed by $104301 (opcode table 0x00c6c4), slots at 0x1052f0+0x10*i.
- Writers per frame (title/REWARD): palette 0x00d0b0 (block copy every frame), sprite list 0x006354 (clear) + object drawers, tilemap clear 0x008530 (movep), fill 0x05abe8.
- Event frames 3100-4200: 3155 regs, 3157-3398 static title, 3399 title+KONAMI, 3625-3651 palette cycle (every 2nd frame), 3880 text clear, 3887 palette, 3890 REWARD poster (3 RLE blits + regs 1,2,3 + k053251[3..4]=2c,34), 3891 k053244[6]=0x50 + sprites, 4165 tilemap, 4166 k053244[6]=ff, 4171 stage 1 demo.
- Breakpoint logging works headless: `-debug -debugger none`, `cpu.debug:bpset(pc,"","printf ...; g")`, read `manager.machine.debugger.consolelog` at exit. Trace windows are 1 frame earlier than state.bin frame numbers.

## Attract sim (web/sim/attract.js) — checkpoint 2026-11-01
Corrected timeline ($104003 attract state, table 0x2408): 3 = intro film 0x2d3a (until frame 3396; 3157-3396 is the
end-of-film pan over the Cormano/Steve close-ups, steps 108-113 of film table 0x5b48e); 4 = title 0x2dec from 3397
(3399 logo halves slide/zoom, 3625 colour cycle + KONAMI text, 3880 clear); 5 = REWARD 0x30de from 3881.
Hand ports: IRQ 0x1ef2 (sprite DMA via move.b d0,$5a000c — d0 is the main loop's leftover, modelled as mainD0),
scroll latch 0x20b2, film pan 0x5bd42-0x5be90 + streams 0x5c0f4 + block blit 0x5a666 + scroll 0x5c078/0x4e530,
palette cycles 0xcde0/0xce6a/0xcea4, job queue 0x2666 + jobs 0x8476 (clear), 0x863a (text), 0x86a8/0x86b0,
0x62e8/0x630a/0x24ba/0xd04e/0x34a0. Jobs run to completion right after the IRQ (true for every job so far).
Verification: node test/attract_check.js 3156 3881 (video state byte-exact every frame; WRAM also matches except
stacks, IRQ register save 0x104700, sound queue). python3 test/test_attract.py (pixels vs snaps + contact sheet
ref/preview/attract_sheet.png). Frame 3398's MAME snapshot is mid-clear (raster caught job 0x8476 halfway) — not a sim bug.
Seed: (superseded, see "power-on" below) frame 3156 used to be copied from the recording (tools/export_attract_seed.py,
now only a debugging aid).

## Attract sim checkpoint: state 5 REWARD (Nov 1, 2026)
- Ported attract state 5 (0x0030de): init 0x3122, sub 1 0x4ba0, sub 2 0x4bcc (0x4c36/4c52/4c98/4d62/4d94, 0x4df2),
  sub 3 0x4e42 k0-k3 (0x4e7a, 0x4ef0, 0x4f12 + 0x233c, 0x4f26 with 0x4da90 / 0x1277c). Job 0x14 = 0x5a432 (poster:
  protection cmd 0x6003, 0x5abbc, three 0xc506 RLE blits, 0x5aec2). Palette fade 0xcca0/0xcd40, staged palette loads
  0xcfc2/0xd008 (0xd050, 0xd120).
- Bus additions: palette reads, K053251 (0x5c0700, odd bytes, &0x3f), K053244 at 0x5a0000 is wired without A1
  (reg = ((a&0x1c)>>1)|(a&1); 0x5a000c = reg 6), K052109 control registers tracked in k052109_regs, 0x1c0301 dim,
  0x1c0800 protection (only cmd 0x6003).
- mainD0 after job 0x5a432 = d0 left by the last RLE blit = (0x80 - 2*width) & 0xff (0x50 here).
- Result: 3157..4171 byte-exact video state (1015/1015); work RAM exact apart from known noise (add 0x1044f3 to the
  stack-noise list). Pixel-exact 1012/1015: 3398, 3890, 4165 are MAME mid-job snapshot artefacts (tilemap clear/blit
  running while the frame was captured); state is exact on all three.
- Next: frame 4172 is state 5 sub 3 k4 (stage intro). Intro film 14..3156 + seed removal not started.

## Attract sim from power-on: intro film 14..3156, no seed (Nov 1, 2026)
- index.html now runs `Sim.powerOn(eeprom)` and plays frames 1..4171, then reloads the power-on snapshot (loops).
  Nothing recorded is loaded: only prog.bin and eeprom.bin, which tools/extract_prog.py now also writes from
  ssriders_eac.nv in the user's zip (identical to MAME's nvram/ssriders/eeprom used for the recording). Both gitignored.
- Boot (reset 0x1000, service switch off -> 0x1102 -> 0x1941c -> 0x189a). IRQs are masked until 0x1536, so the boot
  code is ported as straight-line work at the frames where the recording shows its effects (`post_frame`):
  1 chip setup 0x1000-0x10ea (+0x113e); 14 palette test 0x1a5c + VRAM tests 0x1b30 (they leave the 00 01 02 03 /
  +04040404 pattern, reset when the low word hits 0x0303) + test screen 0x17ea + text 0x1870(0x1cd4); 25 WRAM/obj RAM
  tests (approximated: real WRAM after the test is address&0xff, not checked); 116 0x17ea again (ROM checksum
  passed); 117 text 0x1870(0x1ce6); 171 0x1156 (K053244 reg 7 = 0xff from the d0 of the 0x1a36 delay loop, VRAM clear
  0x118c, obj RAM clear 0x62f0, palette 0xd04e(0xd1aa), tile fill 0x1346); 254 RAM clear 0x1202, queues, 0xac1c
  (table copied from entry 9 down to 0), EEPROM read 0x19434 into 0x104380; 256 0x1410 init + IRQ enable.
  Frames 1..13 (tests in progress) are not compared. Video between 14 and 256 only changes at 14/116/117/171.
- First IRQs (257+): game mode $104001 = 0 runs 0x2254 (states 0x227a sound 0xfa + flip 0x233c + job 1,
  0x22d2 wait, 0x22f6 one-frame countdown) before attract mode 1 (0x23ba). Attract states 0 (0x296a), 1 (0x2984 sub 0:
  0x29c4 clear + job 7, 0x29f4 regs/0x24ba/0x233c; credits or free play would branch to 0x2a72, not ported) and 2
  (0x2d1e) lead into the intro film (state 3) at 263.
- Input history 0x1ff2 ported (no buttons; 0x1c0103 reads 0xf3 so $104070 = 0x0c) — the seed used to hide it.
- Job 0x8476 leaves d0 = 0xffff for every bit (FIX too), so mainD0 = 0xff after any clear.
- Film/late-job details from the earlier session: scene jobs 0x1500|7 and |0xe run ~275k cycles and straddle the
  next IRQ (`this.late`: the routine runs after that IRQ's attract code, and the DMA sees d0 = 0); text 0x901e/0x934a
  always run with d5 = 0x23; sound queue 0xb18c/0xb1aa/0xb1b2 ported (ring 0x1044c0-0x10453f, write ptr 0x104018).
- Result: `node test/attract_check.js 0 4171 --ram` (0 = power-on): 4156/4158 frames byte-exact video state from 14,
  WRAM exact from 257 apart from the noise list (now built into attract_check: IRQ save 0x104700-73f, 0x104bxx/0x104dxx
  stacks, 0x10401b/1f, 0x1044ec-f3). The two misses, 1099 and 2786, are MAME snapshots taken while a long scene blit
  was half done (the sim finishes it atomically); 1100/2787 match again.
  `python3 test/test_attract.py` (now from power-on, FIRST=14): 4152/4158 pixel-exact, mean 99.97%; misses 14, 116,
  171 (boot writes landing mid-raster) and 3398, 3890, 4165 (mid-job, as before). Sheet regenerated for 14..4171.
- Not done: optional cleanup (job 0x5a432 reusing fixBlank_5aba4). Next: frame 4172 (stage 1 demo intro).

## Attract cycle beyond REWARD (measured, not yet ported)
- 4172-4175: state 5 sub 4e42 k4 (4f88: 4dcdc scroll setup + job 0x13 = 4e8d6 stage tilemap draw, spans ~3 IRQs) and k5 (4f9e: 465c players, 4ff2 jobs [0200,0600]).
- 4176-8674: sub 4 = 50f8, stage 1 demo. 8675 sub 6/8, 8676 state 6, 8677-9326 state 7 (hi-score), 9327 state 8, 9634 state 9, 9637 -> attract state 0 (intro film again, NOT power-on). 2nd cycle: title 12775, REWARD 13259, demo = stage 2 (104300=1).
- Scope (1 frame every 40 across 4172-9640): 8069 distinct PCs, 435 functions; ~9250 distinct PCs for the whole attract so far. The hand-ported attract covers ~1k.
- Multi-frame jobs (e.g. 0x13) are interrupted by IRQs mid-way; exact frame match needs cycle-accurate interruption points.
- run/trace_pcs.lua: SSR_WIN="a-b,..." SSR_TRACE=prefix -> per-window debugger traces.

## Hardware sim (web/sim/ssr.js + web/sim/m68k.js) — MAME lockstep (2026-11-01)
- `node test/machine_check.js 14000 --ram --spr` from power-on: **13999/14000 frames byte-exact** vs ref/attract
  (video state + work RAM + spriteram), 0.45 ms/frame in node (interpreter). Recorded frame f-1 = state after step f.
  The one diff (frame 21, 2 bytes of spriteram) is a recorder artifact: a move.l straddles the frame boundary and MAME
  snapshots between its two word writes.
- `node test/lockstep.js /tmp/regs.log` compares pc/cycles/regs/SR per instruction against run/trace_regs.lua
  (MAME `-debug`, SSR_A..SSR_B frames). Clean through frame 266 (9.38M instructions). MAME's sp column is the SSP.
- Fixes found by lockstep:
  - ER5911 8-bit uses 9 command-address bits (MAME DEFINE ... 8, 128, 9); the cell index is masked to 7 bits.
  - andi.l #,Dn = 16 cycles (cmpi.l Dn stays 14).
  - 0x1c0102 bit 3 is NVBLK (active low): 0 during vblank.
  - Autovector IACK waits for the E clock (MAME vpa_sync): vector read 10 cycles into the exception, wait to the
    next E edge (mod 10 < 7 ? +10-mod : +20-mod) +1. Needs the absolute cycle mod 10 (Machine.ephase()).
  - IRQ sampling: the instruction crossing the vblank boundary gets one more instruction before the IRQ when it ends
    < 3 cycles after the boundary (prefetch-start sampling + IRQ ~1 cycle early; fit to traces). CPU reg R_IDLY.
  - now() is a wrapping int32 (overflows at ~frame 7900): use differences only. EEPROM busy is a flag.

## Web runtime = interpreter Machine from power-on (2026-11-01)
- web/index.html now runs `SSRM.Machine` (sim/ssr.js + sim/m68k.js, the original program on the emulated board) from
  power-on and draws `m.v` with render.js. Assets: web/assets/{prog,eeprom,gfx_tiles,gfx_sprites}.bin + gfx/ (gitignored,
  from tools/extract_prog.py / extract_gfx.py). Browser global of ssr.js renamed G.SSR -> G.SSRM; game API is
  window.SSRG (alias window.SSR). Old hand-port attract still at ?legacy=1. Query flags: ?pause=1, ?turbo=N, ?movie=..., ?dump=...
- Headless Chromium (test/test_web_runtime.py): machine step ~0.3 ms/frame (attract) / ~0.37 ms/frame (gameplay),
  render.js ~1.0-1.6 ms/frame; budget is 16.9 ms. Screenshots: ref/preview/web_demo.png (attract stage-1 demo, frame 9000),
  ref/preview/web_play.png (MAME movie replay, frame 2400). Note: frame numbers in ref/dump differ from ref/attract.
- Static 68000->JS translator: DEFERRED. Optional optimisation only; the interpreter already uses <3% of the frame.
- Preview on the box: `cd web && python3 -m http.server 8765` then http://127.0.0.1:8765/index.html

## Inputs (web/input.js)
- One byte per player per frame (FrameInput = Uint8Array(4)), active high: bit0 left, 1 right, 2 up, 3 down, 4 fire,
  5 jump, 6 coin, 7 service. applyFrame(m, fi, test) maps it onto the ports; game.js keeps inputLog[] (one FrameInput per
  emulated frame) -> together with Machine.save/load this is the netcode/rollback interface.
- MAME set ssriders = 4 Players ver EAC (ports ssridr4p): no start buttons. Coin into a player's slot (COIN1..4 =
  0x1c0100 bits 0..3) then press fire to join. Service1..4 = bits 4..7. 0x1c0102 bit 7 = test switch (F9; settings
  menu). No DIP switches: difficulty/lives/coinage are in the EEPROM.
- Keys: P1 arrows or WASD, Z/J fire, X/K jump, 5 coin, 1/Enter start(=fire). P2 numpad 8/4/5(2)/6, numpad0 or N fire,
  numpad . or M jump, 6 coin, 2 start. P3/P4 coin 7/8, start 3/4. F2 service, F9 test. Gamepad n -> player n
  (d-pad/left stick, A fire, B jump, Select coin, Start fire). Local opposite directions cancel; movie inputs are raw.

## MAME input movie replay (frame-exact)
- tools/make_movie.js writes the scripted movie (coin at 600, then run/shoot/jump/aim/duck through stage 1).
- Record: `SSR_OUT=ref/movie SSR_LAST=3000 SSR_MOVIE=ref/movie/movie.bin SSR_SPR=1 mame-ssr ssriders -rompath roms
  -video none -sound none -nothrottle -skip_gameinfo -autoboot_script run/record_attract.lua` (writes ports.bin = port
  values as MAME reads them, 5 bytes/frame, plus state/wram/spr).
- Check: `node test/movie_check.js ref/movie 3000 --dead [--spr]` -> 3000/3000 byte-exact (video state + work RAM) through
  the FrameInput struct. Timing: ports record k drives our step k+1 (IO=-1).
- --dead ignores 0x104bf0-bff / 0x104df0-dff: freed stack slots below the idle SP where the snapshot moment (MAME frame_done
  vs our step boundary) leaves the idle loop's return address 0x1578 or 0x157e (86 frames, never read back). --spr adds the
  known frame-21 move.l straddle artifact.
- Browser check: test/test_web_runtime.py replays web/assets/movie/ports.bin (copy of ref/movie/ports.bin) and matches MAME work RAM at frame 2400.

## Sound (pt13u) — MAME-exact sound board
- Sim: `sim/z80.js` + `sim/k053260.js` + `sim/sound.js` run the sound board in lockstep with the 68000 (MAME scheduling;
  `samplesAt(T) = floor(T*55930/16e6)+1` = MAME's integer stream grid, rate 3579545/64 = 55930). Board writes to the YM2151
  are logged (`takeLog`, `safeSamples`); the log is part of the snapshot base (`logBase`), so rollback cannot go past the last `takeLog`.
- `sim/ym2151.js`: ymfm OPM port, bit-exact with ymfm (test/ym_check.js vs native harness: 0 mismatches over 4.2M samples).
- `sim/mixer.js`: YM*1.0 + K053260*0.70 (MAME mix), then MAME's default "lofi" resampler (pairs averaged, 4-point tables, exact
  source position per output sample) to 48 kHz.
- `audio_worklet.js` ('ssr-audio'): the mixer runs in an AudioWorklet; game.js starts it on the first key/click (browser policy) and posts
  the log after each tick. Keeps ~2600 chip samples buffered; the smoothed level outside ±400 → skip/repeat 1 sample; >8×target buffered → jumps; starving → silence.
  `?sound=0` disables the board. Needs assets/z80.bin and assets/k053260.bin (ROM-derived, never in git).
- Checks: sound_check (attract 2.1M + movie 14.6M accesses, 0 mismatches), sound_machine_check, test/ym_check.js,
  tools/dump_sndlog.js + tools/render_wav.js + test/wav_compare.py vs MAME -wavwrite: movie 50.7 s max |diff| 9 LSB rms 0.71
  (signal rms 2764), attract max 4. test/test_web_audio.py (headless Chrome): step 0.43 → 0.70 ms/frame with the board,
  worklet render ≈ 4.9% of one core, 20 s real time: 0 starved, 0 skips, 0 nudges.
- Gaps: residual ±9 LSB vs MAME (MAME's per-chunk resampler stepping/rounding); audio only after a gesture; a long stall (tab hidden)
  jumps the audio forward instead of time-stretching.

## Online multiplayer (pt27u) — web/net/
- **Model**: input-only rollback (GGPO style). `snaps[F] = Machine.save()` taken before frame F; prediction repeats the
  last input; input delay 2 (?delay=), rollback up to 8 frames, else stall. The sim must stay deterministic/integer.
  Cost (node): save 36 µs, load 4 µs, hash 65 µs, packed state ≈ 70 KB.
- **Topology: star** (host relays inputs). One WebRTC link per guest (simplest for NAT, 3 links max on the host);
  host owns roster, hash checks and state transfer. Cost: guest↔guest adds one hop.
- **Protocol** (JSON on DataChannels; id 0 unordered maxRetransmits 0 for inputs with redundancy from last ack,
  id 1 reliable for state, chunked 16 KB): 'i' inputs+acks+ping+roster, 'hello', 'state' (snapshot + inputs),
  'h' hash every 60 confirmed frames, 'full'. Desync → host resends state (≤ 1 per 2 s). Late join: host assigns a slot
  with join = frame+30, sends state at confirmed+1. Players join the game as in the arcade: coin (5) then fire.
- **Audio**: only confirmed frames feed the worklet (sound log `takeLogUpTo`), ~100 ms latency in net mode; on state
  load `mixer.resync` rewrites YM regs (shadow `snd.ymRegs`) + K053260 state (approximate: notes restart on next key-on).
- **Guest clock**: chases estimated host frame (0..12 frames per tick).
- **Signaling** (pluggable, `web/net/transport.js`): default PHP `https://games4me.alwaysdata.net/ssr/signal.php`
  (constant DEFAULT_SIGNAL, or ?signal=); fallback PeerJS cloud (?net=peerjs, untested offline). ICE: Google STUN +
  TURN (see "TURN relay fallback"), extra TURN via ?turn=url,user,pass.
- **signal.php deploy**: upload web/net/signal.php to `ssr/` on alwaysdata; it creates `ssr/rooms/` (must be
  writable) with .htaccess deny. Plain files + flock, CORS *, TTL 600 s. Must be **https**: an https page (itch) cannot
  call an http signal URL (mixed content).
- **UI**: F7 / "Multijogador" button: apelido, Criar sala, link ?sala=CODE, Copiar, WhatsApp, slots with nick + ping, spectators (see below).
- **Tests**: `node test/net_check.js 4 120 100,40,10` (in-memory); `python3 test/test_netplay.py --players 4
  --seconds 300 --netsim 60,20,5 --last-join 60` (headless Chrome, real WebRTC, php -S). 4p/5 min: PASS, 739 hash
  checks, 0 desyncs, rollbacks ~6/s per guest, max 7 frames, 1-2 stalls, msSim 1.0-1.2 ms/frame, tick 1.2-1.5 ms.
- Limits: no host migration (host leaves = room ends); stalls when one-way latency > ~170 ms.

## ROM loader for public hosting (web/romload.js)
If `assets/prog.bin` is missing, the page asks for the user's ssriders.zip, finds files by CRC32 (names free),
checks CRCs, builds prog/eeprom/gfx/z80/k053260 + decoded gfx exactly like tools/extract_*.py, caches in IndexedDB
('ssriders'). PC deploys with assets/ are unchanged. Tests: `node test/romload_check.js` (byte-exact vs
assets_extracted) and `python3 test/test_romload_web.py` (serves web/ without assets). Zip → running 0.13 s.

## itch.io build (pt28)
`python3 tools/make_itch.py` → `dist/sunsetriders_itch_<stamp>.zip` (dist/ gitignored): web code only (no assets/,
dumps, movie, signal.php), `?v=<stamp>` on scripts and worklet modules (window.SSR_BUILD). After packing it asserts
the zip is ROM-free (CRCs of chips + extracted files, ROM/extracted sizes, assets/ or non-code paths, 32-byte samples
every 2 KB of every chip/extracted file searched in every file) and deletes the zip on failure.
`python3 test/test_itch_iframe.py` runs it in a cross-origin iframe with itch's sandbox/allow attributes: loader,
zip, keyboard focus, fullscreen refit, cache on reload, F7 + signal URL; screenshots ref/preview/itch_*.png.
Loader text follows navigator.language (pt-BR / EN). Drafts: dist/itch_page.md, dist/devlog_01.md.
itch settings: "HTML", "This file will be played in the browser", viewport 960x600 (or larger), fullscreen button on.

## Chat in online multiplayer (web/net/chat.js)

- TAB opens a text field (max 60 characters), Enter sends, and Esc or TAB cancels. While the field is open, `SSRIN.block` makes the game input neutral.
- Transport: a session message `{t:'c', x:text}` on the reliable data channel.
  - The host takes the sender slot from the link (never from the payload), applies `sanitize` and a rate limit (700 ms between messages, at most 5 per 10 s), and relays `{t:'c', s:slot, x}` to the other guests.
  - Each peer sees the event `{t:'chat', slot, text}`.
  - Chat is outside the sim, rollback and hashes. Offline/local play also works and shows the message as P1.
- Drawing: the canvas overlay `#chatov` over the game, at 288x224 logical size.
  - Duration is 4 s, plus 60 ms per character over 20, with a 600 ms fade-out.
  - Border and P-tag use the player's colour: P1 #ffd23c, P2 #4aa8ff, P3 #5adc6a (Bob, green), P4 #ff6b5a (Cormano, red poncho).
  - Bubbles that overlap are pushed up or down.
- Player anchor RAM is the object RAM inside K053245 sprite RAM, not WRAM. Player p (0..3) uses object 57+6p, with 128 bytes per object, which gives:
  - P1 0x181c80, P2 0x181f80, P3 0x182280, P4 0x182580.
  - Word +0x00: high byte 0x89 (or 0x99, a flag set after respawn) while the player is active. Other values mean dying or inactive, and the bubble then goes to that player's HUD (x = 72p+30, y = 20).
  - Word +0x0c: X. Screen x ≈ X − 106.
  - Word +0x08: Y. Feet y ≈ 266 − Y, which already includes the jump height; the jump height itself is word +0x04.
  - Head ≈ feet − 58.
  - The game state byte $104005 is 4 while in a stage.
- Tests:
  - `node test/net_check.js` checks that all peers see both lines, that HTML and control characters are sanitized, and that 6 spam messages result in exactly 1 delivered.
  - `python3 test/test_netplay.py --preview ref/preview` drives a real TAB/typing/Enter, checks that an Esc-cancelled line is never sent, and saves screenshots to `ref/preview/chat_p{1..4}.png`.

## Spectators and nicknames (pt40u)
- **Spectators**: a guest whose `hello` finds no free slot gets `{t:'full', watch:1}`; the F7 panel shows "Sala cheia" with
  **Assistir** / **Sair**. Assistir sends `hello{watch:1}`; the host (max `MAXSPEC` = 4, beyond that `watch:0` = only Sair)
  marks the link `spec`, slot -1, and sends the confirmed snapshot like a late join.
  - The spectator's Rollback has slot -1 and is driven by `specTick`: it simulates only frames whose inputs are all
    known (never predicts, never rolls back), 1-2 frames per tick, catching up up to 12 when far behind; video + audio
    from confirmed frames. It sends only acks (no inputs). Players never wait on spectators (`knownTo` covers slots only).
  - Host → spectator: the same 'i' messages (all slots' inputs from the spectator's acks) + `v` = free slot flag.
    Upload per spectator ≈ one small unreliable JSON per tick + the 70 KB snapshot on join/resync.
  - Hashes: spectators report 'h' like guests; host counts them apart (`specHashChecks`, `specDesyncs`, per link
    `hc`/`dc`) and resends state on mismatch (≤ 1 per 2 s), never touching players.
  - Promotion: when a slot frees, the spectator sees "Vaga livre!" (screen + panel, panel opens); coin (5) or the
    "Entrar como jogador" button sends `{t:'promote'}`; first come first served; host seats it (`seat`, join = frame+30)
    and sends state with the new slot (no reload). Then coin + fire to play, as usual.
  - Chat: spectators can chat (own rate limit); host relays `{t:'c', s:-1, n:name, x}`; shown as a blue box at the top
    centre tagged with the name (not on a character). Players' lines are relayed to spectators too.
  - `{t:'who', sp:[spectator names], pl:[4 nicks]}` (reliable, host → all, on every change) feeds the F7 lists.
- **Nicknames**: F7 field "Seu apelido" (localStorage `ssr_nick`, `cleanNick`: sanitize + letters/digits/space/_.!?'-,
  max 12). Sent in `hello`, changed live with `{t:'nick'}`; defaults "Jogador N" (players) / "Espectador N".
  Drawn online only by chat.js: 6 px bold text in the player colour with a dark outline, centred over the head
  (same object-RAM anchor as the bubbles), hidden while the player object isn't active; overlapping nicks stack upward;
  while a bubble shows, the nick becomes the bubble's tag ("P2 Ana").
- **Tests**: `node test/net_check.js 4 60 100,40,10 6` (4 players + 6 knocking: 4 watch, 2 refused; last player leaves
  at half time, spectator 1 promoted and plays; spectator chat; nicks equal on all peers; host frames/tick with vs
  without spectators ≥ 0.9 — measured 1.00). `python3 test/test_netplay.py --players 4 --seconds 120 --last-join 30
  --spectators 2 --preview ref/preview` (real Chrome/WebRTC: Assistir click, spectator chat, page close, coin promote).
  Previews: ref/preview/spec_choice.png, spec_panel_host.png, spec_panel_spectator.png, spec_screen.png, spec_vaga.png,
  nicks_p1.png.
- Limits: a spectator lags the players by ~delay + one-way latency (+ a few frames of buffer); no host migration.

## Room list + public/private rooms (pt47u) — signal.php 'list', ui.js
- F7 panel (no session): "Criar sala" + checkbox **Sala pública** (default on, localStorage `ssr_public`), and below the
  code field a live table "Salas abertas agora" (Sala, Anfitrião, Jog. n/4, Esp. n/4, Fase, button Entrar / Assistir
  when 4 players / disabled Cheia when also 4 spectators). Refreshed when the panel opens and every 5 s only while it is
  open and we are not in a room. Empty: "Nenhuma sala aberta agora". Own room filtered. Host panel shows pública/privada.
  "Assistir" joins and auto-accepts the watch offer (st.autoWatch).
- Host of a **public** room piggybacks `&meta={n,p,s,st}` on its poll every ≥5 s (transport.js PhpSignal.meta).
  **Private** rooms never send meta → never listed (joinable by link/code as before).
- signal.php: `?a=list` (no room/id needed) → rooms whose host polled < 30 s and meta < 20 s old, newest first, max 50,
  cached 3 s in rooms/_list.json (flock). Meta accepted only from the host id, nick/stage stripped of control/format
  chars and `<>&"'\`\\`, nick ≤12 chars, stage ≤20, counts clamped 0..4. A new 'host' claim deletes old meta. No
  mbstring needed (alwaysdata/XAMPP plain PHP). Backward compatible: old actions unchanged; old clients (no meta) work
  but are not listed; new clients against an old signal.php get an empty list (error → []).
- Stage from work RAM: 0x104001 = 1 attract / 2 game; in game "Fase " + (0x104300 + 1); attract step 0x104003 == 5 →
  "Demo", else "Tela de título" (measured with node power-on run: 0x104003 0..4 intro/title/poster, 5 demo, 6..9 scores).
- Tests: `test/test_signal_list.sh` (php -l, php -S workers=8, sanitizing, host-only meta, private/stale hidden, 40
  parallel poll+list, cache expiry); `python3 test/test_room_list.py --preview ref/preview` (3 hosts 2 public + 1 private,
  visitor list, Entrar from list → P2, private by code; screenshots room_list.png / room_list_host.png).
- Deploy: upload web/net/signal.php (copy in dist/signal.php) over `ssr/signal.php` on alwaysdata.

## Coin hint (pt63u) — web/net/hint.js
- Bottom-centre overlay (drawn by chat.js on `#chatov`, outside the sim): "Aperte 5 para colocar ficha, depois Z para entrar"
  / "Press 5 to insert a coin, then Z to join" (navigator.language pt* → PT). Gamepad wording (Select / A) when a pad is
  connected and was the last device used (any key press switches back). After a local coin press (Digit5 / pad button 8,
  tracked locally, 60 s timeout) → "Aperte Z para entrar" / "Press Z to join" (A on pad).
- Shown only while the local slot (offline P1, online `session.slot`) is inactive (object RAM +0x00 high byte & 0xef != 0x89);
  hidden while the chat field is open; never during the ROM loader (draw runs only once the machine exists).
  Spectators: replaces the old "Vaga livre! Ficha (5) para entrar" with a bilingual "Vaga livre! Aperte 5 para entrar".
- The arcade's INSERT COIN is in the top HUD, so the bottom band does not cover it. `SSRHINT.off = true` disables it.
- Test: `python3 test/test_coin_hint.py --preview ref/preview` (PT/EN/pad wording, coin → join text, hidden after join and
  with chat open, machine state hash identical over 600 frames with the hint on vs off). Previews coin_hint_{pt,en,pad,joined}.png.

## Display modes: CRT shader + western bezel (pt67u) — web/gfx.js
- Presentation only: gfx.js uploads game.js's finished 288x224 ImageData to a WebGL texture and positions `#screen`
  (kept exactly on the picture, opacity 0 when WebGL draws) — never touches the machine, inputs, rollback or hashes.
- **Always CRT + 16:9 bezel** (pt70u: Saulo removed the F8 toggle, toast and the "F8: trocar visual" bezel text).
  Old localStorage `ssr_gfx` from the F8 build is ignored and removed on load. Hidden debug only (no UI, not persisted):
  `?gfx=crt|orig`, `?webgl=0` (2D fallback). No WebGL / context lost → 2D canvas (bezel still drawn, picture smoothed).
- 4:3 modes have non-square game pixels: chat.js now scales #chatov with separate kx/ky, so bubbles, nicks and the coin
  hint stay on the picture. Mild curvature means anchors drift ≤ ~1% at the extreme edges.
- Shader (one pass, 6 texture taps): sharp-bilinear in x, two-row gaussian scanlines whose beam width grows with
  brightness, 3-px RGB aperture mask, 4-tap glow, curvature (.028/.040), vignette, rounded corners. Scanline/mask
  strength fades out below ~1.6x scale (small iframes) to avoid moiré. ~0.08 ms/frame CPU side.
- Bezel: procedural canvas at 1920x1080 design units (redrawn only on resize, ≤3840 px wide): wood planks with grain,
  knots and nails, rope border, stitched leather frame with brass rivets and lip, sheriff badges on the corners,
  WANTED / BOUNTY HUNTERS posters, brass title plate "SUNSET RIDERS" in system serif (Georgia/Noto/DejaVu). Own art,
  no image files, no Konami artwork. Picture 1266.7x950 at (326.7,70) (pt133u: larger inner frame; was 1146.7x860 at 386.7,112); title plate sits fully above gy so #crt cannot clip it; side posters scaled down and tucked under the leather; 16:9 area letterboxed in other windows.
- Test: `python3 test/test_gfx_modes.py --preview ref/preview` (SwiftShader WebGL, default bezel, F8 inert, stale ssr_gfx ignored+cleaned, ?gfx=crt debug,
  alignment of #screen/#crt/#chatov, 960x600 letterbox, ?webgl=0 fallback, identical state hash in all modes).
  Previews gfx_crt_bezel_title.png, gfx_final.png (stage 1), gfx_crt_zoom.png.

## TURN relay fallback + connection UX (pt77u)
Real bug (room CGWH, itch): friend on another ISP stuck on "Conectando…", host saw nobody, room live with p=1.
Signaling worked; ICE never found a path (only Google STUN, no TURN -> CGNAT/symmetric NAT/blocked UDP fails), and
the UI had no timeout. Also fixed a signaling race: guest ICE candidates sent in separate POSTs could reach the host
before the offer and were dropped (host only created the link on sdp); now buffered per sender (`early`).
- `SSRNET.getTurn(signal)`: only `signal.php?a=ice`. Server-minted Cloudflare Realtime TURN or Metered credentials
  if `ssr/turn_config.php` exists are mapped to `{urls, username, credential}`. The page has no static TURN
  username or password. Missing list, HTTP error, or bad JSON returns [] and is not cached; the peer connection
  then uses Google STUN (`SSRNET.ICE`) plus an optional `?turn=` override. A successful empty list is cached.
  Reliable option: Cloudflare Realtime TURN (free 1 TB/month) needs an account -> TURN key id + API token in
  turn_config.php: `<?php return ['cloudflare_key_id' => '...', 'cloudflare_api_token' => '...'];`
- Guest: attempt 1 policy all (STUN+TURN) for 15 s (?direct=N), then fresh id + relay-only for 20 s (?relayt=N), then
  bilingual failure text (navigator.language pt / en) + "Tentar de novo". Host panel: "Alguém tentando entrar…".
- Console `[ssr-net <peer>]`: ice/connection states, local candidate counts, candidate errors, chosen path (local>remote type).
- Test hooks: ?noturn=1 (no getTurn), ?simnat=1 drop non-relay candidates, ?simnat=2 drop all unless relay policy.
- `python3 test/test_relay.py` (local coturn `turnserver`, --allow-loopback-peers): relay gathering, CGNAT path via
  relay, retry after direct timeout, failure message without TURN.
- Black game area while "Conectando…" (friend's report): not a ROM/WebGL bug. The ROM prompt runs first (`SSRG.ready`
  awaits `SSRROM.ensure()`, and `join()` awaits `SSRG.ready`, so ?sala= links ask for the zip); a guest just has no
  machine state until the host's snapshot arrives. hint.js now paints "Conectando ao anfitrião…" / relay / failure
  text over the game area while a guest has no rollback (`SSRHINT.waiting`).

## Desktop build (Electron, Windows x64)
- `desktop/` = Electron wrapper: `main.js` serves the game via privileged `app://game/` (not file://; blocks net/rooms and *.php, 404 for missing files),
  no menu, fullscreen; F11 / Alt+Enter toggle, Esc only leaves fullscreen; autoplay allowed + background throttling off (online); audio auto-started.
  Signal URL in transport.js is already absolute (alwaysdata), server sends CORS `*`. Icon = generated sheriff star (`icon.png/.ico`).
- `desktop/build.sh semrom` -> `dist/desktop/SunsetRiders-win64-<stamp>.zip`: web = the itch zip (tools/make_itch.py, ROM-free check), player gives
  ssriders.zip on first run (romload UI), cached in IndexedDB under userData (origin app://game) -> not asked again. Shareable.
- `desktop/build.sh pessoal` -> `...-pessoal-<stamp>.zip`: full web/ incl. assets/ROM. PERSONAL ONLY, never git/itch/share.
- Needs npm i (electron, @electron/packager) + wine (rcedit for the icon). Unsigned exe -> SmartScreen "More info / Run anyway".
- Test on Linux: `xvfb-run npx electron --no-sandbox .` in desktop/ (after a build fills desktop/web). CopyFromBox to PCs: split in 20 MB parts.

## Netplay signaling on Cloudflare (2026-11-09, branch cloudflare-netplay)
- `web/net/transport.js` DEFAULT_SIGNAL = `https://games4me-netplay.games4me.workers.dev/sunsetriders_web/signal.php`
  (Worker in /workspace/netplay-cf, same API as signal.php; slug = the `_web` page folder). `?signal=` override still works.
- `web/net/transport-cf.js` (copy of /workspace/netplay-cf/client/transport-cf.js) loaded before transport.js; openPhp uses
  `new (G.NETCF ? G.NETCF.CfSignal : PhpSignal)(...)`: after host/join it opens `wss://.../sunsetriders_web/ws` and gets
  offers/answers/ICE pushed; if the socket fails/drops it polls over HTTP like PhpSignal and retries (1 s -> 30 s). Against an
  alwaysdata URL it only polls. Packaging: make_itch.py and desktop/build.sh copy all net/*.js, so transport-cf.js goes along.
- TURN: only from the Worker's `?a=ice` (Cloudflare Realtime TURN, 24 h credentials minted server-side); no static relay in
  the page (turn-ice patch fbc89687 applied); without TURN the page keeps Google STUN (`SSRNET.ICE`).
- Test: `python3 test/test_netplay_cf.py web 45` (production Worker, nicks teste-bot/teste-bot2, room left at the end).
  2026-11-09: ~3100 frames, 44 hash checks, 0 desyncs, WebSocket push on both peers (no HTTP polling), ?a=ice = turn.cloudflare.com;
  with WebSocket disabled in the page it fell back to HTTP polling, ~1900 frames, 0 desyncs. Room gone from ?a=list after leave.
- Rooms on alwaysdata and on Cloudflare do not see each other. Still on the old alwaysdata signal: itch build, Saulo-PC XAMPP,
  and the desktop builds 0319/0320 (absolute DEFAULT_SIGNAL `https://games4me.alwaysdata.net/ssr/signal.php`). The desktop
  zips must be rebuilt from this branch (desktop/build.sh) so desktop and web players share rooms; check the Electron app://
  page can open the wss:// socket (it falls back to polling if not). Do not redistribute the old desktop zips for online play.

## Project rules from Saulo (2026-11-09)
1. **Desktop/Electron has no online multiplayer anymore.** Every future desktop build must remove or hide the multiplayer
   menu/UI (F7 panel, "Multijogador" button, ?sala= handling) and must never call the Cloudflare Worker. Online play is web only.
   (Not implemented yet: no desktop build was made on 2026-11-09; the current desktop/ wrapper still ships net/*.js.)
2. **Desktop: only the public ROM-free version.** Do not generate the personal (with ROM) desktop variant anymore
   (`desktop/build.sh pessoal` is retired). The personal web copy with ROM assets in the local XAMPP stays as before.
3. **No itch.io and no GitHub for this project** (Saulo deleted the GitHub repo). Do not publish, push, write devlogs,
   or run tools/make_itch.py for upload. Commits stay local.
4. **alwaysdata signal folders were deleted.** Signaling is Cloudflare only (DEFAULT_SIGNAL = the games4me-netplay Worker);
   anything still pointing at games4me.alwaysdata.net/ssr/signal.php (old itch build, old Saulo-PC copy, desktop 0319/0320) has no online play.

## Netplay UI languages (i18next, 2026-11-09)
- `web/lib/i18next.min.js` (i18next 27.0.1, vendored from /workspace/netplay-i18n, no CDN) + `web/i18n/{en,pt,init}.js`,
  loaded in index.html before romload.js. Code calls the global `t('key')`; keys net.* / chat.* / hint.* / rom.* (shared
  with the other remakes). pt.js holds the previous hardcoded pt-BR wording verbatim; en.js is also the fallback.
- Language: `?lang=xx` (pt* -> pt), then `navigator.languages` (first language that has resources), then `en`.
  Adding a language: copy en.js -> xx.js, translate values, add the script tag before init.js (web/i18n/README.md).
- Translated: F7 panel (room list, public/private, spectate, slots, help), connection/error messages, chat placeholder +
  ASSISTINDO tag, coin hint + guest wait screen, ROM loader + its errors. hint.js reads `SSRNETPLAY.state.wait`
  ('connecting'|'relay'|'receiving'|'fail') instead of regex-matching the message.
- Protocol values stay pt-BR (room-list `st` 'Fase N'/'Tela de título'/'Demo', default host name 'Jogador 1') so older
  clients still match; `SSRSESSION.localName` and ui.js `stageLabel` map these defaults (and Player/Spectator N minted by a
  host in another language) to the local language for display. Real nicknames are untouched. Node tests without i18n keep pt fallbacks.
- Test: `python3 test/test_i18n_panel.py --preview ref/preview [--base <pre-i18n web dir>]` (php -S signal, 4 variants:
  ?lang=pt/en and navigator pt-BR/en-US; panel, room list row from an other-language host, guest panel, chat, own room,
  ROM loader + bad zip; scans text/placeholder/title/value/overlay strings for leftover pt in EN; pt panels byte-identical
  to the pre-i18n build). test_netplay.py and test_room_list.py now open pages with ?lang=pt (their checks read pt text).
- test_high_rtt.js / test_invite_url.js / test_stall_budget.js exist only in the 20261108 desktop staging tree; they test
  session.js exports (delayForRtt, inviteUrl, WEB_BASE) that are not in this branch, so they fail on b642bd3 too.

## Typed room names (2026-11-09, Saulo: "o jogador escreva o nome da sala")
- F7 panel: field "Nome da sala" / "Room name" above "Criar sala". `normRoom` (ui.js) normalizes while typing: NFD +
  accents removed, uppercase, whitespace runs -> '-', anything outside A-Z 0-9 '-' dropped, max 16 (caret kept). Valid =
  `ROOM_RE` /^[A-Z0-9-]{3,16}$/, the same rule as the Worker (and web/net/signal.php, kept in sync for local tests).
- **Empty field**: "Criar sala" disabled + hint "Digite um nome para criar a sala." (no random name from the UI: the
  player always chooses). 1-2 chars: "Nome curto demais…". Enter in the field = Criar sala. `SSRNETPLAY.host(pub, name)`;
  host() WITHOUT a name (console/tests only, e.g. test_netplay.py) still picks a random 4-char code.
- Host errors: 409 'room taken' -> "O nome X já está em uso. Escolha outro nome para a sala." (form kept with the name
  selected, no session, UI usable); 400 'bad room' -> "O servidor recusou o nome X"; join 404 'no such room' -> "A sala X
  não existe ou o anfitrião já saiu." (session ended, back to the form). Join field + ?sala= use normRoom (lowercase ok).
- Room-list cells wrap long hyphenated names (300 px panel).
- Worker rule observed 2026-11-09 12:23 BRT: old [A-Z0-9]{4,8} (SAULO-TESTE -> 400 bad room); 12:25: new rule live
  (SAULO-TESTE ok, AB / 17 chars / AB_C -> 400, 409 'room taken' for a 2nd host id).
- Tests: `python3 test/test_room_name.py web --preview ref/preview` (production Worker: empty/short/normalize, typed host,
  409 with two hosts same name, EN without pt, join by field / ?sala= / list, 4 players 0 desyncs, unknown room, ?sala=ab,
  rooms gone). test_netplay_cf.py now types the name (default "Saulo Teste") and the guest uses ?sala=<lowercase>;
  test_room_list.py / test_i18n_panel.py / test_relay.py fill #np-room. test_i18n_panel's byte-identical pre-i18n panel
  compare is now opt-in (--base DIR) since the idle panel changed on purpose.
  Previews: room_name_create_{pt,en}.png, room_name_taken_{pt,en}.png.
- net_check.js needs assets_extracted/ in the repo root (symlink /workspace/sunsetriders/assets_extracted while running).

## Voice chat (2026-11-09, Saulo: "a conversa via voz pelo microfone de cada jogador") - WEB ONLY (no desktop/Electron)
- Code: `web/net/voice.js` (SSRVOICE; loaded before ui.js), hooks in transport.js (`rtcLink`), session.js (`t:'vs'` message, drop),
  game.js (master `duck` GainNode between the audio worklet and the destination), ui.js (panel, HUD, hint), i18n `voice.*`.
  `?voice=0` disables everything. Voice never touches inputs, snapshots, hashes or the rollback.
- **Topology (star, same as netplay)**: each host<->guest RTCPeerConnection carries 4 audio transceivers (sendrecv, created by the guest in
  its offer: no renegotiation ever). Transceiver N = voice of the player in slot N. Host mic -> transceiver 0 of every link; guest in slot S
  -> transceiver S of its link; the host RELAYS a speaking guest by `sender.replaceTrack(remoteTrack)` on transceiver S of every other
  link (mix-minus by construction: nobody gets its own voice; every listener gets one stream per speaker, so per-player mute/icons work).
  Spectators = guests without slot: receive all 4, send nothing, no mic button. Speaking flags `{t:'vs', on}` (guest->host) and
  `{t:'vs', s, on}` (host->others) travel on the reliable DataChannel. Old clients ignore the message and reject the audio m-lines
  (voice unavailable on that link, game unaffected).
- **Bandwidth**: mic starts OFF (button in the F7 panel, getUserMedia once with echoCancellation/noiseSuppression/autoGainControl,
  channelCount 1). VAD = AnalyserNode RMS with adaptive noise floor (thr = max(0.015, 3*floor)) + 300 ms hangover; outside speech
  `replaceTrack(null)` => no RTP at all (measured ~0 kbps). Opus mono, in-band FEC, `maxaveragebitrate=28000` in the SDP + `encodings[0].maxBitrate=28000`.
  ICE = the netplay PeerConnection's (STUN + TURN from `?a=ice`; relay-only retry also carries voice).
- **UI**: speaker icon next to each player in the slot list + HUD (top-left over the game, names of who speaks), mute button per player
  (local, cleared when the slot empties), voice volume slider (`localStorage ssr_voice_vol`, GainNode on the game AudioContext, separate from the game sound),
  error texts (denied / no mic / insecure origin (needs https or localhost) / unavailable).
- **Ducking** (Saulo: "o som do game deve abaixar..."): the received voice of another, un-muted player is measured per slot with an
  AnalyserNode (rms > 0.008); while heard (+300 ms hangover) the game master gain goes to `DUCK_GAIN` (voice.js, **0.65**) with
  `setTargetAtTime` (attack ~80 ms, release ~500 ms); the own voice and muted players never duck. Only the `duck` GainNode moves; the
  emulated audio and the worklet are untouched.
- **Invite hint**: only for who opened `?sala=` (not host, not code field/list). Text `voice.hintBar` ("TAB: chat · F7: painel online e
  microfone"), drawn as DOM text with a black outline on the leather bar of the bezel right below the CRT, between the lower corner stars
  (`SSRGFX.rects()` gives the geometry); fallback = framed banner at the top centre when the bezel is off (?gfx=crt|orig) or the text would
  be < 12 px. Hides after 8 s or on TAB (TAB still opens the chat). pointer-events none.
- `net.help` explains the microphone (starts off, one click, voice only while talking, game sound ducks, mute per player, volume, spectators listen only).
- Test: `python3 test/test_voice.py web --players 4 --spectator 1 [--lang en] --preview ref/preview` (production Worker, fake media devices with
  speech-like WAVs; numbers: received energy per listener, bitrate talking/silent, gain during/after speech, mute, spectator, hint, denial, desyncs).
- **Speaking icon over the nick** (2026-11-12, Saulo: "esse icone piscante em todos os outros jogos de arcade", same as Moo Mesa): `web/net/chat.js`
  `drawNick` draws a small procedural white microphone (`drawMicIcon`, no bitmap, dark outline) right after the nick (`x + w/2 + MIC_GAP`, centred on
  the 6 px text) while `SSRNETPLAY.voice.speaking[p]` is true; blink `MIC_BLINK_MS` = 120 ms on/off (`micBlinkOn`). The flag already existed in voice.js
  (local: `setSelf` when the VAD transmits; remote: `{t:'vs'}` on the reliable DataChannel, host relays it to the other players AND spectators).
  Nothing new on the wire, nothing in rollback inputs/hashes/Worker. The nick text is untouched. The overlay already redraws every frame while a nick
  is on screen (`wantsDraw`), so the blink needs no extra dirty flag or sprite scan. Spectators never transmit but see the icons. Test hook:
  `SSRCHAT.now = ms` freezes the blink clock. Test: `python3 test/test_mic_icon.py web --preview ref/preview` (host + guest + spectator, real Worker, fake mics).

## Game sound while a remote voice is heard, and unlock hint (2026-11-10, Saulo) - WEB ONLY
- **Ducking** (Saulo had no mic; he only *heard* another player, and the music seemed to lose instruments): the duck GainNode still lowers the already-mixed stereo master equally (it cannot mute only some chips). `DUCK_GAIN` was **0.4** (~-8 dB), which made quiet parts of the YM/K053260 mix fall below audibility. It is now **0.65** (~-3.7 dB), same attack/release/hang, restore to 1 after speech. Listener-side recording (game-only, 0.4 build): RMS during remote speech ≈ 0.37× the pre-speech level, L=R, all bands down, then back to ~1 after silence.
- **Remote voice path**: playback is a MediaStreamSource → GainNode (volume/mute) → the *same* 48 kHz game AudioContext destination (plus the analyser). A muted dummy `<audio srcObject>` is kept only to pump the WebRTC track. This avoids a second default-rate AudioContext and audible HTML-media WebRTC output (which some browsers treat as a communications stream). Voice `stop()` never closes the game context.
- **Unlock hint** (spectator "Assistir" with no click, and any load without a gesture): the game AudioContext is created when the machine is ready; if its state is `suspended` or `interrupted`, a centred banner `sound.unlock` is shown ("Clique para ativar o som" / "Click to enable sound"). First click or key calls `resume()`, starts the worklet if needed, and hides the hint. The hint is never shown while the context is running, nor with `?sound=0`. A delayed `netAudioResync` after audio becomes ready covers a spectator/guest who gets the snapshot before the worklet is up.
- Tests: `python3 test/test_voice.py web --players 4 --spectator 1` (DG=0.65); `python3 test/test_sound_unlock.py web [--preview ref/preview]` (hint only while suspended; click and key hide it; hidden when running / `?sound=0`). Analysis videos: `ref/preview/voice_duck_before.mp4`, `ref/preview/voice_duck_after.mp4`.

## Watch-only joining "Assistir" (2026-11-09, Saulo) - WEB ONLY
- **URL format**: `<game page>?sala=NAME&assistir=1` (`NAME` = room name, any case; `assistir` accepts `1|true|sim|yes`). Joins as a spectator even
  when a player slot is free: never takes a slot, no mic button (listens to the voice), no coin-to-join prompt (the panel still offers an
  explicit "Entrar como jogador" button when a slot is free). Without `assistir` the link behaves as before (player slot, spectator only if the room is full).
- Protocol: the guest's `hello` carries `watch:1` from the start (`Session` option `watch` -> `watchOnly`); the host's existing spectator path (MAXSPEC=4)
  handles it, no Worker change. Room full of spectators -> host answers `full` -> ui shows "A sala X já tem o máximo de 4 espectadores." (`net.err.specFull`).
- Hint banner for `?assistir=1` guests: "Assistindo · TAB: chat · F7: painel online" / "Watching · TAB: chat · F7: online panel" (instead of the player hint).
- F7 room list: per row `[Entrar] [eye Assistir]` (full room: only `[eye Assistir]`); at Esp. 4/4 the Assistir button is disabled with the tooltip "Sem vagas para assistir" /
  "No spectator spots left". The list data comes from the Worker's `?a=list` (`s` = spectators, `p` = players, host meta every 5 s) - the portal can use `s >= 4`.
  Join-by-name field has `[Entrar] [eye Assistir]` too.
- Test: `python3 test/test_watch.py web [--lang en] --preview ref/preview` (production Worker).

## Netplay smoothness at high RTT (2026-11-10, Saulo: "melhorias de conexão") - ported from the desktop build, WEB ONLY
- **Ported** (web/net): `Session.followRtt` + `delayForRtt` (input delay follows the measured RTT: floor 2, cap 24, +2 frames of jitter slack, one step down per second,
  host ignores spectator links; `?delay=N` still pins it), `Rollback.setDelay`, `Rollback.addLocal` latch (a short tap sampled while no new frame can be scheduled is
  committed on the next scheduled frame instead of vanishing; survives a state reload), guest stall budget (catch-up limited to what the rollback window accepts, no
  repeated refused advance in one tick). Emulation, frames, rules, snapshots, hashes and the wire protocol are unchanged; peers need not share the delay number.
- **Not ported**: invite-web (web already invites with `location.href`), `input.js` readonly-field fix (desktop only; note: on the web a focused readonly invite link
  still swallows 5/Z until clicking the game - could be a follow-up), turn-ice (already in the web).
- Tests: `node test/test_high_rtt.js`, `node test/test_stall_budget.js`, `node test/test_delay_spec.js` (no ROM, no network).
- **Benchmark** `test/test_netplay_bench.py WEB --players N --rtt MS [--slow MS]`: one headless Chromium per player, real WebRTC on loopback, signalling by the production
  Worker (private `BENCH-*` rooms, removed at the end). Latency = the game's own link simulator (`?netsim=rtt/2,10% jitter,0` on every page; for `--slow` the last guest and
  the host's link to it use the slow RTT). No tc/netem used. Metrics inside a 45 s window after join + warm-up: stall episodes (consecutive ticks with no frame simulated),
  effective FPS, worst 1 s FPS, input delay in frames, desyncs (hash checks) and committed-input mismatch between peers; then 50 ms COIN taps counted on every peer.
- Result (2 rounds, same box, before = cdadc61): no change at RTT <= ~180 with 2 players (delay stays 2); at 500 ms 2p FPS 38 -> 59, 4p/180 ms 41-47 -> 59,
  4p/500 ms 20 -> 59, 1 slow player of 4 (500 ms) 34 -> 59; taps lost 0; desyncs 0. Cost: input delay rises to ~11 frames (~180 ms) at 500 ms RTT; a guest of a 4-player
  room at 500 ms RTT hits the cap of 24 frames (400 ms).

## Netplay overlay / panel performance (2026-11-10, Saulo via HTML5 Helper)
- No visual change (pt/en previews of bubbles, nicknames and the in-room F7 panel are pixel-identical to 0c24bae). Chat, nicks, hint, spectators, F7 and voice stay outside the simulation / inputs / rollback.
- `web/net/chat.js`: wrap+measureText of a bubble (and of a spectator line / the "ASSISTINDO" tag / nickname width) is cached until the text, name or on/off-screen mode changes; the frame only updates positions. `document.getElementById('screen')` and `names().map(localName)` are kept and recomputed only when the roster, nicknames or language change. If there is no bubble, nickname, hint or spectator tag to draw, the overlay returns immediately; when the last piece of content goes away, the canvas is `clearRect`'d once.
- `web/net/ui.js`: while a match is running and the F7 panel is open, the 1 s timer updates only the RTT `<small data-rtt>` values and the speaker icons (no `innerHTML` rebuild). Events (join/leave/who/full/…) still call `render()`. Outside a room the list refresh is unchanged.
- Optional VAD in AudioWorklet (`web/net/voice-vad-worklet.js`): same RMS / adaptive floor / 300 ms hangover as the AnalyserNode path, evaluated every ~1024 samples (~21 ms) so the floor time-constant stays the same. `setSelf` / `replaceTrack` / the DataChannel stay on the main thread. If `AudioWorklet` is missing or `addModule` fails, the previous `setInterval` analyser path is used. Ducking uses `DUCK_GAIN=0.65` (`setTargetAtTime` attack 80 ms / release 500 ms). Remote voice plays through a GainNode on the game AudioContext (a muted `<audio>` element is kept only so Chromium keeps the WebRTC track alive); received-voice RMS for ducking still runs on the 25 ms tick.
- Tests: `test_room_name.py`, `test_netplay_cf.py`, `test_i18n_panel.py`, `test_room_list.py`, `test_voice.py` (4p+1s), `test_watch.py`, `test_netplay.py` (4p+1s), plus the node specs (`test_high_rtt.js`, `test_stall_budget.js`, `test_delay_spec.js`, `test_turn_ice.js`). Previews: `ref/preview/perf_{nicks,bubbles,mix,panel}_{pt,en}.png`.

## Spectator playout (jitter) buffer (2026-11-11, Saulo) - WEB ONLY, SPECTATORS ONLY (ported from the Simpsons, commit 0c274cb)
- **Problem**: a spectator simulates only host-confirmed frames (`Session.specTick`), so every bit of network jitter became a stall (picture and sound).
- **What changed** (spectator path only; host and players: no change to input delay, rollback window 8, adaptive delay, RTT or the hash/desync path):
  - `web/net/session.js`: `PB` constants, `specPlayoutReset` / `specBuf` / new `specTick`, and the `pb` reset in the `state` handler (spectator: rebuffer keeping the learned cushion; promoted spectator: `pb = null`, plays like a player, `tick()` never calls `specTick`).
    Cushion `avail = knownTo - frame + 1`; target `c` frames (start 14, min 9, max 30 = ~150-500 ms). Prebuffer on join / resync / after an underrun, then 1 frame per tick; a smoothed cushion (EMA ~0.5 s) is compared with `c` and the playout runs at most +-2 % faster / slower (accumulator: an extra or a held frame every ~1-2 s). Underrun (avail 0) = the only thing counted in `rb.stats.stalls`: `c += 4` and rebuffer; near miss `c += 1`; a 4 s window whose minimum cushion stayed > 4 frames: `c -= 1`. Surplus > 16 frames is dropped, <= 6 per tick.
    Unlike the Simpsons, `specTick` still calls `sendAll()` on every path (SR has no `flushSend`), also on the underrun / prebuffer ticks, so the spectator's acks keep flowing.
  - Audio (differs from the Simpsons: SR streams the sound board's register log to a SoundMixer in the worklet, no PCM ring buffer): `web/audio_worklet.js` accepts `{cfg:{nudge}}` = max chip samples skipped/repeated per 128-sample block (default 1 = ~0.7 %, unchanged for players). `game.js` `wkSync()` (called in the net tick) posts `SSRSESSION.SPEC_AUDIO = {nudge:3}` (~2 %) while the local session is a spectator and `PLAYER_AUDIO = {nudge:1}` otherwise (promotion goes back to the default; the worklet target stays the net default 6000 chip samples ~107 ms, so no extra A/V offset). `SSRG.specAudio` shows it. Voice / ducking / GainNode path untouched.
  - `session.specBuf()` (`SSRNETPLAY.session.specBuf()`): `{c,cMs,avail,ema,playing,grows,shrinks,underruns,nearMiss,holds,extras,bursts,prebuf}`.
- Tests: `node test/test_spec_jitter.js <webdir> [--assets web/assets] [--secs 60] [--lat 100 --jit 60 --loss 5 --glat 60 --gjit 30 --gloss 2 --spike 600 --tickjit 0.1 --json f --video f.rgba]` (virtual time, deterministic; host + 2 bot players + spectator, netsim on the spectator link, REAL `audio_worklet.js` + SoundMixer at 48 kHz fed like `netAudio` / `netAudioResync`; counts stall ticks, freezes > 50 ms, worklet starved blocks/runs). Old build for A/B: `git archive 5b1644c web | tar -x -C /tmp/old`. `node test/test_spec_promote.js` (promotion: slot 3, `pb` null, 0 desyncs). `test_watch.py` also checks spectators have the playout + `specAudio` and host/players do not.
- Numbers (60 s virtual, host + 2 players + spectator, tickjit 0.1; before 5b1644c -> after): jitter only (RTT 200+-120 ms, 5 % loss): stalls 173 -> 0, freezes > 50 ms 12 -> 1, worklet starved 0 -> 0;
  jitter + five 600 ms spikes: stalls 296 -> 5, freezes 19 -> 6, longest gap 524 -> 439 ms, audio starved runs 7 -> 6 but starved blocks 305 -> 365 (a 500 ms hole is more than the cushion, and the rebuffer after an underrun waits ~0.6 c frames before playing again);
  spectator lag behind the host 7-10 -> 14-42 frames (the price); host fps identical, 0 player / spectator desyncs. Chart / video / raw: ref/preview/spec_playout_{chart.png,before_after.mp4}, specbuf_results.txt, specbuf/*.json (ref/ is gitignored).

## Spectator "Sair da sala" reloads the page (2026-11-11, Saulo) - WEB ONLY
- Problem: a spectator (Assistir) who left the room kept the last snapshot on screen (characters frozen, looked like everyone had left).
- `web/net/ui.js` `leave()`: if the local session is a spectator (`session.spec === true`) it calls `leaveSpectator()`: `endSession()` (voice stop, Worker `leave`,
  links closed so the host sees the spectator go; `endSession` now returns the pending leave request, `transport.js` / `transport-cf.js` `close()` return it), waits for
  that request (max 1.5 s) + 200 ms for the peer connections, then `location.replace(url)` where `url` = current URL without `sala` and `assistir` (lang / voice / mute /
  other params kept; `replace` so Back does not return to the `?sala=` link and rejoin). Nothing joins after the reload, so F7 stays closed, the game boots fresh (ROM check
  / attract, coin hint). A player clicking "Sair da sala" is unchanged (session ends in place, F7 stays open on the list, no reload). Desktop (`app:`) is unchanged
  (no online play). Host, players, input delay, rollback, RTT, the spectator playout buffer and the Worker are untouched.
- Test: `python3 test/test_spec_leave.py web [--lang pt|en] [--preview ref/preview] [--room NAME]` (production Worker, use a fresh room name per run: rooms of killed
  browsers stay listed for a while). Previews: `ref/preview/spec_leave_before_pt.png`, `ref/preview/spec_leave_after_pt.png` (also `_en`). Also rerun `test_watch.py`,
  `test_netplay_cf.py` and `test_sound_unlock.py`.

## Spectator "Aguardando o host…" notice (2026-11-11, Saulo) - WEB ONLY, SPECTATORS ONLY
- **Problem**: when the host's tab goes to the background, `requestAnimationFrame` stops, the host stops sending confirmed frames, and the spectator sits on a silently frozen last frame (`avail=0`, playout prebuffer growing) with no explanation.
- **What changed** (spectator path only; host and player loops untouched — no background timer, no change to input delay, rollback, RTT, hash or playout-buffer constants):
  - `web/net/session.js`: after ~3 s (`WAIT_HOST_MS`, not a `PB` constant) with `avail=0` (view not advancing), `pb.waitHost` becomes true (`specWaitingHost()`, also in `specBuf()`). It clears as soon as a confirmed frame is available again (`avail>0`). Join prebuffer and short jitter underruns stay under 3 s, so the flag stays off.
  - `web/game.js`: a `#hosthint` overlay, same gold style as the sound-unlock `#sndhint` ("Aguardando o host…" / "Waiting for the host…", i18n `spec.waitHost`). Shown only while `specWaitingHost()` is true. When both notices are visible they move to 38% / 62% so they do not overlap; alone, each stays centred.
- Tests: `python3 test/test_spec_wait_host.py web [--preview ref/preview]` (headless Chromium, production Worker; host rAF stopped → notice after ~3 s and hides on resume; hidden during join prebuffer and an ~0.8 s underrun; host and players never see it; both notices visible without overlap, spectator reads use CDP so a `page.evaluate` gesture cannot unlock audio). `node test/test_spec_jitter.js` now fails if the notice appears under jitter-only conditions. Also rerun `test_watch.py`, `test_spec_leave.py`, `test_sound_unlock.py`, `test_netplay_cf.py`. Previews: `ref/preview/spec_wait_host_{pt,en}.png`.

## Host idle auto-close of the online room (2026-11-12, Saulo) - WEB ONLY, HOST ONLY
- **Problem**: a host that forgot the tab open kept the room listed for hours (the Worker keeps a room alive while the host's heartbeat runs).
- **Rule**: only the HOST of a room, only the web build (never `app:` / Electron, never spectators, players or local play). The host leaves through the same path as "Sair da sala" (`SSRNETPLAY.leave()` -> `endSession()` -> transport `close()` = Worker `leave` with `keepalive` + sockets closed), so the room disappears from `?a=list` and the players get the existing "host left" behaviour. Worker unchanged.
- **Triggers** (constants at the top of `web/net/idle.js`): `IDLE_MS` = 10 min with NO local input AND NO remote player input, OR 10 min with the tab hidden (`document.hidden`) without interruption. Warning `WARN_MS` = 60 s before ("Sala será fechada por inatividade em N s — aperte qualquer tecla" / "Room will close due to inactivity in N s — press any key", i18n `idle.warn`), refreshed every second. Afterwards "Sala fechada por inatividade" / "Room closed due to inactivity" (`idle.closed`, `CLOSED_MS` = 12 s, disappears on any input). The overlay `#idlehint` has the same gold style as `#hosthint` / `#sndhint` but sits at 22 % of the height, so it never overlaps the sound hint (50 %, or 62 % when both of those show) nor the wait-host notice.
- **Local input**: `keydown` / `pointerdown` / `mousedown` / `touchstart` / `wheel` (capture, also while typing in chat), the gamepad (polled every 250 ms: any pressed button or axis > 0.5) and `Session.tick(local)` with a non-empty local byte (`session.localAt`). Input during the warning cancels it at once. The tab becoming visible again restarts BOTH timers.
- **Remote input** (`Session.noteRemote`, host only, called from the `i` message handler before `addRemote`): a remote player's input counts only when a byte DIFFERS from the previous frame's byte of that player (a real press / release / direction change), so runs of neutral frames never count. Frames are de-duplicated per link (`L.inHi`; the same range is resent until acked), so a resend never counts twice. Result in `session.remoteAt` (Date.now()). Reset for a promoted spectator in `seat()`.
- **Clock**: `Date.now()` driven by a Web Worker timer (1 s; `setInterval` fallback) - NOT the game loop: `requestAnimationFrame` stops in a hidden tab and page timers can be throttled to once a minute there. Nothing touches the simulation, rollback, inputs, hashes, or the Worker protocol.
- **Debug**: `?idletest=1` -> `IDLE_MS` 20 s, `WARN_MS` 5 s. `window.SSRIDLE` = `{ IDLE_MS, WARN_MS, CLOSED_MS, tick(), state() }` for tests.
- Tests: `python3 test/test_idle_close.py web [--preview ref/preview] [--only a,b,c,d,e,p]` (production Worker, headless Chromium): (a) idle host -> warning (pt/en, countdown) -> closed notice, room gone from `?a=list`, a connected idle player does not keep it alive; (b) key / click during the warning cancels and restarts; (c) an active remote player keeps the room, `remoteAt` stays 0 with neutral frames, host closes after the player goes idle and the player gets host-left; (d) hidden tab (emulated `document.hidden`) closes even with local input, visible again restarts; (e) spectator (idle + hidden), player and local game never fire; (p) production constants with a shifted `Date.now` (warning "em 60 s" at 9:00, closed at 10:00) + previews `ref/preview/idle_close_{warn,closed}_{pt,en}.png`. Regression: `test_netplay_cf.py`, `test_watch.py`, `test_spec_leave.py`, `test_spec_wait_host.py`, `test_sound_unlock.py`, `node test/net_check.js 4 40 100,40,10`, `test_spec_jitter.js`, `test_spec_promote.js`. (`net_check.js ... 6` with spectators FAILS identically before this change - pre-existing.)

## "Sair da sala" reloads the page for PLAYERS and the HOST too (2026-11-12, Saulo) - WEB ONLY
- Before: only a spectator reloaded (c678f92); a player or the host ended the session in place (F7 panel stayed open on the room list).
- `web/net/ui.js`: `leaveReload(grace)` is the old `leaveSpectator` generalised: `endSession()` (voice stop, Worker `leave`, peer links closed, returns the pending leave
  request), waits for that request (max 1.5 s) + `grace` ms (200 spectator / 400 player and host: lets the closed peer connections / DataChannels reach the others), then
  `location.replace(url)` where `url` = current URL without `sala`, `assistir` (and `watch`, never used by this game but removed if present); lang / voice / mute / other
  params kept; `replace` so Back does not rejoin. A re-entrancy guard (`leaving`) ignores double clicks.
- The reload applies to the **button** only (`leaveClick`, bound to `#np-leave`). `SSRNETPLAY.leave()` is unchanged (spectator -> reload, player -> in place) and is what the host
  idle auto-close (`idle.js`) calls, so the idle flow is untouched: room closed, "Sala fechada por inatividade" notice on the same page, no reload. Desktop (`app:`) and clicks
  without a session (full room / no room) keep the old in-place `leave()`.
- Others: a guest leaving is a normal peer drop (host `left` + roster leave frame, other players and spectators continue, Worker count p-1). The HOST leaving behaves as before
  (links closed -> guests/spectators get `hostgone`: session ended in place, `state.msg` = "O anfitrião saiu da sala.", room removed from `?a=list`); there is no host migration in this game.
  Note (pre-existing, unchanged): the host-left text is stored in `state.msg` and only painted at the next panel render.
- Test: `python3 test/test_player_leave_reload.py web [--lang pt|en] [--preview DIR]` (production Worker). `test_spec_leave.py` now checks that the `leave()` API for a player stays in place.
  Previews: `ref/preview/player_leave_*`.

## Online highscore report to the bar board (2026-11-16, via HTML5 Helper) - WEB ONLY, players of a Cloudflare Worker match only
- Contract: `/workspace/highscores/DESIGN.md` section 7 (Worker `games4me-netplay` v19: `match_id` on host / join / poll / WS hello, `POST /scores/report`, `GET /scores/top`). Offline play, PeerJS, plain `signal.php`
  (no `match_id`), spectators (also a promoted one: `Session.wasSpec`) and the desktop app (`app:`) never report. Nothing is sent to the Worker's score endpoint except the single real report below.
- **Transport**: `PhpSignal.req` / `CfSignal.req` copy `match_id` (32 hex) from any host / join / poll answer, `CfSignal.openWs` from the `hello` message (first one wins); `openPhp()` exposes it as `t.match_id` (getter),
  plus `t.room` / `t.role` (`t.id` = signaling peer id already existed). `SSRNETPLAY.state.t.match_id` in the console.
- **RAM (work RAM 0x104000..0x107fff, `machine.wram[a - 0x104000]`)**, found with the real 68000 run of `web/sim/ssr.js` and checked against the HUD:
  | address | meaning |
  |---|---|
  | `0x104001` byte | game mode: 0 boot, 1 attract / title / hi-score screens, 2 game running (the only code that goes 2 -> 1 is the end-of-game routine `0x604e`, reached via phase table `0x25f4` phase 7 = `0x5cae`, step 9) |
  | `0x104200 + 0x40*s` byte | player slot s (P1..P4) energy, 0 = dead or empty |
  | `0x104210 + 0x40*s` byte | slot s active flag: 0x81 playing, 0x01 hit / dead, 0 never used since the game began |
  | `0x104206 + 0x40*s` long | slot s score, packed BCD (`00 00 20 00` = $2000, exactly the HUD "$2000"; max 8 digits = 99,999,999 = the Worker cap) |
  Verified: scripted 2-player runs where the HUD showed P1 $2000 / P2 $2200 (screenshot) held 0x00002000 at 0x104206 and 0x00002200 at 0x104246; every kill adds $100 / $10 steps on the same long; a P3/P4 that never coined stays all zero.
  `test/highscore_check.js` replays a power-on game on the real machine and checks all of it (see below).
- **Game-ended event** = work-RAM mode byte `0x104001` leaving 2 (game running) on a CONFIRMED frame (`Rollback.onConfirm(f, snapshot)`, a new read-only observer next to `onHash` / `onAudio`; the snapshot's `wram` is the state after frame f, so
  both peers see the same frames). It covers "everybody's continues ran out" (real run: last death + ~800 frames) and the ending sequence (same routine). An individual player's game over while others still play does NOT end it
  (mode stays 2). The game clears all four scores one frame BEFORE the mode flips (real run: frame 11974 / 11975), so `web/net/highscore.js` keeps, per slot, the HIGHEST score seen in mode 2 and whether the slot was ever occupied
  (energy or active flag non-zero) - that, not the zeroed RAM at the flip, is what is reported. A continue does not lower it.
- **Armed only after a non-game frame** (mode != 2) was seen by this page: a guest that joins in the middle of a running game never saw the beginning (an earlier player's score may already be gone) and does not report;
  the host and guests that were in the room before the game started do. A host that opens a room in the middle of an offline game does not report that game either.
- **One report per match_id**: a different body from the same peer is `409 already reported`, so after the first reportable game of a match the later games of the same room are skipped (`SSRHS.events`: `skip: already reported`).
- **Who reports / what**: host (`role:'host'`, `my_slot` 0) and each guest player (`role:'guest'`, `my_slot` = `session.slot`), if the game had >= 2 occupied slots, my slot is one of them and a match_id was
  received. Body = `{game:'sunsetriders_web', match_id, room, peer_id: t.id, role, nick, my_slot, scores:[{slot, score, nick}, ...]}` with every occupied slot that is still connected (opponents included; a peer that already left is omitted, see below); `nick` is filled for every such slot (see "Board nick"; the Worker v19 accepts the match on the first 2 equal slot:score fingerprints and later reports have no merged nicks, so every peer sends all of them). The report is never blocked for lack of a nick: the board nick is always derived from the player's normal nick.
  URL = origin of the signaling URL in use + `/scores/report` (= production Worker by default).
  `fetch` POST, `Content-Type: application/json`, `keepalive`; the IDENTICAL body is retried (0 / 1.5 s / 5 s) on network error, 429 and 5xx; any other 4xx (bad nick, mismatch, expired, 403...) is final; `pending` / `accepted` are done.
  Never blocks the game or the end screen (fire-and-forget Promise, errors only logged). `SSRHS.events` / `console.log('[ssr-score] ...')` show gameover / skip / report / result.
- **Board nick**: there is no separate field and no `ssr_board_nick`. The name on the online board is always derived from the player's normal nick (F7 "Seu apelido", localStorage `ssr_nick`, the same name shown in the room): uppercase, accents stripped (NFD), anything outside A-Z0-9 dropped, cut to 8 characters. If the result has fewer than 3 characters it is padded by appending `P` + the 1-based slot (P1..P4) and then `X` until it is 3 characters long (empty nick in slot 0 -> `P1X`; "Zé" in slot 1 -> `ZEP2`; "AB" in slot 0 -> `ABP1`; "João Silva" -> `JOAOSILV`; "Anfitrião" -> `ANFITRIA`). The player never has to do anything for the score to be sent; a report is never skipped for lack of a nick. The Worker's profanity filter can still answer `400 bad nick` (logged, final).
- **Board nick sharing**: the normal nicks already travel through the session (`hello.name`, `{t:'nick'}` on change, `pl` inside `{t:'who'}` on every join / promote / leave / nick change, late joiners included). The redundant `hello.bn` / `{t:'bn'}` / `who.bn` messages and `Session.boardNicks()` / `setBoardNick()` were removed. `highscore.js` `finish()` derives each slot's board nick from `Session.names()` (raw roster names, not `localName()`, so every peer reports the same string); top-level `nick` / `my_slot` stay the reporter's own. Spectators never occupy a slot and never report.
- **Players who leave mid-match**: only slots still connected when the game ends are reported (rollback roster: `join[s] !== INF` and `leave[s] === INF`). A guest that already left is omitted from every remaining report (no score, no nick), so the slot:score fingerprints of the players who stayed still agree. If fewer than 2 connected players remain, nobody reports. The leaver itself has no session left and does not send a report.
- **Host leaves mid-match**: this is treated as the end of the match (there is no host migration; guests get `hostgone` and the session ends in place). (a) If the game had already ended normally (mode 2 -> 1), the reports were already sent and nothing extra happens (`flushOnHostLeft` no-ops when the tracker is not in a game, or `already reported`). (b) If the host leaves during the game, the remaining guests report right away from the last *confirmed* max scores (`Tracker.current()`, the same confirmed frames every guest observed from the host) and INCLUDE the host's slot (score and nick): the host never gets a `leave` frame, the session just ends, so the roster still lists slot 0. The host, on "Sair da sala" (and on `SSRNETPLAY.leave()`), also sends that same report *before* `endSession` / the existing leave wait (`s.flushScore()`, keepalive POST). Guests hook `hostgone` in `attach()` before `ui.js` tears the session down. Still one POST per `match_id`.
- Files: `web/net/highscore.js` (`window.SSRHS`; node-loadable), `rollback.js` (`onConfirm`), `session.js` (`onConfirmed`, `wasSpec`; nicks via `names()`), `transport.js` / `transport-cf.js` (match_id), `ui.js` (attach, no board-nick field), `index.html` (script tag).
- Tests: `node test/highscore_check.js` (tracker rules, real-machine RAM / end event, finish / retry / skip stubs; needs web/assets for the real-machine part) and `python3 test/test_highscore_report.py web [--lang pt|en] [--preview DIR]` (headless Chromium,
  production Worker for SIGNALING only, `/scores/report` intercepted by Playwright - nothing real is posted): host + guest (+ spectator) one body each with equal match_id / room / slot:score set, spectator and offline silent, one report per match,
  failed POST retried with the same body without blocking the ending, accented / short nicks still report (derived / padded), a mid-match guest leaver is omitted from the remaining reports (same 2-slot fingerprint), a mid-match host leave makes the guests (and the host) report immediately including the host's slot. The in-page end of the game is a test hook (a pure function of the machine state in `Machine.step`) that jumps the game's own state machine to `0x604e`;
  the natural end is covered by the node check.
- Previews: `ref/preview/highscore_panel_no_bnick_pt.png` (F7 panel without the extra field), `ref/preview/highscore_report_bodies.json` (example report bodies, including a 3-player match with an accented nick and a short one).
