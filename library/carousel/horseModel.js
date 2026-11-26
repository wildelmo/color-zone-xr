/**
 * The carved carousel horse, sculpted as signed distance fields.
 *
 * Pure JS so the sdf worker can import it. Units are metres at life size;
 * local axes: +x forward (head), +y up, +z outward ("romance side": the side
 * a carousel horse shows to the crowd gets the flowing mane and extra trim).
 * The pole passes through the origin.
 *
 * Pose: an outer-row "jumper" mid-leap: forelegs tucked, hind legs
 * stretched, head high, tail streaming.
 */
import { smin, smax, sphere, ellipsoid, roundCone, chain, contour, hitSurface, smoothstep } from '../core/sdf.js';

const scaleZ = (f, s) => (x, y, z) => f(x, y, z * s) / s;
const OX = -0.06; // shift so the pole sits just in front of the saddle

function shifted(f) {
  return (x, y, z) => f(x - OX, y, z);
}

// ---------------------------------------------------------------- anatomy
const chest = ellipsoid(0.3, 0.0, 0, 0.34, 0.3, 0.235);
const mid = ellipsoid(-0.02, -0.01, 0, 0.4, 0.265, 0.225);
const rump = ellipsoid(-0.37, 0.03, 0, 0.32, 0.3, 0.25);
const withers = ellipsoid(0.3, 0.2, 0, 0.2, 0.11, 0.12);
const thighR = ellipsoid(-0.41, -0.1, 0.115, 0.22, 0.23, 0.12);
const thighL = ellipsoid(-0.41, -0.1, -0.115, 0.22, 0.23, 0.12);
const shoulderR = ellipsoid(0.36, -0.05, 0.1, 0.16, 0.2, 0.11);
const shoulderL = ellipsoid(0.36, -0.05, -0.1, 0.16, 0.2, 0.11);

const neck = scaleZ(chain([[0.34, 0.06, 0], [0.5, 0.33, 0], [0.62, 0.55, 0], [0.69, 0.68, 0]], [0.22, 0.175, 0.14, 0.12], 0.04), 1.45);
const neckCrest = scaleZ(chain([[0.3, 0.26, 0], [0.45, 0.46, 0], [0.6, 0.7, 0], [0.68, 0.8, 0]], [0.08, 0.07, 0.06, 0.05], 0.03), 1.5);

const headLine = scaleZ(roundCone([0.7, 0.72, 0], [0.98, 0.5, 0], 0.11, 0.075), 1.28);
const jaw = scaleZ(ellipsoid(0.75, 0.6, 0, 0.13, 0.11, 0.1), 1.0);
const muzzle = ellipsoid(0.995, 0.475, 0, 0.085, 0.075, 0.068);
const browR = ellipsoid(0.8, 0.675, 0.06, 0.045, 0.03, 0.03);
const browL = ellipsoid(0.8, 0.675, -0.06, 0.045, 0.03, 0.03);
const earR = roundCone([0.7, 0.8, 0.045], [0.665, 0.935, 0.06], 0.032, 0.008);
const earL = roundCone([0.7, 0.8, -0.045], [0.68, 0.93, -0.065], 0.032, 0.008);
const nostrilR = sphere(1.045, 0.475, 0.042, 0.02);
const nostrilL = sphere(1.045, 0.475, -0.042, 0.02);
const mouth = roundCone([1.07, 0.418, 0], [0.93, 0.43, 0], 0.012, 0.008);

const HOOVES = {
  rf: [[0.36, -0.08, 0.1], [0.41, -0.27, 0.11], [0.61, -0.33, 0.11], [0.55, -0.55, 0.11], [0.585, -0.625, 0.11]],
  lf: [[0.34, -0.08, -0.1], [0.43, -0.28, -0.11], [0.64, -0.26, -0.11], [0.53, -0.45, -0.11], [0.54, -0.535, -0.11]],
  rh: [[-0.33, -0.24, 0.12], [-0.63, -0.4, 0.12], [-0.89, -0.5, 0.12], [-0.975, -0.495, 0.12]],
  lh: [[-0.35, -0.25, -0.12], [-0.61, -0.46, -0.12], [-0.85, -0.58, -0.12], [-0.93, -0.6, -0.12]],
};
const legR = chain(HOOVES.rf, [0.1, 0.07, 0.056, 0.041, 0.046], 0.035, 3);
const legL = chain(HOOVES.lf, [0.1, 0.07, 0.056, 0.041, 0.046], 0.035, 3);
const hindR = chain(HOOVES.rh, [0.1, 0.057, 0.041, 0.046], 0.03, 3);
const hindL = chain(HOOVES.lh, [0.1, 0.057, 0.041, 0.046], 0.03, 3);
const knees = [sphere(0.61, -0.33, 0.11, 0.06), sphere(0.64, -0.26, -0.11, 0.06), sphere(-0.63, -0.4, 0.12, 0.058), sphere(-0.61, -0.46, -0.12, 0.058)];

