import * as THREE from 'three';
import { Noise2D } from '../util/noise.js';
import { WORLD } from '../config.js';
import { smoothstep, clamp } from '../util/math.js';

/**
 * A floating island: polar grid so the rim is a clean circle, hills from
 * layered simplex noise, a flat spawn meadow in the centre, a pond bowl,
 * and a rocky underside that tapers to a point beneath the island.
 * heightAt() is analytic so gameplay never needs raycasts.
 */
export class Terrain {
  constructor(seed = 1) {
    this.seed = seed;
    this.noise = new Noise2D(seed);
    this.noiseB = new Noise2D(seed * 7 + 3);
    this.radius = WORLD.islandRadius;
    this.pond = WORLD.pond;
    this.pondDepth = 1.4;
  }

  /** ground height (metres) at world x,z. Off-island returns falling values. */
  heightAt(x, z) {
    const d = Math.hypot(x, z);
    const n = this.noise.fbm(x * 0.028, z * 0.028, 4) * 2.4 + this.noise.get(x * 0.09 + 7.1, z * 0.09) * 0.45;
    let h = n + 0.4;
    // flat spawn meadow
    h *= smoothstep(1.5, 9, d);
    // rim drops away
    const rim = smoothstep(this.radius - 9, this.radius + 1, d);
    h -= rim * rim * 7;
    // pond bowl
    const p = this.pond;
    const pd = Math.hypot(x - p.x, z - p.z);
    const bowl = 1 - smoothstep(p.radius * 0.55, p.radius * 1.35, pd);
    h -= bowl * this.pondDepth;
    return h;
  }

  /** the pond's water level */
  get waterLevel() {
    return this.heightAt(this.pond.x, this.pond.z) + this.pondDepth * 0.62;
  }

  isWater(x, z) {
    return Math.hypot(x - this.pond.x, z - this.pond.z) < this.pond.radius * 0.9;
  }

  isOnIsland(x, z, margin = 2) {
    return Math.hypot(x, z) < this.radius - margin;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.35;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  slopeAt(x, z) {
    return 1 - this.normalAt(x, z).y;
  }

  buildGeometry() {
    const rings = 96;
    const segs = 160;
    const R = this.radius;
    const positions = [];
    const colors = [];
    const tints = [];
    const sways = [];
    const indices = [];
    const grassA = new THREE.Color('#5fd36a');
    const grassB = new THREE.Color('#3aa84f');
    const grassC = new THREE.Color('#9be055');
    const rock = new THREE.Color('#8d8a94');
    const dirt = new THREE.Color('#8a5f3f');
    const under = new THREE.Color('#5a4a52');
    const tmp = new THREE.Color();
    const nrm = new THREE.Vector3();

    // top surface rings (0..R), then lip, then underside cone
    const topRings = rings;
    const underRings = 22;
    const totalRings = topRings + underRings;
    const ringRadius = (i) => {
      if (i <= topRings) {
        const t = i / topRings;
        return R * Math.pow(t, 0.85); // denser near centre
      }
      const t = (i - topRings) / underRings; // 0..1 going under
      return R * (1 - Math.pow(t, 1.6)) * 0.98 + 0.02;
    };
    const ringY = (i, x, z) => {
      if (i <= topRings) return this.heightAt(x, z);
      const t = (i - topRings) / underRings;
      const rimH = this.heightAt(x, z);
      return rimH - Math.pow(t, 0.7) * 26 - 0.6;
    };

    for (let i = 0; i <= totalRings; i++) {
      const r = ringRadius(i);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const jitter = i > 0 && i < topRings ? this.noiseB.get(i * 0.7, j * 0.3) * 0.25 : 0;
        const x = Math.cos(a) * (r + jitter);
        const z = Math.sin(a) * (r + jitter);
        const y = ringY(i, x, z);
        positions.push(x, y, z);
        if (i <= topRings) {
          this.normalAt(x, z, nrm);
          const slope = 1 - nrm.y;
          const nn = this.noiseB.fbm(x * 0.12, z * 0.12, 3) * 0.5 + 0.5;
          tmp.copy(grassA).lerp(grassB, nn).lerp(grassC, Math.max(0, this.noise.get(x * 0.2, z * 0.2 + 3)) * 0.6);
          if (slope > 0.22) tmp.lerp(rock, smoothstep(0.22, 0.45, slope));
          const pd = Math.hypot(x - this.pond.x, z - this.pond.z);
          if (pd < this.pond.radius * 1.15) tmp.lerp(dirt, 1 - smoothstep(this.pond.radius * 0.8, this.pond.radius * 1.15, pd));
          const rim = smoothstep(R - 4, R, Math.hypot(x, z));
          tmp.lerp(dirt, rim * 0.7);
          colors.push(tmp.r, tmp.g, tmp.b);
          tints.push(0.8 - slope * 0.5);
        } else {
          const t = (i - topRings) / underRings;
          tmp.copy(dirt).lerp(under, Math.min(1, t * 1.6));
          const v = this.noiseB.get(x * 0.3, y * 0.3) * 0.12;
          colors.push(clamp(tmp.r + v, 0, 1), clamp(tmp.g + v, 0, 1), clamp(tmp.b + v, 0, 1));
          tints.push(0.25);
        }
        sways.push(0);
      }
    }
    // centre vertex handled by ring 0 having radius 0 (all segs collapse) — fine for indexing
    for (let i = 0; i < totalRings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * segs + j;
        const b = i * segs + ((j + 1) % segs);
        const c = (i + 1) * segs + j;
        const d = (i + 1) * segs + ((j + 1) % segs);
        if (i === 0) {
          indices.push(a, d, c);
        } else {
          indices.push(a, d, c, a, b, d);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('tint', new THREE.Float32BufferAttribute(tints, 1));
    geo.setAttribute('sway', new THREE.Float32BufferAttribute(sways, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}
