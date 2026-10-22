import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldMaterial, addSmoothNormals } from './WorldMaterial.js';
import { Rng } from '../util/random.js';
import { WORLD } from '../config.js';

/**
 * Procedural low-poly plants and rocks. Trees/rocks are always present
 * (sketched, then coloured) and wear a graphite outline. Flowers, grass
 * tufts and mushrooms are hidden until colour reaches them, then pop up
 * with an elastic bounce (popT). Trees and rocks carry a pokeT attribute (the
 * time something poked them) so they wobble when touched — see play/Boops.js.
 * Everything is instanced.
 */

const HIDDEN = 1e9;
const STILL = -1e9; // pokeT for "never poked"

/** turn a primitive into a paintable part with colour/tint/sway attributes */
function part(geo, color, { tint = 0.6, sway = 0, jitter = 0, matrix = null, swayByHeight = false, rng = null, upNormals = false } = {}) {
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
  if (upNormals) {
    const nrm = geo.attributes.normal;
    for (let i = 0; i < n; i++) nrm.setXYZ(i, 0, 1, 0);
  }
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

/** organic lumpiness: push vertices in/out by a hash of their position (shared verts stay shared) */
function lumpy(geo, amount = 0.12) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const k = 1 + (h - Math.floor(h) - 0.5) * 2 * amount;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  return geo;
}

const TRUNK = new THREE.Color('#8a5a3c');
const CANOPIES = ['#4fcf62', '#37b355', '#8fdb4b', '#2f9e6a', '#6fd28f'].map((h) => new THREE.Color(h));
const CANDY = ['#ff9ad0', '#ffd166', '#b8f0ff', '#d5a6ff', '#ffb38a'].map((h) => new THREE.Color(h));
const PETALS = ['#ff5c8a', '#ffd23f', '#ff8c42', '#9b7bff', '#ffffff', '#56ccf2', '#ff6ad5'].map((h) => new THREE.Color(h));
const CENTER = new THREE.Color('#ffcf3d');
const STEM = new THREE.Color('#3f9c4a');
const GRASS = ['#5fd36a', '#7fe07a', '#3fb85a', '#8fe28a'].map((h) => new THREE.Color(h));
const ROCK = new THREE.Color('#9a97a3');
const CAP = ['#ff4d5e', '#ffb347', '#c66dff', '#ff7ab8'].map((h) => new THREE.Color(h));
const STEMW = new THREE.Color('#f4ead6');

export function buildRoundTree(rng) {
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.11, 0.2, 1.7, 7), TRUNK, { tint: 0.15, matrix: trs(0, 0.85, 0), jitter: 0.06, rng }));
  const n = 3 + rng.int(0, 2);
  const base = rng.pick(CANOPIES);
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.9, 1.5);
    const a = rng.float() * Math.PI * 2;
    const d = i === 0 ? 0 : rng.range(0.4, 0.9);
    const mtx = trs(Math.cos(a) * d, 2.3 + rng.range(-0.2, 0.7), Math.sin(a) * d, r, r * rng.range(0.75, 1.0), r);
    parts.push(part(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.1), base, { tint: 0.7, sway: 0.5, matrix: mtx, jitter: 0.1, rng }));
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
    parts.push(part(lumpy(new THREE.ConeGeometry(r, h, 8), 0.05), base, { tint: 0.7, sway: 0.35, matrix: trs(0, y, 0, 1, 1, 1, rng.float()), jitter: 0.08, rng }));
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
    parts.push(part(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.12), base, { tint: 0.75, sway: 0.6, matrix: trs(Math.cos(a) * d, 3.1 + rng.range(-0.3, 0.6), Math.sin(a) * d, r), jitter: 0.08, rng }));
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

/** a curved petal: 2x1 quad bent upward, double sided */
function petalGeometry(len, wid) {
  const g = new THREE.PlaneGeometry(wid, len, 1, 3);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / len + 0.5; // 0 at base .. 1 at tip
    const taper = 0.35 + 0.65 * Math.sin(t * Math.PI);
    pos.setX(i, pos.getX(i) * taper);
    pos.setZ(i, -t * t * len * 0.55);
    pos.setY(i, y + len / 2);
  }
  g.rotateX(-Math.PI / 2 + 0.75);
  return g;
}

