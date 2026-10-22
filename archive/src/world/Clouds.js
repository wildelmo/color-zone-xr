import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldMaterial } from './WorldMaterial.js';
import { Rng } from '../util/random.js';

/**
 * Puffy low-poly clouds merged into one mesh. Each cloud drifts as a unit
 * (vertex shader reads its centre + speed from the cloudInfo attribute).
 * Some float below the island so the world reads as a sky island.
 */
export class Clouds {
  constructor(world, seed) {
    const rng = new Rng(seed + 99);
    const white = new THREE.Color('#f7f9ff');
    const parts = [];
    const count = 30;
    for (let c = 0; c < count; c++) {
      const below = c > 21;
      const a = rng.float() * Math.PI * 2;
      const r = below ? rng.range(45, 100) : rng.range(18, 120);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const cy = below ? rng.range(-26, -9) : rng.range(16, 42);
      const speed = rng.range(0.25, 0.8) * (rng.chance(0.5) ? 1 : -1);
      const puffs = rng.int(4, 7);
      const size = rng.range(1.5, 3.2) * (r > 60 ? 1.8 : 1);
      for (let p = 0; p < puffs; p++) {
        const px = cx + rng.range(-1.2, 1.2) * size;
        const pz = cz + rng.range(-0.6, 0.6) * size;
        const py = cy + rng.range(-0.2, 0.35) * size;
        const pr = size * rng.range(0.5, 1) * (p === 0 ? 1.15 : 1);
        const g = new THREE.IcosahedronGeometry(1, 1);
        g.deleteAttribute('uv');
        g.applyMatrix4(new THREE.Matrix4().makeScale(pr, pr * 0.62, pr).setPosition(px, py, pz));
        const n = g.attributes.position.count;
        const col = new Float32Array(n * 3);
        const info = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          const j = (rng.float() - 0.5) * 0.04;
          col[i * 3] = white.r + j;
          col[i * 3 + 1] = white.g + j;
          col[i * 3 + 2] = white.b + j;
          info[i * 4] = cx;
          info[i * 4 + 1] = cz;
          info[i * 4 + 2] = speed;
          info[i * 4 + 3] = 0;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n).fill(0), 1));
        g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(n).fill(0), 1));
        g.setAttribute('cloudInfo', new THREE.BufferAttribute(info, 4));
        parts.push(g);
      }
    }
    const geo = mergeGeometries(parts, false);
    geo.computeVertexNormals();
    const mat = new WorldMaterial(world.uniforms, { flat: true, cloud: true, globalColor: true, tint: 0, emissive: 0.5, name: 'clouds' });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'clouds';
  }
}
