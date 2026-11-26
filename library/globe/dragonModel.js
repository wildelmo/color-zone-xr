/**
 * A little toy dragon, sculpted as signed distance fields (pure JS, meshed
 * in the sdf worker). Toy proportions — big head, big eyes, plump body — but
 * carved detail everywhere: brow ridges, nostrils, fangs, cheek spikes,
 * curling horns, a ridged belly, a crest of spines from head to spade tail.
 *
 * Local axes: +x forward, +y up, +z left. Units: ~1 = 1/3 of the dragon's
 * size in the globe (the globe scales it). Wings are built separately in JS
 * (dragons.js) so they can flap.
 */
import { smin, smax, sphere, ellipsoid, roundCone, chain, catmull, smoothstep } from '../core/sdf.js';

// spine: tail tip -> hips -> chest -> neck -> head (used for the belly mask,
// the dorsal spines and the belly plates)
const SPINE = catmull(
  [
    [-2.3, 0.12, 0],
    [-1.95, -0.04, 0.08],
    [-1.5, -0.1, 0.1],
    [-1.05, 0.0, 0.04],
    [-0.6, 0.06, 0],
    [0.0, 0.04, 0],
    [0.45, 0.08, 0],
    [0.78, 0.33, 0],
    [0.95, 0.58, 0],
    [1.12, 0.74, 0],
    [1.3, 0.8, 0],
  ],
  4,
);
const SPINE_R = (t) => {
  // body radius along the spine (t: 0 tail tip .. 1 head)
  const k = [
    [0, 0.03],
    [0.12, 0.08],
    [0.28, 0.14],
    [0.42, 0.24],
    [0.55, 0.34],
    [0.66, 0.33],
    [0.74, 0.22],
    [0.84, 0.16],
    [0.92, 0.15],
    [1, 0.18],
  ];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
      return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * u;
    }
  }
  return 0.18;
};

/** nearest point on the spine: { t, d (offset vector), tan } */
function spineFrame(x, y, z) {
  let best = Infinity, bi = 0, bu = 0;
  for (let i = 0; i < SPINE.length - 1; i++) {
    const a = SPINE[i], b = SPINE[i + 1];
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const l2 = abx * abx + aby * aby + abz * abz;
    let u = ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / l2;
    u = Math.max(0, Math.min(1, u));
    const px = a[0] + abx * u - x, py = a[1] + aby * u - y, pz = a[2] + abz * u - z;
    const d2 = px * px + py * py + pz * pz;
    if (d2 < best) {
      best = d2;
      bi = i;
      bu = u;
    }
  }
  const a = SPINE[bi], b = SPINE[bi + 1];
  const tx = b[0] - a[0], ty = b[1] - a[1];
  const tl = Math.hypot(tx, ty) || 1;
  const cx = a[0] + (b[0] - a[0]) * bu, cy = a[1] + (b[1] - a[1]) * bu, cz = a[2] + (b[2] - a[2]) * bu;
  return { t: (bi + bu) / (SPINE.length - 1), dx: x - cx, dy: y - cy, dz: z - cz, tx: tx / tl, ty: ty / tl };
}

// ---------------------------------------------------------------- anatomy
const chest = ellipsoid(0.32, 0.03, 0, 0.4, 0.36, 0.32);
const belly = ellipsoid(-0.05, -0.02, 0, 0.5, 0.33, 0.33);
const hips = ellipsoid(-0.5, 0.04, 0, 0.36, 0.3, 0.28);
const neck = chain([[0.45, 0.1, 0], [0.78, 0.34, 0], [0.96, 0.6, 0], [1.12, 0.74, 0]], [0.24, 0.17, 0.145, 0.14], 0.04, 3);
const tail = chain([[-0.7, 0.05, 0], [-1.05, 0.0, 0.04], [-1.5, -0.1, 0.1], [-1.95, -0.04, 0.08], [-2.28, 0.11, 0]], [0.24, 0.16, 0.1, 0.06, 0.03], 0.03, 4);
const spade = ellipsoid(-2.38, 0.13, 0, 0.17, 0.035, 0.13);
const spadeTip = roundCone([-2.36, 0.13, 0], [-2.6, 0.15, 0], 0.06, 0.008);