function buildDaisy(rng) {
  const h = rng.range(0.18, 0.32);
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.007, 0.011, h, 3, 1, true), STEM, { tint: 0.3, sway: 1.6, matrix: trs(0, h / 2, 0), swayByHeight: true }));
  const col = rng.pick(PETALS);
  const n = 5 + rng.int(0, 1);
  const len = rng.range(0.045, 0.06);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Matrix4().makeRotationY((i / n) * Math.PI * 2).setPosition(0, h, 0);
    parts.push(part(petalGeometry(len, len * 0.55), col, { tint: 0.95, sway: 1.6, matrix: m, swayByHeight: true, jitter: 0.05, rng }));
  }
  parts.push(part(new THREE.IcosahedronGeometry(0.018, 0), CENTER, { tint: 0.25, sway: 1.6, matrix: trs(0, h + 0.008, 0, 1, 0.7, 1), swayByHeight: true }));
  return mergeGeometries(parts, false);
}

function buildTulip(rng) {
  const h = rng.range(0.2, 0.34);
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.007, 0.011, h, 3, 1, true), STEM, { tint: 0.3, sway: 1.6, matrix: trs(0, h / 2, 0), swayByHeight: true }));
  // a leaf
  parts.push(part(petalGeometry(0.09, 0.03), STEM, { tint: 0.4, sway: 1.6, matrix: new THREE.Matrix4().makeRotationY(rng.float() * 6.28).setPosition(0, h * 0.3, 0), swayByHeight: true }));
  const col = rng.pick(PETALS);
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector2(0.004 + Math.sin(t * Math.PI * 0.85) * 0.032, t * 0.07));
  }
  const cup = new THREE.LatheGeometry(pts, 6);
  parts.push(part(cup, col, { tint: 0.95, sway: 1.6, matrix: trs(0, h - 0.005, 0), swayByHeight: true, jitter: 0.05, rng }));
  return mergeGeometries(parts, false);
}

function buildGrassTuft(rng) {
  const blades = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const h = rng.range(0.16, 0.3);
    const w = rng.range(0.018, 0.03);
    const g = new THREE.PlaneGeometry(w, h, 1, 2);
    const pos = g.attributes.position;
    const lean = rng.range(0.03, 0.09);
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) + h / 2;
      const t = y / h;
      pos.setX(k, pos.getX(k) * (1 - t * 0.85));
      pos.setY(k, y);
      pos.setZ(k, -t * t * lean);
    }
    const m = trs(rng.range(-0.02, 0.02), 0, rng.range(-0.02, 0.02), 1, 1, 1, (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4));
    blades.push(part(g, rng.pick(GRASS), { tint: 0.75, sway: 2.4, matrix: m, swayByHeight: true, jitter: 0.08, rng, upNormals: true }));
  }
  return mergeGeometries(blades, false);
}

