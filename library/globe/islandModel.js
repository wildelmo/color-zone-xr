/**
 * The globe's rock as SDF layers (pure JS, meshed in the sdf worker):
 *   island  the floating island (island-local coordinates)
 *   floor   the snowy rock floor inside the globe (asset coordinates)
 *   base    the wild basalt base cupping the glass (asset coordinates)
 * plus anchor points for crystals.
 */
import { G } from './dimensions.js';
import { T, edgeR, topHeight, bottomHeight, channel, streetMask, noise3, smooth01, SPIKES } from './terrain.js';
import { smin, smax, roundCone, hitSurface } from '../core/sdf.js';

const spikes = SPIKES.map(([x, z, len, rad]) => {
  const y0 = bottomHeight(x, z) + 1.2;
  return roundCone([x, y0, z], [x + (z > 0 ? 0.6 : -0.6), y0 - len, z * 1.02], rad, 0.08);
});

function islandRaw(x, y, z) {
  const r = Math.hypot(x, z);
  if (r > T.edge + 6) return r - T.edge - 4;
  const a = Math.atan2(z, x);
  const crag = 0.9 * (noise3(x * 0.32, y * 0.32, z * 0.32) - 0.5) + 0.4 * (noise3(x * 0.9, y * 0.9, z * 0.9) - 0.5);
  const dSide = r - edgeR(a) - crag;
  const top = topHeight(x, z);
  const dTop = (y - top) * 0.8;
  const dBot = (bottomHeight(x, z) - y) * 0.6;
  let d = smax(smax(dTop, dSide, 0.6), dBot, 1.6);
  if (y < -2) for (const s of spikes) d = smin(d, s(x, y, z), 1.2);
  return d;
}

function islandColor(x, y, z) {
  const top = topHeight(x, z);
  const onTop = smooth01(top - 0.9, top - 0.25, y);
  // rock: blue-grey with darker strata and frosty patches (a soft ramp, not a
  // threshold: a step from one vertex to the next shows as speckle)
  const strata = 0.82 + 0.18 * Math.sin(y * 1.7 + noise3(x * 0.2, y * 0.2, z * 0.2) * 4);
  const speck = 1 + 0.25 * smooth01(0.7, 0.86, noise3(x * 2.1, y * 2.1, z * 2.1));
  const under = smooth01(-2, -12, y);
  let rr = 0.34 * strata * speck * (1 - under * 0.35);
  let gg = 0.36 * strata * speck * (1 - under * 0.32);
  let bb = 0.42 * strata * speck * (1 - under * 0.25);
  // snow on top, cobbles on the streets, dark wet rock in the river bed
  const street = streetMask(x, z);
  const wet = smooth01(0.3, 1.2, channel(x, z));
  const snow = onTop * (1 - street * 0.85) * (1 - wet);
  rr = rr * (1 - snow) + 0.93 * snow;
  gg = gg * (1 - snow) + 0.95 * snow;
  bb = bb * (1 - snow) + 1.0 * snow;
  const cob = onTop * street * (1 - wet);
  const cn = 0.85 + 0.3 * noise3(x * 3, 0, z * 3);
  rr = rr * (1 - cob) + 0.5 * cn * cob;
  gg = gg * (1 - cob) + 0.46 * cn * cob;
  bb = bb * (1 - cob) + 0.44 * cn * cob;
  return [rr, gg, bb];
}

// ------------------------------------------------------------------ floor
const FC = G.globeY;
function floorRaw(x, y, z) {
  const r = Math.hypot(x, z);
  const drift = 1.6 * noise3(x * 0.12, 0, z * 0.12) + 0.6 * noise3(x * 0.4, 3, z * 0.4) + 2.2 * smooth01(G.floorR - 8, G.floorR, r);
  const dTop = (y - (G.floorY + drift)) * 0.8;
  const dIn = Math.hypot(x, y - FC, z) - (G.globeR - 0.35);
  return smax(smax(dTop, dIn, 0.8), G.floorY - 4 - y, 0.5);
}
function floorColor(x, y, z) {
  // snow, with rock showing through softly where it lies thin: a smooth blend at
  // a scale well above the mesh's cells (1.2 in the hero, 5.5 on the shelf),
  // never a hard threshold, which drew grey blotches with stepped edges
  const n = 0.75 * noise3(x * 0.3, y * 0.3, z * 0.3) + 0.25 * noise3(x * 0.11, 7, z * 0.11);
  const t = 0.55 * smooth01(0.56, 0.8, n);
  return [0.9 + (0.36 - 0.9) * t, 0.93 + (0.38 - 0.93) * t, 0.98 + (0.44 - 0.98) * t];
}

