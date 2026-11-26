import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry helpers shared by every asset in the library.
 *
 * The workhorse is GeoBag: parts are added with a transform and a material
 * key, then merged into one mesh per material, so an ornate object made of
 * hundreds of mouldings, bolts and trims still costs only a handful of draw
 * calls on a standalone headset.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** quick transform: position, euler rotation (radians, order YXZ), scale */
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** transform for something placed on a ring: at angle a, radius r, height y, facing outward */
export function ringMat(a, r, y, rx = 0, rz = 0, s = 1) {
  return mat(Math.cos(a) * r, y, Math.sin(a) * r, rx, Math.PI / 2 - a, rz, s);
}

/** make any BufferGeometry compatible for merging: indexed, position/normal/uv[/color] */
export function normalizeGeometry(g, color) {
  let geo = g;
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  for (const k of Object.keys(geo.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') geo.deleteAttribute(k);
  }
  if (color !== undefined) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const n = geo.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = c.r;
      a[i * 3 + 1] = c.g;
      a[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  return geo;
}

export class GeoBag {
  constructor() {
    this.parts = new Map(); // key -> geometries[]
  }

  /**
   * @param {THREE.BufferGeometry} geo  consumed (will be transformed in place)
   * @param {THREE.Matrix4|null} matrix
   * @param {string} key material key
   * @param {THREE.ColorRepresentation} [color] vertex colour (for vertexColors materials)
   */
  add(geo, matrix, key, color) {
    if (matrix) geo.applyMatrix4(matrix);
    normalizeGeometry(geo, color);
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(geo);
    return this;
  }

  /** add the same source geometry at many transforms */
  addMany(geo, matrices, key, color) {
    for (const m of matrices) this.add(geo.clone(), m, key, color);
    geo.dispose();
    return this;
  }

  get keys() {
    return [...this.parts.keys()];
  }

  /** merge everything into meshes; materials is { key: Material } */
  build(materials, { castShadow = true, receiveShadow = true, name = 'bag' } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, list] of this.parts) {
      const mat = materials[key];
      if (!mat) throw new Error(`GeoBag: no material for key "${key}"`);
      const hasColor = list.some((g) => g.attributes.color);
      if (hasColor) for (const g of list) if (!g.attributes.color) normalizeGeometry(g, 0xffffff);
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) throw new Error(`GeoBag: merge failed for "${key}"`);
      if (list.length > 1) for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}:${key}`;
      mesh.castShadow = castShadow && !mat.userData.noShadow;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/** lathe from [radius, y] pairs; optional partial sweep */
export function lathe(profile, segments = 48, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  return new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
}

/**
 * Turned moulding profile helper: describe a profile as a list of steps
 * ['bead', r, y, h] / ['cove', ...] / ['fillet'...] etc. is overkill; here a
 * profile is built from points with optional rounded corners.
 */
export function roundedProfile(points, radius = 0.02, steps = 3) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i === 0 || i === points.length - 1 || radius <= 0) {
      out.push(p);
      continue;
    }
    const a = points[i - 1], b = points[i + 1];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(radius, da * 0.45, db * 0.45);
    const pa = [p[0] + ((a[0] - p[0]) / da) * r, p[1] + ((a[1] - p[1]) / da) * r];
    const pb = [p[0] + ((b[0] - p[0]) / db) * r, p[1] + ((b[1] - p[1]) / db) * r];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // quadratic bezier through the corner
      out.push([
        (1 - t) * (1 - t) * pa[0] + 2 * (1 - t) * t * p[0] + t * t * pb[0],
        (1 - t) * (1 - t) * pa[1] + 2 * (1 - t) * t * p[1] + t * t * pb[1],
      ]);
    }
  }
  return out;
}

/** a half-round bead moulding ring (torus with a flat back) */
export function beadRing(radius, y, size, segments = 64, tubeSeg = 8) {
  const g = new THREE.TorusGeometry(radius, size, tubeSeg, segments);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** points evenly spaced on a horizontal circle */
export function circlePoints(n, r, y, offset = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return pts;
}

/**
 * Barley-twist pole (the classic brass carousel pole): a lobed cross-section
 * swept along +y with a twist. Centered on the origin, length along y.
 */
export function twistedPole(length, radius, { lobes = 4, depth = 0.16, twists = 6, radial = 24, rows = 96 } = {}) {
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  const rOf = (th) => radius * (1 - depth + depth * (0.5 + 0.5 * Math.cos(lobes * th)));
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const y = (v - 0.5) * length;
    const tw = v * twists * Math.PI * 2;
    for (let i = 0; i <= radial; i++) {
      const u = i / radial;
      const th = u * Math.PI * 2;
      const r = rOf(th);
      const a = th + tw;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      // normal: from the lobed profile (derivative in theta) ignoring twist tilt
      const dr = -radius * depth * 0.5 * lobes * Math.sin(lobes * th);
      const tx = -Math.sin(a) * r + Math.cos(a) * dr;
      const tz = Math.cos(a) * r + Math.sin(a) * dr;
      const nx = tz, nz = -tx;
      const l = Math.hypot(nx, nz) || 1;
      nor.push(nx / l, 0, nz / l);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * (radial + 1) + i, b = a + 1, c = a + radial + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // the twist tilts the true normal; recomputing gives the right highlights
  g.computeVertexNormals();
  return g;
}

/**
 * Spur gear in the XY plane, extruded along +z by `depth`, centred at origin.
 * Teeth are trapezoids with rounded tips: reads as a real gear up close.
 */
export function spurGear(teeth, radius, depth, { toothDepth = null, hole = 0, spokes = 0, bevel = true, curveSegments = 2 } = {}) {
  const td = toothDepth ?? (radius * 2 * Math.PI) / teeth * 0.55;
  const ro = radius + td * 0.5;
  const ri = radius - td * 0.5;
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [ri, a - step * 0.5],
      [ri, a - step * 0.28],
      [ro, a - step * 0.14],
      [ro, a + step * 0.14],
      [ri, a + step * 0.28],
    ];
    pts.forEach(([r, t], k) => {
      const x = Math.cos(t) * r, y = Math.sin(t) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  if (spokes > 0) {
    const rim = ri - td * 0.9;
    const hubR = Math.max(hole * 1.8, radius * 0.22);
    for (let s = 0; s < spokes; s++) {
      const a0 = (s / spokes) * Math.PI * 2 + 0.22;
      const a1 = ((s + 1) / spokes) * Math.PI * 2 - 0.22;
      const h = new THREE.Path();
      const n = 10;
      for (let k = 0; k <= n; k++) {
        const t = a0 + ((a1 - a0) * k) / n;
        const fn = k === 0 ? 'moveTo' : 'lineTo';
        h[fn](Math.cos(t) * rim, Math.sin(t) * rim);
      }
      for (let k = n; k >= 0; k--) {
        const t = a0 + 0.06 + ((a1 - a0 - 0.12) * k) / n;
        h.lineTo(Math.cos(t) * (hubR + td * 0.4), Math.sin(t) * (hubR + td * 0.4));
      }
      h.closePath();
      shape.holes.push(h);
    }
  }
  if (hole > 0) {
    const h = new THREE.Path();
    h.absarc(0, 0, hole, 0, Math.PI * 2, true);
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel,
    bevelThickness: Math.min(depth * 0.15, td * 0.15),
    bevelSize: td * 0.08,
    bevelSegments: 1,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Face ("crown") gear: a flat ring with radial teeth standing up from its top
 * face, as in the stationary gear a carousel's pinions roll around.
 * Built in XZ, teeth top at y = 0.
 */
export function crownGear(teeth, rInner, rOuter, thickness, toothH) {
  const parts = [];
  const ring = new THREE.CylinderGeometry(rOuter, rOuter, thickness, teeth * 2, 1, true);
  const ringIn = new THREE.CylinderGeometry(rInner, rInner, thickness, teeth * 2, 1, true);
  ringIn.scale(-1, 1, 1); // flip faces inward
  const top = new THREE.RingGeometry(rInner, rOuter, teeth * 2, 1);
  top.rotateX(-Math.PI / 2);
  top.translate(0, thickness / 2, 0);
  const bottom = new THREE.RingGeometry(rInner, rOuter, teeth * 2, 1);
  bottom.rotateX(Math.PI / 2);
  bottom.translate(0, -thickness / 2, 0);
  parts.push(ring, ringIn, top, bottom);
  const span = rOuter - rInner;
  const w = ((rInner + span * 0.5) * Math.PI * 2) / teeth * 0.48;
  const tooth = new THREE.BoxGeometry(span * 0.92, toothH, w);
  // taper the tooth tops a little
  const p = tooth.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setZ(i, p.getZ(i) * 0.6);
  tooth.computeVertexNormals();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const t = tooth.clone();
    t.translate(rInner + span / 2, thickness / 2 + toothH / 2, 0);
    t.rotateY(-a);
    parts.push(t);
  }
  tooth.dispose();
  const g = mergeGeometries(parts.map((x) => normalizeGeometry(x)), false);
  parts.forEach((x) => x.dispose());
  g.translate(0, -(thickness / 2 + toothH), 0);
  return g;
}

/** tube along points (Catmull-Rom), skipping duplicate points */
export function tube(points, radius, { closed = false, segments = null, radial = 6, tension = 0.5 } = {}) {
  const pts = [];
  for (const p of points) {
    const v = p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]);
    if (!pts.length || pts[pts.length - 1].distanceToSquared(v) > 1e-8) pts.push(v);
  }
  if (closed && pts.length > 2 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-8) pts.pop();
  if (pts.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', tension);
  return new THREE.TubeGeometry(curve, segments ?? Math.max(4, pts.length * 2), radius, radial, closed);
}

/** tube whose radius tapers from r0 to r1 along its length */
export function taperedTube(points, r0, r1, { segments = 24, radial = 6, tension = 0.5 } = {}) {
  const pts = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', tension);
  const g = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const p = g.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, c);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  // round end caps
  const caps = [];
  for (const [t, r] of [[0, r0], [1, r1]]) {
    const s = new THREE.SphereGeometry(r, Math.max(4, radial), 3);
    curve.getPointAt(t, c);
    s.translate(c.x, c.y, c.z);
    caps.push(s);
  }
  g.computeVertexNormals();
  const out = mergeGeometries([normalizeGeometry(g), ...caps.map((x) => normalizeGeometry(x))], false);
  g.dispose();
  caps.forEach((x) => x.dispose());
  return out;
}

/**
 * Gilded filigree cresting: C-scrolls, curling leaves and a crown leaf built
 * from tapered tubes, so it reads as carved relief rather than a flat cut-out.
 * Built in XY facing +z, base centred at the origin, ~1 x 0.85 at scale 1.
 */
export function filigreeCrest(scale = 1, { radial = 5, segments = 18, medallion = true } = {}) {
  const parts = [];
  const S = (pts, sx = 1) => pts.map(([x, y, z = 0]) => [x * sx * scale, y * scale, z * scale]);
  for (const sx of [1, -1]) {
    parts.push(taperedTube(S([[0.04, 0.03], [0.3, 0.02], [0.5, 0.06], [0.56, 0.18], [0.5, 0.32], [0.36, 0.41], [0.23, 0.37], [0.2, 0.27], [0.26, 0.21], [0.32, 0.25], [0.3, 0.3]], sx), 0.045 * scale, 0.014 * scale, { segments: segments + 8, radial }));
    parts.push(taperedTube(S([[0.12, 0.5], [0.2, 0.6], [0.3, 0.68], [0.38, 0.66], [0.38, 0.59], [0.33, 0.58]], sx), 0.038 * scale, 0.01 * scale, { segments, radial }));
    parts.push(taperedTube(S([[0.48, 0.07], [0.62, 0.1], [0.68, 0.2], [0.63, 0.25]], sx), 0.03 * scale, 0.01 * scale, { segments: Math.round(segments * 0.6), radial }));
    const ball = new THREE.SphereGeometry(0.035 * scale, radial + 1, radial);
    ball.translate(0.56 * sx * scale, 0.42 * scale, 0);
    parts.push(normalizeGeometry(ball));
  }
  parts.push(taperedTube(S([[0, 0.57], [0.03, 0.66], [-0.02, 0.75], [0, 0.86]]), 0.05 * scale, 0.012 * scale, { segments, radial }));
  if (medallion) {
    const ring = tube(ellipsePoints(0.17 * scale, 0.21 * scale, 20).map((v) => v.add(new THREE.Vector3(0, 0.36 * scale, 0))), 0.03 * scale, { closed: true, segments: 32, radial });
    parts.push(normalizeGeometry(ring));
  }
  const out = mergeGeometries(parts.map((g) => normalizeGeometry(g)), false);
  parts.forEach((g) => g.dispose());
  return out;
}

/** decorative scroll (C-scroll / S-scroll) outline as a Shape, extruded by the caller */
export function scrollShape(w, h, { curl = 0.35 } = {}) {
  const s = new THREE.Shape();
  // a leafy acanthus-ish cartouche: symmetric C-scrolls around a shield
  s.moveTo(0, h);
  s.bezierCurveTo(w * 0.18, h * 1.02, w * 0.22, h * 0.78, w * 0.12, h * 0.7);
  s.bezierCurveTo(w * 0.32, h * 0.82, w * 0.5, h * 0.62, w * 0.42, h * 0.36);
  s.bezierCurveTo(w * 0.38, h * 0.18, w * 0.2, h * (0.12 + curl * 0.1), w * 0.22, h * 0.3);
  s.bezierCurveTo(w * 0.3, h * 0.36, w * 0.34, h * 0.2, w * 0.5, 0);
  s.lineTo(-w * 0.5, 0);
  s.bezierCurveTo(-w * 0.34, h * 0.2, -w * 0.3, h * 0.36, -w * 0.22, h * 0.3);
  s.bezierCurveTo(-w * 0.2, h * (0.12 + curl * 0.1), -w * 0.38, h * 0.18, -w * 0.42, h * 0.36);
  s.bezierCurveTo(-w * 0.5, h * 0.62, -w * 0.32, h * 0.82, -w * 0.12, h * 0.7);
  s.bezierCurveTo(-w * 0.22, h * 0.78, -w * 0.18, h * 1.02, 0, h);
  return s;
}

/** rounded rectangle Shape centred on the origin */
export function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** points around an ellipse in the XY plane */
export function ellipsePoints(rx, ry, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * rx, Math.sin(a) * ry, 0));
  }
  return pts;
}

/**
 * Bend a flat panel geometry (built in XY, facing +z) around the y axis onto a
 * cylinder of radius R, so x becomes arc length. The panel's +z faces outward.
 */
export function bendAroundY(geo, R) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const a = x / R;
    const r = R + z;
    p.setXYZ(i, Math.sin(a) * r, p.getY(i), Math.cos(a) * r);
    if (n) {
      const nx = n.getX(i), nz = n.getZ(i);
      n.setXYZ(i, nx * Math.cos(a) + nz * Math.sin(a), n.getY(i), -nx * Math.sin(a) + nz * Math.cos(a));
    }
  }
  p.needsUpdate = true;
  if (n) n.needsUpdate = true;
  return geo;
}

/** dispose every geometry / material / texture under an object */
export function disposeDeep(root) {
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    if (o.isInstancedMesh && o.dispose) o.dispose();
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
    m.dispose();
  }
}
