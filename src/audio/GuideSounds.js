/**
 * Sounds for Dot's guiding. Both are short, positional and caused by what
 * the player does; nothing continuous, nothing twinkly.
 *   dart — the little whoosh of Dot zipping off to show you something
 *   tada — a soft two-note "ta-daa" (a toy horn, not a chime) at the place you finished
 */
export function dart(audio, pos) {
  audio._noise({ duration: 0.3, freq: 600, sweepTo: 2400, q: 1.1, gain: 0.05, reverb: 0.25, pos });
}

export function tada(audio, pos, when = 0) {
  // "ta": a short warm note with a puff of air
  audio._noise({ duration: 0.05, freq: 2400, q: 0.7, gain: 0.03, reverb: 0.2, when, pos });
  audio._tone(330, { type: 'triangle', attack: 0.006, decay: 0.15, gain: 0.08, reverb: 0.35, sweepTo: 392, sweepTime: 0.05, when, pos });
  audio._tone(165, { type: 'sine', attack: 0.006, decay: 0.15, gain: 0.05, reverb: 0.3, when, pos });
  // "daa": a fourth up, a touch longer, sliding in like a toy horn
  audio._tone(440, { type: 'triangle', attack: 0.008, decay: 0.36, gain: 0.1, reverb: 0.5, sweepTo: 523, sweepTime: 0.07, when: when + 0.15, pos });
  audio._tone(261, { type: 'sine', attack: 0.008, decay: 0.36, gain: 0.06, reverb: 0.4, when: when + 0.15, pos });
}
