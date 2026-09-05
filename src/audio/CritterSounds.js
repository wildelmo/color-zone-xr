/**
 * Voices for the Sleepyheads (creatures/Critters.js): snores, squeaks,
 * yawns, thuds, croaks and chirps. Every sound is short, soft and placed in
 * the world (`pos`), built from Audio's `_tone` / `_noise` primitives so this
 * file never touches the audio engine. Nothing here is twinkly or musical
 * apart from the frog's pentatonic croak, which is a croak first.
 */
const CROAK = [130.81, 146.83, 164.81, 196.0, 220.0]; // C3 major pentatonic

/** a soft "hrrr… pff" every few seconds from a sleeper */
export function snore(audio, pos) {
  if (!audio) return;
  audio._noise({ duration: 0.42, freq: 170, sweepTo: 330, q: 3.5, gain: 0.045, reverb: 0.05, pos });
  audio._tone(92, { type: 'triangle', attack: 0.12, decay: 0.32, gain: 0.022, sweepTo: 118, sweepTime: 0.38, reverb: 0.05, pos });
  audio._noise({ duration: 0.3, freq: 950, sweepTo: 380, q: 0.8, gain: 0.016, reverb: 0.05, when: 0.58, pos });
}

/** a tiny rising "mmh?" (teased sleeper, booped bunny) */
export function squeak(audio, pos, pitch = 1) {
  if (!audio) return;
  audio._tone(860 * pitch, { type: 'triangle', attack: 0.008, decay: 0.11, gain: 0.05, sweepTo: 1240 * pitch, sweepTime: 0.09, reverb: 0.15, pos });
  audio._tone(1290 * pitch, { type: 'sine', attack: 0.008, decay: 0.07, gain: 0.012, sweepTo: 1700 * pitch, sweepTime: 0.07, reverb: 0.1, pos });
}

/** dry rustle for a twitch in the grass */
export function rustle(audio, pos) {
  if (!audio) return;
  audio._noise({ duration: 0.07, freq: 2200, sweepTo: 1100, q: 0.9, gain: 0.035, reverb: 0.05, pos });
}

/** waking up: a soft pop, then a yawn that rises and falls */
export function yawn(audio, pos) {
  if (!audio) return;
  audio._tone(230, { type: 'sine', attack: 0.003, decay: 0.16, gain: 0.1, sweepTo: 70, sweepTime: 0.14, reverb: 0.2, pos });
  audio._tone(250, { type: 'triangle', attack: 0.06, decay: 0.5, gain: 0.045, sweepTo: 470, sweepTime: 0.28, reverb: 0.25, when: 0.08, pos });
  audio._tone(460, { type: 'triangle', attack: 0.02, decay: 0.45, gain: 0.038, sweepTo: 230, sweepTime: 0.4, reverb: 0.25, when: 0.4, pos });
  audio._noise({ duration: 0.5, freq: 700, sweepTo: 340, q: 0.7, gain: 0.028, reverb: 0.1, when: 0.3, pos });
}

/** a little body landing on the grass */
export function thud(audio, pos, pitch = 1) {
  if (!audio) return;
  audio._tone(150 * pitch, { type: 'sine', attack: 0.002, decay: 0.08, gain: 0.035, sweepTo: 55 * pitch, sweepTime: 0.07, reverb: 0.1, pos });
  audio._noise({ duration: 0.04, freq: 520, q: 1, gain: 0.018, reverb: 0.05, pos });
}

/** the frog: two raspy pulses on a low pentatonic note */
export function ribbit(audio, pos, note = 0) {
  if (!audio) return;
  const f = CROAK[Math.abs(Math.round(note)) % CROAK.length];
  audio._tone(f, { type: 'sawtooth', attack: 0.015, decay: 0.13, gain: 0.05, sweepTo: f * 0.74, sweepTime: 0.13, reverb: 0.15, pos });
  audio._noise({ duration: 0.14, freq: 420, q: 5, gain: 0.04, reverb: 0.05, pos });
  audio._tone(f * 1.25, { type: 'sawtooth', attack: 0.015, decay: 0.16, gain: 0.045, sweepTo: f * 0.9, sweepTime: 0.15, reverb: 0.15, when: 0.15, pos });
  audio._noise({ duration: 0.16, freq: 520, q: 5, gain: 0.035, reverb: 0.05, when: 0.15, pos });
}

/** the bird: two quick chirps */
export function tweet(audio, pos) {
  if (!audio) return;
  audio._tone(1600, { type: 'sine', attack: 0.004, decay: 0.08, gain: 0.045, sweepTo: 2300, sweepTime: 0.06, reverb: 0.3, pos });
  audio._tone(2100, { type: 'sine', attack: 0.004, decay: 0.1, gain: 0.04, sweepTo: 1500, sweepTime: 0.09, reverb: 0.3, when: 0.13, pos });
}

/** wings beating as a bird takes off */
export function flutter(audio, pos) {
  if (!audio) return;
  for (let i = 0; i < 3; i++) audio._noise({ duration: 0.06, freq: 450, sweepTo: 820, q: 1.2, gain: 0.028, reverb: 0.05, when: i * 0.09, pos });
}

/** a happy double squeak when a critter gets a fresh coat of colour */
export function happy(audio, pos) {
  if (!audio) return;
  audio._tone(700, { type: 'triangle', attack: 0.006, decay: 0.09, gain: 0.045, sweepTo: 1000, sweepTime: 0.08, reverb: 0.15, pos });
  audio._tone(900, { type: 'triangle', attack: 0.006, decay: 0.1, gain: 0.04, sweepTo: 1300, sweepTime: 0.08, reverb: 0.15, when: 0.11, pos });
}
