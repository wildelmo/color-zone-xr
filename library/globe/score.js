/**
 * "Berceuse du Givre": an original lullaby in A minor for the globe's music
 * box, slow 3/4. notes: [beat, midi, durationBeats, velocity]
 */
const MELODY = [
  [0, 76, 2], [2, 72, 1],
  [3, 74, 2], [5, 71, 1],
  [6, 72, 1.5], [7.5, 69, 0.5], [8, 71, 1],
  [9, 69, 3],
  [12, 72, 2], [14, 76, 1],
  [15, 79, 2], [17, 77, 1],
  [18, 76, 1], [19, 74, 1], [20, 72, 1],
  [21, 74, 3],
  [24, 76, 2], [26, 81, 1],
  [27, 79, 2], [29, 76, 1],
  [30, 77, 1.5], [31.5, 76, 0.5], [32, 74, 1],
  [33, 72, 3],
  [36, 71, 2], [38, 72, 1],
  [39, 74, 1], [40, 71, 1], [41, 68, 1],
  [42, 69, 3],
  [45, 81, 3], [45, 69, 3],
];
const CHORDS = { Am: [45, [57, 60, 64]], F: [41, [57, 60, 65]], C: [48, [55, 60, 64]], G: [43, [55, 59, 62]], E: [40, [56, 59, 64]], Dm: [50, [57, 62, 65]] };
const BARS = ['Am', 'G', 'F', 'E', 'Am', 'C', 'G', 'G', 'F', 'C', 'Dm', 'Am', 'Dm', 'E', 'Am', 'Am'];

function build() {
  const notes = MELODY.map(([b, p, d]) => [b, p, d, 0.85]);
  BARS.forEach((name, bar) => {
    const [root, arp] = CHORDS[name];
    const b = bar * 3;
    notes.push([b, root + 12, 1, 0.55]);
    notes.push([b + 1, arp[0] + 12, 0.8, 0.35]);
    notes.push([b + 1.5, arp[1] + 12, 0.8, 0.3]);
    notes.push([b + 2, arp[2] + 12, 0.8, 0.32]);
  });
  notes.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return notes;
}

export const SCORE = { title: 'Berceuse du Givre', length: 48, bpm: 84, notes: build() };
