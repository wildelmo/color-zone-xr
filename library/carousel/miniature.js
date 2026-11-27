import * as THREE from 'three';
import { GeoBag, lathe, mat, ringMat } from '../core/geometry.js';
import { PALETTE } from '../core/materials.js';
import { BulbString } from '../core/bulbs.js';
import { meshLayer } from '../core/sdfClient.js';
import { D, HORSE_CELLS, MINI_HORSE_TRIS } from './dimensions.js';
import { LIVERY } from './horses.js';
import { simplify } from './simplify.js';

/**
 * The shelf preview: the same carousel as a cheap miniature, seen about
 * 32 cm across from half a metre or more. Only what reads at that size is
 * built: the turned base with its gold bands and bun feet, the centre column
 * and organ, the striped tent roof, rounding boards and scalloped valance,
 * cupola and pennant, the lights, and the horses on their poles. No
 * mechanism, movement, figures, mouldings, jewels or textures.
 *
 * Draw calls: the stationary base and the turning top are each one paint
 * mesh (vertex colours) and one gold mesh; the 24 horses are one instanced
 * mesh (every part painted by one shader), their poles another, and the
 * lights one instanced glow billboard per bulb.
 */
const SEG = 24; // round things: a 24-gon is under a pixel off a circle at shelf size
const MODEL = new URL('./horseModel.js', import.meta.url).href;

export async function buildMiniature(ctx, kit) {
  const mats = {
    // double-sided: crests and the valance are seen from behind across the roof;
    // a little rougher than the hero's enamel, which stands in for the
    // textures' grain and keeps the deck from mirroring the room at a glancing angle
    paint: kit.paint({ side: THREE.DoubleSide, roughness: 0.55 }),
    gold: kit.standard({ color: PALETTE.gold, metalness: 1, roughness: 0.3, side: THREE.DoubleSide }),
  };
  const root = new THREE.Group();
  root.name = 'carousel:shelf';

  const base = buildBase(mats);
  root.add(base);
  await ctx.step();

  const rotor = new THREE.Group();
  rotor.name = 'rotating';
  root.add(rotor);
  const bulbs = new BulbString({ radius: 0.055, glow: 0.52, detail: 0 });
  rotor.add(buildTop(mats, bulbs));
  const lights = bulbs.build(kit);
  // the glass bulbs are a millimetre across here: the glow halos alone read as lights
  lights.remove(bulbs.bulbs);
  bulbs.bulbs.geometry.dispose();
  rotor.add(lights);
  await ctx.step();

  const herd = await buildHorses(ctx, kit);
  rotor.add(herd.group);

  return {
    root,
    horseTris: herd.tris,
    update(state) {
      rotor.rotation.y = state.angle;
      herd.update(state.crank);
      bulbs.update(state.time, state.speed);
    },
  };
}

/* ------------------------------------------------- stationary base + column */

