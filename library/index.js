/**
 * The Curio Cabinet catalogue.
 *
 * Each entry lazy-loads its module, so the viewer only downloads and builds
 * what you pick. `load()` resolves to { info, create(ctx, { lod }) }.
 * Entries marked `comingSoon` are shown draped under a dust cloth.
 */
export const CATALOG = [
  {
    id: 'carousel',
    name: 'Le Grand Carrousel',
    tagline: 'Clockwork music-box carousel',
    load: () => import('./carousel/index.js').then((m) => ({ info: m.info, create: m.createCarousel })),
  },
  {
    id: 'globe',
    name: 'Le Royaume de Givre',
    tagline: 'A dragon kingdom in a snow globe',
    load: () => import('./globe/index.js').then((m) => ({ info: m.info, create: m.createGlobe })),
  },
  { id: 'orrery', name: 'Brass Orrery', tagline: 'Planets on nested arms', comingSoon: true },
  { id: 'city', name: 'Clockwork City', tagline: 'A little town that runs itself', comingSoon: true },
  { id: 'lighthouse', name: 'Lighthouse', tagline: 'Waves, gulls and a turning lamp', comingSoon: true },
];