// ------------------------------------------------------------------- base
// obsidian claws curling up around the glass
const CLAWS = Array.from({ length: 7 }, (_, i) => {
  const a = (i / 7) * Math.PI * 2 + 0.35;
  const c = Math.cos(a), s = Math.sin(a);
  const r0 = G.baseR - 6, r1 = 47.5, r2 = 49.5;
  return [
    roundCone([c * r0, 12, s * r0], [c * (r1 - 1), 30, s * (r1 - 1)], 5.5, 3.2),
    roundCone([c * (r1 - 1), 30, s * (r1 - 1)], [c * r2 + -s * 3, 46 + (i % 3) * 4, s * r2 + c * 3], 3.2, 0.25),
  ];
}).flat();
function baseRaw(x, y, z) {
  const r = Math.hypot(x, z);
  const t = Math.min(1, Math.max(0, y / G.rimY));
  const R = G.baseR * (1 - t) + (G.floorR + 4.5) * t - 4 * Math.sin(t * Math.PI) * 0.0;
  const crag = 2.4 * (noise3(x * 0.16, y * 0.16, z * 0.16) - 0.5) + 1.0 * (noise3(x * 0.5, y * 0.5, z * 0.5) - 0.5);
  // jagged rim: rock fingers reaching up around the glass
  const a = Math.atan2(z, x);
  const fingers = Math.max(0, Math.sin(a * 7 + 0.7)) * 3.2 + Math.max(0, Math.sin(a * 11 + 2.1)) * 1.6;
  let d = smax(r - R - crag, y - (G.rimY + fingers * smooth01(G.floorR - 2, G.floorR + 6, r)), 1.5);
  d = smax(d, -y, 0.5);
  if (y > 8) for (const c of CLAWS) d = smin(d, c(x, y, z) + crag * 0.35, 2.5);
  // carve out room for the glass
  d = smax(d, -(Math.hypot(x, y - G.globeY, z) - (G.globeR + 0.25)), 0.6);
  return d;
}
function baseColor(x, y, z) {
  // near-black obsidian with faint blue sheen and frosted flecks
  const n = noise3(x * 0.4, y * 0.4, z * 0.4);
  const fleck = noise3(x * 3, y * 3, z * 3) > 0.84 ? 0.18 : 0;
  const k = 0.022 + 0.03 * n + fleck;
  return [k * 0.9, k, k * 1.35];
}

export const layers = {
  island: { sdf: islandRaw, bounds: [-T.edge - 5, -32, -T.edge - 5, T.edge + 5, 11, T.edge + 5], color: islandColor },
  floor: { sdf: floorRaw, bounds: [-G.floorR - 1, G.floorY - 4.5, -G.floorR - 1, G.floorR + 1, G.floorY + 6, G.floorR + 1], color: floorColor },
  base: { sdf: baseRaw, bounds: [-G.baseR - 9, -1, -G.baseR - 9, G.baseR + 9, 58, G.baseR + 9], color: baseColor },
};

/** crystal anchors: points on the base, the inner floor and the island underside */
export function details() {
  const out = { base: [], floor: [], under: [], key: null };
  let s = 7;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  // clusters on the base's flanks (cast rays inward from outside)
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.2;
    const y = 4 + rnd() * (G.rimY - 6);
    const p = hitSurface(baseRaw, [Math.cos(a) * (G.baseR + 8), y, Math.sin(a) * (G.baseR + 8)], [-Math.cos(a), 0, -Math.sin(a)], 0, 30, 0.25);
    if (p) out.base.push({ p, n: [Math.cos(a), 0.35 + rnd() * 0.4, Math.sin(a)], size: 3.5 + rnd() * 5.5 });
  }
  // the key crystal: a big shard on the front (+z)
  const kp = hitSurface(baseRaw, [0.0, 17, G.baseR + 8], [0, 0, -1], 0, 30, 0.2);
  if (kp) out.key = { p: kp, n: [0, 0.45, 1], size: 10 };
  // inside on the floor, peeking out of the snow
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, r = 8 + rnd() * (G.floorR - 12);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const p = hitSurface(floorRaw, [x, G.floorY + 10, z], [0, -1, 0], 0, 20, 0.2);
    if (p) out.floor.push({ p, n: [rnd() - 0.5, 1, rnd() - 0.5], size: 1.4 + rnd() * 2.4 });
  }
  // glowing crystals under the island (island-local)
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 18;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const p = hitSurface(islandRaw, [x, -40, z], [0, 1, 0], 0, 40, 0.25);
    if (p) out.under.push({ p, n: [rnd() - 0.5, -1, rnd() - 0.5], size: 0.9 + rnd() * 1.6 });
  }
  return out;
}

export { islandRaw, T };
