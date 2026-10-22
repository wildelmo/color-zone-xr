/**
 * The palette. Every color in the scene comes from here.
 *
 * Values were sampled from reference stills (the stills are not committed):
 *   [WR] The Wind Rises: hillside with parasol
 *   [SA] Spirited Away: inside the sea train
 *   [TR] fan painting of the flooded railway
 *   [SF] summer still: sunflowers and towering cumulus
 *   [IS] painting of the floating castle island
 * Values marked "est." are extrapolated where no still shows that part.
 *
 * Choose a preset with ?palette=<name> in the URL. The default is seaTrain.
 */

// Sea by depression angle in degrees below the horizon. Shared by the presets for now.
const SEA = [
  [0.0, '#9bc1cc'],   // [TR] horizon line
  [0.25, '#5698b3'],  // [TR] reflected cloud bank
  [0.6, '#7dc8f0'],   // [SA] bright band
  [1.5, '#58bae6'],   // [SA]
  [4.0, '#18a4e8'],   // [TR]
  [10.0, '#0d94e3'],  // [TR]
  [22.0, '#0b85c8'],  // [TR]
  [45.0, '#0b7cb9'],  // [TR]
  [90.0, '#11769f'],  // [TR] looking straight down
];

// Train car (Module 6).
const TRAIN = {
  seat: '#962329',      // [SA] lit red velvet
  seatMid: '#741a21',   // [SA]
  seatShadow: '#2e101c',// [SA]
  woodDark: '#4b332f',  // [SA] pillars
  wood: '#63453f',      // [SA]
  woodLight: '#785a4e', // [SA]
  handle: '#e8dcc8',    // est.: cream hand rings
};

export const PALETTES = {
  // Bright cyan-cerulean with cool white clouds: the sea-train ride.
  seaTrain: {
    // Sky by elevation angle in degrees above the horizon.
    sky: [
      [0.0, '#d3eced'],   // [TR] pale mint haze at the horizon
      [1.5, '#b6e5ec'],   // [TR]
      [3.5, '#86d9e7'],   // [TR]
      [6.0, '#5ccfe6'],   // [TR]
      [10.0, '#23c5e4'],  // [TR]
      [18.0, '#12bde5'],  // [TR]
      [32.0, '#01abe2'],  // [WR] main cerulean body
      [55.0, '#01a3dd'],  // [WR]
      [90.0, '#0896d2'],  // est.: slightly deeper at the zenith
    ],
    cloud: {
      light: '#fefefe',   // [SA] sunlit tops
      lit: '#f8fafd',     // [SA]
      shade: '#e7e6f5',   // [SA] lavender-tinted shade
      shade2: '#daddee',  // [SA]
      deep: '#cedaef',    // [SA]
      base: '#a5c9e3',    // [SA] blue-grey underside
      baseDeep: '#89acc2',// [SA]
      bankDeep: '#689fb6',// [TR] shadowed horizon cloud bank
    },
    water: SEA,
    train: TRAIN,
  },

  // Deep teal summer sky with cream-topped towering cumulus.
  summer: {
    sky: [
      [0.0, '#b9dcda'],   // est.: haze
      [2.0, '#72bfca'],   // [IS] near horizon
      [5.0, '#4fb2ca'],   // [IS]
      [10.0, '#078db3'],  // [SF]
      [25.0, '#0885af'],  // [SF]
      [50.0, '#097dab'],  // [SF]
      [90.0, '#0a77a6'],  // [SF] top of frame
    ],
    cloud: {
      light: '#f1eed9',   // [SF] warm cream tops
      lit: '#ecead6',     // [SF]
      shade: '#e2e4d3',   // [SF]
      shade2: '#cfded3',  // [SF]
      deep: '#c0d3cb',    // [SF]
      base: '#8ebac0',    // [SF] teal-grey body shadow
      baseDeep: '#74a9b8',// [SF]
      bankDeep: '#68a4b6',// [SF]
    },
    water: SEA,
    train: TRAIN,
  },

  // Softer cerulean with neutral cream clouds.
  castle: {
    sky: [
      [0.0, '#c4dfdc'],   // est.: haze
      [3.0, '#72bfca'],   // [IS]
      [8.0, '#50b3cc'],   // [IS]
      [15.0, '#2e9bd3'],  // [IS]
      [35.0, '#2a91d2'],  // [IS]
      [90.0, '#2990d2'],  // [IS]
    ],
    cloud: {
      light: '#ede9db',   // [IS]
      lit: '#dde3d9',     // [IS]
      shade: '#c5cdcd',   // [IS]
      shade2: '#bdd2d1',  // [IS]
      deep: '#a6c0c8',    // [IS]
      base: '#9cc4cd',    // [IS]
      baseDeep: '#77aac1',// [IS]
      bankDeep: '#6a7e85',// [IS]
    },
    water: SEA,
    train: TRAIN,
  },
};

const requested = new URLSearchParams(globalThis.location?.search ?? '').get('palette');
export const PALETTE_NAME = requested in PALETTES ? requested : 'seaTrain';
export const PALETTE = PALETTES[PALETTE_NAME];

/** '#rrggbb' -> [r, g, b] in 0..1, still in sRGB (not linearised). */
export function srgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
