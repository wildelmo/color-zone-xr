import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { meshLayer, modelDetails } from '../core/sdfClient.js';
import { normalizeGeometry, tube, twistedPole, lathe } from '../core/geometry.js';
import { paintMaskMaterial } from '../core/materials.js';
import { D, HORSE_CELLS } from './dimensions.js';

const MODEL = new URL('./horseModel.js', import.meta.url).href;

// coat, blanket, mane (g = gilded), saddle: one entry per horse, outer row first
export const LIVERY = [
  ['#f3ece0', '#a8262b', 'g', '#5a1314'],
  ['#2a2422', '#2c4a8f', 'g', '#7a1c1c'],
  ['#d9b27a', '#2d5838', '#f3e9d6', '#5a1314'],
  ['#bdb8ae', '#4e2350', 'g', '#2a1e3c'],
  ['#f3ece0', '#1f6a6a', '#4a2a19', '#5a1314'],
  ['#8a4a2a', '#c58a2a', '#2a1a12', '#1f2f5c'],
  ['#f3ece0', '#2c4a8f', 'g', '#7a1c1c'],
  ['#dcd6ca', '#a8262b', '#2a2422', '#1f2f5c'],
  ['#2a2422', '#b98a3a', 'g', '#5a1314'],
  ['#d9b27a', '#8c1c1e', '#f3e9d6', '#2d3a2a'],
  ['#f3ece0', '#2d5838', 'g', '#5a1314'],
  ['#9a7b5e', '#2c4a8f', '#f3e9d6', '#5a1314'],
];

/**
 * Builds the 24 carved horses with their barley-twist poles and crank rods.
 * Each layer (body, mane, saddle, gold, jewels) has a high- and a low-detail
 * instanced mesh; every frame each horse is assigned to one of them by its
 * distance to the viewer, so only the horses you are looking closely at pay
 * for the full sculpt.
 */
