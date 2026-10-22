/**
 * Voices for the rail riders (creatures/Riders.js). Everything here is
 * short, positional and caused by something the player built or touched:
 * a squealing "wheee" on the downhills, a squeaky giggle when poked, a
 * "boip" when one pops onto a rail, a "whoop" when it flies off the end.
 * Built from the shared Audio primitives — no files, no loops, no chimes.
 */

/**
 * The downhill squeal: a sine glide with vibrato, pitched by speed.
 * (_tone has no vibrato, so this one voice wires its own LFO; it uses the
 * same guards and the same positional output as the shared primitives.)
 */
export function wheee(audio, pos, speed = 2) {
  if (!audio || !audio.ready || audio.muted || !audio.ctx) return;
  const ctx = audio.ctx;
  const t0 = ctx.currentTime;
  const f0 = 470 + Math.min(4.5, speed) * 95;
  const dur = 0.45;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.045, t0 + 0.04);
  g.gain.setValueAtTime(0.045, t0 + dur * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(audio._out(pos));
  if (audio.reverb) {
    const rg = ctx.createGain();
    rg.gain.value = 0.3;
    g.connect(rg);
    rg.connect(audio.reverb);
  }
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 8.5;
  const depth = ctx.createGain();
  depth.gain.value = f0 * 0.05;
  lfo.connect(depth);
  // fundamental + a quiet octave so it sounds like a tiny voice, not a whistle
  for (const [mul, level, type] of [[1, 1, 'sine'], [2, 0.22, 'triangle']]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0 * mul, t0);
    o.frequency.exponentialRampToValueAtTime(f0 * mul * 1.75, t0 + dur * 0.5);
    o.frequency.exponentialRampToValueAtTime(f0 * mul * 1.4, t0 + dur);
    depth.connect(o.frequency);
    const og = ctx.createGain();
    og.gain.value = level;
    o.connect(og);
    og.connect(g);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  lfo.start(t0);
  lfo.stop(t0 + dur + 0.05);
}

/** poked: a squeaky little "hehehe" (3–4 rising blips with a breathy edge) */
export function giggle(audio, pos) {
  if (!audio) return;
  const n = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const f = 860 * Math.pow(2, (i * 1.6 + Math.random()) / 12);
    const when = i * 0.075;
    audio._tone(f, { type: 'triangle', attack: 0.004, decay: 0.07, gain: 0.035, sweepTo: f * 1.25, sweepTime: 0.05, reverb: 0.25, when, pos });
    audio._noise({ duration: 0.025, freq: 3500, q: 1.2, gain: 0.02, reverb: 0.1, when, pos });
  }
}

/** a rider pops onto its rail: a soft rising "boip" */
export function popIn(audio, pos) {
  if (!audio) return;
  audio._tone(360, { type: 'sine', attack: 0.004, decay: 0.13, gain: 0.05, sweepTo: 1050, sweepTime: 0.1, reverb: 0.4, pos });
  audio._noise({ duration: 0.05, freq: 2200, sweepTo: 5000, q: 1, gain: 0.025, reverb: 0.2, pos });
}

/** flying off the end of the rail: a quick "whoop!" (louder when faster) */
export function whoop(audio, pos, speed = 2) {
  if (!audio) return;
  const v = Math.min(1, speed / 5);
  audio._noise({ duration: 0.22, freq: 600, sweepTo: 2400, q: 1.1, gain: 0.05 + v * 0.04, reverb: 0.3, pos });
  audio._tone(520, { type: 'sine', attack: 0.005, decay: 0.22, gain: 0.04, sweepTo: 1400 + v * 400, sweepTime: 0.2, reverb: 0.4, pos });
}

/** hopping across onto the next rail: a tiny boing */
export function boing(audio, pos) {
  if (!audio) return;
  audio._tone(300, { type: 'triangle', attack: 0.004, decay: 0.14, gain: 0.035, sweepTo: 620, sweepTime: 0.12, reverb: 0.3, pos });
}
