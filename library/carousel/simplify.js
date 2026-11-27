/**
 * Quadric-error mesh simplification (Garland & Heckbert) for small closed
 * meshes, such as an SDF sculpt meshed by Surface Nets. Edges are collapsed
 * cheapest first; a collapse is refused if it would flip a face or pinch
 * the surface (the two ends must share exactly two neighbours), so thin parts
 * like legs keep their shape while flat flanks lose their triangles.
 *
 * Pure JS, no three.js. Meant for a few thousand triangles (a horse of 2,400
 * takes a few tens of milliseconds).
 *
 *   const { positions, index } = await simplify(positions, index, 400, { step: ctx.step });
 *
 * Returns new typed arrays (Float32Array positions, Uint16/32Array index)
 * holding only the surviving vertices. Other vertex attributes are not
 * carried: re-evaluate them at the new positions.
 */
export async function simplify(srcPos, srcIndex, targetTris, { step = null, chunk = 150 } = {}) {
  const nv = srcPos.length / 3;
  const P = Float64Array.from(srcPos);
  const F = Int32Array.from(srcIndex);
  const nf = F.length / 3;
  const faceAlive = new Uint8Array(nf).fill(1);
  const vFaces = Array.from({ length: nv }, () => new Set());
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) vFaces[F[f * 3 + k]].add(f);

  // fundamental error quadrics, area-weighted: (a,b,c,d) plane -> 10 coeffs
  const Q = new Float64Array(nv * 10);
  const plane = (f, out) => {
    const a = F[f * 3] * 3, b = F[f * 3 + 1] * 3, c = F[f * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-20) return 0;
    nx /= l;
    ny /= l;
    nz /= l;
    out[0] = nx;
    out[1] = ny;
    out[2] = nz;
    out[3] = -(nx * P[a] + ny * P[a + 1] + nz * P[a + 2]);
    return l * 0.5;
  };
  const pl = [0, 0, 0, 0];
  for (let f = 0; f < nf; f++) {
    const w = plane(f, pl);
    if (!w) continue;
    const [a, b, c, d] = pl;
    const q = [a * a, a * b, a * c, a * d, b * b, b * c, b * d, c * c, c * d, d * d];
    for (let k = 0; k < 3; k++) {
      const o = F[f * 3 + k] * 10;
      for (let i = 0; i < 10; i++) Q[o + i] += q[i] * w;
    }
  }
  const err = (q, x, y, z) =>
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y + q[7] * z * z + 2 * q[8] * z + q[9];

  // edges: key -> { a, b, cost, x, y, z }
  const key = (a, b) => (a < b ? a * nv + b : b * nv + a);
  const edges = new Map();
  const qs = new Float64Array(10);
  const evaluate = (a, b) => {
    for (let i = 0; i < 10; i++) qs[i] = Q[a * 10 + i] + Q[b * 10 + i];
    // candidates: either end or the midpoint (robust, and good enough here)
    let best = Infinity, bx = 0, by = 0, bz = 0;
    const cands = [
      [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]],
      [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]],
      [(P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2],
    ];
    for (const [x, y, z] of cands) {
      const e = err(qs, x, y, z);
      if (e < best) [best, bx, by, bz] = [e, x, y, z];
    }
    return { a: Math.min(a, b), b: Math.max(a, b), cost: Math.max(0, best), x: bx, y: by, z: bz };
  };
  const neighbours = (v) => {
    const s = new Set();
    for (const f of vFaces[v]) for (let k = 0; k < 3; k++) s.add(F[f * 3 + k]);
    s.delete(v);
    return s;
  };
  for (let f = 0; f < nf; f++) {
    for (let k = 0; k < 3; k++) {
      const a = F[f * 3 + k], b = F[f * 3 + ((k + 1) % 3)];
      const kk = key(a, b);
      if (!edges.has(kk)) edges.set(kk, evaluate(a, b));
    }
  }

  /** would moving the faces round u and v to (x,y,z) keep them unflipped and non-degenerate? */
  const n0 = [0, 0, 0, 0], n1 = [0, 0, 0, 0];
  const valid = (u, v, x, y, z) => {
    const nu = neighbours(u), nvv = neighbours(v);
    let shared = 0;
    for (const w of nu) if (nvv.has(w)) shared++;
    if (shared !== 2) return false;
    for (const s of [u, v]) {
      for (const f of vFaces[s]) {
        const fa = F[f * 3], fb = F[f * 3 + 1], fc = F[f * 3 + 2];
        const hasU = fa === u || fb === u || fc === u, hasV = fa === v || fb === v || fc === v;
        if (hasU && hasV) continue; // collapses away
        if (!plane(f, n0)) continue;
        const save = [];
        for (const w of [u, v]) save.push(P[w * 3], P[w * 3 + 1], P[w * 3 + 2]);
        for (const w of [u, v]) {
          P[w * 3] = x;
          P[w * 3 + 1] = y;
          P[w * 3 + 2] = z;
        }
        const ok = plane(f, n1) > 1e-12 && n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] > 0.2;
        [P[u * 3], P[u * 3 + 1], P[u * 3 + 2], P[v * 3], P[v * 3 + 1], P[v * 3 + 2]] = save;
        if (!ok) return false;
      }
    }
    return true;
  };

  // binary min-heap of edges by cost; stale entries (edge gone or re-costed) are skipped
  const heap = [];
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].cost <= heap[i].cost) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
        if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const e of edges.values()) push(e);

  let faces = nf;
  const refused = new Set();
  let done = 0;
  while (faces > targetTris && heap.length) {
    if (step && ++done % chunk === 0) await step();
    const best = pop();
    const k0 = key(best.a, best.b);
    if (edges.get(k0) !== best || refused.has(k0)) continue;
    const { a: v, b: u, x, y, z } = best; // keep v, remove u
    if (!valid(u, v, x, y, z)) {
      refused.add(k0);
      continue;
    }
    // drop the edges that touch u
    for (const w of neighbours(u)) edges.delete(key(u, w));
    for (const f of vFaces[u]) {
      const i = f * 3;
      if (F[i] === v || F[i + 1] === v || F[i + 2] === v) {
        faceAlive[f] = 0;
        faces--;
        for (let k = 0; k < 3; k++) vFaces[F[i + k]].delete(f);
      } else {
        for (let k = 0; k < 3; k++) if (F[i + k] === u) F[i + k] = v;
        vFaces[v].add(f);
      }
    }
    vFaces[u].clear();
    P[v * 3] = x;
    P[v * 3 + 1] = y;
    P[v * 3 + 2] = z;
    for (let i = 0; i < 10; i++) Q[v * 10 + i] += Q[u * 10 + i];
    // v's neighbourhood changed: re-cost its edges and give refused ones another chance
    for (const w of neighbours(v)) {
      const kk = key(v, w);
      const e = evaluate(v, w);
      edges.set(kk, e);
      push(e);
      refused.delete(kk);
      for (const w2 of neighbours(w)) {
        const k2 = key(w, w2);
        if (refused.delete(k2) && edges.has(k2)) push(edges.get(k2));
      }
    }
  }

  // compact
  const remap = new Int32Array(nv).fill(-1);
  let count = 0;
  const idx = [];
  for (let f = 0; f < nf; f++) {
    if (!faceAlive[f]) continue;
    for (let k = 0; k < 3; k++) {
      const v = F[f * 3 + k];
      if (remap[v] < 0) remap[v] = count++;
      idx.push(remap[v]);
    }
  }
  const positions = new Float32Array(count * 3);
  for (let v = 0; v < nv; v++) {
    if (remap[v] < 0) continue;
    positions.set([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], remap[v] * 3);
  }
  const index = count > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  return { positions, index };
}
