/**
 * Central tuning knobs. Everything visual in Color Zone is generated from
 * these numbers plus a seed, so the whole world can be re-rolled instantly.
 */
export const WORLD = {
  islandRadius: 38, // metres
  mapSize: 100, // paint map covers x/z in [-50, 50]
  mapRes: 1024, // paint map texture resolution
  gridRes: 128, // CPU coverage grid used for gameplay checks
  eyeHeight: 1.6,
  spawnZoneRadius: 2.6, // the little "colour zone" you start inside
  pond: { x: 11, z: -9, radius: 5.2 },
  sunDir: [0.42, 0.68, -0.6],
};

export const PALETTE = [
  { name: 'Cherry', hex: '#ff3b5c' },
  { name: 'Tangerine', hex: '#ff8c2a' },
  { name: 'Sunshine', hex: '#ffd93d' },
  { name: 'Lime', hex: '#a6f542' },
  { name: 'Grass', hex: '#33d872' },
  { name: 'Mint', hex: '#2ee6d6' },
  { name: 'Sky', hex: '#3ec9ff' },
  { name: 'Blueberry', hex: '#4f6dff' },
  { name: 'Grape', hex: '#a05cff' },
  { name: 'Bubblegum', hex: '#ff6ad5' },
  { name: 'Cotton Candy', hex: '#ffb3e6' },
  { name: 'Snow', hex: '#ffffff' },
];

export const BRUSHES = [
  { id: 'glow', name: 'Glow', icon: '✦', desc: 'A ribbon of light' },
  { id: 'rainbow', name: 'Rainbow', icon: '🌈', desc: 'Every colour at once' },
  { id: 'sparkle', name: 'Sparkle', icon: '✨', desc: 'Leaves a trail of stars' },
  { id: 'cotton', name: 'Cotton', icon: '☁', desc: 'Puffy cotton-candy clouds' },
  { id: 'stamp', name: 'Stickers', icon: '★', desc: 'Stars and hearts' },
  { id: 'bubble', name: 'Bubbles', icon: '○', desc: 'Blow bubbles to pop' },
];

export const BRUSH_SIZE = { min: 0.006, max: 0.07, default: 0.02 };

export const MILESTONES = [
  { at: 0.25, id: 'butterflies', title: 'Butterflies!', text: 'The butterflies came to see your colours' },
  { at: 0.5, id: 'rainbow', title: 'A rainbow!', text: 'Half the world is painted' },
  { at: 0.75, id: 'sunshine', title: 'So bright!', text: 'The sun is smiling at you' },
  { at: 0.97, id: 'finale', title: 'You painted the whole world!', text: 'Amazing! Fireworks time!' },
];
