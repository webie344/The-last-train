// Fully procedural audio (Web Audio): ambience, footsteps, creature, alarms, heartbeat, radio. No audio files needed.
import { clamp, rand } from './util.js';

export class GameAudio {
  constructor() { this.ctx = null; this.vol = { master: 0.9, sfx: 1, music: 0.8 }; this.zone = 'hall'; this.threat = 0; this.fear = 0; this._loops = {}; this._drip = 3; this._clang = 12; }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.vol.master;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = this.vol.music * 0.55; this.music.connect(this.master);
    // reverb
    this.verb = c.createConvolver(); this.verb.buffer = this._ir(2.4, 2.6);
    this.verbIn = c.createGain(); this.verbIn.gain.value = 0.35; this.verbIn.connect(this.verb);
    const vo = c.createGain(); vo.gain.value = 0.9; this.verb.connect(vo); vo.connect(this.master);
    this.nb = { white: this._noise('white'), brown: this._noise('brown') };
    this._buildAmbience();
    this._buildTension();
  }
  setVolumes(v) { Object.assign(this.vol, v); if (!this.ctx) return; this.master.gain.value = this.vol.master; this.sfx.gain.value = this.vol.sfx; this.music.gain.value = this.vol.music * 0.55; }

  _noise(kind) {
    const c = this.ctx, len = c.sampleRate * 3, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  _ir(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  _src(buf, loop = true) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }
  _out(node, { wet = 0.3, pan = null, dest = null } = {}) {
    const c = this.ctx; let n = node;
    if (pan) { n.connect(pan); n = pan; }
    n.connect(dest || this.sfx);
    if (wet > 0) { const g = c.createGain(); g.gain.value = wet; n.connect(g); g.connect(this.verbIn); }
  }

  _buildAmbience() {
    const c = this.ctx;
    // air / room tone
    const air = this._src(this.nb.brown), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; this.airG = c.createGain(); this.airG.gain.value = 0.35;
    air.connect(lp); lp.connect(this.airG); this.airG.connect(this.music); air.start();
    // sub drone
    const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'sine'; o1.frequency.value = 41; o2.frequency.value = 55.4;
    const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 140; this.droneG = c.createGain(); this.droneG.gain.value = 0.16;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.06; lfo.connect(lg); lg.connect(this.droneG.gain); lfo.start();
    o1.connect(dl); o2.connect(dl); dl.connect(this.droneG); this.droneG.connect(this.music); o1.start(); o2.start();
    // train hum (only audible inside the train)
    const o3 = c.createOscillator(); o3.type = 'square'; o3.frequency.value = 50; const f3 = c.createBiquadFilter(); f3.type = 'lowpass'; f3.frequency.value = 220;
    this.trainG = c.createGain(); this.trainG.gain.value = 0; o3.connect(f3); f3.connect(this.trainG); this.trainG.connect(this.music); o3.start();
    const rattle = this._src(this.nb.white), rf = c.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 900; rf.Q.value = 0.6; this.rumbleG = c.createGain(); this.rumbleG.gain.value = 0;
    rattle.connect(rf); rf.connect(this.rumbleG); this.rumbleG.connect(this.sfx); rattle.start();
    // emergency hum / generator
    const og = c.createOscillator(); og.type = 'sawtooth'; og.frequency.value = 60; const gf = c.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 260;
    this.genG = c.createGain(); this.genG.gain.value = 0; og.connect(gf); gf.connect(this.genG); this.genG.connect(this.sfx); og.start();
  }
  _buildTension() {
    const c = this.ctx;
    this.tOsc = [0, 1, 2].map((i) => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = [233, 247.5, 311][i]; return o; });
    this.tG = c.createGain(); this.tG.gain.value = 0; const trem = c.createOscillator(), tg = c.createGain(); trem.frequency.value = 5.2; tg.gain.value = 0.02; trem.connect(tg); tg.connect(this.tG.gain); trem.start();
    this.tOsc.forEach((o) => { o.connect(this.tG); o.start(); }); this.tG.connect(this.music);
  }

  setZone(z) { this.zone = z; }
  setThreat(t) { this.threat = t; }
  setPower(on) { if (!this.ctx) return; this.genG.gain.setTargetAtTime(on ? 0.06 : 0, this.ctx.currentTime, 1.2); }
  setMoving(on) { if (!this.ctx) return; this.rumbleG.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.8); }

  update(dt, listener) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, inTrain = this.zone === 'train';
    this.trainG.gain.setTargetAtTime(inTrain ? 0.05 : 0, t, 0.6);
    this.airG.gain.setTargetAtTime(inTrain ? 0.12 : 0.35, t, 0.8);
    this.verbIn.gain.setTargetAtTime(inTrain ? 0.12 : this.zone === 'room' ? 0.25 : 0.42, t, 0.5);
    this.tG.gain.setTargetAtTime(clamp(this.threat, 0, 1) * 0.045, t, 1.2);
    if (listener) {
      const L = this.ctx.listener, p = listener.pos, f = listener.fwd;
      if (L.positionX) { L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z; L.forwardX.value = f.x; L.forwardY.value = 0; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else { L.setPosition?.(p.x, p.y, p.z); L.setOrientation?.(f.x, 0, f.z, 0, 1, 0); }
    }
    if (!inTrain) { this._drip -= dt; if (this._drip < 0) { this._drip = rand(2, 7); this.drip(); } this._clang -= dt; if (this._clang < 0) { this._clang = rand(14, 38); this.clang(rand(10, 30)); } }
    // heartbeat
    if (this.fear > 0.05) { this._hb = (this._hb || 0) - dt; if (this._hb < 0) { this._hb = 0.95 - this.fear * 0.5; this.heart(this.fear); } }
  }

  _env(g, a, d, peak, end = 0.0001) { const t = this.ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(end, t + a + d); }
  _panner(pos) {
    const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2; p.rolloffFactor = 1.4; p.maxDistance = 80;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 1; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y ?? 1, pos.z);
    return p;
  }
  _burst({ type = 'white', freq = 800, q = 1, filt = 'bandpass', dur = 0.12, peak = 0.3, wet = 0.2, pos = null, a = 0.004, rate = 1 }) {
    if (!this.ctx) return;
    const c = this.ctx, s = this._src(this.nb[type], false), f = c.createBiquadFilter(), g = c.createGain();
    f.type = filt; f.frequency.value = freq; f.Q.value = q; s.playbackRate.value = rate; s.connect(f); f.connect(g);
    this._env(g, a, dur, peak); this._out(g, { wet, pan: pos ? this._panner(pos) : null });
    s.start(0, Math.random() * 2, dur + a + 0.1);
  }
  _tone({ f0 = 440, f1 = null, type = 'sine', dur = 0.2, peak = 0.2, wet = 0.2, pos = null, a = 0.005 }) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f0;
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, c.currentTime + dur);
    o.connect(g); this._env(g, a, dur, peak); this._out(g, { wet, pan: pos ? this._panner(pos) : null }); o.start(); o.stop(c.currentTime + dur + a + 0.1);
  }

  step(surface = 'concrete', power = 1, pos = null) {
    const metal = surface === 'metal';
    this._burst({ type: 'white', freq: metal ? 1500 : 520 + rand(-60, 60), q: metal ? 1.4 : 0.9, dur: 0.07 + power * 0.03, peak: (metal ? 0.1 : 0.08) * (0.4 + power * 0.8), wet: this.zone === 'train' ? 0.06 : 0.3, pos });
    if (metal) this._tone({ f0: 180 + rand(-10, 10), f1: 120, type: 'triangle', dur: 0.08, peak: 0.03 * power, wet: 0.2, pos });
  }
  drip() { const p = { x: rand(-8, 10), y: 1, z: rand(-30, 30) }; this._tone({ f0: 1800 + rand(-300, 300), f1: 900, type: 'sine', dur: 0.09, peak: 0.05, wet: 0.7, pos: p }); }
  clang(d) { const a = rand(0, 6.28), p = { x: Math.cos(a) * d, y: 1, z: Math.sin(a) * d }; [430, 660, 1180].forEach((f, i) => this._tone({ f0: f * rand(0.95, 1.05), f1: f * 0.97, type: 'triangle', dur: 1.2 - i * 0.3, peak: 0.07 / (i + 1), wet: 0.9, pos: p })); }
  door(heavy = false, pos = null) { this._burst({ type: 'brown', freq: heavy ? 140 : 320, q: 0.8, filt: 'lowpass', dur: 0.5, peak: 0.45, wet: 0.5, pos }); this._tone({ f0: 90, f1: 55, type: 'sine', dur: 0.35, peak: 0.25, wet: 0.5, pos }); this._burst({ type: 'white', freq: 2400, q: 3, dur: 0.18, peak: 0.07, wet: 0.5, pos }); }
  slide(pos = null) { this._burst({ type: 'white', freq: 700, q: 0.7, dur: 0.6, peak: 0.06, wet: 0.3, pos, a: 0.08 }); this._tone({ f0: 160, f1: 210, type: 'sawtooth', dur: 0.5, peak: 0.02, wet: 0.2, pos }); }
  pickup() { this._tone({ f0: 660, f1: 990, type: 'sine', dur: 0.18, peak: 0.1, wet: 0.3 }); this._tone({ f0: 990, f1: 1320, type: 'sine', dur: 0.22, peak: 0.06, wet: 0.3, a: 0.06 }); }
  click() { this._burst({ type: 'white', freq: 3200, q: 4, dur: 0.025, peak: 0.12, wet: 0.05 }); }
  ui(kind = 'tap') { this._tone({ f0: kind === 'back' ? 380 : 620, f1: kind === 'back' ? 300 : 760, type: 'sine', dur: 0.06, peak: 0.05, wet: 0.05 }); }
  beep(ok = true) { this._tone({ f0: ok ? 880 : 220, type: 'square', dur: 0.12, peak: 0.06, wet: 0.2 }); if (ok) this._tone({ f0: 1320, type: 'square', dur: 0.12, peak: 0.05, wet: 0.2, a: 0.1 }); }
  hurt() { this._burst({ type: 'brown', freq: 220, filt: 'lowpass', dur: 0.3, peak: 0.6, wet: 0.2 }); this._tone({ f0: 140, f1: 70, type: 'sawtooth', dur: 0.28, peak: 0.12, wet: 0.2 }); }
  heal() { this._tone({ f0: 440, f1: 880, type: 'sine', dur: 0.5, peak: 0.1, wet: 0.5 }); }
  heart(s = 0.5) { this._tone({ f0: 62, f1: 42, type: 'sine', dur: 0.16, peak: 0.34 * s + 0.06, wet: 0.05 }); setTimeout(() => this._tone({ f0: 56, f1: 38, type: 'sine', dur: 0.14, peak: 0.24 * s + 0.04, wet: 0.05 }), 170); }
  roll() { this._burst({ type: 'white', freq: 400, q: 0.5, dur: 0.35, peak: 0.1, wet: 0.2, a: 0.05 }); }
  flashlight(on) { this._burst({ type: 'white', freq: 2600, q: 5, dur: 0.03, peak: 0.1, wet: 0.05 }); this._tone({ f0: on ? 300 : 220, type: 'square', dur: 0.03, peak: 0.03, wet: 0.05 }); }
  flare() { this._burst({ type: 'white', freq: 3000, q: 0.5, filt: 'highpass', dur: 1.4, peak: 0.12, wet: 0.4, a: 0.1 }); }
  generator(phase) {
    if (phase === 'crank') { for (let i = 0; i < 4; i++) setTimeout(() => this._tone({ f0: 70 + i * 12, f1: 50, type: 'sawtooth', dur: 0.3, peak: 0.2, wet: 0.5 }), i * 420); }
    if (phase === 'start') { this._tone({ f0: 40, f1: 120, type: 'sawtooth', dur: 2.2, peak: 0.3, wet: 0.7, a: 0.4 }); this._burst({ type: 'brown', freq: 200, filt: 'lowpass', dur: 2, peak: 0.5, wet: 0.5 }); }
  }
  alarm(on) {
    if (!this.ctx) return;
    if (on && !this._alarm) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain(); o.type = 'sawtooth'; o.frequency.value = 520; l.frequency.value = 1.1; lg.gain.value = 180; l.connect(lg); lg.connect(o.frequency);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.07, c.currentTime + 0.5); o.connect(f); f.connect(g); this._out(g, { wet: 0.7 }); o.start(); l.start(); this._alarm = { o, l, g };
    } else if (!on && this._alarm) { const { o, l, g } = this._alarm; g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.6); setTimeout(() => { o.stop(); l.stop(); }, 700); this._alarm = null; }
  }
  // ---- gunfire (own = the player's rifle, louder and closer)
  shot(pos = null, own = false) {
    const k = own ? 1 : 0.7;
    this._burst({ type: 'white', freq: 2200, q: 0.6, filt: 'bandpass', dur: 0.09, peak: 0.55 * k, wet: this.zone === 'hall' ? 0.55 : 0.3, pos, a: 0.001 });
    this._burst({ type: 'brown', freq: 260, filt: 'lowpass', dur: 0.2, peak: 0.7 * k, wet: 0.5, pos, a: 0.001 });
    this._tone({ f0: 150, f1: 48, type: 'sine', dur: 0.14, peak: 0.35 * k, wet: 0.3, pos, a: 0.001 });
  }
  mag(stage = 'out') { this._burst({ type: 'white', freq: stage === 'out' ? 1400 : 2400, q: 4, dur: 0.05, peak: 0.22, wet: 0.05 }); this._tone({ f0: stage === 'out' ? 180 : 260, type: 'square', dur: 0.05, peak: 0.05, wet: 0.05 }); }
  dry() { this._burst({ type: 'white', freq: 3400, q: 6, dur: 0.03, peak: 0.18, wet: 0.05 }); }
  hitTick(kill = false) { this._tone({ f0: kill ? 520 : 1500, f1: kill ? 260 : 1100, type: 'triangle', dur: kill ? 0.18 : 0.05, peak: kill ? 0.16 : 0.09, wet: 0.1 }); }
  flesh(pos = null) { this._burst({ type: 'brown', freq: 380, filt: 'lowpass', dur: 0.12, peak: 0.3, wet: 0.2, pos }); }
  whiz(pos = null) { this._tone({ f0: 3200, f1: 1200, type: 'sine', dur: 0.12, peak: 0.05, wet: 0.2, pos, a: 0.002 }); }
  melee() { this._burst({ type: 'white', freq: 700, q: 0.8, dur: 0.12, peak: 0.2, wet: 0.2 }); this._tone({ f0: 120, f1: 70, type: 'sine', dur: 0.1, peak: 0.2, wet: 0.1 }); }
  stinger(pos = null) { [233, 247.5, 277, 311].forEach((f) => this._tone({ f0: f, f1: f * 0.98, type: 'sawtooth', dur: 1.6, peak: 0.07, wet: 0.7, pos, a: 0.02 })); this._burst({ type: 'white', freq: 4000, q: 0.4, filt: 'highpass', dur: 0.5, peak: 0.15, wet: 0.5 }); }
  growl(pos = null, intensity = 1) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = 54; o2.type = 'square'; o2.frequency.value = 81; f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 3; f.frequency.linearRampToValueAtTime(240, c.currentTime + 1.2);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 24; lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency); lfo.start();
    o.connect(f); o2.connect(f); f.connect(g); this._env(g, 0.15, 1.1, 0.3 * intensity); this._out(g, { wet: 0.5, pan: pos ? this._panner(pos) : null });
    o.start(); o2.start(); [o, o2, lfo].forEach((n) => n.stop(c.currentTime + 1.5));
  }
  screech(pos = null) {
    this._tone({ f0: 900, f1: 2300, type: 'sawtooth', dur: 0.9, peak: 0.16, wet: 0.7, pos, a: 0.02 }); this._tone({ f0: 1350, f1: 3100, type: 'square', dur: 0.8, peak: 0.07, wet: 0.7, pos, a: 0.02 });
    this._burst({ type: 'white', freq: 2500, q: 0.6, dur: 0.8, peak: 0.12, wet: 0.5, pos });
  }
  breath(pos) { this._burst({ type: 'brown', freq: 380, q: 1.4, dur: 0.9, peak: 0.12, wet: 0.5, pos, a: 0.3 }); }
  skitter(pos) { for (let i = 0; i < 5; i++) setTimeout(() => this._burst({ type: 'white', freq: 3200 + rand(-400, 400), q: 3, dur: 0.03, peak: 0.07, wet: 0.5, pos }), i * 70); }
  bottle(pos) { [1800, 2700, 3300].forEach((f, i) => this._tone({ f0: f, f1: f * 0.9, type: 'triangle', dur: 0.4, peak: 0.1 / (i + 1), wet: 0.7, pos, a: 0.002 })); this._burst({ type: 'white', freq: 5000, q: 0.5, filt: 'highpass', dur: 0.25, peak: 0.08, wet: 0.7, pos }); }
  radio(on) {
    if (!this.ctx) return;
    if (on) { this._radio = this._src(this.nb.white); const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 1.2; const g = this.ctx.createGain(); g.gain.value = 0.04; this._radio.connect(f); f.connect(g); this._out(g, { wet: 0.1 }); this._radio.start(); this._radioG = g; }
    else if (this._radio) { try { this._radio.stop(); } catch { /* */ } this._radio = null; }
  }
  blip() { this._tone({ f0: 300 + rand(0, 700), type: 'square', dur: 0.05, peak: 0.02, wet: 0.1 }); }
  trainDepart() { this._burst({ type: 'brown', freq: 160, filt: 'lowpass', dur: 5, peak: 0.6, wet: 0.5, a: 2 }); this._tone({ f0: 45, f1: 90, type: 'sawtooth', dur: 5, peak: 0.1, wet: 0.4, a: 2.5 }); }
  brakes() { this._burst({ type: 'white', freq: 3600, q: 1.2, dur: 3.5, peak: 0.12, wet: 0.7, a: 0.4 }); this._tone({ f0: 2400, f1: 900, type: 'sawtooth', dur: 3.4, peak: 0.04, wet: 0.7, a: 0.4 }); }
  speak(text, { rate = 0.92, pitch = 0.9, radio = false } = {}) {
    try { if (!('speechSynthesis' in window)) return; const u = new SpeechSynthesisUtterance(text); u.rate = rate; u.pitch = pitch; u.volume = clamp(this.vol.master * 0.9, 0, 1); speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* optional */ }
  }
}