function bodyRaw(x, y, z) {
  let d = smin(chest(x, y, z), mid(x, y, z), 0.16);
  d = smin(d, rump(x, y, z), 0.16);
  d = smin(d, withers(x, y, z), 0.1);
  d = smin(d, thighR(x, y, z), 0.08);
  d = smin(d, thighL(x, y, z), 0.08);
  d = smin(d, shoulderR(x, y, z), 0.08);
  d = smin(d, shoulderL(x, y, z), 0.08);
  if (x > 0.15 && y > -0.1) {
    d = smin(d, neck(x, y, z), 0.08);
    d = smin(d, neckCrest(x, y, z), 0.05);
  }
  if (x > 0.55 && y > 0.3) {
    let h = smin(headLine(x, y, z), jaw(x, y, z), 0.07);
    h = smin(h, muzzle(x, y, z), 0.06);
    h = smin(h, browR(x, y, z), 0.03);
    h = smin(h, browL(x, y, z), 0.03);
    h = smin(h, earR(x, y, z), 0.02);
    h = smin(h, earL(x, y, z), 0.02);
    h = smax(h, -nostrilR(x, y, z), 0.012);
    h = smax(h, -nostrilL(x, y, z), 0.012);
    h = smax(h, -mouth(x, y, z), 0.008);
    d = smin(d, h, 0.06);
  }
  if (y < 0.05) {
    if (x > 0.1) {
      d = smin(d, legR(x, y, z), 0.05);
      d = smin(d, legL(x, y, z), 0.05);
    }
    if (x < -0.15) {
      d = smin(d, hindR(x, y, z), 0.05);
      d = smin(d, hindL(x, y, z), 0.05);
    }
    for (const k of knees) d = smin(d, k(x, y, z), 0.03);
  }
  return d;
}

// ------------------------------------------------------- mane, forelock, tail
const crest = [[0.685, 0.82, 0], [0.64, 0.74, 0], [0.585, 0.66, 0], [0.53, 0.575, 0], [0.475, 0.49, 0], [0.42, 0.41, 0], [0.365, 0.34, 0], [0.31, 0.29, 0]];
const locks = crest.map((c, i) => {
  const s = 1 - i / (crest.length + 2);
  const sway = i % 2 ? 0.02 : -0.01;
  return chain(
    [c, [c[0] - 0.045, c[1] - 0.025, 0.085 * s + 0.03], [c[0] - 0.075 + sway, c[1] - 0.12 * s - 0.02, 0.11 * s + 0.045], [c[0] - 0.07 + sway * 2, c[1] - 0.2 * s - 0.03, 0.09 * s + 0.05]],
    [0.05, 0.046, 0.032, 0.008],
    0.01,
    3,
  );
});
const crestRidge = chain(crest, [0.045, 0.05, 0.05, 0.05, 0.045, 0.04, 0.035, 0.025], 0.02, 2);
const forelock = chain([[0.705, 0.82, 0], [0.765, 0.8, 0.02], [0.8, 0.74, 0.03], [0.815, 0.69, 0.02]], [0.034, 0.03, 0.02, 0.006], 0.01, 3);
const tailLocks = [
  chain([[-0.62, 0.16, 0], [-0.79, 0.15, 0.02], [-0.92, 0.03, 0.035], [-0.97, -0.18, 0.05], [-0.93, -0.37, 0.04]], [0.05, 0.075, 0.07, 0.055, 0.018], 0.02, 4),
  chain([[-0.63, 0.15, 0], [-0.78, 0.12, -0.035], [-0.88, -0.01, -0.03], [-0.9, -0.2, -0.02], [-0.85, -0.32, -0.03]], [0.045, 0.06, 0.055, 0.04, 0.012], 0.02, 4),
  chain([[-0.64, 0.17, 0], [-0.8, 0.19, 0.05], [-0.95, 0.1, 0.07], [-1.04, -0.05, 0.08], [-1.05, -0.2, 0.06]], [0.04, 0.05, 0.05, 0.035, 0.01], 0.02, 4),
];

function maneRaw(x, y, z) {
  let d = 1; // finite "far away" keeps the mesher's interpolation NaN-free
  if (x > 0.2 && y > 0.2) {
    d = crestRidge(x, y, z);
    for (const l of locks) d = smin(d, l(x, y, z), 0.025);
    d = smin(d, forelock(x, y, z), 0.02);
  }
  if (x < -0.5) for (const t of tailLocks) d = smin(d, t(x, y, z), 0.03);
  return d;
}

