/**
 * Procedural sound with Web Audio (no audio files): a music-box tine synth
 * that plays whatever the asset's cylinder plucks, positioned in 3D at the
 * toy, plus small mechanical and wooden sounds for assembly and winding.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.noise = null;
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
        console.warn('audio unavailable', e);
        return false;
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {}
    }
    return this.ctx.state === 'running';
  }

  _build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // small warm room reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.reverb.connect(wet).connect(this.master);
    // the toy's position in space
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 0.6;
    this.panner.rolloffFactor = 0.9;
    this.toyBus = ctx.createGain();
    this.toyBus.gain.value = 0.55;
    this.toyBus.connect(this.panner);
    this.panner.connect(this.master);
    this.panner.connect(this.reverb);
    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = 0.35;
    this.uiBus.connect(this.master);
    // shared noise buffer
    const n = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** place the toy and the listener (world space) */
  setPositions(toy, listenerPos, forward, up) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const p = this.panner;
    if (p.positionX) {
      p.positionX.setTargetAtTime(toy.x, t, 0.03);
      p.positionY.setTargetAtTime(toy.y, t, 0.03);
      p.positionZ.setTargetAtTime(toy.z, t, 0.03);
    } else p.setPosition(toy.x, toy.y, toy.z);
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.setTargetAtTime(listenerPos.x, t, 0.03);
      L.positionY.setTargetAtTime(listenerPos.y, t, 0.03);
      L.positionZ.setTargetAtTime(listenerPos.z, t, 0.03);
      L.forwardX.setTargetAtTime(forward.x, t, 0.03);
      L.forwardY.setTargetAtTime(forward.y, t, 0.03);
      L.forwardZ.setTargetAtTime(forward.z, t, 0.03);
      L.upX.setTargetAtTime(up.x, t, 0.03);
      L.upY.setTargetAtTime(up.y, t, 0.03);
      L.upZ.setTargetAtTime(up.z, t, 0.03);
    } else {
      L.setPosition(listenerPos.x, listenerPos.y, listenerPos.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** one music-box tine: fundamental, a bright partial and a metallic ping */
  note(midi, velocity = 0.8, bus = null) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const out = ctx.createGain();
    out.gain.value = velocity * 0.22 * (midi < 60 ? 1.25 : 1);
    out.connect(bus || this.toyBus);
    const decay = Math.max(0.6, 3.2 - (midi - 48) * 0.05);
    const parts = [
      [1, 1, decay],
      [2.0, 0.18, decay * 0.4],
      [5.95, 0.12 * Math.min(1, 900 / f), 0.18],
      [9.2, 0.04, 0.07],
    ];
    for (const [mult, amp, dec] of parts) {
      const fr = f * mult;
      if (fr > 16000) continue;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dec + 0.05);
    }
    // the tiny click of the pin leaving the tooth
    this._noiseBurst(out, t, 0.006, 6000, 0.05);
  }

  _noiseBurst(dest, t, dur, freq, gain, type = 'highpass', q = 0.7) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  _tone(dest, t, freq, freqEnd, dur, gain, type = 'sine') {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd !== freq) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** named effects emitted by assets */
  sfx(name, { pitch = 1, gain = 1 } = {}) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime + 0.005;
    const bus = this.toyBus;
    switch (name) {
      case 'thunk':
        this._tone(bus, t, 150 * pitch, 55 * pitch, 0.25, 0.5 * gain);
        this._noiseBurst(bus, t, 0.08, 900 * pitch, 0.25 * gain, 'lowpass');
        break;
      case 'clop':
        this._tone(bus, t, 900 * pitch, 700 * pitch, 0.06, 0.18 * gain, 'triangle');
        this._noiseBurst(bus, t, 0.04, 1800 * pitch, 0.25 * gain, 'bandpass', 3);
        break;
      case 'clank':
        for (const m of [1, 2.76, 5.4]) this._tone(bus, t, 420 * m * pitch, 420 * m * pitch, 0.5 / m, (0.12 / m) * gain, 'sine');
        this._noiseBurst(bus, t, 0.05, 3000, 0.15 * gain);
        break;
      case 'pop':
        this._tone(bus, t, 300 * pitch, 900 * pitch, 0.12, 0.3 * gain);
        break;
      case 'chime':
        [84, 88, 91, 96, 100].forEach((m, i) => setTimeout(() => this.note(m, 0.7), i * 110));
        break;
      case 'ratchet':
        this._noiseBurst(bus, t, 0.018, 2500 * pitch, 0.5 * gain, 'bandpass', 4);
        this._tone(bus, t, 1800 * pitch, 1500 * pitch, 0.02, 0.08 * gain, 'square');
        break;
      case 'tinkle': {
        // glassy: a few high, quiet music-box pings
        for (let k = 0; k < 3; k++) {
          const m = 88 + Math.floor(Math.random() * 14);
          setTimeout(() => this.note(m, 0.25 * gain), k * 60 + Math.random() * 40);
        }
        break;
      }
      case 'whoosh': {
        const ctx = this.ctx;
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 1.2;
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(1800, t + 0.6);
        f.frequency.exponentialRampToValueAtTime(400, t + 1.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.35 * gain, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
        s.connect(f).connect(g).connect(bus);
        s.start(t, Math.random() * 0.3);
        s.stop(t + 1.4);
        break;
      }
      case 'roar': {
        // a small dragon's growl-and-flame: a falling buzzy tone and a hiss
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220 * pitch, t);
        o.frequency.exponentialRampToValueAtTime(90 * pitch, t + 0.5);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12 * gain, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
        o.connect(lp).connect(g).connect(bus);
        o.start(t);
        o.stop(t + 0.6);
        this._noiseBurst(bus, t + 0.05, 0.6, 2500, 0.18 * gain, 'bandpass', 0.8);
        break;
      }
      case 'puff':
        this._noiseBurst(bus, t, 0.35, 700 * pitch, 0.12 * gain, 'lowpass', 0.7);
        break;
      case 'tick':
        this._noiseBurst(bus, t, 0.012, 3200 * pitch, 0.06 * gain, 'bandpass', 5);
        break;
      default:
        break;
    }
  }

  ui(kind = 'click') {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime + 0.002;
    if (kind === 'hover') this._tone(this.uiBus, t, 1400, 1400, 0.03, 0.05, 'sine');
    else if (kind === 'select') {
      this._tone(this.uiBus, t, 660, 990, 0.12, 0.18, 'triangle');
    } else this._tone(this.uiBus, t, 900, 700, 0.05, 0.16, 'triangle');
  }
}
