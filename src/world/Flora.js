import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldMaterial } from './WorldMaterial.js';
import { Rng } from '../util/random.js';
import { WORLD } from '../config.js';

/**
 * Procedural low-poly plants and rocks. Trees/rocks are always present
 * (sketched, then coloured). Flowers, grass tufts and mushrooms are hidden
 * until colour reaches them, then pop up with an elastic bounce (popT).
 * Everything is instanced: a handful of draw calls for thousands of plants.
 */

const HIDDEN = 1e9;

/** turn a primitive into a paintable part with colour/tint/sway attributes */
function part(geo, color, { tint = 0.6, sway = 0, jitter = 0, matrix = null, swayByHeight = false, rng = null } = {}) {
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  if (matrix) geo.applyMatrix4(matrix);
  const n = geo.attributes.position.count;
  const pos = geo.attributes.position;
  const col = new Float32Array(n * 3);
  const tints = new Float32Array(n);
  const sways = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = jitter && rng ? (rng.float() - 0.5) * jitter : 0;
    col[i * 3] = Math.min(1, Math.max(0, color.r + j));
    col[i * 3 + 1] = Math.min(1, Math.max(0, color.g + j));
    col[i * 3 + 2] = Math.min(1, Math.max(0, color.b + j));
    tints[i] = tint;
    sways[i] = swayByHeight ? sway * Math.max(0, pos.getY(i)) : sway;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tints, 1));
  geo.setAttribute('sway', new THREE.BufferAttribute(sways, 1));
  geo.computeVertexNormals();
  return geo;
}

const P = new THREE.Vector3();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function trs(x, y, z, sx = 1, sy = sx, sz = sx, ry = 0) {
  P.set(x, y, z);
  Q.setFromAxisAngle(Y_AXIS, ry);
  S.set(sx, sy, sz);
  return new THREE.Matrix4().compose(P, Q, S);
}

const TRUNK = new THREE.Color('#8a5a3c');
const CANOPIES = ['#4fcf62', '#37b355', '#8fdb4b', '#2f9e6a', '#6fd28f'].map((h) => new THREE.Color(h));
const CANDY = ['#ff9ad0', '#ffd166', '#b8f0ff', '#d5a6ff', '#ffb38a'].map((h) => new THREE.Color(h));
const FLOWER = ['#ff5c8a', '#ffd23f', '#ff8c42', '#9b7bff', '#ffffff', '#56ccf2'].map((h) => new THREE.Color(h));
const STEM = new THREE.Color('#3f9c4a');
const GRASS = ['#5fd36a', '#7fe07a', '#3fb85a'].map((h) => new THREE.Color(h));
const ROCK = new THREE.Color('#9a97a3');
const CAP = ['#ff4d5e', '#ffb347', '#c66dff'].map((h) => new THREE.Color(h));
const STEMW = new THREE.Color('#f4ead6');

function buildRoundTree(rng) {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.11, 0.2, 1.7, 7), TRUNK, { tint: 0.15, matrix: trs(0, 0.85, 0), jitter: 0.06, rng }));
  const n = 3 + rng.int(0, 2);
  const base = rng.pick(CANOPIES);
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.9, 1.5);
    const a = rng.float() * Math.PI * 2;
    const d = i === 0 ? 0 : rng.range(0.4, 0.9);
    const mtx = trs(Math.cos(a) * d, 2.3 + rng.range(-0.2, 0.7), Math.sin(a) * d, r, r * rng.range(0.75, 1.0), r);
    parts.push(part(new THREE.IcosahedronGeometry(1, 1), base, { tint: 0.7, sway: 0.5, matrix: mtx, jitter: 0.1, rng }));
  }
  return mergeGeometries(parts, false);
}

function buildPineTree(rng) {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.1, 0.17, 1.3, 6), TRUNK, { tint: 0.15, matrix: trs(0, 0.6, 0), jitter: 0.06, rng }));
  const base = rng.pick(CANOPIES);
  const tiers = [
    [1.55, 1.6, 1.6],
    [1.2, 1.5, 2.65],
    [0.85, 1.4, 3.6],
  ];
  for (const [r, h, y] of tiers) {
    parts.push(part(new THREE.ConeGeometry(r, h, 7), base, { tint: 0.7, sway: 0.35, matrix: trs(0, y, 0, 1, 1, 1, rng.float()), jitter: 0.08, rng }));
  }
  return mergeGeometries(parts, false);
}