function buildBase(mats) {
  const bag = new GeoBag();
  const R = 5.45;
  // turned mahogany body (no underside or hidden top)
  bag.add(lathe([[5.1, 0.2], [5.5, 0.22], [5.64, 0.3], [5.5, 0.4], [R, 0.46], [R, 1.02], [5.58, 1.08], [5.64, 1.15], [5.25, 1.205], [4.8, 1.205]], SEG), null, 'paint', '#4e1d10');
  bag.add(lathe([[5.49, 0.41], [5.53, 0.44], [5.47, 0.47]], SEG), null, 'gold');
  bag.add(lathe([[5.5, 1.01], [5.57, 1.035], [5.52, 1.06]], SEG), null, 'gold');
  // bun feet
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    bag.add(lathe([[0, 0], [0.32, 0.05], [0.27, 0.17], [0, 0.2]], 6), mat(Math.cos(a) * 5.05, 0, Math.sin(a) * 5.05), 'gold');
  }
  // the music-box window as a velvet patch, and the maker's plaque opposite the key, both gold-framed
  const w = D.windowHalfAngle;
  const patch = (a0, a1, y0, y1, r, key, color) => bag.add(new THREE.CylinderGeometry(r, r, y1 - y0, 3, 1, true, a0, a1 - a0), mat(0, (y0 + y1) / 2, 0), key, color);
  patch(-w, w, D.windowY0, D.windowY1, R + 0.01, 'paint', '#7a2a22');
  patch(-w - 0.012, w + 0.012, D.windowY0 - 0.05, D.windowY1 + 0.05, R + 0.005, 'gold');
  patch(-Math.PI / 2 - 0.2, -Math.PI / 2 + 0.2, 0.55, 0.93, R + 0.01, 'paint', '#1b1411');
  patch(-Math.PI / 2 - 0.21, -Math.PI / 2 + 0.21, 0.52, 0.96, R + 0.005, 'gold');
  // winding key on the +x side
  bag.add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 8).rotateZ(Math.PI / 2), mat(5.46, 0.72, 0), 'gold');
  bag.add(new THREE.CylinderGeometry(0.055, 0.055, 0.4, 4, 1, true).rotateZ(Math.PI / 2), mat(5.68, 0.72, 0), 'gold');
  bag.add(new THREE.BoxGeometry(0.05, 0.8, 0.3), mat(5.9, 0.72, 0), 'gold');

  // twelve-sided column: alternating panels, gold corner posts, skirt and cornice
  const sides = 12;
  const ap = D.columnR;
  const vr = ap / Math.cos(Math.PI / sides);
  const faceW = 2 * ap * Math.tan(Math.PI / sides);
  const y0 = D.deckTop, y1 = D.columnTop;
  const phi0 = -Math.PI / sides;
  const panelY0 = y0 + 0.44, panelY1 = y1 - 0.42;
  bag.add(lathe([[vr + 0.08, y0], [vr + 0.1, y0 + 0.08], [vr + 0.03, y0 + 0.14], [vr + 0.03, y0 + 0.36], [vr, panelY0]], sides, phi0), null, 'paint', PALETTE.red);
  bag.add(lathe([[vr, panelY1], [vr + 0.06, y1 - 0.34], [vr + 0.26, y1 - 0.08], [vr + 0.28, y1], [0.3, y1]], sides, phi0), null, 'paint', PALETTE.red);
  for (let i = 0; i < sides; i++) {
    const a = Math.PI / 2 + (i / sides) * Math.PI * 2;
    bag.add(new THREE.PlaneGeometry(faceW, panelY1 - panelY0), mat(Math.cos(a) * ap, (panelY0 + panelY1) / 2, Math.sin(a) * ap, 0, Math.PI / 2 - a), 'paint', i % 2 ? PALETTE.cream : '#e7d3a6');
    const ca = a - Math.PI / sides;
    bag.add(new THREE.CylinderGeometry(0.05, 0.05, panelY1 - panelY0, 3, 1, true), mat(Math.cos(ca) * (vr + 0.02), (panelY0 + panelY1) / 2, Math.sin(ca) * (vr + 0.02)), 'gold');
  }
  // band organ in front of the +z face: cabinet, pipe case, gold pipes and pediment
  const Z = D.columnR, yb = D.deckTop + 0.02, W = 1.7, DEPTH = 0.42;
  bag.add(new THREE.BoxGeometry(W, 1.0, DEPTH), mat(0, yb + 0.5, Z + DEPTH / 2), 'paint', PALETTE.cream);
  bag.add(new THREE.BoxGeometry(W + 0.08, 0.08, DEPTH + 0.08), mat(0, yb + 1.02, Z + DEPTH / 2), 'paint', PALETTE.red);
  bag.add(new THREE.BoxGeometry(W, 1.15, 0.12), mat(0, yb + 1.64, Z + 0.06), 'paint', '#5a1314');
  for (let i = 0; i < 7; i++) {
    const u = i / 6 - 0.5;
    const len = 0.45 + 0.45 * Math.cos(u * Math.PI);
    bag.add(new THREE.CylinderGeometry(0.05, 0.05, len, 4, 1, true), mat(u * (W - 0.5), yb + 1.25 + len / 2, Z + 0.19), 'gold');
  }
  bag.add(new THREE.BoxGeometry(W + 0.12, 0.08, DEPTH + 0.1), mat(0, yb + 2.24, Z + DEPTH / 2), 'gold');
  return bag.build(mats, { name: 'base' });
}

/* -------------------------------------------- deck, canopy, roof and cupola */

