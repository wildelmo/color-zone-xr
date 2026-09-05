/**
 * Pond sounds: plops, blubs and splashes for the water toys. All short,
 * positional and watery — no chimes and nothing continuous (the player hated
 * both). Every function takes the app's Audio instance and a world position;
 * the underlying _tone/_noise voices silently no-op until audio is ready.
 */

/** a paint ball hitting the pond: a deep plop under a big splashy whoosh (big ≈ 0.5..1.6) */
export function plop(audio, pos, big = 1) {
  const g = Math.min(1.6, Math.max(0.4, big));
  audio._tone(180, { type: 'sine', attack: 0.004, decay: 0.3, gain: 0.2 * g, sweepTo: 60, sweepTime: 0.26, reverb: 0.45, pos });
  audio._tone(95, { type: 'triangle', attack: 0.006, decay: 0.22, gain: 0.06 * g, sweepTo: 50, sweepTime: 0.2, reverb: 0.3, pos });
  audio._noise({ duration: 0.45, freq: 1800, sweepTo: 220, q: 0.8, gain: 0.14 + 0.1 * g, reverb: 0.6, type: 'lowpass', pos });
  audio._noise({ duration: 0.22, freq: 600, sweepTo: 2600, q: 1.1, gain: 0.07 * g, reverb: 0.4, when: 0.05, pos });
}

/** a koi nibbling at the wand tip: a tiny watery blip */
export function blub(audio, pos) {
  const f = 360 + Math.random() * 180;
  audio._tone(f, { type: 'sine', attack: 0.003, decay: 0.07, gain: 0.035, sweepTo: f * 0.5, sweepTime: 0.06, reverb: 0.3, pos });
  audio._noise({ duration: 0.04, freq: 1400, sweepTo: 500, q: 1.5, gain: 0.02, reverb: 0.2, pos });
}

/** a fish leaving or re-entering the water: a bright splashy hiss with a soft plip (v = loudness 0..1) */
export function leapSplash(audio, pos, v = 1) {
  audio._noise({ duration: 0.24, freq: 2400, sweepTo: 500, q: 1.0, gain: 0.08 * v, reverb: 0.5, pos });
  audio._tone(260, { type: 'sine', attack: 0.004, decay: 0.12, gain: 0.045 * v, sweepTo: 120, sweepTime: 0.1, reverb: 0.4, pos });
}

/** the fountain gulping a colour: a rising watery gloop that gets fuller with the level (0..1) */
export function gulp(audio, pos, level = 0, isNew = true) {
  const f0 = 90 + level * 50;
  audio._tone(f0, { type: 'sine', attack: 0.01, decay: 0.32, gain: isNew ? 0.1 : 0.05, sweepTo: f0 * (2.6 + level), sweepTime: 0.28, reverb: 0.5, pos });
  audio._noise({ duration: 0.5, freq: 500, sweepTo: 2800 + level * 2000, q: 1.3, gain: 0.04 + level * 0.03, reverb: 0.6, when: 0.04, pos });
  if (isNew) audio._noise({ duration: 0.35, freq: 3000, sweepTo: 900, q: 0.9, gain: 0.05, reverb: 0.6, when: 0.25, pos });
}

/** the brush dipping colour into the water: a small plip and a fizz */
export function ripple(audio, pos) {
  audio._tone(420, { type: 'sine', attack: 0.003, decay: 0.09, gain: 0.04, sweepTo: 180, sweepTime: 0.08, reverb: 0.4, pos });
  audio._noise({ duration: 0.16, freq: 1600, sweepTo: 700, q: 1.2, gain: 0.035, reverb: 0.4, pos });
}
