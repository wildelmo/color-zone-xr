import * as THREE from 'three';
import { mat } from '../core/geometry.js';
import { tileUV } from './townTextures.js';

/**
 * Carved detail for the town, sized to read when the globe is blown up to
 * the size of a carousel ride: real window frames, sills, shutters and
 * flower boxes over the painted windows, half-timbering that stands proud
 * of the plaster, door surrounds with steps, hoods and lamps, bargeboards,
 * dormers, a lip of snow along every eave with icicles under it, and the
 * chimney tops that smoke.
 *
 * Positions follow the façade atlas (townTextures.js): a bay is one tile,
 * its window sits 64/256 down from the top, 96/256 of the bay wide.
 *
 * Two bags: `bag` gets the structural pieces that still read when the globe
 * sits on the table (shutters, doors and their hoods and steps, balcony
 * floors, bargeboards, dormers, the snow along the eaves); `trim` gets the
 * carved members a few centimetres across (frames, mullions, sills, beams,
 * railings, garlands, wreaths, lamps, wires, icicles), which the globe only
 * shows when they are big enough to see (see index.js). Which bag a part
 * goes to never changes the random draws, so the layout stays the same.
 */

// trim (frames, sills) and beam colours by façade style
const TRIM = ['#4a2c1a', '#6d665c', '#efe4d2', '#3c2a1e'];
const BEAM = ['#4a2c1a', null, null, '#3c2a1e'];
const SHUTTER = ['#3d5a3a', '#6a2a22', '#2f4a5a', '#7a5a2a', '#4a3a5a'];
const DOOR = ['#5a3420', '#2f4a5a', '#6a2a22', '#3d5a3a'];

