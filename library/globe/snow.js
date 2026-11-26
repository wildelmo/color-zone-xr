import * as THREE from 'three';
import { GlowPoints } from '../core/glowPoints.js';
import { G } from './dimensions.js';
import { edgeR, topHeight } from './terrain.js';

/**
 * The snow: a few thousand flakes simulated on the CPU (cheap at this size).
 * Shaking the globe kicks resting flakes up into a swirling vortex; then
 * they drift down, slowly, and settle on the island's roofs and lanes or on
 * the floor of the globe.
 */
export function buildSnow(kit, { lod }) {
  const hero = lod === 'hero';
  const N = hero ? 2600 : 500;
  const pts = new GlowPoints(kit, N, { additive: false, soft: 0.6, core: 1.0, name: 'snow', renderOrder: 9 });
  const P = new Float32Array(N * 3), V = new Float32Array(N * 3), S = new Float32Array(N), R = new Uint8Array(N), ph = new Float32Array(N);
  const C = new THREE.Vector3(0, G.globeY, 0);
  const rad = G.globeR - 1.2;
  const floorAt = (x, z) => G.floorY + 1.0 + 2.2 * Math.max(0, (Math.hypot(x, z) - (G.floorR - 8)) / 8);
  for (let i = 0; i < N; i++) {
    // start mostly settled on the floor, some still drifting
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (G.floorR - 1);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (i % 4 === 0) {
      P[i * 3] = x;
      P[i * 3 + 1] = G.globeY - 30 + Math.random() * 70;
      P[i * 3 + 2] = z;
      R[i] = 0;
    } else {
      P[i * 3] = x;
      P[i * 3 + 1] = floorAt(x, z);
      P[i * 3 + 2] = z;
      R[i] = 1;
    }
    S[i] = 0.22 + Math.random() * 0.3;
    ph[i] = Math.random() * 100;
  }
  let onIsland = 0;
  return {
    mesh: pts.mesh,
    get onIsland() {
      return onIsland;
    },
    update(dt, t, agitation) {
      dt = Math.min(dt, 0.05);
      onIsland = 0;
      const swirl = agitation * 9;
      for (let i = 0; i < N; i++) {
        const o = i * 3;
        let x = P[o], y = P[o + 1], z = P[o + 2];
        if (R[i]) {
          if (agitation > 0.15 && Math.random() < agitation * dt * 4) {
            R[i] = 0;
            V[o] = (Math.random() - 0.5) * 6 * agitation;
            V[o + 1] = (4 + Math.random() * 10) * agitation;
            V[o + 2] = (Math.random() - 0.5) * 6 * agitation;
          } else {
            if (R[i] === 2) onIsland++;
            pts.set(i, x, y, z, 0.95, 0.97, 1.0, S[i] * 0.8, 0.9);
            continue;
          }
        }
        // swirl around the vertical axis + gentle flutter, sinking slowly
        const dx = x, dz = z;
        const rr = Math.hypot(dx, dz) + 1e-3;
        const tx = -dz / rr, tz = dx / rr;
        const flutter = Math.sin(t * 1.7 + ph[i]) * 0.6;
        V[o] += (tx * swirl + Math.sin(t * 0.9 + ph[i] * 1.3) * 0.5 - V[o] * 0.9) * dt;
        V[o + 2] += (tz * swirl + Math.cos(t * 0.8 + ph[i]) * 0.5 - V[o + 2] * 0.9) * dt;
        V[o + 1] += (-1.1 - V[o + 1]) * dt * (agitation > 0.3 ? 0.4 : 1.2) + flutter * dt;
        x += V[o] * dt;
        y += V[o + 1] * dt;
        z += V[o + 2] * dt;
        // keep inside the glass
        const ox = x - C.x, oy = y - C.y, oz = z - C.z;
        const d = Math.hypot(ox, oy, oz);
        if (d > rad) {
          const k = rad / d;
          x = C.x + ox * k;
          y = C.y + oy * k;
          z = C.z + oz * k;
          V[o] *= -0.3;
          V[o + 1] *= -0.3;
          V[o + 2] *= -0.3;
        }
        // land on the island top or the floor
        const r = Math.hypot(x, z);
        if (V[o + 1] < 0 && r < G.edgeR + 2.5 && y < G.islandY + 12 && y > G.islandY - 4 && r < edgeR(Math.atan2(z, x)) - 0.3) {
          const top = G.islandY + topHeight(x, z) + 0.1;
          if (y <= top) {
            y = top;
            R[i] = 2;
          }
        } else if (y < floorAt(x, z)) {
          y = floorAt(x, z);
          R[i] = 1;
        }
        P[o] = x;
        P[o + 1] = y;
        P[o + 2] = z;
        const tw = 0.75 + 0.25 * Math.sin(t * 5 + ph[i]);
        pts.set(i, x, y, z, 0.96, 0.98, 1.0, S[i], tw);
      }
      pts.commit(N);
    },
  };
}