function buildTop(mats, bulbs) {
  const bag = new GeoBag();
  // platform: painted edge, plank-brown floor, gold band
  bag.add(lathe([[4.9, D.deckBottom], [4.98, D.deckBottom + 0.03], [5.04, 1.31], [5.04, 1.45], [4.95, D.deckTop - 0.005]], SEG), null, 'paint', PALETTE.red);
  bag.add(new THREE.RingGeometry(1.4, 4.95, SEG, 1).rotateX(-Math.PI / 2), mat(0, D.deckTop - 0.005, 0), 'paint', '#9a6a40');
  bag.add(lathe([[5.05, 1.35], [5.08, 1.38], [5.05, 1.41]], SEG), null, 'gold');

  // rounding boards: cream band, red mouldings with gold bands, mirrors and painted vignettes
  const yb0 = D.boardBottom, yb1 = D.boardTop, ybm = (yb0 + yb1) / 2;
  bag.add(new THREE.CylinderGeometry(D.boardR, D.boardR, yb1 - yb0, SEG, 1, true), mat(0, ybm, 0), 'paint', PALETTE.cream);
  bag.add(lathe([[D.boardR - 0.04, yb0 - 0.05], [D.boardR + 0.1, yb0 - 0.02], [D.boardR, yb0 + 0.06]], SEG), null, 'paint', PALETTE.red);
  bag.add(lathe([[D.boardR, yb1 - 0.06], [D.boardR + 0.16, yb1 + 0.05], [D.roofBaseR + 0.05, D.roofBaseY], [D.roofBaseR - 0.12, D.roofBaseY]], SEG), null, 'paint', PALETTE.red);
  bag.add(lathe([[D.boardR + 0.09, yb0 - 0.04], [D.boardR + 0.12, yb0 - 0.01], [D.boardR + 0.09, yb0 + 0.02]], SEG), null, 'gold');
  bag.add(lathe([[D.roofBaseR + 0.05, D.roofBaseY - 0.07], [D.roofBaseR + 0.09, D.roofBaseY - 0.035], [D.roofBaseR + 0.05, D.roofBaseY]], SEG), null, 'gold');
  const slots = 24;
  const sky = new THREE.Color('#b4cde0'), meadow = new THREE.Color('#6f9a52');
  for (let i = 0; i < slots; i++) {
    const a = ((i + 0.5) / slots) * Math.PI * 2;
    if (i % 2 === 0) {
      // oval mirror (aged silvering reads as warm grey at this size) in a gold frame
      bag.add(new THREE.ShapeGeometry(ellipse(0.36, 0.3), 4), ringMat(a, D.boardR + 0.045, ybm), 'paint', '#8d877d');
      bag.add(new THREE.ShapeGeometry(ellipse(0.42, 0.36), 4), ringMat(a, D.boardR + 0.035, ybm), 'gold');
    } else {
      // a painted landscape: sky above, meadow below, in a gold frame
      const pg = new THREE.PlaneGeometry(1.0, 0.6);
      const p = pg.attributes.position;
      const col = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) (p.getY(k) > 0 ? sky : meadow).toArray(col, k * 3);
      pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      bag.add(pg, ringMat(a, D.boardR + 0.045, ybm), 'paint');
      bag.add(new THREE.PlaneGeometry(1.1, 0.7), ringMat(a, D.boardR + 0.035, ybm), 'gold');
    }
    // the bulbs are as many as on the real one: a glow halo costs two triangles
    const pa = (i / slots) * Math.PI * 2;
    bulbs.add(new THREE.Vector3(Math.cos(pa) * (D.boardR + 0.1), yb0 + 0.16, Math.sin(pa) * (D.boardR + 0.1)), 1, i, slots);
    bulbs.add(new THREE.Vector3(Math.cos(pa) * (D.boardR + 0.1), yb1 - 0.16, Math.sin(pa) * (D.boardR + 0.1)), 2, i, slots);
  }
  const nc = 48;
  for (let i = 0; i < nc; i++) {
    const a = ((i + 0.25) / nc) * Math.PI * 2;
    bulbs.add(new THREE.Vector3(Math.cos(a) * (D.roofBaseR + 0.1), D.roofBaseY - 0.12, Math.sin(a) * (D.roofBaseR + 0.1)), 3, i, nc);
  }

  // scalloped valance (crimson, shaded into each swag)
  {
    const nScallop = 48;
    const vTop = yb0 - 0.05, vDepth = 0.2, vSag = 0.1;
    const cols = nScallop * 2;
    const pos = [], col = [], idx = [];
    const red = new THREE.Color(PALETTE.crimson);
    for (let i = 0; i <= cols; i++) {
      const u = i / cols, a = u * Math.PI * 2;
      const frac = (u * nScallop) % 1;
      const yb = vTop - vDepth - vSag * Math.sin(Math.PI * frac);
      for (let j = 0; j <= 1; j++) {
        const r = D.boardR + 0.06 + 0.06 * j;
        pos.push(Math.cos(a) * r, j ? yb : vTop, Math.sin(a) * r);
        const shade = 1 - 0.18 * Math.sin(Math.PI * frac) * j;
        col.push(red.r * shade, red.g * shade, red.b * shade);
      }
    }
    for (let i = 0; i < cols; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    bag.add(g, null, 'paint');
  }

  // cresting round the eaves: a gold-ringed medallion on a spike, crowned by
  // a bulb, with a little gold finial between each pair
  const ring = ellipse(0.27, 0.32);
  ring.holes.push(ellipse(0.18, 0.225));
  for (let i = 0; i < 12; i++) {
    const a = ((i * 2 + 0.5) / slots) * Math.PI * 2;
    const m = ringMat(a, D.roofBaseR + 0.02, D.roofBaseY - 0.02, -0.12);
    bag.add(new THREE.ShapeGeometry(ring, 4), m.clone().multiply(mat(0, 0.396, 0)), 'gold');
    bag.add(new THREE.ShapeGeometry(ellipse(0.18, 0.225), 4), m.clone().multiply(mat(0, 0.396, -0.005)), 'paint', i % 2 ? '#8d877d' : PALETTE.crimson);
    bag.add(new THREE.CylinderGeometry(0, 0.06, 0.3, 3, 1, true), m.clone().multiply(mat(0, 0.86, 0)), 'gold');
    bag.add(new THREE.CylinderGeometry(0.05, 0.12, 0.1, 4, 1, true), m.clone().multiply(mat(0, 0.05, 0)), 'gold');
    bulbs.add(new THREE.Vector3(0, 0.98, 0).applyMatrix4(m), 4, i, 12);
    const fa = ((i * 2 + 1.5) / slots) * Math.PI * 2;
    bag.add(new THREE.CylinderGeometry(0, 0.06, 0.38, 3, 1, true), mat(Math.cos(fa) * (D.roofBaseR + 0.04), D.roofBaseY + 0.17, Math.sin(fa) * (D.roofBaseR + 0.04)), 'gold');
  }

  // striped tent roof: 24 gores, cream and red, with bulbs up the seams
  const steps = 5;
  const roofPts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    roofPts.push([D.roofBaseR + (D.roofTopR - D.roofBaseR) * t, D.roofBaseY + (D.roofTopY - D.roofBaseY) * Math.pow(t, 1.5)]);
  }
  const gores = 24;
  for (let r = 0; r < gores; r++) {
    bag.add(lathe(roofPts, 1, (r / gores) * Math.PI * 2, (Math.PI * 2) / gores), null, 'paint', r % 2 ? PALETTE.red : PALETTE.cream);
    {
      const phi = (r / gores) * Math.PI * 2;
      for (const t of [0.22, 0.5, 0.78]) {
        const rr = D.roofBaseR + (D.roofTopR - D.roofBaseR) * t;
        const y = D.roofBaseY + (D.roofTopY - D.roofBaseY) * Math.pow(t, 1.5);
        bulbs.add(new THREE.Vector3(Math.sin(phi) * (rr + 0.07), y + 0.06, Math.cos(phi) * (rr + 0.07)), 5 + Math.round(t * 4), r, gores);
      }
    }
  }
  // gilded ribs over the seams: flat strips lying on the canvas
  for (let r = 0; r < gores; r++) {
    const phi = (r / gores) * Math.PI * 2;
    const pos = [];
    for (const [rr, y] of roofPts) {
      for (const side of [-1, 1]) {
        const a = phi + (side * 0.035) / rr;
        pos.push(Math.sin(a) * (rr + 0.02), y + 0.02, Math.cos(a) * (rr + 0.02));
      }
    }
    const idx = [];
    for (let i = 0; i < steps; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const rib = new THREE.BufferGeometry();
    rib.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rib.setIndex(idx);
    rib.computeVertexNormals();
    bag.add(rib, null, 'gold');
  }
  bag.add(lathe([[D.roofTopR - 0.05, D.roofTopY - 0.04], [D.roofTopR + 0.12, D.roofTopY + 0.02], [D.roofTopR - 0.05, D.roofTopY + 0.08]], 12), null, 'gold');

  // cupola, dome, finial and a pennant (still: it is a centimetre long here)
  const cr = 1.1;
  bag.add(new THREE.CylinderGeometry(cr, cr, D.cupolaTop - D.roofTopY, 12, 1, true), mat(0, (D.cupolaTop + D.roofTopY) / 2, 0), 'paint', PALETTE.cream);
  for (let i = 0; i < 8; i++) {
    const wa = ((i + 0.5) / 8) * Math.PI * 2;
    bag.add(new THREE.ShapeGeometry(arch(0.32, 0.36), 3), ringMat(wa, cr + 0.012, (D.cupolaTop + D.roofTopY) / 2 - 0.02), 'paint', '#6f6a62');
    const pa = (i / 8) * Math.PI * 2;
    bulbs.add(new THREE.Vector3(Math.cos(pa) * (cr + 0.09), D.cupolaTop - 0.08, Math.sin(pa) * (cr + 0.09)), 9, i, 8);
  }
  bag.add(lathe([[cr - 0.02, D.cupolaTop - 0.05], [cr + 0.16, D.cupolaTop + 0.02], [1.25, D.cupolaTop + 0.05]], 12), null, 'paint', PALETTE.red);
  bag.add(lathe([[1.25, D.cupolaTop + 0.05], [1.2, D.cupolaTop + 0.22], [0.9, D.cupolaTop + 0.42], [0.4, D.cupolaTop + 0.56], [0, D.domeTop]], 12), null, 'paint', PALETTE.crimson);
  bag.add(lathe([[0, D.domeTop - 0.02], [0.12, D.domeTop], [0.2, D.domeTop + 0.22], [0.05, D.domeTop + 0.48], [0.02, D.finialTop], [0, D.finialTop]], 6), null, 'gold');
  bag.add(new THREE.CylinderGeometry(0.02, 0.025, 0.9, 4, 1, true), mat(0, D.finialTop + 0.4, 0), 'gold');
  const flag = new THREE.BufferGeometry();
  flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.23, 0, 0, -0.23, 0, 0.96, -0.05, 0.08, 0.96, 0.01, 0.08], 3));
  flag.setIndex([0, 1, 2, 0, 2, 3]);
  flag.computeVertexNormals();
  bag.add(flag, mat(0, D.finialTop + 0.62, 0), 'paint', PALETTE.crimson);
  return bag.build(mats, { name: 'top' });
}