function buildCandyTree(rng) {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.07, 0.13, 2.8, 6), TRUNK, { tint: 0.15, matrix: trs(0, 1.4, 0), jitter: 0.05, rng }));
  const n = 4 + rng.int(0, 2);
  const base = rng.pick(CANDY);
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.55, 0.9);
    const a = rng.float() * Math.PI * 2;
    const d = i === 0 ? 0 : rng.range(0.35, 0.75);
    parts.push(part(new THREE.IcosahedronGeometry(1, 1), base, { tint: 0.75, sway: 0.6, matrix: trs(Math.cos(a) * d, 3.1 + rng.range(-0.3, 0.6), Math.sin(a) * d, r), jitter: 0.08, rng }));
  }
  return mergeGeometries(parts, false);
}

function buildRock(rng) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 1 + (rng.float() - 0.5) * 0.35;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.7, pos.getZ(i) * k);
  }
  return part(geo, ROCK, { tint: 0.3, jitter: 0.1, rng });
}

function buildFlower(rng) {
  const h = rng.range(0.2, 0.36);
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.008, 0.013, h, 3, 1, true), STEM, { tint: 0.3, sway: 1.6, matrix: trs(0, h / 2, 0), swayByHeight: true }));
  const head = new THREE.IcosahedronGeometry(0.058, 0);
  parts.push(part(head, rng.pick(FLOWER), { tint: 0.95, sway: 1.6, matrix: trs(0, h + 0.03, 0, 1, 0.7, 1), swayByHeight: true, jitter: 0.06, rng }));
  return mergeGeometries(parts, false);
}

function buildGrassTuft(rng) {
  const blades = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const h = rng.range(0.22, 0.42);
    const w = rng.range(0.035, 0.06);
    const g = new THREE.BufferGeometry();
    const lean = rng.range(-0.08, 0.08);
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, lean, h, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const m = trs(0, 0, 0, 1, 1, 1, (i / n) * Math.PI + rng.range(-0.3, 0.3));
    const p = part(g, rng.pick(GRASS), { tint: 0.7, sway: 2.2, matrix: m, swayByHeight: true, jitter: 0.08, rng });
    // keep normals pointing up (part() recomputed them)
    p.getAttribute('normal').array.set([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    blades.push(p);
  }
  return mergeGeometries(blades, false);
}

function buildMushroom(rng) {
  const h = rng.range(0.18, 0.3);
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.05, 0.07, h, 6, 1, true), STEMW, { tint: 0.2, matrix: trs(0, h / 2, 0), jitter: 0.03, rng }));
  const cap = new THREE.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  parts.push(part(cap, rng.pick(CAP), { tint: 0.9, matrix: trs(0, h - 0.02, 0, 1, 0.8, 1), jitter: 0.05, rng }));
  return mergeGeometries(parts, false);
}

