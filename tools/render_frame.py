#!/usr/bin/env python3
"""Reconstruct a frame from a run/dump_vram.lua dump using our decoded gfx, mirroring MAME's
lgtnfght/ssriders screen_update (K052109 tilemaps + K053245 sprites + K053251 priorities/colorbases).
Usage: tools/render_frame.py ref/dump/f3800 [--zip roms/ssriders.zip] [--out ref/preview/f3800_recon.png]
Compares against <dump>_mame.png when present and writes a side-by-side <out>_sbs.png."""
import sys, os, argparse
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import extract_gfx

NOPRI = os.environ.get("NOPRI") == "1"
def palette_rgb(pal):
    w = np.frombuffer(pal, '<u2').astype(np.int32)
    c5 = lambda v: (v << 3) | (v >> 2)
    return np.stack([c5(w & 31), c5((w >> 5) & 31), c5((w >> 10) & 31)], 1).astype(np.uint8)

def render(prefix, tiles, sprites, debug=None):
    rd = lambda s: open(f'{prefix}_{s}.bin', 'rb').read()
    ram = np.frombuffer(rd('k052109'), np.uint8)
    regs = rd('k052109_regs'); charrombank = regs[0:4]; addrmap = regs[8]; tileflip = regs[9]; scrollctrl = regs[10]
    k51 = rd('k053251'); k44 = rd('k053244'); buf = np.frombuffer(rd(os.environ.get('SSR_BUF','k053245_buf')), '>u2').astype(np.int64)
    rgb = palette_rgb(rd('pal'))
    misc = rd('misc') if os.path.exists(f'{prefix}_misc.bin') else bytes([0x10, 0])
    dim_c, dim_v = misc[0], misc[1]
    shadow_mode = (~dim_c >> 4) & 1          # palette set_shadow_mode(BIT(~dim_c, 4)): 0 = shadow, 1 = highlight
    sprite_shadow_drawmode = 3 if shadow_mode else 2   # DRAWMODE_SHADOW_PRI if palette shadow_mode != 0 else DRAWMODE_SHADOW
    NPEN = 2048
    def shadowtable(pen):                     # IND16 tables: shadow -> +2048, highlight -> +4096, only for base pens
        return pen + (NPEN << shadow_mode) if pen < NPEN else pen
    pidx = [32*(k51[9] & 3), 32*((k51[9] >> 2) & 3), 32*((k51[9] >> 4) & 3), 16*(k51[10] & 7), 16*((k51[10] >> 3) & 7)]
    CI = [2, 4, 3]  # layer F,A,B -> CI2, CI4, CI3
    colorbase = [pidx[c] for c in CI]; layerpri = [k51[c] for c in CI]
    bg_colorbase = pidx[0]; sprite_colorbase = pidx[1]
    W, H = 384, 264
    bmp = np.full((H, W), 16*bg_colorbase, np.int32)
    pri = np.zeros((H, W), np.uint8)
    # tilemaps (64x32 tiles = 512x256)
    def layer_pixels(l):
        cram = ram[0x800*l:0x800*l+0x800]; v1 = ram[0x2000+0x800*l:][:0x800]; v2 = ram[0x4000+0x800*l:][:0x800]
        pix = np.zeros((256, 512), np.int32); opaque = np.zeros((256, 512), bool)
        for i in range(2048):
            color = int(cram[i]); code = int(v1[i]) + 256*int(v2[i])
            bank = charrombank[(color & 0x0c) >> 2]
            if not (addrmap & 0x40): color = (color & 0xf3) | ((bank & 3) << 2)
            bank >>= 2
            flipy = (color & 2) and (tileflip & 4)
            code |= ((color & 3) << 8) | ((color & 0x10) << 6) | ((color & 0x0c) << 9) | (bank << 13)
            col = colorbase[l] + ((color & 0xe0) >> 5)
            t = tiles[code & 0x7fff]
            if flipy: t = t[::-1]
            y, x = divmod(i, 64)
            pix[y*8:y*8+8, x*8:x*8+8] = col*16 + t.astype(np.int32); opaque[y*8:y*8+8, x*8:x*8+8] = t != 0
        return pix, opaque
    ys = np.arange(H)[:, None]; xs = np.arange(W)[None, :]
    def layer_screen(l):
        pix, op = layer_pixels(l)
        if l == 0:
            tx = (xs + 96 + 0*ys) % 512; ty = (ys + 0*xs) % 256
        else:
            sc = (scrollctrl >> ((l-1)*3)) & 7; m = 0x2000 if l == 2 else 0
            sy = ram[0x1800 | m:][:0x40]; sx = ram[0x1a00 | m:][:0x200]
            rows = [1, 1, 32, 256][sc & 3]; cols = 64 if sc & 4 else 1
            yscroll = int(sy[12]); xscroll0 = int(sx[0]) + 256*int(sx[1])
            if rows == 1 and cols == 1:
                tx = (xs + 90 + xscroll0 + 0*ys) % 512; ty = (ys + yscroll + 0*xs) % 256
            elif cols == 1:
                mask = 0xff if rows == 256 else 0xf8
                rs = np.zeros(256, np.int64)
                for offs in range(256):
                    o = offs & mask; rs[(offs + yscroll) & 0xff] = int(sx[2*o]) + 256*int(sx[2*o+1])
                ty = (ys + yscroll + 0*xs) % 256; tx = (xs + 90 + rs[ty]) % 512
            elif rows == 1:
                cs = np.zeros(64, np.int64)
                for offs in range(64): cs[(offs + xscroll0 // 8) & 0x3f] = int(sy[offs])
                tx = (xs + 90 + xscroll0 + 0*ys) % 512; ty = (ys + cs[tx // 8]) % 256
            else:
                raise NotImplementedError('mixed row+col scroll')
        return pix[ty, tx], op[ty, tx]
    order = sorted(range(3), key=lambda i: -layerpri[i])  # konami_sortlayers3: descending, drawn first = back
    spri = sorted(layerpri, reverse=True)
    for n, l in enumerate(order):
        p, o = layer_screen(l)
        bmp[o] = p[o]; pri[o] |= (1 << n)
    # sprites
    flipX = k44[5] & 1; flipY = k44[5] & 2
    offX = (k44[0] << 8) | k44[1]; offY = (k44[2] << 8) | k44[3]
    sorted_l = [-1]*128
    for offs in range(0, 0x400, 8):
        pc = int(buf[offs])
        if pc & 0x8000:
            pc &= 0x7f
            if offs and pc == 0: continue  # z_rejection = 0
            if sorted_l[pc] == -1: sorted_l[pc] = offs
    nspr = 0
    for pc in range(127, -1, -1):
        offs = sorted_l[pc]
        if offs < 0: continue
        b = buf[offs:offs+8]
        code = int(b[1]); code = (code & 0xffe1) + ((code & 0x10) >> 2) + ((code & 8) << 1) + ((code & 4) >> 1) + ((code & 2) << 2)
        color = int(b[6]) & 0xff
        p = 0x20 | ((color & 0x60) >> 2)
        if p <= spri[2]: pmask = 0
        elif p <= spri[1]: pmask = 0xf0
        elif p <= spri[0]: pmask = 0xf0 | 0xcc
        else: pmask = 0xf0 | 0xcc | 0xaa
        pmask |= 1 << 31  # MAME pdrawgfx: pixels already covered by a sprite (pri 31) are masked -> first drawn wins
        color = sprite_colorbase + (color & 0x1f)
        size = (int(b[0]) & 0x0f00) >> 8; w = 1 << (size & 3); h = 1 << ((size >> 2) & 3)
        zy = int(b[4])
        if zy > 0x2000: continue
        zy = (0x400000 + zy // 2) // zy if zy else 0x800000
        if not (int(b[0]) & 0x4000):
            zx = int(b[5])
            if zx > 0x2000: continue
            zx = (0x400000 + zx // 2) // zx if zx else 0x800000
        else: zx = zy
        ox = int(b[3]) + offX - 96; oy = int(b[2])
        flipx = int(b[0]) & 0x1000; flipy = int(b[0]) & 0x2000
        mirrorx = int(b[6]) & 0x100; mirrory = int(b[6]) & 0x200; shadow = int(b[6]) & 0x80
        if mirrorx: flipx = 0
        if flipX:
            ox = 320 - ox
            if not mirrorx: flipx = not flipx
        if flipY:
            oy = -oy
            if not mirrory: flipy = not flipy
        ox = (ox + 0x5d) & 0x3ff
        if ox >= 768: ox -= 1024
        oy = (-(oy + offY + 7)) & 0x3ff
        if oy >= 640: oy -= 1024
        ox -= (zx * w) >> 13; oy -= (zy * h) >> 13
        nspr += 1
        if os.environ.get('SDBG'): print('spr', offs//8, 'pc', pc, 'code', hex(code), 'col', hex(int(b[6])&0xff), 'pmask', hex(pmask), 'pos', ox, oy, w, h, hex(zx), hex(zy))
        for y in range(h):
            sy0 = oy + ((zy*y + 2048) >> 12); zh = oy + ((zy*(y+1) + 2048) >> 12) - sy0
            for x in range(w):
                sx0 = ox + ((zx*x + 2048) >> 12); zw = ox + ((zx*(x+1) + 2048) >> 12) - sx0
                if mirrorx:
                    if (flipx == 0) ^ (2*x < w): c = code + (w-x-1); fx = 1
                    else: c = code + x; fx = 0
                else:
                    c = code + (w-1-x if flipx else x); fx = flipx
                if mirrory:
                    if (flipy == 0) ^ (2*y >= h): c += 8*(h-y-1); fy = 1
                    else: c += 8*y; fy = 0
                else:
                    c += 8*(h-1-y if flipy else y); fy = flipy
                c = (c & 0x3f) | (code & ~0x3f)
                if zw <= 0 or zh <= 0: continue
                t = sprites[c & 0x3fff]
                # MAME drawgfxzoom_core: dx = (16<<16)/dstw, src = i*dx (no half-pixel bias); flip reverses in source space
                dxs = (16 << 16) // zw; dys = (16 << 16) // zh
                xi = np.arange(zw) * dxs; yi = np.arange(zh) * dys
                if fx: xi = (zw - 1) * dxs - xi
                if fy: yi = (zh - 1) * dys - yi
                t = t[(yi >> 16)][:, (xi >> 16)]
                for yy in range(t.shape[0]):
                    Y = sy0 + yy
                    if Y < 0 or Y >= H: continue
                    for xx in range(t.shape[1]):
                        X = sx0 + xx; v = t[yy, xx]
                        if X < 0 or X >= W or v == 0: continue
                        pd = int(pri[Y, X])
                        if shadow and v == 15:   # pen 15 of a shadow sprite -> shadow drawmode (PIXEL_OP_REBASE_TRANSTABLE16_PRIORITY)
                            if (pd & 0x80) == 0 and (NOPRI or ((pmask >> (pd & 0x1f)) & 1) == 0):
                                bmp[Y, X] = shadowtable(int(bmp[Y, X])); pri[Y, X] = pd | (sprite_shadow_drawmode << 6)
                        else:
                            if NOPRI or ((pmask >> (pd & 0x1f)) & 1) == 0:
                                pen = color*16 + int(v)
                                bmp[Y, X] = shadowtable(pen) if (pd & 0xc0) == 0xc0 else pen
                            pri[Y, X] = 31
    # ssriders_state::screen_update palette dimming (applied after drawing, used by the snapshot)
    enable = k51[5]; dimpal = 0
    if enable != 0x3e:
        dimpal |= 1 << ((colorbase[1] >> 4) & 7)
        if not (enable & 0x10):
            for i in range(2): dimpal |= 1 << (((sprite_colorbase >> 4) | i) & 7)
            dimpal |= 1 << ((colorbase[2] >> 4) & 7)
    factor = dim_v | ((~dim_c & 0x10) >> 1)
    brt = 1.0 - (1.0 - float(np.float32(0.6))) * factor / 8
    entry_c = np.ones(NPEN, np.float32)
    for i in range(8):
        if dimpal >> i & 1: entry_c[i*256:(i+1)*256] = np.float32(brt)
    group_c = np.array([1.0, 0.6, 1.0/0.6], np.float32); group_c[2] = np.float32(1.0) / np.float32(0.6)
    lut = np.zeros((3*NPEN, 3), np.uint8)
    for g in range(3):
        c = (group_c[g] * entry_c).astype(np.float32)          # group_contrast * entry_contrast * contrast(1)
        v = rgb.astype(np.float32) * c[:, None] + np.float32(0)
        lut[g*NPEN:(g+1)*NPEN] = np.clip(v.astype(np.int32), 0, 255)   # rgb_t::clamp(s32) after float->int truncation
    out = lut[bmp]
    img = out[16:240, 16:304].astype(np.uint8)
    return img, dict(sprites=nspr, layerpri=list(layerpri), colorbase=colorbase, sprite_colorbase=sprite_colorbase, bg=bg_colorbase, scrollctrl=scrollctrl, dim_c=dim_c, dim_v=dim_v, r5=k51[5], dimpal=dimpal, factor=factor, shadow_px=int((bmp[16:240,16:304] >= NPEN).sum()))

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('prefix'); ap.add_argument('--zip', default='roms/ssriders.zip'); ap.add_argument('--out')
    a = ap.parse_args()
    tiles, sprites = extract_gfx.load(a.zip)
    img, info = render(a.prefix, tiles, sprites)
    out = a.out or f'ref/preview/{os.path.basename(a.prefix)}_recon.png'
    os.makedirs(os.path.dirname(out), exist_ok=True)
    Image.fromarray(img).save(out); print(info)
    mp = f'{a.prefix}_mame.png'
    if os.path.exists(mp):
        m = np.array(Image.open(mp).convert('RGB'))
        diff = np.any(m != img, axis=2)
        print(f'match {100*(1-diff.mean()):.4f}%  ({diff.sum()} px differ of {diff.size})')
        d = np.zeros_like(img); d[diff] = (255, 0, 255)
        Image.fromarray(np.concatenate([m, img, d], 1)).resize((288*3*2, 224*2), Image.NEAREST).save(out.replace('.png', '_sbs.png'))