const skull = ellipsoid(1.24, 0.81, 0, 0.27, 0.23, 0.22);
const snout = roundCone([1.32, 0.76, 0], [1.66, 0.69, 0], 0.145, 0.095);
const jaw = roundCone([1.24, 0.67, 0], [1.6, 0.62, 0], 0.115, 0.07);
const browR = ellipsoid(1.34, 0.9, 0.1, 0.11, 0.05, 0.06);
const browL = ellipsoid(1.34, 0.9, -0.1, 0.11, 0.05, 0.06);
const cheekR = ellipsoid(1.18, 0.7, 0.14, 0.11, 0.08, 0.06);
const cheekL = ellipsoid(1.18, 0.7, -0.14, 0.11, 0.08, 0.06);
const nostrilBumpR = sphere(1.64, 0.735, 0.05, 0.038);
const nostrilBumpL = sphere(1.64, 0.735, -0.05, 0.038);
const nostrilR = sphere(1.68, 0.74, 0.05, 0.018);
const nostrilL = sphere(1.68, 0.74, -0.05, 0.018);
const mouth = roundCone([1.7, 0.655, 0], [1.22, 0.69, 0], 0.016, 0.01);
const socketR = sphere(1.35, 0.835, 0.15, 0.07);
const socketL = sphere(1.35, 0.835, -0.15, 0.07);

const LEGS = {
  fr: [[0.32, -0.16, 0.2], [0.46, -0.38, 0.25], [0.64, -0.42, 0.23]],
  fl: [[0.32, -0.16, -0.2], [0.44, -0.36, -0.25], [0.6, -0.44, -0.23]],
  hr: [[-0.48, -0.14, 0.22], [-0.52, -0.38, 0.26], [-0.78, -0.46, 0.24]],
  hl: [[-0.48, -0.14, -0.22], [-0.5, -0.36, -0.26], [-0.76, -0.48, -0.24]],
};
const legs = Object.entries(LEGS).map(([k, p]) => chain(p, k[0] === 'f' ? [0.1, 0.075, 0.06] : [0.12, 0.08, 0.065], 0.03, 3));
const thighR = ellipsoid(-0.5, -0.12, 0.2, 0.22, 0.22, 0.13);
const thighL = ellipsoid(-0.5, -0.12, -0.2, 0.22, 0.22, 0.13);
const paws = Object.values(LEGS).map((p) => sphere(...p[2], 0.075));

function bodyRaw(x, y, z) {
  let d = smin(chest(x, y, z), belly(x, y, z), 0.18);
  d = smin(d, hips(x, y, z), 0.18);
  if (x > 0.3) d = smin(d, neck(x, y, z), 0.1);
  if (x < -0.4) {
    d = smin(d, tail(x, y, z), 0.12);
    if (x < -2.1) {
      d = smin(d, spade(x, y, z), 0.05);
      d = smin(d, spadeTip(x, y, z), 0.03);
    }
  }
  if (x > 0.95 && y > 0.45) {
    let h = smin(skull(x, y, z), snout(x, y, z), 0.1);
    h = smin(h, jaw(x, y, z), 0.06);
    h = smin(h, browR(x, y, z), 0.04);
    h = smin(h, browL(x, y, z), 0.04);
    h = smin(h, cheekR(x, y, z), 0.05);
    h = smin(h, cheekL(x, y, z), 0.05);
    h = smin(h, nostrilBumpR(x, y, z), 0.03);
    h = smin(h, nostrilBumpL(x, y, z), 0.03);
    h = smax(h, -nostrilR(x, y, z), 0.012);
    h = smax(h, -nostrilL(x, y, z), 0.012);
    h = smax(h, -mouth(x, y, z), 0.01);
    h = smax(h, -socketR(x, y, z), 0.02);
    h = smax(h, -socketL(x, y, z), 0.02);
    d = smin(d, h, 0.08);
  }
  if (y < 0.05 && x > -0.9 && x < 0.8) {
    for (const l of legs) d = smin(d, l(x, y, z), 0.06);
    d = smin(d, thighR(x, y, z), 0.08);
    d = smin(d, thighL(x, y, z), 0.08);
    for (const p of paws) d = smin(d, p(x, y, z), 0.03);
  }
  // ridged belly plates: shallow grooves across the underside
  if (d < 0.05) {
    const f = spineFrame(x, y, z);
    const down = (f.dx * f.ty - f.dy * f.tx) / (SPINE_R(f.t) + 1e-3); // + toward the belly side
    const w = smoothstep(0.35, 0.8, down) * smoothstep(0.05, 0.2, f.t);
    if (w > 0) d += w * 0.012 * (0.5 + 0.5 * Math.cos(f.t * Math.PI * 2 * 26));
  }
  return d;
}

