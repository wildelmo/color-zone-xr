/**
 * Sounds for playing catch with Dot. All short, positional and percussive:
 * a soft "thup" when a ball lands in a hand (or in Dot), a breathy whoosh
 * when Dot lobs it back, a deep boom under a rally ball's big final splat
 * and a tiny two-note "ta-da" for a rally milestone. Nothing continuous,
 * nothing chime-like. Every function is a no-op until audio is ready.
 */

/** a ball lands in a hand / in Dot: a soft, low "thup" (bigger balls thump lower) */
export function thup(audio, pos, charge = 0) {
  if (!audio) return;
  const k = Math.min(1, charge / 6);
  audio._noise({ duration: 0.05 + k * 0.03, freq: 420 - k * 180, sweepTo: 140, q: 1.1, gain: 0.2 + k * 0.08, reverb: 0.15, pos });
  audio._tone(160 - k * 50, { type: 'sine', attack: 0.003, decay: 0.09 + k * 0.05, gain: 0.12 + k * 0.06, sweepTo: 60, sweepTime: 0.08, reverb: 0.2, pos });
}

/** Dot lobs the ball back: a breathy little whoosh from where Dot is */
export function lobWhoosh(audio, pos) {
  if (!audio) return;
  audio._noise({ duration: 0.28, freq: 450, sweepTo: 1400, q: 0.8, gain: 0.06, reverb: 0.3, pos });
}

/** a rally ball finally lands: an extra deep boom under the normal splat */
export function bigSplat(audio, pos, catches = 1) {
  if (!audio) return;
  const k = Math.min(1, catches / 6);
  audio._tone(95 - k * 25, { type: 'sine', attack: 0.004, decay: 0.35 + k * 0.25, gain: 0.2 + k * 0.1, sweepTo: 32, sweepTime: 0.3, reverb: 0.4, pos });
  audio._noise({ duration: 0.35 + k * 0.2, freq: 500, sweepTo: 120, q: 0.6, gain: 0.12 + k * 0.08, reverb: 0.5, pos });
}

/** three catches in a row: a confetti pop and a quick, soft two-note "ta-da" */
export function rallyTada(audio, pos) {
  if (!audio) return;
  audio._noise({ duration: 0.08, freq: 1800, sweepTo: 600, q: 0.9, gain: 0.12, reverb: 0.3, pos });
  audio._tone(392, { type: 'triangle', attack: 0.01, decay: 0.16, gain: 0.07, reverb: 0.4, pos });
  audio._tone(523.25, { type: 'triangle', attack: 0.01, decay: 0.28, gain: 0.07, reverb: 0.5, when: 0.13, pos });
}