function ellipse(rx, ry) {
  const s = new THREE.Shape();
  s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false);
  return s;
}

function arch(w, h) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(-r, -h / 2);
  s.lineTo(r, -h / 2);
  s.lineTo(r, h / 2 - r);
  s.absarc(0, h / 2 - r, r, 0, Math.PI, false);
  s.lineTo(-r, -h / 2);
  return s;
}

/* ------------------------------------------------------------------ horses */

/**
 * 24 horses as one instanced mesh. The fused `mini` sculpt is meshed in the
 * worker, simplified to MINI_HORSE_TRIS (legs and head keep their shape, the
 * flanks lose their triangles), and its part distances re-evaluated at the
 * surviving vertices so the shader can paint coat, blanket, saddle, mane and
 * gold shoes per horse.
 */
async function buildHorses(ctx, kit) {
  const raw = await meshLayer(MODEL, 'mini', HORSE_CELLS.shelf);
  await ctx.step();
  const { positions, index } = await simplify(raw.attributes.position.array, raw.index.array, MINI_HORSE_TRIS, { step: ctx.step });
  raw.dispose();
  const { layers } = await import('./horseModel.js');
  const L = layers.mini;
  const n = positions.length / 3;
  const normals = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const parts = Object.fromEntries(Object.keys(L.attributes).map((k) => [k, new Float32Array(n)]));
  const e = 0.01;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const gx = L.sdf(x + e, y, z) - L.sdf(x - e, y, z);
    const gy = L.sdf(x, y + e, z) - L.sdf(x, y - e, z);
    const gz = L.sdf(x, y, z + e) - L.sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals.set([gx / l, gy / l, gz / l], i * 3);
    colors.set(L.color(x, y, z), i * 3);
    for (const [k, f] of Object.entries(L.attributes)) parts[k][i] = f(x, y, z);
  }
  await ctx.step();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  for (const [k, a] of Object.entries(parts)) geo.setAttribute(k, new THREE.BufferAttribute(a, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();

  // per-horse paint, as in the hero's livery
  const N = D.sweeps * 2;
  const coat = new Float32Array(N * 3), trim = new Float32Array(N * 3), saddle = new Float32Array(N * 3), mane = new Float32Array(N * 4);
  const gold = new THREE.Color(PALETTE.gold), c = new THREE.Color();
  const horses = [];
  for (let i = 0; i < N; i++) {
    const outer = i < D.sweeps;
    const k = i % D.sweeps;
    const liv = LIVERY[outer ? k : (k * 5 + 3) % LIVERY.length];
    c.set(liv[0]).toArray(coat, i * 3);
    c.set(liv[1]).toArray(trim, i * 3);
    c.set(liv[3]).toArray(saddle, i * 3);
    (liv[2] === 'g' ? gold : c.set(liv[2])).toArray(mane, i * 4);
    mane[i * 4 + 3] = liv[2] === 'g' ? 1 : 0;
    horses.push({ sweep: k, outer, angle: (k / D.sweeps) * Math.PI * 2, r: outer ? D.outerR : D.innerR, scale: outer ? 1 : D.innerScale });
  }
  geo.setAttribute('instanceCoat', new THREE.InstancedBufferAttribute(coat, 3));
  geo.setAttribute('instanceTrim', new THREE.InstancedBufferAttribute(trim, 3));
  geo.setAttribute('instanceSaddle', new THREE.InstancedBufferAttribute(saddle, 3));
  geo.setAttribute('instanceMane', new THREE.InstancedBufferAttribute(mane, 4));

  const group = new THREE.Group();
  group.name = 'horses';
  const body = new THREE.InstancedMesh(geo, miniHorseMaterial(kit), N);
  body.name = 'horses:mini';
  // poles: plain brass rods, long enough to vanish into the canopy (no crank rods here)
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.5, 5, 1, true).translate(0, (2.8 - 1.7) / 2, 0);
  const poles = new THREE.InstancedMesh(poleGeo, kit.brass({ roughness: 0.2 }), N);
  poles.name = 'poles';
  for (const m of [body, poles]) {
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
  }

  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  return {
    group,
    tris: geo.index.count / 3,
    /** same motion as the hero: each pole rides its crank, outer and inner rows opposite */
    update(crankBase) {
      horses.forEach((h, i) => {
        const phi = crankBase + h.sweep * (Math.PI / 2);
        const sgn = h.outer ? 1 : -1;
        const v = sgn * D.crank * Math.cos(phi);
        const t = sgn * D.crank * Math.sin(phi);
        const yH = D.shaftY + v - Math.sqrt(D.rod * D.rod - t * t) - D.poleTopToHorse;
        _p.set(Math.cos(h.angle) * h.r, yH, Math.sin(h.angle) * h.r);
        _q.setFromAxisAngle(_y, Math.PI / 2 - h.angle);
        body.setMatrixAt(i, m4.compose(_p, _q, _s.setScalar(h.scale)));
        poles.setMatrixAt(i, m4.compose(_p, _q, _s.setScalar(1)));
      });
      body.instanceMatrix.needsUpdate = true;
      poles.instanceMatrix.needsUpdate = true;
    },
  };
}