// ------------------------------------------------------------ saddle + tack
const SADDLE_X = -0.03;
const pommel = roundCone([0.15, 0.25, 0], [0.19, 0.355, 0], 0.055, 0.035);
const cantle = chain([[-0.2, 0.25, -0.13], [-0.235, 0.335, 0], [-0.2, 0.25, 0.13]], [0.03, 0.035, 0.03], 0.01, 3);

function saddleRaw(x, y, z) {
  if (y < 0.0 || x < -0.35 || x > 0.3) return 0.1;
  const e = (Math.hypot((x - SADDLE_X) / 0.2, z / 0.33) - 1) * 0.2;
  const region = smax(e, 0.1 - y, 0.02);
  let d = smax(bodyRaw(x, y, z) - 0.035, region, 0.02);
  d = smin(d, pommel(x, y, z), 0.04);
  d = smin(d, cantle(x, y, z), 0.04);
  return d;
}

const scallopY = (x) => -0.095 + 0.028 * Math.cos(((x - SADDLE_X) * Math.PI * 2) / 0.15);
const BLANKET_HALF = 0.29;
/** signed distance to the painted saddle-blanket region (negative inside) */
function blanketRegion(x, y, z) {
  return smax(Math.abs(x - SADDLE_X) - BLANKET_HALF, scallopY(x) - y, 0.01);
}

// gold horseshoes
const shoes = Object.values(HOOVES).map((pts) => {
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz);
  const t0 = 1 - 0.028 / l;
  const s = [a[0] + dx * t0, a[1] + dy * t0, a[2] + dz * t0];
  const e = [b[0] + (dx / l) * 0.03, b[1] + (dy / l) * 0.03, b[2] + (dz / l) * 0.03];
  return roundCone(s, e, 0.05, 0.052);
});
function goldRaw(x, y, z) {
  let d = Infinity;
  for (const s of shoes) d = Math.min(d, s(x, y, z));
  return d;
}

// -------------------------------------------------------------- colouring
const HOOF_TIPS = Object.values(HOOVES).map((p) => p[p.length - 1]);
function bodyColor(x, y, z) {
  let r = 1, g = 1, b = 1;
  // soft muzzle
  const m = smoothstep(0.93, 1.06, x + (0.5 - y) * 0.2);
  r -= m * 0.35;
  g -= m * 0.45;
  b -= m * 0.42;
  // dark hooves
  let hd = Infinity;
  for (const t of HOOF_TIPS) hd = Math.min(hd, Math.hypot(x - t[0], y - t[1], z - t[2]));
  const h = 1 - smoothstep(0.03, 0.07, hd);
  r = r * (1 - h) + 0.12 * h;
  g = g * (1 - h) + 0.1 * h;
  b = b * (1 - h) + 0.09 * h;
  // a little belly shadow, like aged paint
  const s = smoothstep(-0.05, -0.3, y) * 0.12;
  return [r * (1 - s), g * (1 - s), b * (1 - s)];
}

// ----------------------------------------------------------- public layers
const B = [-1.15 + OX, -0.7, -0.33, 1.15 + OX, 1.0, 0.33];

export const POLE_X = 0;

export const layers = {
  // `paint` carries the blanket region's distance so the shader can paint a
  // crisp scalloped blanket (and a gold pinstripe) at sub-vertex precision
  body: { sdf: shifted(bodyRaw), bounds: B, color: (x, y, z) => bodyColor(x - OX, y, z), attributes: { paint: (x, y, z) => blanketRegion(x - OX, y, z) } },
  mane: { sdf: shifted(maneRaw), bounds: [-1.15 + OX, -0.45, -0.15, 0.9 + OX, 0.98, 0.25] },
  saddle: { sdf: shifted(saddleRaw), bounds: [-0.33 + OX, 0.05, -0.3, 0.28 + OX, 0.42, 0.3] },
  gold: { sdf: shifted(goldRaw), bounds: [-1.08 + OX, -0.7, -0.2, 0.68 + OX, -0.43, 0.2] },
};

