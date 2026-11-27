/**
 * Checks the carousel horse's mane the way it is actually drawn: meshes the
 * body and mane layers with the same mesher and grid spacing as the app, then
 * drops rays straight down onto the top of the neck. Wherever a ray reaches
 * the neck before the hair, the neck shows through the mane (the "shaved
 * strip" a too-thin ridge of hair leaves once it is meshed coarsely).
 *
 *   const r = maneCoverage(layers, 0.034);   // { bare, n, map }
 *
 * x runs along the neck from the withers to the poll (raw horse units), z
 * across it; `map` has one text row per z ('#' hair, '.' bare neck).
 */
import { surfaceNets } from '../../library/core/surfaceNets.js';

const OXH = -0.06; // horseModel's layers are shifted by this along x

/** distance down to the nearest triangle under (x, top, z), or Infinity */
function drop(m, x, top, z) {
  const P = m.positions, I = m.index;
  let best = Infinity;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a], az = P[a + 2], bx = P[b], bz = P[b + 2], cx = P[c], cz = P[c + 2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    const y = l1 * P[a + 1] + l2 * P[b + 1] + l3 * P[c + 1];
    if (y < top) best = Math.min(best, top - y);
  }
  return best;
}

export function maneCoverage(layers, cell, { x0 = 0.32, x1 = 0.64, dx = 0.02, half = 0.06, dz = 0.01 } = {}) {
  const body = surfaceNets(layers.body.sdf, layers.body.bounds, cell);
  const mane = surfaceNets(layers.mane.sdf, layers.mane.bounds, cell);
  let bare = 0, n = 0;
  const map = [];
  for (let z = -half; z <= half + 1e-6; z += dz) {
    let row = '';
    for (let x = x0; x <= x1 + 1e-6; x += dx) {
      const tb = drop(body, x + OXH, 2, z), tm = drop(mane, x + OXH, 2, z);
      n++;
      if (tm < tb) row += '#';
      else {
        bare++;
        row += '.';
      }
    }
    map.push(row);
  }
  return { bare, n, map };
}