export function makeDetailer(bag, rnd, { hero = true, trim = bag } = {}) {
  const lamps = [];
  const chimneys = [];
  const fairy = []; // { p, color } little string lights along some eaves

  /** a box of trim from its size, placed by the frame m then a local offset */
  const box = (m, w, h, d, x, y, z, key, color, attrs, rx = 0, ry = 0, rz = 0) => trim.add(new THREE.BoxGeometry(w, h, d), m.clone().multiply(mat(x, y, z, rx, ry, rz)), key, color, attrs);
  /** the same for a structural piece (big enough to read from the table) */
  const panel = (m, w, h, d, x, y, z, key, color, attrs, rx = 0, ry = 0, rz = 0) => bag.add(new THREE.BoxGeometry(w, h, d), m.clone().multiply(mat(x, y, z, rx, ry, rz)), key, color, attrs);

  /**
   * Detail for one wall bay. f is the bay's frame: origin at the bay's
   * bottom-left on the wall face, +x along the wall, +y up, +z out of it.
   */
  function bay(f, len, h, style, kind, house, attrs, back = false, where = {}) {
    if (!hero) return;
    const trimColor = TRIM[style];
    const out = 0.035;
    const S = 256;
    if (kind === 1 || kind === 2) {
      const ww = (len * 96) / S;
      const wh = (h * (kind === 1 ? 110 : 120)) / S;
      const top = h * (1 - 64 / S);
      const cx = len / 2, cy = top - wh / 2;
      const fw = 0.07;
      // a deep frame, with a dark reveal inside it so the window looks set in
      box(f, ww + 2 * fw, fw, 0.13, cx, top + fw / 2, 0.06, 'wood', trimColor, attrs);
      box(f, fw, wh, 0.13, cx - ww / 2 - fw / 2, cy, 0.06, 'wood', trimColor, attrs);
      box(f, fw, wh, 0.13, cx + ww / 2 + fw / 2, cy, 0.06, 'wood', trimColor, attrs);
      box(f, ww, 0.03, 0.1, cx, top - 0.015, 0.05, 'wood', '#2a2018', attrs);
      for (const s of [-1, 1]) box(f, 0.03, wh, 0.1, cx + s * (ww / 2 - 0.015), cy, 0.05, 'wood', '#2a2018', attrs);
      // mullion cross
      box(f, 0.035, wh, 0.03, cx, cy, out - 0.01, 'wood', trimColor, attrs);
      box(f, ww, 0.035, 0.03, cx, top - wh * 0.45, out - 0.01, 'wood', trimColor, attrs);
      // sill (snow collects on it) and, for stone, a keystone lintel
      box(f, ww + 0.3, 0.07, 0.2, cx, top - wh - 0.06, 0.09, 'stone', style === 1 ? '#a8a196' : trimColor, attrs);
      if (style === 1) box(f, ww + 0.34, 0.16, 0.1, cx, top + 0.13, 0.05, 'stone', '#9a948a', attrs);
      // shutters, swung half open
      if (style !== 1 && !back) {
        const sw = ww * 0.42;
        for (const s of [-1, 1]) {
          const hx = cx + s * (ww / 2 + fw);
          const open = 0.5 + rnd() * 0.5;
          const sh = f.clone().multiply(mat(hx, cy, 0.04, 0, -s * open, 0));
          panel(sh, sw, wh + 0.04, 0.035, (s * sw) / 2, 0, 0, 'wood', house.shutter, attrs);
        }
      }
      // a balcony under the middle front window of the first floor
      if (where.balcony) {
        const bw = ww + 0.9, bd = 0.62, by = top - wh - 0.1;
        panel(f, bw, 0.08, bd, cx, by, bd / 2, 'wood', '#5a3a24', attrs);
        for (const s of [-1, 1]) box(f, 0.06, 0.06, bd * 1.3, cx + s * (bw / 2 - 0.1), by - 0.28, bd * 0.42, 'wood', '#3a2618', attrs, 0.78);
        const n = Math.round(bw / 0.16);
        for (let k = 0; k <= n; k++) box(f, 0.035, 0.42, 0.035, cx - bw / 2 + 0.04 + (k * (bw - 0.08)) / n, by + 0.25, bd - 0.04, 'wood', '#3a2618', attrs);
        for (const s of [-1, 1]) for (let k = 1; k < 4; k++) box(f, 0.035, 0.42, 0.035, cx + s * (bw / 2 - 0.04), by + 0.25, (k * bd) / 4, 'wood', '#3a2618', attrs);
        box(f, bw, 0.05, 0.07, cx, by + 0.48, bd - 0.04, 'wood', '#5a3a24', attrs);
        for (const s of [-1, 1]) box(f, 0.07, 0.05, bd, cx + s * (bw / 2 - 0.04), by + 0.48, bd / 2, 'wood', '#5a3a24', attrs);
        // a garland along its rail
        garland(f, [cx - bw / 2 + 0.05, by + 0.5, bd], [cx + bw / 2 - 0.05, by + 0.5, bd], 0.14, attrs);
      } else if (!back && rnd() < 0.35) {
        // a flower box of winter greens now and then
        box(f, ww + 0.1, 0.2, 0.2, cx, top - wh - 0.2, 0.15, 'wood', '#5a3a24', attrs);
        box(f, ww - 0.02, 0.1, 0.16, cx, top - wh - 0.06, 0.15, 'wood', '#2f5a38', attrs);
        for (let k = 0; k < 5; k++) trim.add(new THREE.IcosahedronGeometry(0.035, 0), f.clone().multiply(mat(cx - ww / 2 + 0.1 + (k * (ww - 0.2)) / 4, top - wh + 0.0, 0.15 + (rnd() - 0.5) * 0.08)), 'wood', '#a8202a', attrs);
      }
    } else if (kind === 0) {
      const dw = (len * 84) / S, dh = (h * 150) / S;
      const cx = len / 2, base = (h * 16) / S;
      // stone surround and a step
      box(f, 0.12, dh + 0.1, 0.1, cx - dw / 2 - 0.06, base + dh / 2, out, 'stone', '#a8a196', attrs);
      box(f, 0.12, dh + 0.1, 0.1, cx + dw / 2 + 0.06, base + dh / 2, out, 'stone', '#a8a196', attrs);
      box(f, dw + 0.44, 0.16, 0.12, cx, base + dh + 0.1, out, 'stone', '#9a948a', attrs);
      panel(f, dw + 0.5, 0.18, 0.45, cx, 0.02, 0.22, 'stone', '#8a847a', attrs);
      // the door itself, set in, with planks and a ring
      panel(f, dw, dh * 0.82, 0.05, cx, base + dh * 0.41, 0.01, 'wood', house.door, attrs);
      for (let k = 1; k < 4; k++) box(f, 0.02, dh * 0.8, 0.02, cx - dw / 2 + (k * dw) / 4, base + dh * 0.41, 0.04, 'wood', '#2a1a10', attrs);
      // a little pitched hood over the door
      const hood = f.clone().multiply(mat(cx, base + dh + 0.32, 0.32));
      for (const s of [-1, 1]) panel(hood, dw * 0.62 + 0.25, 0.06, 0.72, s * (dw * 0.3 + 0.08), 0, 0, 'roof', house.roof, attrs, 0, 0, -s * 0.55);
      for (const s of [-1, 1]) box(f, 0.05, 0.05, 0.5, cx + s * (dw / 2 + 0.2), base + dh + 0.05, 0.25, 'wood', '#3a2618', attrs, -0.7);
      // a wreath on the door, and a garland swagged over it
      if (rnd() < 0.7) {
        trim.add(new THREE.TorusGeometry(0.15, 0.05, 6, 14), f.clone().multiply(mat(cx, base + dh * 0.62, 0.08)), 'wood', '#24502e', attrs);
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          trim.add(new THREE.IcosahedronGeometry(0.022, 0), f.clone().multiply(mat(cx + Math.cos(a) * 0.15, base + dh * 0.62 + Math.sin(a) * 0.15, 0.12)), 'wood', '#b8202a', attrs);
        }
        box(f, 0.12, 0.07, 0.03, cx, base + dh * 0.62 + 0.17, 0.12, 'wood', '#b8202a', attrs);
      }
      if (rnd() < 0.5) garland(f, [cx - dw / 2 - 0.12, base + dh + 0.05, 0.14], [cx + dw / 2 + 0.12, base + dh + 0.05, 0.14], 0.16, attrs);
      // a lamp beside the door
      const lx = cx + (rnd() < 0.5 ? -1 : 1) * (dw / 2 + 0.38);
      box(f, 0.05, 0.05, 0.22, lx, base + dh * 0.8, 0.11, 'wood', '#2a2420', attrs);
      box(f, 0.16, 0.22, 0.16, lx, base + dh * 0.8 - 0.12, 0.22, 'wood', '#2a2420', attrs);
      lamps.push(new THREE.Vector3(lx, base + dh * 0.8 - 0.12, 0.22).applyMatrix4(f));
    } else if (kind === 3) {
      // a round window: a ring of trim
      const ring = new THREE.TorusGeometry(0.34 * (len / 2.3), 0.05, 4, hero ? 12 : 8);
      trim.add(ring, f.clone().multiply(mat(len / 2, h * (1 - 110 / S), out)), 'wood', trimColor, attrs);
    }
  }

  /** an evergreen garland swagged between two points (frame f), with berries */
  function garland(f, a, b, sag, attrs) {
    const n = Math.max(6, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.07));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const y = a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag;
      const x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t;
      trim.add(new THREE.IcosahedronGeometry(0.05 + rnd() * 0.015, 0), f.clone().multiply(mat(x, y, z, rnd() * 3, rnd() * 3, 0)), 'wood', rnd() < 0.5 ? '#24502e' : '#1d4428', attrs);
      if (k % 3 === 1) trim.add(new THREE.IcosahedronGeometry(0.02, 0), f.clone().multiply(mat(x, y - 0.04, z + 0.04)), 'wood', '#c0202a', attrs);
    }
  }

  /** half-timbering standing proud of a timber-framed storey (one wall) */
  function timbers(f, len, h, bays, style, upper, attrs) {
    if (!hero || !BEAM[style]) return;
    const c = BEAM[style];
    const t = 0.13, d = 0.06, z = 0.03;
    box(f, len + 0.02, 0.12, d, len / 2, h - 0.05, z, 'wood', c, attrs);
    box(f, len + 0.02, 0.16, d, len / 2, 0.08, z, 'wood', c, attrs);
    for (let b = 0; b <= bays; b++) box(f, t, h, d, (len * b) / bays, h / 2, z, 'wood', c, attrs);
    if (upper) {
      // braces from the sill beam up to the posts, either side of each window
      for (let b = 0; b < bays; b++) {
        const x0 = (len * b) / bays, x1 = (len * (b + 1)) / bays;
        const bw = x1 - x0;
        const dx = bw * 0.22, dy = h * 0.45;
        const L = Math.hypot(dx, dy), a = Math.atan2(dx, dy);
        box(f, 0.1, L, d, x0 + t / 2 + dx / 2, 0.16 + dy / 2, z, 'wood', c, attrs, 0, 0, -a);
        box(f, 0.1, L, d, x1 - t / 2 - dx / 2, 0.16 + dy / 2, z, 'wood', c, attrs, 0, 0, a);
      }
    }
  }

  /**
   * Eaves of a pitched roof (frame fr: x along the ridge, z across, y = 0 at
   * the wall tops): bargeboards on the gables, a lip of snow along both
   * eaves and icicles hanging under it.
   */
  function eaves(fr, span, len, R, tanA, oh, ohg, attrs, house) {
    if (!hero) return;
    const ang = Math.atan(tanA);
    const run = span / 2 + oh, drop = oh * tanA;
    const slope = Math.hypot(run, R + drop);
    for (const sgn of [1, -1]) {
      // bargeboards up both slopes of each gable
      for (const gx of [-1, 1]) {
        const x = gx * (len / 2 + ohg + 0.03);
        const cy = (R - drop) / 2 + Math.cos(ang) * 0.1, cz = (sgn * run) / 2 + sgn * Math.sin(ang) * 0.1;
        box(fr, 0.06, 0.3, slope, x, cy, cz, 'wood', house.barge, attrs, sgn * ang);
      }
      // the snow lip along the eave, slightly lumpy
      const ez = sgn * (run - 0.04), ey = -drop + 0.24;
      const lip = new THREE.CylinderGeometry(0.17, 0.17, len + 2 * ohg + 0.06, 7, 1).rotateZ(Math.PI / 2);
      bag.add(lip, fr.clone().multiply(mat(0, ey, ez, 0, 0, 0, 1, 0.8, 1)), 'snow', '#f4f8ff', attrs);
      // string lights along the street-side eave of some houses: a dark wire
      // hooked under the eave every few bulbs, sagging between the hooks,
      // with a bulb hanging from it every 0.32
      if (house.lights && sgn === 1) {
        const m = Math.floor((len + 2 * ohg) / 0.32);
        const per = 4; // bulbs between hooks
        const pal = house.lights;
        const x0 = -len / 2 - ohg + 0.08, x1 = len / 2 + ohg - 0.08;
        const zw = sgn * (run - 0.03), yh = -drop - 0.025;
        const wireAt = (t) => {
          const f = (t * m) / per; // position between hooks
          const y = yh - Math.sin(Math.PI * (f - Math.floor(f))) * 0.07;
          return new THREE.Vector3(x0 + t * (x1 - x0), y, zw);
        };
        const steps = m * 2;
        let prev = wireAt(0);
        for (let k = 1; k <= steps; k++) {
          const cur = wireAt(k / steps);
          const mid = prev.clone().add(cur).multiplyScalar(0.5);
          const d = cur.clone().sub(prev);
          const seg = new THREE.CylinderGeometry(0.012, 0.012, d.length() + 0.004, 4);
          seg.rotateZ(-Math.atan2(d.x, d.y));
          trim.add(seg, fr.clone().multiply(mat(mid.x, mid.y, mid.z)), 'wood', '#1a1816', attrs);
          prev = cur;
        }
        for (let k = 0; k <= m; k++) {
          const w = wireAt(k / m);
          if (k % per === 0) box(fr, 0.03, 0.05, 0.03, w.x, w.y + 0.02, w.z, 'wood', '#1a1816', attrs); // a hook
          fairy.push({ p: new THREE.Vector3(w.x, w.y - 0.045, w.z).applyMatrix4(fr), color: pal[k % pal.length] });
        }
      }
      // icicles
      const n = Math.floor((len + 2 * ohg) / 0.28);
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.3) continue;
        const x = -len / 2 - ohg + ((k + 0.3 + rnd() * 0.4) / n) * (len + 2 * ohg);
        const il = 0.15 + rnd() * rnd() * 0.75;
        const ic = new THREE.ConeGeometry(0.045 + rnd() * 0.03, il, 5).rotateX(Math.PI);
        trim.add(ic, fr.clone().multiply(mat(x, -drop + 0.03 - il / 2, ez + sgn * 0.03)), 'ice', undefined, attrs);
      }
    }
  }

  /**
   * A dormer window on the slope of a roof (frame fr as for eaves), facing
   * +z; uses pitchedRoof for its own little roof. Returns false if it
   * doesn't fit under the main roof.
   */
  function dormer(fr, span, R, x, style, pitchedRoof, house, attrs) {
    if (!hero) return false;
    const dw = 1.3, hd = 1.15, depth = 1.7;
    const zf = span / 2 - 0.35;
    const yAt = (z) => R * (1 - Math.abs(z) / (span / 2));
    const y0 = yAt(zf) - 0.15;
    const miniTan = 1.1;
    const topY = y0 + hd + (dw / 2) * miniTan + 0.25;
    if (topY > yAt(zf - depth) - 0.05) return false;
    const df = fr.clone().multiply(mat(x, y0, zf - depth / 2));
    // cheeks and front (the front carries a window tile)
    for (const s of [-1, 1]) panel(df, 0.08, hd, depth, s * (dw / 2 - 0.04), hd / 2, 0, 'wood', house.barge, attrs);
    const [u0, v0, u1, v1] = tileUV(style, 2);
    const q = new THREE.PlaneGeometry(dw, hd);
    const uv = q.attributes.uv;
    // the middle of the window tile
    const um = (u0 + u1) / 2, uw = (u1 - u0) * 0.42;
    const vt = v1 - (v1 - v0) * 0.2, vb = v1 - (v1 - v0) * 0.78;
    uv.setXY(0, um - uw, vt);
    uv.setXY(1, um + uw, vt);
    uv.setXY(2, um - uw, vb);
    uv.setXY(3, um + uw, vb);
    bag.add(q, df.clone().multiply(mat(0, hd / 2, depth / 2)), 'walls', undefined, { ...attrs, lit: house.lit + 0.1 });
    box(df, dw + 0.1, 0.08, 0.22, 0, 0.04, depth / 2 + 0.08, 'stone', TRIM[style], attrs);
    // its roof, ridge running out toward the street
    pitchedRoof(df.clone().multiply(mat(0, hd, 0)), dw, depth, false, miniTan, house.roof, style, attrs.build, house.lit, { small: true });
    return true;
  }

  /** remember a chimney top (frame-local point) so it can smoke */
  function chimney(p) {
    chimneys.push(p.clone());
  }

  return { bay, timbers, eaves, dormer, chimney, garland, lamps, chimneys, fairy, box };
}

const LIGHTS = [
  ['#ff4a3a', '#3ad06a', '#ffcf40', '#4a8aff'],
  ['#ffd890'],
  ['#ff4a3a', '#ffd890'],
];

export function houseLook(rnd) {
  return {
    shutter: SHUTTER[Math.floor(rnd() * SHUTTER.length)],
    door: DOOR[Math.floor(rnd() * DOOR.length)],
    barge: ['#3a2618', '#4a2c1a', '#2a2420', '#5a3a24'][Math.floor(rnd() * 4)],
    lights: rnd() < 0.35 ? LIGHTS[Math.floor(rnd() * LIGHTS.length)] : null,
    balcony: rnd() < 0.3,
  };
}
