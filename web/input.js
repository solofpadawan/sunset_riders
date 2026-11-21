// Per-frame player input (netcode-ready). One PlayerInput per player per frame, packed into one byte
// (bit 0 left, 1 right, 2 up, 3 down, 4 fire, 5 jump, 6 coin, 7 service), active HIGH; the FrameInput is 4 bytes.
// applyFrame() maps it onto the machine ports (MAME ssridr4p: P1..P4 at 0x1c0000.., COINS at 0x1c0100, active low).
// This 4-player set (ssriders EAC) has no start buttons: insert a coin in a player's slot, then press fire to join.
// "Start" keys therefore press fire. The test/service switch (0x1c0102 bit 7) opens the settings menu (no DIP switches
// on this board: difficulty, lives and so on are kept in the EEPROM).
(function (G) {
  'use strict';
  const L = 1, R = 2, U = 4, D = 8, FIRE = 16, JUMP = 32, COIN = 64, SERVICE = 128;
  // Keyboard layouts: P1 arrows or WASD, Z/J fire, X/K jump, 5 coin, 1/Enter start.
  // P2: numpad 8/4/5/6 move, numpad 0 or N fire, numpad . or M jump, 6 coin, 2 start.
  const KEYMAP = [
    { ArrowLeft: L, ArrowRight: R, ArrowUp: U, ArrowDown: D, KeyA: L, KeyD: R, KeyW: U, KeyS: D,
      KeyZ: FIRE, KeyJ: FIRE, KeyX: JUMP, KeyK: JUMP, Digit5: COIN, Digit1: FIRE, Enter: FIRE },
    { Numpad4: L, Numpad6: R, Numpad8: U, Numpad5: D, Numpad2: D, Numpad0: FIRE, KeyN: FIRE, NumpadDecimal: JUMP, KeyM: JUMP,
      Digit6: COIN, Digit2: FIRE },
    { Digit7: COIN, Digit3: FIRE },
    { Digit8: COIN, Digit4: FIRE },
  ];
  const SERVICE_KEY = 'F2', TEST_KEY = 'F9';
  const held = {};
  const typing = e => { const t = e.target; return !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)); };
  function attach(target) {
    target.addEventListener('keydown', e => { if (typing(e)) return; held[e.code] = 1; if (/^(Arrow|Space)/.test(e.code)) e.preventDefault(); });
    target.addEventListener('keyup', e => { held[e.code] = 0; });
    target.addEventListener('blur', () => { for (const k in held) held[k] = 0; });
  }
  // Standard-mapping gamepad: d-pad or left stick move, A (0) fire, B (1) jump, Select (8) coin, Start (9) fire.
  function padBits(p) {
    if (!p || !p.connected) return 0;
    const b = i => p.buttons[i] && p.buttons[i].pressed, ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    let v = 0;
    if (b(14) || ax < -0.5) v |= L; if (b(15) || ax > 0.5) v |= R;
    if (b(12) || ay < -0.5) v |= U; if (b(13) || ay > 0.5) v |= D;
    if (b(0) || b(2) || b(9)) v |= FIRE; if (b(1) || b(3)) v |= JUMP; if (b(8)) v |= COIN;
    return v;
  }
  // Sample the local devices into one FrameInput (Uint8Array(4)). Pad n drives player n (pad 0 also adds to P1).
  // block = true (chat field open): every player byte is neutral; the local devices are ignored
  function sample() {
    const out = new Uint8Array(4);
    if (api.block) return out;
    for (let p = 0; p < 4; p++) for (const k in KEYMAP[p]) if (held[k]) out[p] |= KEYMAP[p][k];
    const pads = (G.navigator && navigator.getGamepads) ? navigator.getGamepads() : [];
    for (let i = 0; i < Math.min(4, pads.length); i++) out[i] |= padBits(pads[i]);
    for (let p = 0; p < 4; p++) out[p] = clean(out[p]);
    if (held[SERVICE_KEY]) out[0] |= SERVICE;
    return out;
  }
  // Local devices: opposite directions cancel (a real stick cannot press both). Movies/netcode inputs are applied as is.
  function clean(b) { if ((b & 3) === 3) b &= ~3; if ((b & 12) === 12) b &= ~12; return b; }
  function applyFrame(m, fi, test) {
    let coins = 0xff;
    for (let p = 0; p < 4; p++) {
      const b = fi[p] | 0;
      m.inputs[p] = 0xff & ~(b & 0x3f);
      if (b & COIN) coins &= ~(1 << p);
      if (b & SERVICE) coins &= ~[0x10, 0x20, 0x40, 0x80][p];
    }
    m.inputs[4] = coins; m.inputs[5] = test ? 0x7f : 0xff;
  }
  // Movie conversion: MAME ports record (P1..P4, COINS; active low) -> FrameInput.
  function fromPorts(r) {
    const fi = new Uint8Array(4);
    for (let p = 0; p < 4; p++) { fi[p] = ~r[p] & 0x3f; if (!(r[4] & (1 << p))) fi[p] |= COIN; if (!(r[4] & (0x10 << p))) fi[p] |= SERVICE; }
    return fi;
  }
  const api = { block: false, L, R, U, D, FIRE, JUMP, COIN, SERVICE, KEYMAP, attach, sample, applyFrame, fromPorts, held, TEST_KEY };
  if (typeof module !== 'undefined') module.exports = api; else G.SSRIN = api;
})(typeof window !== 'undefined' ? window : globalThis);
