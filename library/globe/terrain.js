/**
 * The floating island's shape and the town plan, as pure functions so the
 * SDF worker (island rock) and the town builder (houses, walls) agree to the
 * centimetre. Coordinates are island-local: (0,0,0) is the centre of the
 * lowest terrace, y up.
 */
import { G } from './dimensions.js';

export const T = {
  edge: G.edgeR,
  t: G.terrace,
  tr: G.terraceR,
  hill: G.hill,
  wallR: 24.2, // outer town wall
  innerWallR: 16.2, // wall along the top of the first step
  ravineA: 0.55, // angle (rad) of the river ravine
  ravineW: 2.6,
  streams: [2.55, 4.4], // angles of the two small streams/waterfalls
  gateA: 0.55 + Math.PI * 0.5, // main gate
  lanes: [0.55 + Math.PI * 0.5, 0.55 + Math.PI * 1.15, 0.55 + Math.PI * 1.65, 0.55 + Math.PI * 0.1],
};

function hash(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) r += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return r;
}

export function smooth01(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** irregular cliff radius at angle a */
export function edgeR(a) {
  return T.edge + 2.2 * Math.sin(3 * a + 1.1) + 1.2 * Math.sin(7 * a + 0.4) + 0.6 * Math.sin(13 * a);
}

/** angular distance */
export function angDist(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** depth of the river ravine (and streams) cut into the ground at (x, z) */
export function channel(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  let cut = 0;
  // the ravine: from the grotto at the first step out to the cliff
  if (r > T.tr[0] - 1.5) {
    const across = Math.abs(Math.sin(a - T.ravineA)) * r;
    if (Math.cos(a - T.ravineA) > 0) cut = Math.max(cut, (1 - smooth01(T.ravineW * 0.5, T.ravineW * 0.5 + 1.6, across)) * 3.2 * smooth01(T.tr[0] - 1.5, T.tr[0] + 0.5, r));
  }
  // shallow streams to the two small falls
  for (const sa of T.streams) {
    if (r > 19) {
      const across = Math.abs(Math.sin(a - sa)) * r;
      if (Math.cos(a - sa) > 0) cut = Math.max(cut, (1 - smooth01(0.5, 1.4, across)) * 0.7 * smooth01(19, 21, r));
    }
  }
  return cut;
}

/** height of the island's top surface (island-local y) */
export function topHeight(x, z) {
  const hx = x - T.hill[0], hz = z - T.hill[1];
  const rh = Math.hypot(hx, hz);
  let y = T.t[0];
  y += (T.t[1] - T.t[0]) * smooth01(T.tr[0] + 0.8, T.tr[0] - 0.8, rh);
  y += (T.t[2] - T.t[1]) * smooth01(T.tr[1] + 0.8, T.tr[1] - 0.8, rh);
  // the castle crag rises a little in the middle
  y += 1.6 * smooth01(5.5, 0, rh);
  // gentle unevenness
  y += (noise3(x * 0.18, 0, z * 0.18) - 0.5) * 0.5;
  return y - channel(x, z);
}

/** which terrace a point is on: 0, 1 or 2 */
export function terraceOf(x, z) {
  const rh = Math.hypot(x - T.hill[0], z - T.hill[1]);
  return rh < T.tr[1] ? 2 : rh < T.tr[0] ? 1 : 0;
}

/** island underside height (island-local y): a jagged inverted mountain */
export function bottomHeight(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  const e = edgeR(a);
  const k = Math.min(1, r / e);
  let y = -2.5 - 22 * Math.pow(1 - k, 1.4);
  y -= 3.5 * noise3(x * 0.25, 7.3, z * 0.25) + 1.5 * noise3(x * 0.6, 2.1, z * 0.6);
  return y;
}

/** stalactite spikes hanging from the underside: [x, z, length, radius] */
export const SPIKES = (() => {
  const out = [];
  let s = 1;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 20;
    out.push([Math.cos(a) * r, Math.sin(a) * r, 3 + rnd() * 7 * (1 - r / 26), 1 + rnd() * 1.6]);
  }
  return out;
})();

/** the street plan: ring streets on each terrace and lanes climbing between them */
export const STREETS = {
  rings: [
    { r: 20.6, w: 1.7, terrace: 0 },
    { r: 13.2, w: 1.5, terrace: 1 },
  ],
  lanes: T.lanes.map((a) => ({ a, r0: T.tr[1] - 1, r1: T.wallR + 0.5, w: 1.4 })),
};

/** 1 on a cobbled street, 0 elsewhere (soft edge) */
export function streetMask(x, z) {
  const rh = Math.hypot(x - T.hill[0], z - T.hill[1]);
  const r = Math.hypot(x, z);
  let m = 0;
  for (const s of STREETS.rings) m = Math.max(m, 1 - smooth01(s.w * 0.4, s.w * 0.6, Math.abs(rh - s.r)));
  const a = Math.atan2(z - T.hill[1], x - T.hill[0]);
  for (const l of STREETS.lanes) {
    if (rh < l.r0 || r > l.r1) continue;
    if (Math.cos(a - l.a) < 0) continue;
    const across = Math.abs(Math.sin(a - l.a)) * rh;
    m = Math.max(m, 1 - smooth01(l.w * 0.4, l.w * 0.6, across));
  }
  // plaza inside the gate
  const ga = T.gateA;
  const gx = Math.cos(ga) * 21.5 + 0, gz = Math.sin(ga) * 21.5;
  m = Math.max(m, 1 - smooth01(3.0, 3.6, Math.hypot(x - gx, z - gz)));
  return m;
}