/** ornament curves and points computed from the sculpted surface */
export function details() {
  const f = bodyRaw;
  const sh = (p) => [p[0] + OX, p[1], p[2]];
  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const straps = [];
  const add = (pts, radius, closed = false) => {
    if (pts.length > 3) straps.push({ points: pts.map(sh), radius, closed });
  };
  // breast collar around the front of the chest
  const fd = norm([1, -0.18, 0]);
  const breast = contour(f, [0.2, 0.04, 0], fd, [0, 0, 1], { a0: -1.62, a1: 1.62, n: 36, offset: 0.012 });
  add(breast, 0.017);
  // girth under the belly
  add(contour(f, [0.04, 0.02, 0], [0, -1, 0], [0, 0, 1], { a0: -1.25, a1: 1.25, n: 28, offset: 0.01 }), 0.016);
  // hip strap round the rump
  const rd = norm([-1, 0.12, 0]);
  const hip = contour(f, [-0.3, 0.03, 0], rd, [0, 0, 1], { a0: -1.58, a1: 1.58, n: 34, offset: 0.012 });
  add(hip, 0.015);
  // noseband and headstall
  const hUp = norm([0.22, 0.28, 0]);
  add(contour(f, [0.92, 0.52, 0], hUp, [0, 0, 1], { a0: 0, a1: Math.PI * 2, n: 30, offset: 0.008, maxT: 0.3, step: 0.004 }), 0.012, true);
  add(contour(f, [0.735, 0.64, 0], norm([0.05, 1, 0]), [0, 0, 1], { a0: 0, a1: Math.PI * 2, n: 34, offset: 0.008, maxT: 0.4, step: 0.004 }), 0.012, true);
  // gold piping round the painted saddle blanket: scalloped hem on both
  // sides plus the front and back edges over the back
  for (const side of [1, -1]) {
    const hem = [];
    for (let i = 0; i <= 44; i++) {
      const x = SADDLE_X - BLANKET_HALF + (2 * BLANKET_HALF * i) / 44;
      const p = hitSurface(f, [x, scallopY(x), 0], [0, 0, side], 0.004, 0.4, 0.004);
      if (p) hem.push(p);
    }
    add(hem, 0.0095);
  }
  for (const end of [1, -1]) {
    const x = SADDLE_X + end * BLANKET_HALF;
    const y0 = scallopY(x);
    const c = contour(f, [x, y0 + 0.02, 0], [0, 1, 0], [0, 0, 1], { a0: -Math.PI / 2 - 0.02, a1: Math.PI / 2 + 0.02, n: 24, offset: 0.004 })
      .filter((p) => p[1] >= y0 - 0.005);
    add(c, 0.0095);
  }
  // reins: bit ring -> over the neck -> pommel
  for (const side of [1, -1]) {
    const bit = hitSurface(f, [0.93, 0.44, 0], [0, 0, side], 0.006, 0.3, 0.003);
    if (bit) add([bit, [0.8, 0.5, side * 0.12], [0.6, 0.42, side * 0.16], [0.4, 0.36, side * 0.14], [0.2, 0.33, side * 0.06]], 0.008);
  }

  // gems on the breast collar, rosettes at strap ends
  const gems = [];
  const gemAt = (p, size, kind) => {
    const q = sh(p);
    const g = [f(p[0] + 1e-3, p[1], p[2]) - f(p[0] - 1e-3, p[1], p[2]), f(p[0], p[1] + 1e-3, p[2]) - f(p[0], p[1] - 1e-3, p[2]), f(p[0], p[1], p[2] + 1e-3) - f(p[0], p[1], p[2] - 1e-3)];
    gems.push({ p: q, n: norm(g), size, kind });
  };
  for (let i = 4; i < breast.length - 4; i += 4) gemAt(breast[i], i === 16 || i === 20 ? 0.03 : 0.022, i % 8 === 0 ? 0 : 1);
  if (breast.length) {
    gemAt(breast[1], 0.032, 2);
    gemAt(breast[breast.length - 2], 0.032, 2);
  }
  for (const side of [1, -1]) {
    const r = hitSurface(f, [0.9, 0.53, 0], [0, 0, side], 0.01, 0.3, 0.003);
    if (r) gemAt(r, 0.022, 2);
    const t = hitSurface(f, [0.73, 0.66, 0], [0, 0, side], 0.01, 0.3, 0.003);
    if (t) gemAt(t, 0.024, 2);
  }
  // a big jewel on the outward haunch
  const hj = hitSurface(f, [-0.42, 0.0, 0], [0, 0, 1], 0.015, 0.4, 0.004);
  if (hj) gemAt(hj, 0.04, 0);

  const eyes = [];
  for (const side of [1, -1]) {
    const p = hitSurface(f, [0.805, 0.655, 0], [0, 0, side], 0, 0.3, 0.002);
    if (p) eyes.push({ p: [p[0] + OX - 0.004, p[1], p[2] - side * 0.012], r: 0.026 });
  }
  // where the pole enters the saddle and leaves the belly (for brass collars)
  const top = hitSurface(saddleRaw, [-OX, 0.15, 0], [0, 1, 0], 0, 0.5, 0.003);
  const bottom = hitSurface(f, [-OX, 0, 0], [0, -1, 0], 0, 0.5, 0.003);
  const collars = [top ? top[1] : 0.36, bottom ? bottom[1] : -0.27];
  return { straps, gems, eyes, collars };
}