/**
 * Painted-wood horse material for the fused miniature: per-vertex signed
 * part distances (blanket `paint`, `mane`, `saddle`, `shoe`) choose between
 * per-instance colours with an anti-aliased edge; gilded manes and the
 * horseshoes turn to metal.
 */
function miniHorseMaterial(kit) {
  const m = kit.standard({ color: 0xffffff, roughness: 0.32, metalness: 0, vertexColors: true });
  const gold = new THREE.Color(PALETTE.gold);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGold = { value: gold };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float paint;
        attribute float mane;
        attribute float saddle;
        attribute float shoe;
        attribute vec3 instanceCoat;
        attribute vec3 instanceTrim;
        attribute vec3 instanceSaddle;
        attribute vec4 instanceMane;
        varying vec4 vPart;
        varying vec3 vCoat;
        varying vec3 vTrim;
        varying vec3 vSaddle;
        varying vec4 vMane;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vPart = vec4(paint, mane, saddle, shoe);
        vCoat = instanceCoat;
        vTrim = instanceTrim;
        vSaddle = instanceSaddle;
        vMane = instanceMane;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uGold;
        varying vec4 vPart;
        varying vec3 vCoat;
        varying vec3 vTrim;
        varying vec3 vSaddle;
        varying vec4 vMane;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec4 inPart = clamp(0.5 - vPart / max(fwidth(vPart), vec4(1e-5)), 0.0, 1.0);
        vec3 partCol = mix(vCoat, vTrim, inPart.x);
        partCol = mix(partCol, vSaddle, inPart.z);
        partCol = mix(partCol, vMane.rgb, inPart.y);
        partCol = mix(partCol, uGold, inPart.w);
        float gilt = max(inPart.w, inPart.y * vMane.a);
        diffuseColor.rgb *= partCol;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, gilt);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 1.0, gilt);`,
      );
  };
  return m;
}
