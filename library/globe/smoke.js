import { GlowPoints } from '../core/glowPoints.js';

/**
 * Wood smoke curling up from the town's chimneys: soft grey puffs that
 * rise, swell, drift with a little breeze and fade. One draw call for all
 * of them. Positions are island-local, like the chimneys.
 */
export function buildSmoke(kit, chimneys, { perChimney = 7 } = {}) {
  const n = chimneys.length * perChimney;
  if (!n) return null;
  const pts = new GlowPoints(kit, n, { additive: false, soft: 1.6, core: 0.0, opacity: 0.5, name: 'town:smoke', renderOrder: 11 });
  pts.mesh.frustumCulled = false;
  const life = 6;
  const seeds = chimneys.map((_, i) => ({ phase: (i * 0.618) % 1, drift: 0.6 + ((i * 37) % 10) / 20 }));
  return {
    mesh: pts.mesh,
    update(t, { night = 0.5, agitation = 0 } = {}) {
      let k = 0;
      // a shaken globe stirs the smoke about
      const swirl = 1 + agitation * 3;
      chimneys.forEach((c, i) => {
        const s = seeds[i];
        for (let j = 0; j < perChimney; j++) {
          const a = ((t / life + s.phase + j / perChimney) % 1 + 1) % 1; // age 0..1
          const rise = a * 4.2;
          const sway = Math.sin(t * 0.7 + i + a * 4) * 0.35 * a * swirl;
          const x = c.x + a * 1.6 * s.drift + sway;
          const z = c.z + a * 0.9 * s.drift + Math.cos(t * 0.5 + i * 2 + a * 3) * 0.3 * a * swirl;
          const g = 0.46 - 0.16 * night; // unlit, so kept dim to sit in the night
          const alpha = Math.min(1, a * 6) * (1 - a) * (1 - a) * 0.9;
          pts.set(k++, x, c.y + rise, z, g, g * 0.99, g * 1.02, 0.5 + a * 1.9, alpha);
        }
      });
      pts.commit(k);
    },
  };
}