// ------------------------------------------------------- horns, claws, spines
const horns = [1, -1].map((s) =>
  chain([[1.18, 0.93, 0.1 * s], [1.07, 1.06, 0.15 * s], [0.94, 1.12, 0.19 * s], [0.84, 1.08, 0.21 * s], [0.8, 1.0, 0.2 * s]], [0.065, 0.05, 0.035, 0.02, 0.008], 0.01, 3),
);
const cheekSpikes = [1, -1].flatMap((s) => [
  roundCone([1.12, 0.7, 0.17 * s], [0.95, 0.74, 0.24 * s], 0.035, 0.006),
  roundCone([1.14, 0.64, 0.15 * s], [0.98, 0.6, 0.22 * s], 0.03, 0.006),
]);
const fangs = [1, -1].map((s) => roundCone([1.6, 0.66, 0.045 * s], [1.6, 0.6, 0.05 * s], 0.014, 0.003));
const claws = Object.values(LEGS).flatMap((p) => {
  const [x, y, z] = p[2];
  return [-1, 0, 1].map((k) => roundCone([x + 0.04, y - 0.02, z + k * 0.035], [x + 0.11, y - 0.07, z + k * 0.045], 0.018, 0.004));
});
// dorsal spines along the spine, tallest over the shoulders
const SPIKES = [];
for (let i = 3; i < SPINE.length - 3; i += 2) {
  const t = i / (SPINE.length - 1);
  const p = SPINE[i];
  const r = SPINE_R(t);
  const a = SPINE[i - 1], b = SPINE[i + 1];
  const tx = b[0] - a[0], ty = b[1] - a[1];
  const tl = Math.hypot(tx, ty) || 1;
  const nx = -ty / tl, ny = tx / tl; // up-ish normal
  const h = 0.05 + 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (t > 0.88 ? 0.5 : 1);
  const base = [p[0] + nx * r * 0.82, p[1] + ny * r * 0.82, p[2]];
  const tip = [base[0] + nx * h - (tx / tl) * h * 0.55, base[1] + ny * h - (ty / tl) * h * 0.55, p[2]];
  SPIKES.push(roundCone(base, tip, Math.max(0.018, h * 0.32), 0.004));
}

function hornRaw(x, y, z) {
  let d = 1;
  if (x > 0.7 && y > 0.5) {
    for (const h of horns) d = Math.min(d, h(x, y, z));
    for (const c of cheekSpikes) d = Math.min(d, c(x, y, z));
    for (const f of fangs) d = Math.min(d, f(x, y, z));
  }
  if (y < -0.3) for (const c of claws) d = Math.min(d, c(x, y, z));
  return d;
}

function spikesRaw(x, y, z) {
  if (Math.abs(z) > 0.12) return 0.2;
  let d = 1;
  for (const s of SPIKES) d = Math.min(d, s(x, y, z));
  return d;
}

/** signed distance to the painted belly region (negative = belly colour) */
function bellyRegion(x, y, z) {
  const f = spineFrame(x, y, z);
  const r = SPINE_R(f.t) + 1e-3;
  const down = (f.dx * f.ty - f.dy * f.tx) / r; // ~1 at the very bottom
  const radial = Math.hypot(f.dx, f.dy, f.dz) / r; // > ~1.15 means a leg, not the body
  // the lower part of the body, fading out at the tail tip and under the chin
  const taper = smoothstep(0.03, 0.12, f.t) * (1 - smoothstep(0.9, 0.96, f.t));
  return (0.55 - down) * r + (1 - taper) * 0.12 + Math.max(0, radial - 1.0) * 1.2;
}

// cheap 3d value noise for mottled paint
function hash(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) r += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return r;
}

function bodyColor(x, y, z) {
  // darker along the back with mottled spots, lighter flanks: airbrushed toy paint
  const f = spineFrame(x, y, z);
  const up = -(f.dx * f.ty - f.dy * f.tx) / (SPINE_R(f.t) + 1e-3);
  const back = smoothstep(0.1, 0.85, up);
  const spots = smoothstep(0.55, 0.75, noise(x * 7, y * 7, z * 7)) * smoothstep(-0.2, 0.4, up);
  const k = (1 - 0.32 * back) * (1 - 0.25 * spots);
  return [k, k, k];
}

const B = [-2.7, -0.62, -0.42, 1.8, 1.25, 0.42];
export const layers = {
  body: { sdf: bodyRaw, bounds: B, color: bodyColor, attributes: { paint: bellyRegion } },
  horns: { sdf: hornRaw, bounds: [-0.9, -0.62, -0.32, 1.75, 1.2, 0.32] },
  spikes: { sdf: spikesRaw, bounds: [-2.4, -0.2, -0.12, 1.4, 1.2, 0.12] },
};

/** anchor points: eyes, wing roots */
export function details() {
  return {
    eyes: [1, -1].map((s) => ({ p: [1.355, 0.845, 0.16 * s], r: 0.064, out: [0.25, 0.1, s] })),
    wingRoots: [1, -1].map((s) => [0.22, 0.28, 0.2 * s]),
    mouth: [1.72, 0.68, 0],
  };
}