function buildMushroom(rng) {
  const h = rng.range(0.16, 0.28);
  const parts = [];
  parts.push(part(new THREE.CylinderGeometry(0.045, 0.06, h, 7, 1, true), STEMW, { tint: 0.2, matrix: trs(0, h / 2, 0), jitter: 0.03, rng }));
  const cap = new THREE.SphereGeometry(0.15, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  parts.push(part(cap, rng.pick(CAP), { tint: 0.9, matrix: trs(0, h - 0.02, 0, 1, 0.8, 1), jitter: 0.05, rng }));
  // white spots as tiny flattened spheres
  for (let i = 0; i < 4; i++) {
    const a = rng.float() * Math.PI * 2;
    const r = rng.range(0.04, 0.1);
    parts.push(part(new THREE.IcosahedronGeometry(0.018, 0), STEMW, { tint: 0.1, matrix: trs(Math.cos(a) * r, h - 0.02 + 0.11 * Math.sqrt(1 - (r / 0.15) ** 2) * 0.8, Math.sin(a) * r, 1, 0.5, 1) }));
  }
  return mergeGeometries(parts, false);
}

export class Flora {
  constructor(world, seed) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'flora';
    this.bloomers = [];
    this.shadowStamps = [];
    this.bloomedNow = [];
    this.trees = []; // { x, z, y, s, species, canopyY, r, mesh, i }
    this.rocks = []; // { x, z, y, s, r, mesh, i }
    this.build(seed);
  }

  _instanced(geo, material, count, name, outline = null) {
    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.frustumCulled = false;
    mesh.name = name;
    this.group.add(mesh);
    let outlineMesh = null;
    if (outline) {
      addSmoothNormals(geo);
      outlineMesh = new THREE.InstancedMesh(geo, outline, count);
      outlineMesh.instanceMatrix = mesh.instanceMatrix; // share transforms
      outlineMesh.frustumCulled = false;
      outlineMesh.name = name + '-outline';
      this.group.add(outlineMesh);
    }
    return { mesh, outlineMesh };
  }

  build(seed) {
    const rng = new Rng(seed + 11);
    const terrain = this.world.terrain;
    const shared = this.world.uniforms;
    const R = WORLD.islandRadius;
    const spots = [];
    this.shadowStamps.length = 0;
    this.trees.length = 0;
    this.rocks.length = 0;

    const okSpot = (x, z, { minD = 1.2, margin = 3, maxSlope = 0.4, spacing = 0, waterMargin = 1.5 } = {}) => {
      if (!terrain.isOnIsland(x, z, margin)) return false;
      const d = Math.hypot(x, z);
      if (d < minD) return false;
      const pd = Math.hypot(x - WORLD.pond.x, z - WORLD.pond.z);
      if (pd < WORLD.pond.radius + waterMargin) return false;
      if (terrain.slopeAt(x, z) > maxSlope) return false;
      if (Math.hypot(x + 1.2, z + 2.6) < 1.4) return false; // help sign
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

    const treeMat = new WorldMaterial(shared, { flat: true, wind: true, poke: true, name: 'trees' });
    const treeOutline = new WorldMaterial(shared, { flat: true, wind: true, poke: true, outline: true, outlineWidth: 0.035, name: 'trees-outline' });
    const species = [
      { id: 'round', build: buildRoundTree, count: 34, scale: [0.8, 1.35], shadow: 1.5, canopyY: 2.3, r: 1.4 },
      { id: 'pine', build: buildPineTree, count: 26, scale: [0.8, 1.3], shadow: 1.4, canopyY: 2.2, r: 1.1 },
      { id: 'candy', build: buildCandyTree, count: 22, scale: [0.85, 1.25], shadow: 1.0, canopyY: 2.0, r: 1.0 },
    ];
    for (const sp of species) {
      const geo = sp.build(rng);
      const { mesh, outlineMesh } = this._instanced(geo, treeMat, sp.count, 'trees', treeOutline);
      const pokeT = new THREE.InstancedBufferAttribute(new Float32Array(sp.count).fill(STILL), 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('pokeT', pokeT); // shared with the outline mesh, so both wobble together
      let placed = 0;
      let tries = 0;
      while (placed < sp.count && tries++ < 4000) {
        const [x, z] = randomPos(5.5, R - 4);
        if (!okSpot(x, z, { minD: 5.5, margin: 4, maxSlope: 0.33, spacing: 3.6 })) continue;
        const s = rng.range(sp.scale[0], sp.scale[1]);
        const ty = terrain.heightAt(x, z) - 0.15;
        mesh.setMatrixAt(placed, trs(x, ty, z, s, s, s, rng.float() * Math.PI * 2));
        spots.push([x, z]);
        this.shadowStamps.push({ x, z, r: sp.shadow * s, strength: 0.7 });
        this.trees.push({ x, z, y: ty, s, species: sp.id, canopyY: ty + sp.canopyY * s, r: sp.r * s, mesh, i: placed, pokeT });
        placed++;
      }
      mesh.count = outlineMesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
    }

    const rockMat = new WorldMaterial(shared, { flat: true, poke: true, name: 'rocks' });
    const rockOutline = new WorldMaterial(shared, { flat: true, poke: true, outline: true, outlineWidth: 0.02, name: 'rocks-outline' });
    {
      const geo = buildRock(rng);
      const count = 48;
      const { mesh, outlineMesh } = this._instanced(geo, rockMat, count, 'rocks', rockOutline);
      const pokeT = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(STILL), 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('pokeT', pokeT);
      let placed = 0;
      let tries = 0;
      while (placed < count && tries++ < 3000) {
        const [x, z] = randomPos(3, R - 2.5);
        if (!okSpot(x, z, { minD: 3, margin: 2.5, maxSlope: 0.6, waterMargin: -1 })) continue;
        const s = rng.range(0.25, 1.1);
        const ry = terrain.heightAt(x, z) - s * 0.35;
        mesh.setMatrixAt(placed, trs(x, ry, z, s, s * rng.range(0.6, 1), s, rng.float() * Math.PI * 2));
        this.shadowStamps.push({ x, z, r: s * 1.1, strength: 0.4 });
        this.rocks.push({ x, z, y: ry, s, r: s * 0.9, mesh, i: placed, pokeT });
        placed++;
      }
      mesh.count = outlineMesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
    }

    // bloomers: hidden until colour arrives; denser near the spawn meadow
    const bloomDefs = [
      { name: 'daisies', build: buildDaisy, count: 900, scale: [0.85, 1.35], opts: { wind: true, pop: true, double: true }, minD: 0.9, perFrame: 160, near: 0.55 },
      { name: 'tulips', build: buildTulip, count: 500, scale: [0.85, 1.3], opts: { flat: true, wind: true, pop: true, double: true }, minD: 0.9, perFrame: 90, near: 0.55 },
      { name: 'grass', build: buildGrassTuft, count: 2600, scale: [0.7, 1.25], opts: { wind: true, pop: true, double: true }, minD: 0.5, perFrame: 340, near: 0.6 },
      { name: 'mushrooms', build: buildMushroom, count: 90, scale: [0.9, 1.6], opts: { flat: true, pop: true }, minD: 2.5, perFrame: 20, near: 0.3 },
    ];
    for (const def of bloomDefs) {
      const geo = def.build(rng);
      const mat = new WorldMaterial(shared, { ...def.opts, name: def.name });
      const { mesh } = this._instanced(geo, mat, def.count, def.name);
      const popT = new THREE.InstancedBufferAttribute(new Float32Array(def.count).fill(HIDDEN), 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('popT', popT);
      const xs = new Float32Array(def.count);
      const zs = new Float32Array(def.count);
      let placed = 0;
      let tries = 0;
      while (placed < def.count && tries++ < def.count * 10) {
        // a share of plants cluster in the meadow around the start, the rest spread out
        const [x, z] = rng.float() < def.near ? randomPos(0, 14) : randomPos(0, R - 3);
        if (!okSpot(x, z, { minD: def.minD, margin: 3, maxSlope: 0.5, waterMargin: 0.6 })) continue;
        const s = rng.range(def.scale[0], def.scale[1]);
        mesh.setMatrixAt(placed, trs(x, terrain.heightAt(x, z) - 0.01, z, s, s, s, rng.float() * Math.PI * 2));
        xs[placed] = x;
        zs[placed] = z;
        placed++;
      }
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      this.bloomers.push({ mesh, popT, xs, zs, count: placed, cursor: 0, perFrame: def.perFrame, bloomed: 0, flower: def.name !== 'grass' && def.name !== 'mushrooms' });
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

  /** returns the number of plants that bloomed this frame; positions of a few in bloomedNow */
  update(time, paintMap, rng) {
    let bloomedNow = 0;
    this.bloomedNow.length = 0;
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
          if (this.bloomedNow.length < 6) this.bloomedNow.push([b.xs[i], b.zs[i], b.flower]);
        }
      }
      if (changed) b.popT.needsUpdate = true;
    }
    return bloomedNow;
  }

  /** world positions of bloomed flowers (for butterflies) */
  *bloomedFlowers(limit = 64) {
    let n = 0;
    for (const b of this.bloomers) {
      if (!b.flower) continue;
      for (let i = 0; i < b.count && n < limit; i += 2) {
        if (b.popT.array[i] < HIDDEN) {
          n++;
          yield [b.xs[i], b.zs[i]];
        }
      }
    }
  }

  dispose() {
    const seen = new Set();
    this.group.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
    });
    this.group.removeFromParent();
  }
}
