/**
 * Naive Surface Nets mesher: turns a signed distance function into a smooth
 * indexed triangle mesh. One vertex per surface cell (relaxed onto the
 * surface with a Newton step), one quad per sign-changing grid edge, normals
 * from the field gradient so even modest resolutions shade like a sculpt.
 *
 * Pure JS (runs in a worker): returns typed arrays, no three.js.
 */

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * @param {(x:number,y:number,z:number)=>number} f
 * @param {number[]} bounds [minx,miny,minz,maxx,maxy,maxz]
 * @param {number} cell grid spacing
 * @param {{color?:(x:number,y:number,z:number)=>number[], attributes?:Object<string,(x:number,y:number,z:number)=>number>}} [opts]
 */
export function surfaceNets(f, bounds, cell, opts = {}) {
  const [x0, y0, z0, x1, y1, z1] = bounds;
  const nx = Math.ceil((x1 - x0) / cell) + 2;
  const ny = Math.ceil((y1 - y0) / cell) + 2;
  const nz = Math.ceil((z1 - z0) / cell) + 2;
  const ox = x0 - cell * 0.5, oy = y0 - cell * 0.5, oz = z0 - cell * 0.5;
  const F = new Float32Array(nx * ny * nz);
  const idx = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) {
    const z = oz + k * cell;
    for (let j = 0; j < ny; j++) {
      const y = oy + j * cell;
      let o = nx * (j + ny * k);
      for (let i = 0; i < nx; i++) F[o++] = f(ox + i * cell, y, z);
    }
  }

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const v = new Float32Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const C = CORNERS[c];
          const val = F[idx(i + C[0], j + C[1], k + C[2])];
          v[c] = val;
          if (val < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const [a, b] = EDGES[e];
          const va = v[a], vb = v[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          const A = CORNERS[a], B = CORNERS[b];
          sx += A[0] + (B[0] - A[0]) * t;
          sy += A[1] + (B[1] - A[1]) * t;
          sz += A[2] + (B[2] - A[2]) * t;
          n++;
        }
        let px = ox + (i + sx / n) * cell;
        let py = oy + (j + sy / n) * cell;
        let pz = oz + (k + sz / n) * cell;
        // one Newton step onto the surface, kept near its cell to avoid folds
        const e = cell * 0.05;
        const d = f(px, py, pz);
        const gx = (f(px + e, py, pz) - f(px - e, py, pz)) / (2 * e);
        const gy = (f(px, py + e, pz) - f(px, py - e, pz)) / (2 * e);
        const gz = (f(px, py, pz + e) - f(px, py, pz - e)) / (2 * e);
        const gl = gx * gx + gy * gy + gz * gz;
        if (gl > 1e-10) {
          const s = d / gl;
          const lim = cell * 0.6;
          px -= Math.max(-lim, Math.min(lim, gx * s));
          py -= Math.max(-lim, Math.min(lim, gy * s));
          pz -= Math.max(-lim, Math.min(lim, gz * s));
        }
        cellVert[i + cx * (j + cy * k)] = pos.length / 3;
        pos.push(px, py, pz);
      }
    }
  }

  const cid = (i, j, k) => cellVert[i + cx * (j + cy * k)];
  const tris = [];
  const P = pos;
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) {
      const t = b;
      b = d;
      d = t;
    }
    // split along the shorter diagonal
    const dac = (P[a * 3] - P[c * 3]) ** 2 + (P[a * 3 + 1] - P[c * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[c * 3 + 2]) ** 2;
    const dbd = (P[b * 3] - P[d * 3]) ** 2 + (P[b * 3 + 1] - P[d * 3 + 1]) ** 2 + (P[b * 3 + 2] - P[d * 3 + 2]) ** 2;
    if (dac <= dbd) tris.push(a, b, c, a, c, d);
    else tris.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const inside = F[idx(i, j, k)] < 0;
        // x edge
        if (i < nx - 1 && j > 0 && k > 0 && j < cy && k < cz) {
          if (inside !== F[idx(i + 1, j, k)] < 0) quad(cid(i, j - 1, k - 1), cid(i, j, k - 1), cid(i, j, k), cid(i, j - 1, k), !inside);
        }
        // y edge
        if (j < ny - 1 && i > 0 && k > 0 && i < cx && k < cz) {
          if (inside !== F[idx(i, j + 1, k)] < 0) quad(cid(i - 1, j, k - 1), cid(i - 1, j, k), cid(i, j, k), cid(i, j, k - 1), !inside);
        }
        // z edge
        if (k < nz - 1 && i > 0 && j > 0 && i < cx && j < cy) {
          if (inside !== F[idx(i, j, k + 1)] < 0) quad(cid(i - 1, j - 1, k), cid(i, j - 1, k), cid(i, j, k), cid(i - 1, j, k), !inside);
        }
      }
    }
  }

  const count = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(count * 3);
  const e = cell * 0.25;
  for (let n = 0; n < count; n++) {
    const px = positions[n * 3], py = positions[n * 3 + 1], pz = positions[n * 3 + 2];
    let gx = f(px + e, py, pz) - f(px - e, py, pz);
    let gy = f(px, py + e, pz) - f(px, py - e, pz);
    let gz = f(px, py, pz + e) - f(px, py, pz - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals[n * 3] = gx / l;
    normals[n * 3 + 1] = gy / l;
    normals[n * 3 + 2] = gz / l;
  }
  let colors = null;
  if (opts.color) {
    colors = new Float32Array(count * 3);
    for (let n = 0; n < count; n++) {
      const c = opts.color(positions[n * 3], positions[n * 3 + 1], positions[n * 3 + 2]);
      colors[n * 3] = c[0];
      colors[n * 3 + 1] = c[1];
      colors[n * 3 + 2] = c[2];
    }
  }
  const attributes = {};
  if (opts.attributes) {
    for (const [name, fn] of Object.entries(opts.attributes)) {
      const a = new Float32Array(count);
      for (let n = 0; n < count; n++) a[n] = fn(positions[n * 3], positions[n * 3 + 1], positions[n * 3 + 2]);
      attributes[name] = a;
    }
  }
  const index = count < 65536 ? new Uint16Array(tris) : new Uint32Array(tris);
  return { positions, normals, colors, index, attributes };
}
