/**
 * "Valse du Carrousel": an original 32-bar waltz in F for the music box.
 * The cylinder's pins are placed from this score, so the comb teeth you can
 * see through the window are plucked exactly when each note sounds.
 *
 * notes: [beat, midi, durationBeats, velocity]
 */
const MELODY = [
  // A
  [0, 72, 2], [2, 69, 1],
  [3, 77, 2], [5, 76, 1],
  [6, 76, 1.5], [7.5, 74, 0.5], [8, 72, 1],
  [9, 70, 3],
  [12, 70, 2], [14, 67, 1],
  [15, 76, 2], [17, 74, 1],
  [18, 74, 1.5], [19.5, 72, 0.5], [20, 69, 1],
  [21, 72, 3],
  [24, 74, 2], [26, 77, 1],
  [27, 82, 2], [29, 81, 1],
  [30, 81, 1.5], [31.5, 79, 0.5], [32, 77, 1],
  [33, 74, 3],
  [36, 79, 2], [38, 77, 1],
  [39, 76, 1], [40, 79, 1], [41, 82, 1],
  [42, 81, 2], [44, 76, 1],
  [45, 77, 3],
  // A' (an octave up, with turns)
  [48, 84, 2], [50, 81, 1],
  [51, 89, 2], [53, 88, 1],
  [54, 88, 1], [55, 86, 1], [56, 84, 1],
  [57, 82, 3],
  [60, 82, 1], [61, 79, 1], [62, 76, 1],
  [63, 88, 2], [65, 86, 1],
  [66, 86, 1], [67, 84, 1], [68, 81, 1],
  [69, 84, 3],
  [72, 86, 2], [74, 89, 1],
  [75, 86, 1], [76, 82, 1], [77, 77, 1],
  [78, 81, 1.5], [79.5, 79, 0.5], [80, 77, 1],
  [81, 74, 2], [83, 77, 1],
  [84, 79, 2], [86, 82, 1],
  [87, 81, 1], [88, 79, 1], [89, 76, 1],
  [90, 77, 2], [92, 72, 1],
  [93, 77, 3], [93, 89, 3],
];

const CHORDS = {
  F: [53, [57, 60]],
  C7: [48, [58, 64]],
  Bb: [58, [62, 65]],
  Dm: [50, [57, 62]],
  G7: [55, [59, 65]],
  Gm: [55, [58, 62]],
};
const BARS = ['F', 'F', 'C7', 'C7', 'C7', 'C7', 'F', 'F', 'Bb', 'Bb', 'F', 'Dm', 'G7', 'C7', 'F', 'F'];
const BARS2 = ['F', 'F', 'C7', 'C7', 'C7', 'C7', 'F', 'F', 'Bb', 'Bb', 'F', 'Dm', 'Gm', 'C7', 'F', 'F'];

function build() {
  const notes = MELODY.map(([b, p, d]) => [b, p, d, 0.9]);
  [...BARS, ...BARS2].forEach((name, bar) => {
    const [root, pah] = CHORDS[name];
    const b = bar * 3;
    notes.push([b, root, 1, 0.75]);
    for (const k of [1, 2]) for (const p of pah) notes.push([b + k, p, 0.8, 0.42]);
  });
  notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return notes;
}

export const SCORE = {
  title: 'Valse du Carrousel',
  beatsPerBar: 3,
  length: 96, // beats per cylinder turn
  bpm: 144, // at full spring
  notes: build(),
};

/** distinct pitches, low to high: one comb tooth each */
export const COMB = [...new Set(SCORE.notes.map((n) => n[1]))].sort((a, b) => a - b);
