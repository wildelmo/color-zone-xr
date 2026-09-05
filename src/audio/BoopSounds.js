/**
 * Sounds for play/Boops.js. Everything you poke answers with a short,
 * physical noise placed where it happened: grass rustles, flowers plip,
 * mushrooms boing, trees tok and shake their leaves, rocks bonk (deeper for
 * big ones), the fountain clonks, the sign knocks, Dot squeaks. Nothing
 * tonal or musical (no chimes, no keyboard notes) and nothing continuous;
 * every sound is caused by the player and over in a fraction of a second.
 * All functions take the app's Audio and a world position (3D panned).
 */
const rnd = (a, b) => a + Math.random() * (b - a);

/** grass tuft brushed aside: a whisper of filtered noise */
export function rustle(audio, pos, v = 1) {
  audio._noise({ duration: 0.1, freq: rnd(2200, 3000), sweepTo: 1100, q: 0.7, gain: 0.06 * v, reverb: 0.1, pos });
}

/** a flower nudged: a tiny water-drop "plip" (random pitch, 45 ms, no note) */
export function plip(audio, pos, v = 1) {
  const f = rnd(700, 1300);
  audio._tone(f, { type: 'sine', attack: 0.002, decay: 0.045, gain: 0.035 * v, sweepTo: f * 0.5, sweepTime: 0.04, reverb: 0.15, pos });
  audio._noise({ duration: 0.03, freq: 3500, q: 1.2, gain: 0.03 * v, reverb: 0.05, pos });
}

/** deep boing (mushrooms, trampolines): a sine that dives with a wobbling tail */
export function boing(audio, pos, size = 1, v = 1) {
  const f = 190 / Math.max(0.5, size);
  audio._tone(f * 1.6, { type: 'sine', attack: 0.004, decay: 0.24, gain: 0.13 * v, sweepTo: f * 0.45, sweepTime: 0.2, reverb: 0.25, pos });
  audio._tone(f * 1.1, { type: 'triangle', attack: 0.01, decay: 0.16, gain: 0.03 * v, sweepTo: f * 1.4, sweepTime: 0.12, when: 0.06, reverb: 0.2, pos });
  audio._noise({ duration: 0.04, freq: 1200, q: 0.8, gain: 0.04 * v, pos });
}

/** wooden knock (trunks, the signpost): a short resonant tick that dies fast */
export function tok(audio, pos, size = 1, v = 1) {
  const f = 520 / Math.max(0.6, size);
  audio._tone(f, { type: 'triangle', attack: 0.002, decay: 0.07, gain: 0.14 * v, sweepTo: f * 0.55, sweepTime: 0.05, reverb: 0.2, pos });
  audio._noise({ duration: 0.035, freq: 1800, q: 1.1, gain: 0.09 * v, reverb: 0.1, pos });
}

/** a canopy shaking: leaves hiss for a moment */
export function leaves(audio, pos, v = 1) {
  audio._noise({ duration: 0.3, freq: 3400, sweepTo: 1600, q: 0.6, gain: 0.05 * v, reverb: 0.25, pos });
}

/** rock bonk — lower and longer for big rocks */
export function bonk(audio, pos, size = 0.6, v = 1) {
  const f = 300 / (0.45 + size);
  audio._tone(f, { type: 'sine', attack: 0.003, decay: 0.15 + size * 0.1, gain: 0.16 * v, sweepTo: f * 0.55, sweepTime: 0.12, reverb: 0.25, pos });
  audio._noise({ duration: 0.045, freq: 900, q: 0.6, gain: 0.12 * v, reverb: 0.1, pos });
  if (size > 0.7) audio._tone(f * 0.5, { type: 'sine', attack: 0.004, decay: 0.2, gain: 0.08 * v, sweepTo: 40, sweepTime: 0.18, reverb: 0.3, pos });
}

/** stony clonk for the fountain: two inharmonic partials and a chip of noise */
export function clonk(audio, pos, v = 1) {
  audio._tone(430, { type: 'sine', attack: 0.002, decay: 0.16, gain: 0.12 * v, sweepTo: 330, sweepTime: 0.14, reverb: 0.35, pos });
  audio._tone(1130, { type: 'triangle', attack: 0.002, decay: 0.08, gain: 0.04 * v, sweepTo: 900, sweepTime: 0.06, reverb: 0.3, pos });
  audio._noise({ duration: 0.05, freq: 2400, q: 0.9, gain: 0.08 * v, reverb: 0.2, pos });
}

/** Dot's boop: a toy-squeaker chirp (rising) with a tiny puff */
export function squeak(audio, pos, v = 1) {
  const f = rnd(850, 1000);
  audio._tone(f, { type: 'sine', attack: 0.004, decay: 0.09, gain: 0.07 * v, sweepTo: f * 1.65, sweepTime: 0.07, reverb: 0.3, pos });
  audio._noise({ duration: 0.04, freq: 2600, q: 0.7, gain: 0.03 * v, pos });
}

/** a paint ball thwacking into a canopy: soft wet thump */
export function thump(audio, pos, v = 1) {
  audio._tone(160, { type: 'sine', attack: 0.004, decay: 0.14, gain: 0.12 * v, sweepTo: 60, sweepTime: 0.12, reverb: 0.3, pos });
  audio._noise({ duration: 0.12, freq: 700, sweepTo: 300, q: 0.7, gain: 0.08 * v, reverb: 0.3, pos });
}
