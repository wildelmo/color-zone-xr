/**
 * Procedural sound design with Web Audio — no audio files. A warm ambient pad
 * that brightens as the world fills with colour, pentatonic chimes that
 * follow your brush height (so every painting is a melody), a velocity
 * "whoosh", and playful pops, splats and fanfares. Gentle levels for kids.
 */
const PENTA = [];
{
  // C major pentatonic across three octaves starting at C4
  const base = 261.63;
  const steps = [0, 2, 4, 7, 9];
  for (let o = 0; o < 3; o++) for (const s of steps) PENTA.push(base * Math.pow(2, o + s / 12));
  PENTA.push(base * 8);
}

export class Audio {
  constructor(app) {
    this.app = app;
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.lastNote = 0;
    this.lastBloom = 0;
    this.whooshTarget = 0;
    this.whooshFreq = 800;
    this._motionT = 0;
  }

  /** must be called from a user gesture */
  async resume() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this._build();
        this.ready = true;
      } catch (e) {
        console.warn('Audio unavailable', e);
        return false;
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        /* ignore */
      }
    }
    return this.ctx.state === 'running';
  }

  _build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 4;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // reverb from a generated impulse response
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2);
        lp += (n - lp) * 0.35;
        d[i] = lp * 0.9;
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.42;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    // ambient pad
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 420;
    this.padFilter.Q.value = 0.7;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.master);
    this.padGain.connect(this.reverb);
    this.padOscs = [];
    const chord = [130.81, 196.0, 261.63, 329.63, 392.0];
    chord.forEach((f, i) => {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = i < 2 ? 'triangle' : 'sine';
        o.frequency.value = f;
        o.detune.value = det + (i % 2 ? 2 : -2);
        const g = ctx.createGain();
        g.gain.value = i < 3 ? 0.5 : 0.0;
        o.connect(g);
        g.connect(this.padFilter);
        o.start();
        this.padOscs.push({ o, g, i });
      }
    });
    this.padLfo = ctx.createOscillator();
    this.padLfo.frequency.value = 0.07;
    this.padLfoGain = ctx.createGain();
    this.padLfoGain.gain.value = 140;
    this.padLfo.connect(this.padLfoGain);
    this.padLfoGain.connect(this.padFilter.frequency);
    this.padLfo.start();
    this.padGain.gain.setTargetAtTime(0.11, ctx.currentTime, 2.5);

    // whoosh: looped noise through a bandpass
    const nlen = ctx.sampleRate * 2;
    const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
    this.noiseBuffer = nb;
    this.whoosh = ctx.createBufferSource();
    this.whoosh.buffer = nb;
    this.whoosh.loop = true;
    this.whooshFilter = ctx.createBiquadFilter();
    this.whooshFilter.type = 'bandpass';
    this.whooshFilter.frequency.value = 800;
    this.whooshFilter.Q.value = 1.2;
    this.whooshGain = ctx.createGain();
    this.whooshGain.gain.value = 0;
    this.whoosh.connect(this.whooshFilter);
    this.whooshFilter.connect(this.whooshGain);
    this.whooshGain.connect(this.master);
    this.whoosh.start();
  }

  /** keep the 3D listener on the player's head */
  setListener(pos, quat, fwd, up) {
    if (!this.ready) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.05);
      L.positionY.setTargetAtTime(pos.y, t, 0.05);
      L.positionZ.setTargetAtTime(pos.z, t, 0.05);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.05);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.05);
      L.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      L.upX.setTargetAtTime(up.x, t, 0.05);
      L.upY.setTargetAtTime(up.y, t, 0.05);
      L.upZ.setTargetAtTime(up.z, t, 0.05);
    } else if (L.setPosition) {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** destination for a sound: the master bus, or a panner placed in the world */
  _out(pos) {
    if (!pos) return this.master;
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 1.2;
    p.maxDistance = 80;
    p.rolloffFactor = 1.1;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.master);
    return p;
  }

  /** a gentle burbling fountain, positioned in the world */
  startFountain(pos) {
    if (!this.ready || this.fountainGain) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 2.3;
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg);
    lg.connect(g.gain);
    src.connect(f);
    f.connect(g);
    g.connect(this._out(pos));
    src.start();
    lfo.start();
    g.gain.setTargetAtTime(0.055, ctx.currentTime, 1.5);
    this.fountainGain = g;
  }

  /** the colours draining away: a long falling whoosh with a wistful chord */
  drain(duration = 2.6) {
    this._noise({ duration, freq: 3200, sweepTo: 180, q: 0.9, gain: 0.16, reverb: 0.7 });
    this._tone(220, { type: 'sine', attack: 0.05, decay: duration, gain: 0.08, sweepTo: 55, sweepTime: duration * 0.9, reverb: 0.6 });
    [7, 3, 0].forEach((st, i) => this._tone(329.63 * Math.pow(2, st / 12), { type: 'triangle', attack: 0.02, decay: 1.2, gain: 0.05, reverb: 0.9, when: 0.2 + i * 0.5 }));
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** simple enveloped oscillator voice */
  _tone(freq, { type = 'sine', attack = 0.005, decay = 0.4, gain = 0.2, reverb = 0.5, detune = 0, sweepTo = null, sweepTime = 0.1, when = 0, pos = null } = {}) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t0 + sweepTime);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    o.connect(g);
    g.connect(this._out(pos));
    if (reverb > 0) {
      const rg = ctx.createGain();
      rg.gain.value = reverb;
      g.connect(rg);
      rg.connect(this.reverb);
    }
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
  }

  _noise({ duration = 0.08, freq = 1200, q = 1, gain = 0.2, sweepTo = null, reverb = 0.2, when = 0, type = 'bandpass', pos = null } = {}) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(f);
    f.connect(g);
    g.connect(this._out(pos));
    if (reverb > 0) {
      const rg = ctx.createGain();
      rg.gain.value = reverb;
      g.connect(rg);
      rg.connect(this.reverb);
    }
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  _noteForHeight(y, offset = 0) {
    const t = Math.max(0, Math.min(1, (y - 0.35) / 1.9));
    const i = Math.max(0, Math.min(PENTA.length - 1, Math.floor(t * (PENTA.length - 1)) + offset));
    return PENTA[i];
  }

  /** a chime as the brush travels; pitch follows height */
  paintNote(y, color, brushId) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this.lastNote < 0.07) return;
    this.lastNote = now;
    const f = this._noteForHeight(y, brushId === 'sparkle' ? 5 : brushId === 'cotton' ? -5 : 0);
    if (brushId === 'cotton') {
      this._tone(f, { type: 'sine', attack: 0.03, decay: 0.7, gain: 0.09, reverb: 0.7 });
    } else if (brushId === 'sparkle') {
      this._tone(f, { type: 'sine', attack: 0.003, decay: 0.5, gain: 0.07, reverb: 0.8 });
      this._tone(f * 3.01, { type: 'sine', attack: 0.003, decay: 0.25, gain: 0.025, reverb: 0.8 });
    } else {
      this._tone(f, { type: 'sine', attack: 0.004, decay: 0.45, gain: 0.09, reverb: 0.6 });
      this._tone(f * 2, { type: 'triangle', attack: 0.004, decay: 0.2, gain: 0.02, reverb: 0.6 });
    }
  }

  /** continuous brush whoosh driven by hand speed */
  brushMotion(speed, y) {
    this.whooshTarget = Math.min(0.14, speed * 0.06);
    this.whooshFreq = 500 + Math.min(1, y / 2.2) * 900 + speed * 60;
    this._motionT = 0.12;
  }

  tick(y) {
    this._tone(this._noteForHeight(y, 3), { type: 'square', attack: 0.002, decay: 0.06, gain: 0.02, reverb: 0.3 });
    this._noise({ duration: 0.03, freq: 3000, gain: 0.05 });
  }

  select(t = 0.5) {
    this._tone(700 + t * 700, { type: 'sine', attack: 0.003, decay: 0.12, gain: 0.08, reverb: 0.4 });
    this._tone(1400 + t * 1400, { type: 'sine', attack: 0.003, decay: 0.08, gain: 0.03, reverb: 0.4 });
  }

  undo() {
    this._tone(659.25, { type: 'triangle', attack: 0.004, decay: 0.15, gain: 0.07, reverb: 0.3 });
    this._tone(523.25, { type: 'triangle', attack: 0.004, decay: 0.25, gain: 0.07, reverb: 0.3, when: 0.09 });
  }

  pop(r = 0.1, pos = null) {
    const f = 1500 - Math.min(1, r / 0.25) * 900;
    this._noise({ duration: 0.06, freq: f * 1.5, sweepTo: f * 0.5, q: 1.5, gain: 0.25, reverb: 0.3, pos });
    this._tone(f, { type: 'sine', attack: 0.002, decay: 0.12, gain: 0.12, sweepTo: f * 0.45, sweepTime: 0.1, reverb: 0.5, pos });
    this._tone(this._noteForHeight(1.4, Math.floor(Math.random() * 5)), { type: 'sine', attack: 0.004, decay: 0.5, gain: 0.05, reverb: 0.8, when: 0.03, pos });
  }

  bubbleBlow(v = 1) {
    this._noise({ duration: 0.12, freq: 900, sweepTo: 1600, q: 2, gain: 0.05 * v, reverb: 0.2 });
  }

  dripLand(pos = null) {
    this._tone(900 + Math.random() * 400, { type: 'sine', attack: 0.002, decay: 0.08, gain: 0.03, sweepTo: 400, sweepTime: 0.06, reverb: 0.5, pos });
  }

  conjure() {
    this._tone(300, { type: 'sine', attack: 0.02, decay: 0.3, gain: 0.08, sweepTo: 900, sweepTime: 0.25, reverb: 0.6 });
    this._noise({ duration: 0.25, freq: 2500, sweepTo: 6000, q: 0.8, gain: 0.04 });
  }

  throwWhoosh(v = 0.5) {
    this._noise({ duration: 0.25, freq: 600, sweepTo: 2000, q: 0.9, gain: 0.08 + v * 0.1, reverb: 0.2 });
  }

  splat(speed = 3, pos = null) {
    const v = Math.min(1, speed / 8);
    this._tone(140, { type: 'sine', attack: 0.004, decay: 0.22, gain: 0.25, sweepTo: 45, sweepTime: 0.2, reverb: 0.3, pos });
    this._noise({ duration: 0.28, freq: 900, sweepTo: 250, q: 0.7, gain: 0.22 + v * 0.1, reverb: 0.5, pos });
    for (let i = 0; i < 4; i++) {
      this._tone(this._noteForHeight(0.5 + i * 0.4), { type: 'sine', attack: 0.003, decay: 0.35, gain: 0.05, reverb: 0.8, when: 0.05 + i * 0.05, pos });
    }
  }

  teleport() {
    this._tone(320, { type: 'sine', attack: 0.01, decay: 0.3, gain: 0.08, sweepTo: 1000, sweepTime: 0.2, reverb: 0.7 });
    this._noise({ duration: 0.3, freq: 1200, sweepTo: 4000, q: 1, gain: 0.05, reverb: 0.5 });
  }

  snapTurn() {
    this._noise({ duration: 0.06, freq: 2000, q: 1, gain: 0.04 });
  }

  bloom(pos = null) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBloom < 0.09) return;
    this.lastBloom = now;
    const f = PENTA[8 + Math.floor(Math.random() * 6)];
    this._tone(f, { type: 'sine', attack: 0.003, decay: 0.3, gain: 0.04, reverb: 0.8, pos });
  }

  milestone(level = 0) {
    const notes = [0, 2, 4, 5, 7, 9].map((i) => PENTA[Math.min(PENTA.length - 1, i + level * 2)]);
    notes.forEach((f, i) => {
      this._tone(f, { type: 'sine', attack: 0.004, decay: 0.6, gain: 0.1, reverb: 0.8, when: i * 0.11 });
      this._tone(f * 2, { type: 'triangle', attack: 0.004, decay: 0.3, gain: 0.03, reverb: 0.8, when: i * 0.11 });
    });
  }

  fanfare() {
    const seq = [0, 4, 7, 9, 12, 14, 16, 16];
    seq.forEach((s, i) => {
      const f = 261.63 * Math.pow(2, s / 12);
      this._tone(f, { type: 'triangle', attack: 0.005, decay: 0.5, gain: 0.12, reverb: 0.8, when: i * 0.14 });
      this._tone(f * 1.5, { type: 'sine', attack: 0.005, decay: 0.4, gain: 0.05, reverb: 0.8, when: i * 0.14 + 0.02 });
    });
    [0, 4, 7, 12].forEach((s) => {
      const f = 261.63 * Math.pow(2, s / 12);
      this._tone(f, { type: 'sine', attack: 0.05, decay: 2.2, gain: 0.1, reverb: 0.9, when: seq.length * 0.14 });
    });
  }

  fireworkBoom() {
    this._noise({ duration: 0.5, freq: 400, sweepTo: 80, q: 0.6, gain: 0.25, reverb: 0.8 });
    this._tone(120, { type: 'sine', attack: 0.005, decay: 0.4, gain: 0.2, sweepTo: 40, sweepTime: 0.35, reverb: 0.5 });
    for (let i = 0; i < 6; i++) this._tone(PENTA[6 + Math.floor(Math.random() * 8)], { type: 'sine', attack: 0.003, decay: 0.5, gain: 0.03, reverb: 0.9, when: 0.1 + Math.random() * 0.5 });
  }

  fireworkLaunch() {
    this._noise({ duration: 0.6, freq: 500, sweepTo: 3000, q: 1.5, gain: 0.08, reverb: 0.3 });
  }

  newWorld() {
    this._noise({ duration: 1.2, freq: 300, sweepTo: 3000, q: 0.8, gain: 0.12, reverb: 0.7 });
    [0, 4, 7, 12, 16].forEach((s, i) => this._tone(261.63 * Math.pow(2, s / 12), { type: 'sine', attack: 0.01, decay: 0.8, gain: 0.07, reverb: 0.9, when: 0.3 + i * 0.08 }));
  }

  update(dt) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.app.world.worldColor;
    // brighten the pad as colour returns
    this.padFilter.frequency.setTargetAtTime(380 + t * 1500, ctx.currentTime, 0.5);
    for (const p of this.padOscs) {
      const target = p.i < 3 ? 0.5 : p.i === 3 ? t * 0.45 : Math.max(0, t - 0.5) * 0.7;
      p.g.gain.setTargetAtTime(target, ctx.currentTime, 1.0);
    }
    this._motionT -= dt;
    if (this._motionT <= 0) this.whooshTarget = 0;
    this.whooshGain.gain.setTargetAtTime(this.whooshTarget, ctx.currentTime, 0.04);
    this.whooshFilter.frequency.setTargetAtTime(this.whooshFreq, ctx.currentTime, 0.05);
  }
}