export class Flora {
  constructor(world, seed) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'flora';
    this.bloomers = [];
    this.build(seed);
  }

  build(seed) {
    const rng = new Rng(seed + 11);
    const terrain = this.world.terrain;
    const shared = this.world.uniforms;
    const R = WORLD.islandRadius;
    const spots = []; // tree positions for spacing

    const okSpot = (x, z, { minD = 1.2, margin = 3, maxSlope = 0.4, spacing = 0, waterMargin = 1.5 } = {}) => {
      if (!terrain.isOnIsland(x, z, margin)) return false;
      const d = Math.hypot(x, z);
      if (d < minD) return false;
      const pd = Math.hypot(x - WORLD.pond.x, z - WORLD.pond.z);
      if (pd < WORLD.pond.radius + waterMargin) return false;
      if (terrain.slopeAt(x, z) > maxSlope) return false;
      // keep the help sign clear
      if (Math.hypot(x + 1.2, z + 2.6) < 1.4) return false;
      if (spacing > 0) {
        for (const s of spots) if (Math.hypot(s[0] - x, s[1] - z) < spacing) return false;
      }
      return true;
    };
    const randomPos = (rMin, rMax) => {
      const a = rng.float() * Math.PI * 2;
      const r = Math.sqrt(rng.float()) * (rMax - rMin) + rMin;
      return [Math.cos(a) * r, Math.sin(a) * r];
    };

    // trees: three species, always visible
    const species = [
      { build: buildRoundTree, count: 34, scale: [0.8, 1.35] },
      { build: buildPineTree, count: 26, scale: [0.8, 1.3] },
      { build: buildCandyTree, count: 22, scale: [0.85, 1.25] },
    ];
    const treeMat = new WorldMaterial(shared, { flat: true, wind: true, name: 'trees' });
    for (const sp of species) {
      const geo = sp.build(rng);
      const mesh = new THREE.InstancedMesh(geo, treeMat, sp.count);
      let placed = 0;
      let tries = 0;
      while (placed < sp.count && tries++ < 4000) {
        const [x, z] = randomPos(5.5, R - 4);
        if (!okSpot(x, z, { minD: 5.5, margin: 4, maxSlope: 0.33, spacing: 3.6 })) continue;
        const s = rng.range(sp.scale[0], sp.scale[1]);
        mesh.setMatrixAt(placed, trs(x, terrain.heightAt(x, z) - 0.15, z, s, s, s, rng.float() * Math.PI * 2));
        spots.push([x, z]);
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.name = 'trees';
      this.group.add(mesh);
    }

    // rocks
    const rockMat = new WorldMaterial(shared, { flat: true, name: 'rocks' });
    {
      const geo = buildRock(rng);
      const count = 48;
      const mesh = new THREE.InstancedMesh(geo, rockMat, count);
      let placed = 0;
      let tries = 0;
      while (placed < count && tries++ < 3000) {
        const [x, z] = randomPos(3, R - 2.5);
        if (!okSpot(x, z, { minD: 3, margin: 2.5, maxSlope: 0.6, waterMargin: -1 })) continue;
        const s = rng.range(0.25, 1.1);
        mesh.setMatrixAt(placed, trs(x, terrain.heightAt(x, z) - s * 0.35, z, s, s * rng.range(0.6, 1), s, rng.float() * Math.PI * 2));
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.name = 'rocks';
      this.group.add(mesh);
    }

    // bloomers: hidden until colour arrives
    const bloomDefs = [
      { name: 'flowers', build: buildFlower, count: 1500, scale: [0.8, 1.4], opts: { flat: true, wind: true, pop: true }, minD: 0.9, perFrame: 220 },
      { name: 'grass', build: buildGrassTuft, count: 2300, scale: [0.55, 1.0], opts: { wind: true, pop: true, double: true }, minD: 0.6, perFrame: 300 },
      { name: 'mushrooms', build: buildMushroom, count: 80, scale: [0.9, 1.6], opts: { flat: true, pop: true }, minD: 2.5, perFrame: 20 },
    ];
    for (const def of bloomDefs) {
      const geo = def.build(rng);
      const mat = new WorldMaterial(shared, { ...def.opts, name: def.name });
      const mesh = new THREE.InstancedMesh(geo, mat, def.count);
      const popT = new THREE.InstancedBufferAttribute(new Float32Array(def.count).fill(HIDDEN), 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('popT', popT);
      const xs = new Float32Array(def.count);
      const zs = new Float32Array(def.count);
      let placed = 0;
      let tries = 0;
      while (placed < def.count && tries++ < def.count * 8) {
        const [x, z] = randomPos(0, R - 3);
        if (!okSpot(x, z, { minD: def.minD, margin: 3, maxSlope: 0.5, waterMargin: 0.6 })) continue;
        const s = rng.range(def.scale[0], def.scale[1]);
        mesh.setMatrixAt(placed, trs(x, terrain.heightAt(x, z) - 0.01, z, s, s, s, rng.float() * Math.PI * 2));
        xs[placed] = x;
        zs[placed] = z;
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.name = def.name;
      this.group.add(mesh);
      this.bloomers.push({ mesh, popT, xs, zs, count: placed, cursor: 0, perFrame: def.perFrame, bloomed: 0 });
    }
  }

  /** hide every bloomer again (new world / clear) */
  resetBlooms() {
    for (const b of this.bloomers) {
      b.popT.array.fill(HIDDEN);
      b.popT.needsUpdate = true;
      b.bloomed = 0;
      b.cursor = 0;
    }
  }

  /** returns the number of plants that bloomed this frame */
  update(time, paintMap, rng) {
    let bloomedNow = 0;
    for (const b of this.bloomers) {
      const arr = b.popT.array;
      let changed = false;
      for (let k = 0; k < b.perFrame; k++) {
        const i = b.cursor;
        b.cursor = (b.cursor + 1) % Math.max(1, b.count);
        if (arr[i] < HIDDEN) continue;
        if (paintMap.coverageAt(b.xs[i], b.zs[i]) > 0.3) {
          arr[i] = time + rng.float() * 0.35;
          changed = true;
          b.bloomed++;
          bloomedNow++;
        }
      }
      if (changed) b.popT.needsUpdate = true;
    }
    return bloomedNow;
  }

  /** world positions of bloomed flowers (for butterflies) */
  *bloomedFlowers(limit = 64) {
    const b = this.bloomers[0];
    if (!b) return;
    let n = 0;
    for (let i = 0; i < b.count && n < limit; i++) {
      if (b.popT.array[i] < HIDDEN) {
        n++;
        yield [b.xs[i], b.zs[i]];
      }
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.group.removeFromParent();
  }
}