export async function buildHorses(ctx, kit, { lod }) {
  const hero = lod === 'hero';
  const cells = hero ? { hi: HORSE_CELLS.hi, lo: HORSE_CELLS.lo } : { hi: null, lo: HORSE_CELLS.shelf };
  const levels = hero ? ['hi', 'lo'] : ['lo'];

  const det = await modelDetails(MODEL);
  await ctx.step();

  const geos = {};
  for (const L of levels) {
    const c = cells[L];
    const [body, mane, saddle, goldSdf] = await Promise.all([
      meshLayer(MODEL, 'body', c),
      meshLayer(MODEL, 'mane', c),
      meshLayer(MODEL, 'saddle', c * 0.8),
      meshLayer(MODEL, 'gold', c * 0.8),
    ]);
    await ctx.step();
    // gold: horseshoes + strap tubes + rosettes
    const goldParts = [normalizeGeometry(goldSdf)];
    for (const s of det.straps) {
      if (L !== 'hi' && s.radius < 0.009) continue; // reins vanish at a distance anyway
      const t = tube(s.points, s.radius, { closed: s.closed, segments: Math.ceil(s.points.length * (L === 'hi' ? 1.2 : 0.35)), radial: L === 'hi' ? 5 : 3 });
      if (t) goldParts.push(normalizeGeometry(t));
    }
    const jewelParts = [];
    const n = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    for (const g of det.gems) {
      n.set(...g.n).normalize();
      q.setFromUnitVectors(up, n);
      if (g.kind === 2) {
        // gilded rosette: a little domed flower
        const r = new THREE.SphereGeometry(g.size * 0.55, L === 'hi' ? 10 : 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
        r.scale(1, 0.45, 1);
        r.applyQuaternion(q);
        r.translate(...g.p);
        goldParts.push(normalizeGeometry(r));
      } else {
        const gem = new THREE.IcosahedronGeometry(g.size * 0.5, 0);
        gem.scale(1, 0.55, 1);
        gem.applyQuaternion(q);
        gem.translate(g.p[0] + n.x * g.size * 0.15, g.p[1] + n.y * g.size * 0.15, g.p[2] + n.z * g.size * 0.15);
        normalizeGeometry(gem, g.kind === 0 ? '#b3122e' : '#1d4fb5');
        jewelParts.push(gem);
      }
    }
    // brass collars where the pole passes through the horse
    for (const [k, y] of det.collars.entries()) {
      const c = lathe([[0.046, -0.035], [0.07, -0.03], [0.078, 0], [0.07, 0.03], [0.046, 0.035]], L === 'hi' ? 20 : 10);
      c.translate(0, y + (k === 0 ? 0.01 : -0.01), 0);
      goldParts.push(normalizeGeometry(c));
    }
    for (const e of det.eyes) {
      const s = new THREE.SphereGeometry(e.r, L === 'hi' ? 12 : 6, L === 'hi' ? 8 : 4);
      s.translate(...e.p);
      jewelParts.push(normalizeGeometry(s, '#120c0a'));
    }
    const gold = mergeGeometries(goldParts, false);
    goldParts.forEach((g) => g.dispose());
    const jewels = mergeGeometries(jewelParts, false);
    jewelParts.forEach((g) => g.dispose());
    geos[L] = { body, mane, saddle, gold, jewels };
    await ctx.step();
  }

  // ---- materials
  const mats = {
    body: paintMaskMaterial(kit, { roughness: 0.3 }),
    maneGold: kit.gold({ roughness: 0.26 }),
    manePaint: kit.standard({ color: 0xffffff, roughness: 0.42 }),
    saddle: kit.standard({ color: 0xffffff, roughness: 0.45 }),
    gold: kit.gold(),
    jewels: kit.standard({ color: 0xffffff, roughness: 0.06, metalness: 0.25, vertexColors: true }),
    pole: kit.brass({ roughness: 0.18 }),
    rod: kit.steel({ roughness: 0.35 }),
  };

  // ---- horse records
  const horses = [];
  for (let i = 0; i < D.sweeps * 2; i++) {
    const outer = i < D.sweeps;
    const k = i % D.sweeps;
    const liv = LIVERY[outer ? k : (k * 5 + 3) % LIVERY.length];
    horses.push({
      i,
      sweep: k,
      outer,
      angle: (k / D.sweeps) * Math.PI * 2,
      r: outer ? D.outerR : D.innerR,
      scale: outer ? 1 : D.innerScale,
      coat: new THREE.Color(liv[0]),
      trim: new THREE.Color(liv[1]),
      gildedMane: liv[2] === 'g',
      mane: new THREE.Color(liv[2] === 'g' ? '#ffffff' : liv[2]),
      saddle: new THREE.Color(liv[3]),
      matrix: new THREE.Matrix4(),
      poleMatrix: new THREE.Matrix4(),
      rodMatrix: new THREE.Matrix4(),
      level: 'lo',
      drop: 1, // assembly: 0 = above, 1 = seated
      pole: 1, // assembly: pole raised fraction
      world: new THREE.Vector3(),
    });
  }

  // ---- instanced layers
  const group = new THREE.Group();
  group.name = 'horses';
  const N = horses.length;
  const layers = [];
  const makeLayer = (key, material, filter, color, attrs) => {
    const perLevel = {};
    for (const L of levels) {
      const g = geos[L][key];
      const m = new THREE.InstancedMesh(g, material, N);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.name = `horse:${key}:${L}`;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (color) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const extra = {};
      if (attrs) {
        for (const a of attrs) {
          extra[a] = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
          g.setAttribute(a, extra[a]);
        }
      }
      group.add(m);
      perLevel[L] = { mesh: m, extra };
    }
    layers.push({ key, filter, color, attrs, perLevel });
  };
  makeLayer('body', mats.body, null, null, ['instanceCoat', 'instanceTrim']);
  makeLayer('mane', mats.maneGold, (h) => h.gildedMane, null);
  makeLayer('mane', mats.manePaint, (h) => !h.gildedMane, (h) => h.mane);
  makeLayer('saddle', mats.saddle, null, (h) => h.saddle);
  makeLayer('gold', mats.gold, null, null);
  makeLayer('jewels', mats.jewels, null, null);

  // poles + crank rods (one detail level: they're simple)
  const poleGeo = buildPoleGeometry(hero);
  const poles = new THREE.InstancedMesh(poleGeo, mats.pole, N);
  poles.name = 'poles';
  poles.castShadow = poles.receiveShadow = true;
  poles.frustumCulled = false;
  poles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(poles);
  const rodGeo = new THREE.CylinderGeometry(0.028, 0.028, D.rod, hero ? 10 : 6);
  const rodEnds = [new THREE.TorusGeometry(0.05, 0.022, 6, hero ? 14 : 8), new THREE.TorusGeometry(0.05, 0.022, 6, hero ? 14 : 8)];
  rodEnds[0].rotateY(Math.PI / 2).translate(0, D.rod / 2, 0);
  rodEnds[1].rotateY(Math.PI / 2).translate(0, -D.rod / 2, 0);
  const rodAll = mergeGeometries([rodGeo, ...rodEnds].map((g) => normalizeGeometry(g)), false);
  const rods = new THREE.InstancedMesh(rodAll, mats.rod, N);
  rods.name = 'rods';
  rods.castShadow = true;
  rods.frustumCulled = false;
  rods.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(rods);

  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _y = new THREE.Vector3(0, 1, 0);
  const _d = new THREE.Vector3();
  const _cam = new THREE.Vector3();

  /**
   * @param {number} crankBase crank angle of sweep 0 (radians)
   * @param {THREE.Vector3|null} camLocal viewer position in carousel space
   * @param {number} worldScale carousel-units -> metres
   */
  function update(crankBase, camLocal, worldScale) {
    for (const h of horses) {
      const a = h.angle;
      const phi = crankBase + h.sweep * (Math.PI / 2);
      const sgn = h.outer ? 1 : -1;
      const v = sgn * D.crank * Math.cos(phi);
      const t = sgn * D.crank * Math.sin(phi);
      const yTop = D.shaftY + v - Math.sqrt(D.rod * D.rod - t * t);
      const rise = (1 - easeOutBounce(h.drop)) * 4.2;
      const yH = yTop - D.poleTopToHorse + rise;
      const cx = Math.cos(a) * h.r, cz = Math.sin(a) * h.r;
      _q.setFromAxisAngle(_y, Math.PI / 2 - a);
      const s = h.scale * (0.6 + 0.4 * Math.min(1, h.drop * 1.5));
      h.matrix.compose(_p.set(cx, yH, cz), _q, _s.set(s, s, s));
      h.world.set(cx, yH, cz);
      // pole rises out of the deck during assembly
      const pk = h.pole;
      h.poleMatrix.compose(_p.set(cx, yTop - D.poleTopToHorse - (1 - pk) * 3.8, cz), _q, _s.set(1, 1, 1));
      // connecting rod from pole top to crank pin
      const tx = -Math.sin(a), tz = Math.cos(a);
      const pinY = D.shaftY + v;
      _d.set(tx * t, pinY - yTop, tz * t).normalize();
      const qr = new THREE.Quaternion().setFromUnitVectors(_y, _d);
      h.rodMatrix.compose(_p.set(cx + tx * t * 0.5, (yTop + pinY) / 2, cz + tz * t * 0.5), qr, _s.set(pk, pk, pk));
    }

    // level of detail per horse
    if (levels.length > 1 && camLocal) {
      _cam.copy(camLocal);
      const ranked = horses.map((h) => ({ h, d: h.world.distanceTo(_cam) }));
      ranked.sort((x, y) => x.d - y.d);
      let hi = 0;
      for (const { h, d } of ranked) {
        const angular = (2.1 * h.scale) / Math.max(d, 1e-3);
        h.level = hi < 8 && angular > 0.22 / Math.max(0.2, Math.min(1, worldScale * 25)) ? 'hi' : 'lo';
        if (h.level === 'hi') hi++;
      }
    } else for (const h of horses) h.level = levels[0];

    for (const layer of layers) {
      const counts = {};
      for (const L of levels) counts[L] = 0;
      for (const h of horses) {
        if (layer.filter && !layer.filter(h)) continue;
        const L = h.level in layer.perLevel ? h.level : levels[0];
        const slot = counts[L]++;
        const pl = layer.perLevel[L];
        pl.mesh.setMatrixAt(slot, h.matrix);
        if (layer.color) pl.mesh.setColorAt(slot, layer.color(h));
        if (layer.attrs) {
          pl.extra.instanceCoat.setXYZ(slot, h.coat.r, h.coat.g, h.coat.b);
          pl.extra.instanceTrim.setXYZ(slot, h.trim.r, h.trim.g, h.trim.b);
        }
      }
      for (const L of levels) {
        const pl = layer.perLevel[L];
        pl.mesh.count = counts[L];
        pl.mesh.instanceMatrix.needsUpdate = true;
        if (pl.mesh.instanceColor) pl.mesh.instanceColor.needsUpdate = true;
        for (const a of Object.values(pl.extra)) a.needsUpdate = true;
      }
    }
    for (let i = 0; i < N; i++) {
      poles.setMatrixAt(i, horses[i].poleMatrix);
      rods.setMatrixAt(i, horses[i].rodMatrix);
    }
    poles.instanceMatrix.needsUpdate = true;
    rods.instanceMatrix.needsUpdate = true;
  }

  const tris = {};
  for (const L of levels) tris[L] = Object.values(geos[L]).reduce((s, g) => s + g.index.count / 3, 0);

  return { group, horses, update, tris };
}

function buildPoleGeometry(hero) {
  const len = 3.75;
  const parts = [];
  const pole = twistedPole(len, 0.048, { lobes: 4, depth: 0.22, twists: 9, radial: hero ? 10 : 6, rows: hero ? 46 : 18 });
  pole.translate(0, (2.05 + -1.7) / 2, 0); // spans -1.7 .. 2.05 relative to the horse
  parts.push(pole);
  const seg = hero ? 14 : 8;
  // sleeve + knob at the top where the crank rod attaches
  const top = lathe([[0, -0.2], [0.06, -0.2], [0.075, -0.15], [0.065, -0.1], [0.065, 0.0], [0.09, 0.02], [0.09, 0.06], [0.05, 0.08], [0, 0.09]], seg);
  top.translate(0, 2.05 - 0.06, 0);
  parts.push(top);
  const g = mergeGeometries(parts.map((p) => normalizeGeometry(p)), false);
  parts.forEach((p) => p.dispose());
  return g;
}

export function easeOutBounce(x) {
  x = Math.min(1, Math.max(0, x));
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

