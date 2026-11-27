import * as THREE from 'three';
import { GeoBag, mat } from '../core/geometry.js';
import { GlowPoints } from '../core/glowPoints.js';
import { mulberry32 } from '../core/random.js';

/**
 * Crystal clusters: hexagonal shards with faceted points, in ice-cyan and
 * violet, glowing faintly from inside (brighter when the key is wound).
 */
function shard(r, len, tip, sides = 6) {
  // a hexagonal prism with a pointed tip, base at y=0 along +y
  const pts = [];
  pts.push([0, -0.2 * r]);
  pts.push([r * 0.85, 0]);
  pts.push([r, len * 0.15]);
  pts.push([r * 0.92, len]);
  pts.push([0, len + tip]);
  const g = new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), sides);
  return g.toNonIndexed(); // faceted shading
}

/** the shelf's shard: four sides, open at its buried foot (16 triangles) */
function shelfShard(r, len, tip) {
  const pts = [[r, 0], [r * 0.92, len], [0, len + tip]];
  return new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), 4).toNonIndexed();
}

const _up = new THREE.Vector3(0, 1, 0);
/**
 * underY: on the shelf, the crystals under the island go into the one mesh
 * too, lifted by this much (the island's height), and `under` stays empty.
 */
export function buildCrystals(kit, anchors, { lod, seed = 5, underY = 0 }) {
  const hero = lod === 'hero';
  const rnd = mulberry32(seed);
  const level = { value: 0.35 };
  const make = (hex) => {
    const m = kit.standard({ color: 0xffffff, vertexColors: true, roughness: 0.06, metalness: 0.1, emissive: new THREE.Color(hex), emissiveIntensity: 0.6, envMapIntensity: 2.4, flatShading: true });
    return m;
  };
  let mats;
  if (hero) mats = { cyan: make('#3fb8ff'), violet: make('#9a6aff') };
  else {
    // the shelf: one material (one draw call) that glows in each shard's own tint
    const all = make('#ffffff');
    all.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vColor.rgb * 0.8;');
    };
    all.customProgramCacheKey = () => 'crystals:shelf';
    mats = { cyan: all, violet: all, all };
  }
  const keyOf = (key) => (hero ? key : 'all');
  const bag = new GeoBag();
  const tips = [];
  const cluster = (p, n, size, key, tint, spread = 0.7, count = 5) => {
    const nrm = new THREE.Vector3(...n).normalize();
    for (let k = 0; k < count; k++) {
      const dir = nrm.clone().add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(spread)).normalize();
      const s = size * (k === 0 ? 1 : 0.35 + rnd() * 0.5);
      const g = hero ? shard(s * 0.22, s, s * 0.35, 6) : shelfShard(s * 0.22, s, s * 0.35);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...p).addScaledVector(dir, -s * 0.15), q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, rnd() * 6)), new THREE.Vector3(1, 1, 1));
      const c = new THREE.Color(tint).lerp(new THREE.Color('#ffffff'), rnd() * 0.35);
      bag.add(g, m, keyOf(key), c);
      if (k === 0 && hero) tips.push({ p: new THREE.Vector3(...p).addScaledVector(dir, s * 1.2), key, s });
    }
  };
  const base = new THREE.Group();
  for (const a of anchors.base) cluster(a.p, a.n, a.size, rnd() < 0.6 ? 'cyan' : 'violet', rnd() < 0.5 ? '#6fd0ff' : '#b08cff', 0.8, hero ? 6 : 2);
  if (anchors.key) cluster(anchors.key.p, anchors.key.n, anchors.key.size, 'cyan', '#9fe6ff', 0.45, hero ? 7 : 3);
  for (const a of anchors.floor) cluster(a.p, a.n, a.size, rnd() < 0.5 ? 'cyan' : 'violet', rnd() < 0.5 ? '#8fdcff' : '#c0a0ff', 0.6, hero ? 4 : 1);
  const ub = hero ? new GeoBag() : bag;
  for (const a of anchors.under) {
    const nrm = new THREE.Vector3(...a.n).normalize();
    for (let k = 0; k < (hero ? 3 : 1); k++) {
      const dir = nrm.clone().add(new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).multiplyScalar(0.6)).normalize();
      const s = a.size * (k === 0 ? 1 : 0.5);
      const g = hero ? shard(s * 0.22, s, s * 0.35, 6) : shelfShard(s * 0.22, s, s * 0.35);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, dir);
      const color = rnd() < 0.5 ? 'cyan' : 'violet';
      ub.add(g, new THREE.Matrix4().compose(new THREE.Vector3(a.p[0], a.p[1] + (hero ? 0 : underY), a.p[2]), q, new THREE.Vector3(1, 1, 1)), keyOf(color), hero ? '#e0f4ff' : color === 'cyan' ? '#8fdcff' : '#c0a0ff');
    }
  }
  const baseMesh = bag.build(mats, { name: 'crystals' });
  base.add(baseMesh);
  // (hanging under the island, they sit inside its shadow anyway)
  const under = hero ? ub.build(mats, { name: 'crystals:under', castShadow: false }) : new THREE.Group();
  const glow = hero ? new GlowPoints(kit, Math.max(1, tips.length), { additive: true, soft: 0.9, name: 'crystals:glow' }) : null;
  if (glow) base.add(glow.mesh);
  return {
    group: base,
    under,
    mats,
    level,
    update(t) {
      const l = level.value;
      mats.cyan.emissiveIntensity = 0.45 + l * 1.6;
      mats.violet.emissiveIntensity = 0.45 + l * 1.6;
      if (!glow) return;
      tips.forEach((tp, i) => {
        const tw = (0.35 + l) * (0.7 + 0.3 * Math.sin(t * 1.7 + i * 1.9));
        const c = tp.key === 'cyan' ? [0.35, 0.8, 1.0] : [0.7, 0.5, 1.0];
        glow.set(i, tp.p.x, tp.p.y, tp.p.z, c[0] * tw, c[1] * tw, c[2] * tw, tp.s * 1.1);
      });
      glow.commit(tips.length);
    },
  };
}

export { mat };
