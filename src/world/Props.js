import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldMaterial, addSmoothNormals } from './WorldMaterial.js';
import { buildRoundTree } from './Flora.js';
import { Rng } from '../util/random.js';
import { WORLD } from '../config.js';

/** helper: primitive → coloured part */
function part(geo, color, { tint = 0.5, jitter = 0, matrix = null, rng = null } = {}) {
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  if (matrix) geo.applyMatrix4(matrix);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter && rng ? (rng.float() - 0.5) * jitter : 0;
    col[i * 3] = Math.min(1, Math.max(0, color.r + j));
    col[i * 3 + 1] = Math.min(1, Math.max(0, color.g + j));
    col[i * 3 + 2] = Math.min(1, Math.max(0, color.b + j));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n).fill(tint), 1));
  geo.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(n).fill(0), 1));
  geo.computeVertexNormals();
  return geo;
}

const STONE = new THREE.Color('#c9c2cf');
const STONE_DARK = new THREE.Color('#a39bb0');
const PAD = new THREE.Color('#4cbf5a');
const PAD_FLOWER = new THREE.Color('#ff8fc0');
const ISLET_ROCK = new THREE.Color('#8b6f5e');
const ISLET_GRASS = new THREE.Color('#5fd36a');

/**
 * A little stone fountain in the pond: the visible source of the bubbles
 * and a constant sparkle of spray.
 */
export class Fountain {
  constructor(world, rng) {
    const shared = world.uniforms;
    const p = WORLD.pond;
    const y = world.terrain.waterLevel;
    const parts = [];
    const m = (yy, s = 1) => new THREE.Matrix4().makeScale(s, 1, s).setPosition(0, yy, 0);
    parts.push(part(new THREE.CylinderGeometry(1.05, 1.2, 0.5, 12), STONE, { tint: 0.35, matrix: m(0.25 - 0.3), jitter: 0.05, rng }));
    parts.push(part(new THREE.CylinderGeometry(0.85, 0.95, 0.12, 12), STONE_DARK, { tint: 0.35, matrix: m(0.26), jitter: 0.05, rng }));
    parts.push(part(new THREE.CylinderGeometry(0.16, 0.22, 0.8, 8), STONE, { tint: 0.35, matrix: m(0.7), jitter: 0.04, rng }));
    parts.push(part(new THREE.CylinderGeometry(0.55, 0.3, 0.22, 12), STONE, { tint: 0.35, matrix: m(1.15), jitter: 0.05, rng }));
    parts.push(part(new THREE.CylinderGeometry(0.1, 0.13, 0.35, 8), STONE_DARK, { tint: 0.35, matrix: m(1.4), jitter: 0.04, rng }));
    parts.push(part(new THREE.SphereGeometry(0.17, 12, 8), STONE, { tint: 0.35, matrix: m(1.66), jitter: 0.04, rng }));
    const geo = mergeGeometries(parts, false);
    addSmoothNormals(geo);
    this.group = new THREE.Group();
    this.group.name = 'fountain';
    this.mesh = new THREE.Mesh(geo, new WorldMaterial(shared, { flat: true, name: 'fountain' }));
    this.outline = new THREE.Mesh(geo, new WorldMaterial(shared, { flat: true, outline: true, outlineWidth: 0.02, name: 'fountain-outline' }));
    this.group.add(this.mesh, this.outline);
    this.group.position.set(p.x, y, p.z);
    this.top = new THREE.Vector3(p.x, y + 1.85, p.z);
    this.shadowStamps = [{ x: p.x, z: p.z, r: 1.6, strength: 0.4 }];
  }
}

/** flat lily pads with the odd flower, merged into one mesh */
export function buildLilyPads(world, rng) {
  const p = WORLD.pond;
  const y = world.terrain.waterLevel + 0.012;
  const parts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = rng.float() * Math.PI * 2;
    const d = rng.range(1.9, p.radius * 0.78);
    const r = rng.range(0.22, 0.42);
    const pad = new THREE.CircleGeometry(r, 14, rng.float() * 6.28, 5.6);
    pad.rotateX(-Math.PI / 2);
    pad.translate(p.x + Math.cos(a) * d, y, p.z + Math.sin(a) * d);
    parts.push(part(pad, PAD, { tint: 0.55, jitter: 0.06, rng }));
    if (rng.chance(0.45)) {
      const fl = new THREE.IcosahedronGeometry(0.06, 0);
      fl.scale(1, 0.6, 1);
      fl.translate(p.x + Math.cos(a) * d + r * 0.3, y + 0.04, p.z + Math.sin(a) * d);
      parts.push(part(fl, PAD_FLOWER, { tint: 0.9, jitter: 0.05, rng }));
    }
  }
  const geo = mergeGeometries(parts, false);
  const mesh = new THREE.Mesh(geo, new WorldMaterial(world.uniforms, { flat: true, double: true, name: 'lilypads' }));
  mesh.renderOrder = 6;
  mesh.name = 'lilypads';
  return mesh;
}

/**
 * Small floating islets around the main island — depth for the vista.
 * They colour in with the world (GLOBAL_COLOR) and bob gently.
 */
export class Islets {
  constructor(world, seed) {
    const rng = new Rng(seed + 501);
    const shared = world.uniforms;
    this.group = new THREE.Group();
    this.group.name = 'islets';
    this.items = [];
    const mat = new WorldMaterial(shared, { flat: true, globalColor: true, wind: true, name: 'islets' });
    const outline = new WorldMaterial(shared, { flat: true, globalColor: true, outline: true, outlineWidth: 0.05, name: 'islets-outline' });
    const count = 4;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const dist = rng.range(52, 66);
      const r = rng.range(3, 5.5);
      const parts = [];
      // jagged rock cone underneath
      const pts = [];
      const steps = 7;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        pts.push(new THREE.Vector2(Math.max(0.05, r * (1 - Math.pow(t, 1.4)) * (1 + (rng.float() - 0.5) * 0.2)), -t * r * 1.6));
      }
      const rock = new THREE.LatheGeometry(pts, 9);
      parts.push(part(rock, ISLET_ROCK, { tint: 0.25, jitter: 0.08, rng }));
      const top = new THREE.CylinderGeometry(r * 1.02, r * 0.95, 0.5, 9);
      parts.push(part(top, ISLET_GRASS, { tint: 0.8, jitter: 0.08, rng, matrix: new THREE.Matrix4().setPosition(0, 0.2, 0) }));
      const tree = buildRoundTree(rng);
      tree.applyMatrix4(new THREE.Matrix4().makeScale(0.9, 0.9, 0.9).setPosition(rng.range(-r * 0.3, r * 0.3), 0.4, rng.range(-r * 0.3, r * 0.3)));
      parts.push(tree);
      const geo = mergeGeometries(parts, false);
      addSmoothNormals(geo);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, outline));
      const y = rng.range(-8, 6);
      g.position.set(Math.cos(a) * dist, y, Math.sin(a) * dist);
      g.rotation.y = rng.float() * 6.28;
      this.group.add(g);
      this.items.push({ g, y, phase: rng.float() * 6.28, speed: rng.range(0.15, 0.3) });
    }
  }

  update(time) {
    for (const it of this.items) {
      it.g.position.y = it.y + Math.sin(time * it.speed + it.phase) * 0.6;
      it.g.rotation.z = Math.sin(time * it.speed * 0.7 + it.phase) * 0.02;
    }
  }
}
