/**
 * Signed distance field toolkit (pure JS, no three.js) so models can be
 * "sculpted" from smooth primitives and meshed in a worker.
 *
 * Every primitive factory returns a closure f(x, y, z) -> signed distance
 * (negative inside). Distances are only exact near the surface, which is all
 * the mesher needs.
 */

export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

export function sphere(cx, cy, cz, r) {
  return (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r;
}

/** axis-aligned ellipsoid (bound approximation by Inigo Quilez) */
export function ellipsoid(cx, cy, cz, rx, ry, rz) {
  return (x, y, z) => {
    const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
    const k0 = Math.sqrt(px * px + py * py + pz * pz);
    const qx = px / rx, qy = py / ry, qz = pz / rz;
    const k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  };
}

/** cone with rounded ends between points a and b, radii r1 at a and r2 at b */
export function roundCone(a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * bax + pay * bay + paz * baz;
    const zz = yy - l2;
    const cx = pax * l2 - bax * yy, cy = pay * l2 - bay * yy, cz = paz * l2 - baz * yy;
    const x2 = cx * cx + cy * cy + cz * cz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}

export function capsule(a, b, r) {
  return roundCone(a, b, r, r);
}

/**
 * A tapered tube through a list of points (Catmull-Rom smoothed), as a union
 * of round cones. radii is either one number per point or [start, end].
 */
export function chain(points, radii, smooth = 0, subdiv = 3) {
  const pts = catmull(points, subdiv);
  const n = pts.length;
  const rad = (i) => {
    const t = i / (n - 1);
    if (radii.length === 2 && points.length !== 2) return radii[0] + (radii[1] - radii[0]) * t;
    const f = t * (radii.length - 1);
    const i0 = Math.min(radii.length - 2, Math.floor(f));
    const u = f - i0;
    return radii[i0] + (radii[i0 + 1] - radii[i0]) * u;
  };
  const segs = [];
  for (let i = 0; i < n - 1; i++) segs.push(roundCone(pts[i], pts[i + 1], rad(i), rad(i + 1)));
  const bb = boundsOf(pts, Math.max(...radii));
  return (x, y, z) => {
    // cheap reject: distance to the chain's bounding box
    const dx = Math.max(bb[0] - x, 0, x - bb[3]);
    const dy = Math.max(bb[1] - y, 0, y - bb[4]);
    const dz = Math.max(bb[2] - z, 0, z - bb[5]);
    const out = Math.hypot(dx, dy, dz);
    if (out > 0.05) return out;
    let d = Infinity;
    for (let i = 0; i < segs.length; i++) d = smooth > 0 ? smin(d, segs[i](x, y, z), smooth) : Math.min(d, segs[i](x, y, z));
    return d;
  };
}

function boundsOf(pts, pad) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let i = 0; i < 3; i++) {
      b[i] = Math.min(b[i], p[i] - pad);
      b[i + 3] = Math.max(b[i + 3], p[i] + pad);
    }
  }
  return b;
}

/** Catmull-Rom resample of a polyline (keeps end points) */
export function catmull(points, subdiv = 3) {
  if (points.length < 3 || subdiv <= 1) return points.map((p) => p.slice());
  const out = [];
  const P = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv, t2 = t * t, t3 = t2 * t;
      const q = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        q[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      }
      out.push(q);
    }
  }
  out.push(points[points.length - 1].slice());
  return out;
}

/** numeric gradient (unnormalised) */
export function gradient(f, x, y, z, e = 1e-3) {
  return [
    f(x + e, y, z) - f(x - e, y, z),
    f(x, y + e, z) - f(x, y - e, z),
    f(x, y, z + e) - f(x, y, z - e),
  ];
}

/** project a point onto the iso-surface f = offset by a few Newton steps */
export function projectToSurface(f, p, offset = 0, iters = 6) {
  let [x, y, z] = p;
  for (let i = 0; i < iters; i++) {
    const d = f(x, y, z) - offset;
    const g = gradient(f, x, y, z).map((c) => c / 2e-3);
    const gl = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
    if (gl < 1e-12) break;
    x -= (g[0] * d) / gl;
    y -= (g[1] * d) / gl;
    z -= (g[2] * d) / gl;
    if (Math.abs(d) < 1e-5) break;
  }
  return [x, y, z];
}

/**
 * Cross-section contour of the surface f = offset in a plane: rays are cast
 * from `center` along cos(a)*u + sin(a)*v for angles a0..a1 and the first
 * crossing is found by stepping + bisection.
 */
export function contour(f, center, u, v, { a0 = 0, a1 = Math.PI * 2, n = 48, offset = 0, maxT = 1.5, step = 0.01 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / (n - 1);
    const dx = Math.cos(a) * u[0] + Math.sin(a) * v[0];
    const dy = Math.cos(a) * u[1] + Math.sin(a) * v[1];
    const dz = Math.cos(a) * u[2] + Math.sin(a) * v[2];
    let t0 = 0;
    let t1 = -1;
    for (let t = step; t <= maxT; t += step) {
      if (f(center[0] + dx * t, center[1] + dy * t, center[2] + dz * t) > offset) {
        t1 = t;
        t0 = t - step;
        break;
      }
    }
    if (t1 < 0) continue;
    for (let k = 0; k < 24; k++) {
      const tm = (t0 + t1) / 2;
      if (f(center[0] + dx * tm, center[1] + dy * tm, center[2] + dz * tm) > offset) t1 = tm;
      else t0 = tm;
    }
    const t = (t0 + t1) / 2;
    pts.push([center[0] + dx * t, center[1] + dy * t, center[2] + dz * t]);
  }
  return pts;
}

/** first surface crossing from p along dir (for placing eyes, gems, studs) */
export function hitSurface(f, p, dir, offset = 0, maxT = 1, step = 0.005) {
  let prev = 0;
  const inside0 = f(p[0], p[1], p[2]) < offset;
  for (let t = step; t <= maxT; t += step) {
    const inside = f(p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t) < offset;
    if (inside !== inside0) {
      let a = prev, b = t;
      for (let k = 0; k < 24; k++) {
        const m = (a + b) / 2;
        const im = f(p[0] + dir[0] * m, p[1] + dir[1] * m, p[2] + dir[2] * m) < offset;
        if (im === inside0) a = m;
        else b = m;
      }
      const tt = (a + b) / 2;
      return [p[0] + dir[0] * tt, p[1] + dir[1] * tt, p[2] + dir[2] * tt];
    }
    prev = t;
  }
  return null;
}

export function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
