// Presentation modes (pt67u): CRT shader (WebGL) + original western bezel at 16:9, CRT only, or the original sharp look.
// Presentation only: reads the finished 288x224 frame (game.js ImageData) and positions #screen; never touches the
// machine, inputs, rollback or hashes. #screen always sits exactly on the game picture so #chatov (chat bubbles, nicks,
// coin hint) stays aligned. Always CRT + 16:9 bezel (pt70u); hidden debug: ?gfx=crt|orig, ?webgl=0 (2D fallback).
// The bezel is drawn procedurally here (no image files, no Konami art). Fonts: system serif only.
(function (G) {
  'use strict';
  const W = 288, H = 224, MODES = ['bezel', 'crt', 'orig'];
  const q = new URLSearchParams(location.search);
  let mode = q.get('gfx') || 'bezel';
  try { localStorage.removeItem('ssr_gfx'); } catch (e) {} // old F8 choice (pt70u: always bezel)
  if (!MODES.includes(mode)) mode = 'bezel';
  let gl = null, prog = null, tex = null, crt = null, bz = null, bzKey = '', glFail = false, frames = 0;
  // ---------- layout ----------
  // bezel layout in 1920x1080 units: game picture 4:3, 950 high (pt133u: large frame; title must sit above gy / #crt)
  const BZ = { w: 1920, h: 1080, gh: 950, gy: 70 }; BZ.gw = BZ.gh * 4 / 3; BZ.gx = (BZ.w - BZ.gw) / 2;
  function rects() {
    const iw = innerWidth, ih = innerHeight;
    if (mode === 'orig' || (glFail && mode !== 'bezel')) {
      const s = Math.max(1, Math.floor(Math.min(iw / W, ih / H)));
      return { g: { x: (iw - W * s) >> 1, y: (ih - H * s) >> 1, w: W * s, h: H * s } };
    }
    if (mode === 'crt') {
      let h = ih, w = h * 4 / 3; if (w > iw) { w = iw; h = w * 3 / 4; }
      return { g: { x: (iw - w) / 2, y: (ih - h) / 2, w, h } };
    }
    let aw = iw, ah = aw * 9 / 16; if (ah > ih) { ah = ih; aw = ah * 16 / 9; }
    const a = { x: (iw - aw) / 2, y: (ih - ah) / 2, w: aw, h: ah }, k = aw / BZ.w;
    return { a, g: { x: a.x + BZ.gx * k, y: a.y + BZ.gy * k, w: BZ.gw * k, h: BZ.gh * k } };
  }
  const px = (el, r) => { el.style.left = r.x + 'px'; el.style.top = r.y + 'px'; el.style.width = r.w + 'px'; el.style.height = r.h + 'px'; };
  function layout() {
    const scr = document.getElementById('screen'); if (!scr) return;
    const R = rects(), useGL = mode !== 'orig' && ensureGL();
    px(scr, R.g); scr.style.opacity = useGL ? '0' : '1';
    scr.style.imageRendering = useGL || mode === 'orig' ? '' : 'auto';
    if (mode === 'orig') scr.style.imageRendering = 'pixelated';
    if (crt) {
      crt.style.display = useGL ? 'block' : 'none';
      if (useGL) { px(crt, R.g); const d = G.devicePixelRatio || 1; crt.width = Math.round(R.g.w * d); crt.height = Math.round(R.g.h * d); }
    }
    document.body.style.background = mode === 'bezel' ? 'radial-gradient(#1c0f06,#000 80%)' : '#000';
    if (mode === 'bezel') {
      if (!bz) { bz = document.createElement('canvas'); bz.id = 'bezel'; bz.style.cssText = 'position:absolute;z-index:0;pointer-events:none'; document.body.prepend(bz); }
      bz.style.display = 'block'; px(bz, R.a);
      const d = G.devicePixelRatio || 1, cw = Math.min(3840, Math.round(R.a.w * d)), key = cw + '';
      if (key !== bzKey) { bzKey = key; bz.width = cw; bz.height = Math.round(cw * 9 / 16); drawBezel(bz); }
    } else if (bz) bz.style.display = 'none';
    placeChrome(R);
  }
  // Multijogador button: centered in the wood/letterbox under the CRT when there is room;
  // otherwise at the bottom of the viewport, and the coin hint is lifted if they overlap the game.
  function placeChrome(R) {
    const bar = document.getElementById('bar');
    if (!bar) return;
    const bh = bar.offsetHeight || 32;
    const gameBottom = R.g.y + R.g.h;
    const floor = Math.min(R.a ? (R.a.y + R.a.h) : innerHeight, innerHeight);
    const margin = floor - gameBottom;
    let top;
    if (margin >= bh) top = gameBottom + (margin - bh) / 2;
    else {
      // Stay just below the CRT when any wood/letterbox remains (a pixel may
      // clip at the viewport edge). If the CRT fills the height, sit at the bottom.
      top = gameBottom + Math.max(0, Math.min(2, margin));
      if (top + bh > innerHeight + 3 && margin < 8) top = innerHeight - bh - 4;
    }
    bar.style.top = Math.round(top) + 'px';
    bar.style.bottom = 'auto';
    bar.style.left = '50%';
    bar.style.transform = 'translateX(-50%)';
    if (window.SSRHINT) {
      const overlap = Math.max(0, gameBottom - top);
      SSRHINT.bottom = overlap > 0 && R.g.h > 0 ? Math.ceil(overlap * H / R.g.h) + 2 : 2;
    }
    if (window.SSRNETPLAY && typeof SSRNETPLAY.placeHint === 'function') SSRNETPLAY.placeHint();
  }
  // ---------- WebGL CRT ----------
  const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
  const FS = `precision mediump float;
uniform sampler2D T;uniform vec2 SRC;uniform vec2 OUT;varying vec2 uv;
vec2 warp(vec2 p){p=p*2.-1.;p*=vec2(1.+p.y*p.y*.028,1.+p.x*p.x*.040);return p*.5+.5;}
vec3 tap(float x,float y){float i=floor(x-.5),f=fract(x-.5);f=clamp((f-.5)*2.5+.5,0.,1.);vec3 c=texture2D(T,vec2(i+.5+f,y)/SRC).rgb;return c*c;}
vec3 beam(float d,vec3 c){vec3 w=mix(vec3(.24),vec3(.46),sqrt(c));vec3 e=d/w;return exp(-.5*e*e);}
void main(){
 vec2 w=warp(uv);
 if(w.x<0.||w.x>1.||w.y<0.||w.y>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}
 float sc=OUT.y/SRC.y, s=clamp((sc-1.6)/2.2,0.,1.);
 float x=w.x*SRC.x, sy=w.y*SRC.y-.5, r0=floor(sy), f=sy-r0;
 vec3 c0=tap(x,r0+.5), c1=tap(x,r0+1.5);
 vec3 scan=c0*beam(f,c0)+c1*beam(1.-f,c1);
 vec3 fl=mix(c0,c1,smoothstep(.3,.7,f));
 vec3 col=mix(fl,scan*1.75,s);
 vec2 b=vec2(1.6)/SRC; vec3 g=vec3(0.);
 g+=texture2D(T,w+vec2(b.x,b.y)).rgb;g+=texture2D(T,w+vec2(-b.x,b.y)).rgb;g+=texture2D(T,w+vec2(b.x,-b.y)).rgb;g+=texture2D(T,w+vec2(-b.x,-b.y)).rgb;
 g*=.25; col+=g*g*.16;
 float m=mod(floor(gl_FragCoord.x),3.); vec3 mk=vec3(.86); if(m<.5)mk.r=1.12;else if(m<1.5)mk.g=1.12;else mk.b=1.12;
 col*=mix(vec3(1.),mk,s);
 vec2 v=w*(1.-w); col*=pow(clamp(v.x*v.y*16.,0.,1.),.10);
 vec2 e=min(w,1.-w)*vec2(SRC.x/SRC.y,1.); float cm=smoothstep(0.,.008,min(e.x,e.y)); 
 gl_FragColor=vec4(sqrt(col)*cm,1.);}`;
  function ensureGL() {
    if (gl) return true; if (glFail || q.get('webgl') === '0') { glFail = true; return false; }
    try {
      crt = document.createElement('canvas'); crt.id = 'crt'; crt.style.cssText = 'position:absolute;z-index:1;pointer-events:none';
      gl = crt.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!gl) throw new Error('no webgl');
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const bb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.uniform2f(gl.getUniformLocation(prog, 'SRC'), W, H); gl.uniform1i(gl.getUniformLocation(prog, 'T'), 0);
      crt.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glFail = true; layout(); });
      document.getElementById('screen').after(crt);
      return true;
    } catch (e) { console.warn('gfx: WebGL unavailable, using the 2D canvas', e.message); gl = null; glFail = true; if (crt) crt.remove(); crt = null; return false; }
  }
  const tms = [];
  function present(img) {
    if (mode === 'orig' || !gl) return;
    const t0 = performance.now();
    gl.viewport(0, 0, crt.width, crt.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.uniform2f(gl.getUniformLocation(prog, 'OUT'), crt.width, crt.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); frames++;
    tms.push(performance.now() - t0); if (tms.length > 240) tms.shift();
  }
  // ---------- bezel (procedural, 1920x1080 design units) ----------
  function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  const SERIF = 'Georgia,"Noto Serif","DejaVu Serif","Times New Roman",serif';
  function wood(c, R) { // horizontal planks with grain and knots
    const ph = 135;
    for (let i = 0, y = 0; y < BZ.h; i++, y += ph) {
      const r = rnd(7 + i * 31), base = 0.75 + r() * 0.3;
      const g = c.createLinearGradient(0, y, 0, y + ph);
      g.addColorStop(0, `rgb(${92 * base | 0},${52 * base | 0},${26 * base | 0})`); g.addColorStop(.5, `rgb(${110 * base | 0},${64 * base | 0},${32 * base | 0})`); g.addColorStop(1, `rgb(${70 * base | 0},${38 * base | 0},${18 * base | 0})`);
      c.fillStyle = g; c.fillRect(0, y, BZ.w, ph);
      for (let k = 0; k < 46; k++) { // grain lines
        const yy = y + r() * ph, a = 2 + r() * 5, fr = 0.002 + r() * 0.006, ph0 = r() * 6;
        c.strokeStyle = r() < .5 ? `rgba(40,18,6,${.10 + r() * .22})` : `rgba(170,110,60,${.05 + r() * .10})`; c.lineWidth = .8 + r() * 2.2;
        c.beginPath(); for (let x = 0; x <= BZ.w; x += 24) { const v = yy + Math.sin(x * fr + ph0) * a + Math.sin(x * fr * 3.7) * a * .3; x ? c.lineTo(x, v) : c.moveTo(x, v); } c.stroke();
      }
      for (let k = 0; k < 2; k++) { const kx = r() * BZ.w, ky = y + 30 + r() * (ph - 60); for (let j = 6; j > 0; j--) { c.strokeStyle = `rgba(45,20,6,${.12 + .05 * j})`; c.lineWidth = 2; c.beginPath(); c.ellipse(kx, ky, 6 + j * 7, 3 + j * 2.4, 0, 0, 7); c.stroke(); } c.fillStyle = 'rgba(30,12,4,.8)'; c.beginPath(); c.ellipse(kx, ky, 7, 3.5, 0, 0, 7); c.fill(); }
      c.fillStyle = 'rgba(15,6,2,.85)'; c.fillRect(0, y + ph - 3, BZ.w, 3); c.fillStyle = 'rgba(200,140,80,.12)'; c.fillRect(0, y, BZ.w, 2);
      for (const nx of [60, BZ.w - 60]) nail(c, nx, y + ph / 2, 7);
    }
  }
  function nail(c, x, y, r) {
    const g = c.createRadialGradient(x - r * .35, y - r * .35, r * .1, x, y, r);
    g.addColorStop(0, '#fff2c0'); g.addColorStop(.35, '#d9a640'); g.addColorStop(.8, '#7a4f12'); g.addColorStop(1, '#3a2206');
    c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.arc(x + r * .25, y + r * .35, r * 1.05, 0, 7); c.fill();
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  function star(c, x, y, R, label) { // sheriff badge: 6 points with ball tips
    c.save(); c.translate(x, y);
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = R * .25; c.shadowOffsetX = R * .06; c.shadowOffsetY = R * .1;
    const g = c.createLinearGradient(-R, -R, R, R); g.addColorStop(0, '#fff1b0'); g.addColorStop(.3, '#e8b84a'); g.addColorStop(.6, '#a8741c'); g.addColorStop(1, '#f2cf6a');
    c.fillStyle = g; c.strokeStyle = '#5a3608'; c.lineWidth = R * .05;
    c.beginPath(); for (let i = 0; i < 12; i++) { const a = -Math.PI / 2 + i * Math.PI / 6, rr = i % 2 ? R * .52 : R * .9; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill(); c.shadowColor = 'transparent'; c.stroke();
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; c.beginPath(); c.arc(Math.cos(a) * R * .92, Math.sin(a) * R * .92, R * .12, 0, 7); c.fill(); c.stroke(); }
    c.strokeStyle = 'rgba(90,54,8,.8)'; c.lineWidth = R * .04; c.beginPath(); c.arc(0, 0, R * .42, 0, 7); c.stroke();
    if (label) { c.fillStyle = '#5a3608'; c.font = `bold ${R * .16}px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 0, 0); }
    c.restore();
  }
  function poster(c, x, y, w, h, lines, seed) {
    const r = rnd(seed); c.save(); c.translate(x + w / 2, y + h / 2); c.rotate((r() - .5) * .06); c.translate(-w / 2, -h / 2);
    c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(8, 10, w, h);
    const g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, h * .75); g.addColorStop(0, '#f0dcae'); g.addColorStop(.7, '#d6b77c'); g.addColorStop(1, '#9c7840');
    c.fillStyle = g; c.beginPath(); c.moveTo(0, 0); for (let i = 1; i <= 12; i++) c.lineTo(w * i / 12, (r() - .5) * 4); for (let i = 1; i <= 16; i++) c.lineTo(w + (r() - .5) * 4, h * i / 16); for (let i = 11; i >= 0; i--) c.lineTo(w * i / 12, h + (r() - .5) * 4); for (let i = 15; i >= 0; i--) c.lineTo((r() - .5) * 4, h * i / 16); c.fill();
    for (let k = 0; k < 18; k++) { c.fillStyle = `rgba(110,70,20,${r() * .12})`; c.beginPath(); c.arc(r() * w, r() * h, 8 + r() * 30, 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(60,30,8,.7)'; c.lineWidth = 3; c.strokeRect(14, 14, w - 28, h - 28); c.lineWidth = 1; c.strokeRect(20, 20, w - 40, h - 40);
    c.fillStyle = '#3a1c06'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (const L of lines) { if (L.star) { star(c, w / 2, L.y, L.star); continue; } c.font = `${L.b || 'bold'} ${L.s}px ${SERIF}`; fitText(c, L.t, w / 2, L.y, w - 56); }
    nail(c, w / 2, 12, 7); c.restore();
  }
  function fitText(c, t, x, y, maxw) { const m = c.measureText(t).width; if (m > maxw) { c.save(); c.translate(x, y); c.scale(maxw / m, 1); c.fillText(t, 0, 0); c.restore(); } else c.fillText(t, x, y); }
  function drawBezel(cv) {
    const c = cv.getContext('2d'), k = cv.width / BZ.w; c.setTransform(k, 0, 0, k, 0, 0);
    wood(c);
    const v = c.createRadialGradient(960, 540, 300, 960, 540, 1150); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)'); c.fillStyle = v; c.fillRect(0, 0, BZ.w, BZ.h);
    const gx = BZ.gx, gy = BZ.gy, gw = BZ.gw, gh = BZ.gh, L = 46; // leather band width
    // rope around the outer edge
    rope(c, 18, 18, BZ.w - 36, BZ.h - 36);
    // side posters first (drawn under the leather so a larger frame may overlap them)
    const pw = 210, ph = 312, py = 300;
    poster(c, 28, py, pw, ph, [{ t: 'WANTED', s: 44, y: 66 }, { t: 'DEAD OR ALIVE', s: 18, y: 96 }, { star: 54, y: 170 }, { t: 'REWARD', s: 26, y: 256 }, { t: '$ 10,000', s: 30, y: 290 }], 3);
    poster(c, BZ.w - 28 - pw, py, pw, ph, [{ t: 'BOUNTY', s: 42, y: 66 }, { t: 'HUNTERS', s: 24, y: 96 }, { t: 'WELCOME', s: 22, y: 124 }, { star: 50, y: 196 }, { t: '1 - 4', s: 36, y: 274 }, { t: 'PLAYERS', s: 18, y: 296 }], 5);
    // leather frame
    c.fillStyle = 'rgba(0,0,0,.55)'; rr(c, gx - L - 6, gy - L + 4, gw + 2 * L + 20, gh + 2 * L + 14, 26); c.fill();
    const lg = c.createLinearGradient(0, gy - L, 0, gy + gh + L); lg.addColorStop(0, '#7a3a14'); lg.addColorStop(.5, '#5a260b'); lg.addColorStop(1, '#3e1806');
    c.fillStyle = lg; rr(c, gx - L, gy - L, gw + 2 * L, gh + 2 * L, 22); c.fill();
    const r = rnd(99); for (let i = 0; i < 1800; i++) { c.fillStyle = r() < .5 ? 'rgba(0,0,0,.10)' : 'rgba(255,200,150,.05)'; const xx = gx - L + r() * (gw + 2 * L), yy = gy - L + r() * (gh + 2 * L); c.fillRect(xx, yy, 2 + r() * 3, 1 + r() * 2); }
    c.strokeStyle = 'rgba(255,210,160,.25)'; c.lineWidth = 2; rr(c, gx - L + 1, gy - L + 1, gw + 2 * L - 2, gh + 2 * L - 2, 21); c.stroke();
    c.setLineDash([10, 8]); c.strokeStyle = '#e8c48a'; c.lineWidth = 2.4; rr(c, gx - L + 12, gy - L + 12, gw + 2 * L - 24, gh + 2 * L - 24, 14); c.stroke(); c.setLineDash([]);
    // brass inner lip + black glass recess
    const bg = c.createLinearGradient(0, gy - 14, 0, gy + gh + 14); bg.addColorStop(0, '#f0c862'); bg.addColorStop(.5, '#8a5a16'); bg.addColorStop(1, '#d8a83e');
    c.fillStyle = bg; rr(c, gx - 14, gy - 14, gw + 28, gh + 28, 14); c.fill();
    c.fillStyle = '#050403'; rr(c, gx - 5, gy - 5, gw + 10, gh + 10, 10); c.fill();
    // rivets on the leather
    for (let i = 0; i <= 12; i++) { const x = gx - L / 2 + (gw + L) * i / 12; nail(c, x, gy - L / 2 - 2, 6); nail(c, x, gy + gh + L / 2 + 2, 6); }
    for (let i = 1; i < 9; i++) { const y = gy - L / 2 + (gh + L) * i / 9; nail(c, gx - L / 2 - 2, y, 6); nail(c, gx + gw + L / 2 + 2, y, 6); }
    // corner stars on the frame
    for (const [x, y] of [[gx - L / 2, gy - L / 2], [gx + gw + L / 2, gy - L / 2], [gx - L / 2, gy + gh + L / 2], [gx + gw + L / 2, gy + gh + L / 2]]) star(c, x, y, 34);
    // title plate: must end at or above gy (the #crt/#screen DOM layer covers the bezel inside the game rect)
    const tw = 560, th = 56, tx = 960 - tw / 2, ty = Math.max(8, gy - th - 2);
    c.fillStyle = 'rgba(0,0,0,.55)'; rr(c, tx + 5, ty + 6, tw, th, 10); c.fill();
    const tg = c.createLinearGradient(0, ty, 0, ty + th); tg.addColorStop(0, '#ffe6a0'); tg.addColorStop(.45, '#d49a34'); tg.addColorStop(.55, '#b07820'); tg.addColorStop(1, '#f0c45a');
    c.fillStyle = tg; rr(c, tx, ty, tw, th, 10); c.fill(); c.strokeStyle = '#4a2a06'; c.lineWidth = 2.5; rr(c, tx + 5, ty + 5, tw - 10, th - 10, 7); c.stroke();
    for (const x of [tx + 20, tx + tw - 20]) nail(c, x, ty + th / 2, 6);
    c.font = `bold 40px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,240,200,.6)'; fitText(c, 'SUNSET  RIDERS', 961, ty + th / 2 + 3, tw - 80);
    c.fillStyle = '#3a1c04'; fitText(c, 'SUNSET  RIDERS', 960, ty + th / 2 + 1, tw - 80);
  }
  function rope(c, x, y, w, h) {
    c.save(); c.lineCap = 'round';
    const seg = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / 14), dx = (x1 - x0) / len, dy = (y1 - y0) / len, nx = -dy, ny = dx;
      c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 16; c.beginPath(); c.moveTo(x0 + 3, y0 + 4); c.lineTo(x1 + 3, y1 + 4); c.stroke();
      c.strokeStyle = '#8a6a3a'; c.lineWidth = 13; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      for (let i = 0; i < n; i++) { const px0 = x0 + dx * i * 14, py0 = y0 + dy * i * 14; c.strokeStyle = i % 2 ? '#c8a468' : '#b08c50'; c.lineWidth = 4;
        c.beginPath(); c.moveTo(px0 - nx * 6, py0 - ny * 6); c.lineTo(px0 + dx * 10 + nx * 6, py0 + dy * 10 + ny * 6); c.stroke();
        c.strokeStyle = 'rgba(60,40,15,.6)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px0 - nx * 6 + dx * 3, py0 - ny * 6 + dy * 3); c.lineTo(px0 + dx * 13 + nx * 6, py0 + dy * 13 + ny * 6); c.stroke(); }
    };
    seg(x, y, x + w, y); seg(x + w, y, x + w, y + h); seg(x + w, y + h, x, y + h); seg(x, y + h, x, y);
    c.restore();
  }
  // ---------- debug mode switch (tests only; no key, not persisted) ----------
  function set(m) { if (!MODES.includes(m)) return; mode = m; layout(); }
  addEventListener('resize', layout);
  G.SSRGFX = { layout, present, set, rects, BZ, get mode() { return mode; }, get webgl() { return !!gl; }, get frames() { return frames; }, modes: MODES, msPresent: () => tms.reduce((a, b) => a + b, 0) / (tms.length || 1) };
})(window);
