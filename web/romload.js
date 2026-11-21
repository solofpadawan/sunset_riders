// ROM loader for public hosting (no ROM data on the server). If assets/prog.bin is not there, the game asks for the
// player's own ssriders.zip (MAME set, 4-player World ver. EAC), finds the needed files by CRC32 (any file names,
// so renamed or merged sets work), checks them, and builds in the browser the same files tools/extract_prog.py and
// tools/extract_gfx.py produce. The extracted files are kept in IndexedDB, so the zip is asked only once per browser.
(function (G) {
  'use strict';
  // UI and error text via i18next (web/i18n/); node tests and tools (no i18n loaded) keep the pt-BR wording.
  const FB = { 'rom.err.notZip': 'não é um arquivo zip', 'rom.err.corrupt': 'zip corrompido', 'rom.err.method': 'método de compressão não suportado',
    'rom.err.crc': '{{name}}: CRC não confere (arquivo corrompido)', 'rom.err.missing': 'Faltam arquivos no zip (precisa do ssriders da MAME, versão EAC 4 jogadores): {{list}}' };
  const t = (k, o) => { try { if (G.t) return G.t(k, o); } catch (e) {}
    return String(FB[k] || k).replace(/\{\{(\w+)\}\}/g, (m, n) => (o && o[n] != null ? o[n] : m)); };
  // MAME ssriders: name -> CRC32
  const NEED = { '064eac02.8e': 0x5a5425f4, '064eac03.8g': 0x093c00fb, '064eab04.10e': 0xef2315bd, '064eab05.10g': 0x51d6fbc4,
    '064e12.16k': 0xe2bdc619, '064e11.12k': 0x2d8ca8b0, '064e09.7l': 0x4160c372, '064e07.3l': 0x64dd673c,
    '064e01.2f': 0x44b9bc52, '064e06.1d': 0x59810df9, 'ssriders_eac.nv': 0xf6d641a7 };
  const CRCT = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRCT[n] = c; }
  function crc32(u8) { let c = -1; for (let i = 0; i < u8.length; i++) c = CRCT[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(u8); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  // minimal zip reader (central directory; stored and deflate entries; zip64 not needed for these sizes)
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = u8.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error(t('rom.err.notZip'));
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = [];
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error(t('rom.err.corrupt'));
      const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      out.push({ name: name.split('/').pop(), crc, size, method, lo, csize });
    }
    const get = async f => {
      const s = f.lo + 30 + dv.getUint16(f.lo + 26, true) + dv.getUint16(f.lo + 28, true), raw = u8.subarray(s, s + f.csize);
      if (f.method === 0) return raw.slice(); if (f.method === 8) return inflateRaw(raw); throw new Error(t('rom.err.method'));
    };
    return { files: out, get };
  }
  // ---- extraction (same output as tools/extract_prog.py / extract_gfx.py) ----
  function interleave16(out, base, ev, od) { for (let i = 0; i < ev.length; i++) { out[base + 2 * i] = ev[i]; out[base + 2 * i + 1] = od[i]; } }
  function load32w(a, b) { const r = new Uint8Array(2 * a.length); for (let i = 0; i < a.length; i += 2) { r[2 * i] = a[i]; r[2 * i + 1] = a[i + 1]; r[2 * i + 2] = b[i]; r[2 * i + 3] = b[i + 1]; } return r; }
  function rowTo(src, g, dst, o) { // one 32-bit group = one 8-pixel row; byte 3 = plane bit 3 ... byte 0 = bit 0, leftmost pixel = bit 7
    const b0 = src[g], b1 = src[g + 1], b2 = src[g + 2], b3 = src[g + 3];
    for (let x = 0; x < 8; x++) { const s = 7 - x; dst[o + x] = ((b3 >> s) & 1) << 3 | ((b2 >> s) & 1) << 2 | ((b1 >> s) & 1) << 1 | ((b0 >> s) & 1); }
  }
  function decodeTiles(rom) { const n = rom.length / 4, out = new Uint8Array(n * 8); for (let r = 0; r < n; r++) rowTo(rom, r * 4, out, r * 8); return out; }
  function decodeSprites(rom) {
    const n = rom.length / 128, out = new Uint8Array(n * 256);
    for (let c = 0; c < n; c++) for (let q = 0; q < 4; q++) for (let y = 0; y < 8; y++)
      rowTo(rom, c * 128 + q * 32 + y * 4, out, c * 256 + ((q >> 1) * 8 + y) * 16 + (q & 1) * 8);
    return out;
  }
  async function extract(zipBuf, progress) {
    const z = await unzip(zipBuf), byCrc = new Map(z.files.map(f => [f.crc >>> 0, f])), raw = {}, missing = [];
    for (const [name, crc] of Object.entries(NEED)) {
      const f = byCrc.get(crc); if (!f) { missing.push(name); continue; }
      raw[name] = await z.get(f); if (progress) progress(name);
      if (crc32(raw[name]) !== crc) throw new Error(t('rom.err.crc', { name }));
    }
    if (missing.length) throw new Error(t('rom.err.missing', { list: missing.join(', ') }));
    const prog = new Uint8Array(0xc0000);
    interleave16(prog, 0, raw['064eac02.8e'], raw['064eac03.8g']); interleave16(prog, 0x80000, raw['064eab04.10e'], raw['064eab05.10g']);
    return { 'prog.bin': prog, 'eeprom.bin': raw['ssriders_eac.nv'], 'gfx_tiles.bin': load32w(raw['064e12.16k'], raw['064e11.12k']),
      'gfx_sprites.bin': load32w(raw['064e09.7l'], raw['064e07.3l']), 'z80.bin': raw['064e01.2f'], 'k053260.bin': raw['064e06.1d'] };
  }
  function gfx(files) { return { tiles: decodeTiles(files['gfx_tiles.bin']), sprites: decodeSprites(files['gfx_sprites.bin']) }; }
  // ---- IndexedDB cache ----
  const idb = (mode, fn) => new Promise((ok, ko) => {
    const r = indexedDB.open('ssriders', 1); r.onupgradeneeded = () => r.result.createObjectStore('assets');
    r.onerror = () => ko(r.error);
    r.onsuccess = () => { const tx = r.result.transaction('assets', mode), st = tx.objectStore('assets'), q = fn(st); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => ko(tx.error); };
  });
  const cacheGet = () => idb('readonly', st => st.get('files')).catch(() => null);
  const cachePut = f => idb('readwrite', st => st.put(f, 'files')).catch(e => console.warn('IndexedDB', e));
  const cacheClear = () => idb('readwrite', st => st.delete('files'));
  // ---- UI: ask for the zip ----
  function ask() {
    const T = { h: t('rom.h'), d: t('rom.d'), b: t('rom.b'), n: t('rom.n'), r: t('rom.r') };
    return new Promise(resolve => {
      const d = document.createElement('div'); d.id = 'romload';
      d.innerHTML = `<style>
#romload{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(#3a1d08,#000 75%);
 color:#f3e2c0;font:clamp(12px,2.4vmin,18px) system-ui,sans-serif;z-index:20;box-sizing:border-box;padding:3vmin}
#romload .bx{width:min(560px,92vw);max-height:92vh;overflow:auto;text-align:center;border:3px dashed #c8892e;border-radius:14px;padding:4vmin 5vmin;
 background:rgba(0,0,0,.55);box-sizing:border-box;cursor:pointer;transition:background .15s}
#romload .bx.over{background:rgba(200,137,46,.25)}
#romload h1{margin:0 0 .4em;font:900 clamp(22px,6vmin,46px) Georgia,serif;letter-spacing:.06em;color:#ffc861;text-shadow:3px 3px 0 #7a2c00}
#romload .h{font-size:1.35em;margin:.6em 0 .2em}#romload .d{opacity:.75;margin-bottom:1em}
#romload button{font:inherit;font-weight:700;padding:.6em 1.4em;border:0;border-radius:8px;background:#ffc861;color:#3a1d08;cursor:pointer}
#romload button:focus-visible{outline:3px solid #fff}#romload small{display:block;margin-top:1.2em;opacity:.6;line-height:1.35}
#romload .m{min-height:1.3em;margin-top:.8em;color:#ffb0a0}</style>
<div class="bx"><h1>SUNSET RIDERS</h1><div class="h">${T.h}</div><div class="d">${T.d}</div>
<button type="button">${T.b}</button><input type="file" accept=".zip,application/zip" id="rz" hidden>
<div class="m"></div><small>${T.n}</small></div>`;
      document.body.appendChild(d); if (G.SSRLOAD) G.SSRLOAD.hold(true); // the loading message steps aside for the ROM prompt
      const bx = d.querySelector('.bx'), inp = d.querySelector('#rz'), msg = d.querySelector('.m'), btn = d.querySelector('button');
      const take = async file => {
        try { msg.style.color = '#f3e2c0'; msg.textContent = T.r; const files = await extract(await file.arrayBuffer(), n => { msg.textContent = t('rom.c', { name: n }); });
          await cachePut(files); d.remove(); if (G.SSRLOAD) G.SSRLOAD.hold(false); try { window.focus(); } catch (e) {} resolve(files); }
        catch (e) { msg.style.color = '#ffb0a0'; msg.textContent = e.message; inp.value = ''; }
      };
      bx.onclick = () => inp.click(); inp.onclick = e => e.stopPropagation();
      inp.onchange = () => inp.files[0] && take(inp.files[0]);
      d.ondragover = e => { e.preventDefault(); bx.classList.add('over'); }; d.ondragleave = () => bx.classList.remove('over');
      d.ondrop = e => { e.preventDefault(); bx.classList.remove('over'); if (e.dataTransfer.files[0]) take(e.dataTransfer.files[0]); };
      addEventListener('keydown', function k(e) { if (!d.isConnected) return removeEventListener('keydown', k); if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); inp.click(); } });
      btn.focus();
    });
  }
  // Returns null when the server has the extracted assets (PC deploys), else the files (from the cache or the zip).
  async function ensure() {
    try { const r = await fetch('assets/prog.bin', { method: 'HEAD' }); if (r.ok) return null; } catch (e) {}
    const c = await cacheGet(); if (c && c['prog.bin']) return c;
    return ask();
  }
  const api = { NEED, crc32, unzip, extract, decodeTiles, decodeSprites, gfx, ensure, cacheClear };
  if (typeof module !== 'undefined') module.exports = api; else G.SSRROM = api;
})(typeof window !== 'undefined' ? window : globalThis);
