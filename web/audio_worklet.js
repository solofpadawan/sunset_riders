// AudioWorklet side of the sound: receives the sound board's register log from the main thread after every emulated
// frame ({log, safe}: entries + number of chip samples whose log is complete) and renders it with SoundMixer
// (sim/ym2151.js + sim/k053260.js + sim/mixer.js, loaded into this scope first). Keeps ~TARGET chip samples of
// latency behind the emulation; outputs silence while the game is paused or the main thread stalls, and follows
// clock drift by skipping / repeating single output samples.
'use strict';
let TARGET = 2600, NUDGE = 1; const LOW = 300; // chip samples (~46 ms / ~5 ms)
class SSRAudio extends AudioWorkletProcessor {
  constructor() {
    super(); this.mx = null; this.safe = 0; this.started = false;
    this.st = { blocks: 0, starved: 0, skips: 0, nudges: 0, sum2: 0, n: 0 }; // reported to the page about once a second
    this.port.onmessage = e => {
      const m = e.data;
      if (m.pcm) { this.mx = new SoundMixer(new Uint8Array(m.pcm), sampleRate); return; }
      if (!this.mx) return;
      if (m.cfg) { NUDGE = Math.max(1, m.cfg.nudge | 0); return; } // {cfg:{nudge}}: max chip samples skipped/repeated per block (1 = default; spectators 3)
      if (m.target) TARGET = m.target;   // netplay: more latency (sound comes only from confirmed frames, which arrive in bursts)
      if (m.resync) { this.mx.resync(m.resync.n, m.resync.ym, m.resync.k); this.safe = 0; this.started = true; this.avg = undefined; this.hold = TARGET; }
      if (m.log) this.mx.push(m.log);
      if (m.safe !== undefined) this.safe = m.safe;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], mx = this.mx;
    if (!mx || !this.safe) return true;
    if (!this.started) { mx.skipTo(Math.max(0, this.safe - TARGET), 3 * 55930); this.started = true; }
    const need = Math.ceil(L.length * 55930 / sampleRate) + 4;
    let buffered = this.safe - mx.an * mx.div;
    if (this.hold) { if (buffered < this.hold) return true; this.hold = 0; } // after a resync: wait until TARGET is buffered
    if (buffered > 8 * TARGET) { mx.skipTo(this.safe - TARGET, 8 * TARGET); buffered = TARGET; this.avg = undefined; this.st.skips++; } // big stall: jump
    const st = this.st;
    if (++st.blocks % 375 === 0) { this.port.postMessage({ stats: Object.assign({ buffered, rms: Math.sqrt(st.sum2 / (st.n || 1)) }, st) }); st.sum2 = 0; st.n = 0; }
    if (buffered < need + LOW) { st.starved++; return true; }     // starving (paused / hidden): silence, hold
    // the buffer saw-tooths by one frame (~945 samples) as frames arrive; steer its smoothed level towards TARGET
    this.avg = this.avg === undefined ? buffered : this.avg + (buffered - this.avg) / 64;
    const over = this.avg - TARGET;
    if (over > 400) { const k = Math.min(NUDGE, 1 + Math.floor((over - 400) / 500)); mx.nudge(k); st.nudges++; this.avg -= 1.2 * k; }
    else if (over < -400) { const k = Math.min(NUDGE, 1 + Math.floor((-over - 400) / 500)); mx.nudge(-k); st.nudges++; this.avg += 1.2 * k; }
    mx.render(L, R, L.length);
    for (let i = 0; i < L.length; i++) st.sum2 += L[i] * L[i]; st.n += L.length;
    return true;
  }
}
registerProcessor('ssr-audio', SSRAudio);
