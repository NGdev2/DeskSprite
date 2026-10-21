// Tiny WebAudio synth for hits, zaps and booms. Off unless the "Sound effects" setting is on.
export class Sound {
  constructor() { this.ac = null; this.on = false; this.last = {}; }

  ctx() {
    if (!this.ac) {
      try { this.ac = new AudioContext(); } catch { return null; }
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    return this.ac;
  }

  tone(freq, dur, type = 'square', vol = 0.06, slide = 0) {
    const ac = this.ctx(); if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), ac.currentTime + dur);
    g.gain.setValueAtTime(vol, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }

  noise(dur, vol = 0.12, lp = 1200) {
    const ac = this.ctx(); if (!ac) return;
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = lp; g.gain.value = vol;
    src.connect(f).connect(g).connect(ac.destination);
    src.start();
  }

  play(name) {
    if (!this.on) return;
    const now = performance.now();
    if (now - (this.last[name] || 0) < 45) return;
    this.last[name] = now;
    switch (name) {
      case 'hit': this.noise(0.12, 0.18, 900); this.tone(110, 0.1, 'sine', 0.12, 0.5); break;
      case 'whoosh': this.noise(0.18, 0.05, 2500); break;
      case 'boom': this.noise(0.7, 0.35, 500); this.tone(60, 0.6, 'sine', 0.2, 0.4); break;
      case 'zap': this.tone(900, 0.18, 'sawtooth', 0.05, 0.2); this.noise(0.2, 0.08, 4000); break;
      case 'crack': this.noise(0.25, 0.2, 3000); this.tone(1800, 0.05, 'square', 0.03, 0.5); break;
      case 'blip': this.tone(520 + Math.random() * 200, 0.05, 'square', 0.025); break;
      case 'pop': this.tone(700, 0.08, 'sine', 0.08, 1.8); break;
      case 'jump': this.tone(300, 0.12, 'square', 0.03, 2); break;
      case 'eat': this.noise(0.08, 0.1, 1500); break;
      case 'draw': this.tone(1200, 0.03, 'triangle', 0.015); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.18, 'square', 0.05), i * 110)); break;
      case 'lose': [400, 300, 200].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 'square', 0.05), i * 160)); break;
      case 'scan': this.tone(1400, 0.25, 'sine', 0.04, 0.6); break;
      case 'note': this.tone([523, 587, 659, 784, 880][Math.floor(Math.random() * 5)], 0.25, 'triangle', 0.05); break;
    }
  }
}
