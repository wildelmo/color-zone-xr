import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { meshLayer, modelDetails } from '../core/sdfClient.js';
import { normalizeGeometry, tube, twistedPole, lathe } from '../core/geometry.js';
import { paintMaskMaterial, PALETTE } from '../core/materials.js';
import { D, HORSE_CELLS, HORSE_SHADOW, BLANKET_PIPING } from './dimensions.js';
import { simplify } from './simplify.js';

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
 * for the full sculpt. The poles follow their horse's level: the real
 * barley twist near, a plain cylinder with the twist shaded on far.
 *
 * None of those meshes casts a shadow. Two stand-ins do, drawn only into the
 * shadow map (see shadowOnly): a simplified horse (the model's `shadow`
 * layer) and a plain pole. A shadow map texel is about 2 cm of carousel, so
 * straps, jewels, horseshoes and the twist never showed in a shadow anyway.
 */
export async function buildHorses(ctx, kit, { lod }) {
  const hero = lod === 'hero';
  const cells = hero ? { hi: HORSE_CELLS.hi, lo: HORSE_CELLS.lo } : { hi: null, lo: HORSE_CELLS.shelf };
  const levels = hero ? ['hi', 'lo'] : ['lo'];

  const det = await modelDetails(MODEL);
  await ctx.step();
  // the shadow stand-in meshes in the worker while the levels below are built
  const shadowRaw = hero ? meshLayer(MODEL, 'shadow', HORSE_SHADOW.cell) : null;

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
    // the far level paints its tack on the body (see giltTackMaterial) and
    // carries what places it as one vec3 attribute; the near level models it
    packTack(body, L === 'lo');
    // gold: horseshoes + strap tubes (near level only) + rosettes
    const goldParts = [normalizeGeometry(goldSdf)];
    if (L === 'hi') {
      for (const s of det.straps) {
        const t = tube(s.points, s.radius, { closed: s.closed, segments: Math.ceil(s.points.length * 1.2), radial: 5 });
        if (t) goldParts.push(normalizeGeometry(t));
      }
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
    bodyTack: giltTackMaterial(kit, { roughness: 0.3 }),
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
      const m = new THREE.InstancedMesh(g, material.isMaterial ? material : material[L], N);
      m.count = 0;
      m.castShadow = false; // the stand-in below casts for it
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
  makeLayer('body', { hi: mats.body, lo: mats.bodyTack }, null, null, ['instanceCoat', 'instanceTrim']);
  makeLayer('mane', mats.maneGold, (h) => h.gildedMane, null);
  makeLayer('mane', mats.manePaint, (h) => !h.gildedMane, (h) => h.mane);
  makeLayer('saddle', mats.saddle, null, (h) => h.saddle);
  makeLayer('gold', mats.gold, null, null);
  makeLayer('jewels', mats.jewels, null, null);

  // poles: `poles` is the real barley twist, `poles:lo` a plain cylinder with
  // the twist shaded on (barleyTwistMaterial); each pole takes its horse's level
  const instanced = (geo, material, name) => {
    const m = new THREE.InstancedMesh(geo, material, N);
    m.name = name;
    m.count = 0;
    m.castShadow = false;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
    return m;
  };
  const poleLevels = { hi: instanced(buildPoleGeometry(hero), mats.pole, 'poles') };
  if (hero) poleLevels.lo = instanced(buildPlainPoleGeometry(), barleyTwistMaterial(kit, { roughness: 0.18 }), 'poles:lo');
  const rodGeo = new THREE.CylinderGeometry(0.028, 0.028, D.rod, hero ? 10 : 6);
  const rodEnds = [new THREE.TorusGeometry(0.05, 0.022, 6, hero ? 14 : 8), new THREE.TorusGeometry(0.05, 0.022, 6, hero ? 14 : 8)];
  rodEnds[0].rotateY(Math.PI / 2).translate(0, D.rod / 2, 0);
  rodEnds[1].rotateY(Math.PI / 2).translate(0, -D.rod / 2, 0);
  const rodAll = mergeGeometries([rodGeo, ...rodEnds].map((g) => normalizeGeometry(g)), false);
  const rods = instanced(rodAll, mats.rod, 'rods');
  rods.count = N;
  rods.receiveShadow = false;
  // (rods cast only while the carousel is tilted: see shelter in index.js)

  // ---- shadow stand-ins: simplified horse + plain pole, drawn only into the shadow map
  const shadows = [];
  if (hero) {
    const raw = await shadowRaw;
    const { positions, index } = await simplify(raw.attributes.position.array, raw.index.array, HORSE_SHADOW.tris, { step: ctx.step });
    raw.dispose();
    const horseShadowGeo = new THREE.BufferGeometry();
    horseShadowGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    horseShadowGeo.setIndex(new THREE.BufferAttribute(index, 1));
    horseShadowGeo.computeVertexNormals();
    // never drawn in colour: any instanced material without instance colours
    // will do, so it borrows the rods' and needs no shader of its own
    shadows.push(shadowOnly(instanced(horseShadowGeo, mats.rod, 'horse:shadow'), N));
    const poleShadowGeo = new THREE.CylinderGeometry(0.046, 0.046, 3.75, 8, 1, true);
    poleShadowGeo.translate(0, (2.05 + -1.7) / 2, 0);
    shadows.push(shadowOnly(instanced(poleShadowGeo, mats.rod, 'poles:shadow'), N));
    await ctx.step();
  }
  const [horseShadow, poleShadow] = shadows;

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
    // (for comparing the two levels from one spot: see debug.forceHorseLevel in index.js)
    if (herd.force && levels.includes(herd.force)) for (const h of horses) h.level = herd.force;

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
    let nHi = 0, nLo = 0;
    for (let i = 0; i < N; i++) {
      const h = horses[i];
      if (h.level === 'hi' || !poleLevels.lo) poleLevels.hi.setMatrixAt(nHi++, h.poleMatrix);
      else poleLevels.lo.setMatrixAt(nLo++, h.poleMatrix);
      rods.setMatrixAt(i, h.rodMatrix);
      if (horseShadow) {
        horseShadow.setMatrixAt(i, h.matrix);
        poleShadow.setMatrixAt(i, h.poleMatrix);
      }
    }
    poleLevels.hi.count = nHi;
    poleLevels.hi.instanceMatrix.needsUpdate = true;
    if (poleLevels.lo) {
      poleLevels.lo.count = nLo;
      poleLevels.lo.instanceMatrix.needsUpdate = true;
    }
    rods.instanceMatrix.needsUpdate = true;
    for (const m of shadows) m.instanceMatrix.needsUpdate = true;
  }

  const tris = {};
  for (const L of levels) tris[L] = Object.values(geos[L]).reduce((s, g) => s + g.index.count / 3, 0);

  const herd = { group, horses, update, tris, rods, force: null };
  return herd;
}

/**
 * The body layer arrives with three per-vertex attributes that place the
 * tack (strap, strapOn, hem: see strapPaint and hemPaint in horseModel.js).
 * The far level packs them into one vec3 `tack` for giltTackMaterial; the
 * near level, which models its tack, drops them.
 */
function packTack(geo, keep) {
  const { strap, strapOn, hem } = geo.attributes;
  if (keep && strap) {
    const n = strap.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      a[i * 3] = strap.array[i];
      a[i * 3 + 1] = strapOn.array[i];
      a[i * 3 + 2] = hem.array[i];
    }
    geo.setAttribute('tack', new THREE.BufferAttribute(a, 3));
  }
  for (const k of ['strap', 'strapOn', 'hem']) geo.deleteAttribute(k);
}

/**
 * The far horses' paint: paintMaskMaterial plus their tack painted on as
 * gilt (gold, metal, polished) where the near level has gilt tubes: the
 * straps round chest, belly, rump and head, a band |tack.x| < 1 across each
 * strap's plane (where tack.y says this is that strap's part of the body),
 * and the blanket's piping, |tack.z| < BLANKET_PIPING. Both are signed
 * distances, so the bands stay crisp across coarse triangles.
 */
function giltTackMaterial(kit, params) {
  const m = paintMaskMaterial(kit, params);
  const paint = m.onBeforeCompile;
  const gold = new THREE.Color(PALETTE.gold);
  m.onBeforeCompile = (shader, renderer) => {
    paint(shader, renderer);
    shader.uniforms.uGilt = { value: new THREE.Vector4(gold.r, gold.g, gold.b, BLANKET_PIPING) };
    shader.uniforms.uGiltRoughness = { value: 0.28 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 tack;
        varying vec3 vTack;`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vTack = tack;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec4 uGilt;
        uniform float uGiltRoughness;
        varying vec3 vTack;`,
      )
      .replace(
        'diffuseColor.rgb *= paintCol;',
        `diffuseColor.rgb *= paintCol;
        float tw = max(fwidth(vTack.x), 1e-4);
        float strapGilt = clamp((1.0 - abs(vTack.x)) / tw + 0.5, 0.0, 1.0) * smoothstep(0.35, 0.65, vTack.y);
        float hw = max(fwidth(vTack.z), 1e-6);
        float hemGilt = clamp((uGilt.w - abs(vTack.z)) / hw + 0.5, 0.0, 1.0);
        float gilt = max(strapGilt, hemGilt);
        diffuseColor.rgb = mix(diffuseColor.rgb, uGilt.rgb, gilt);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uGiltRoughness, gilt);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 1.0, gilt);`,
      );
  };
  m.customProgramCacheKey = () => 'paintMaskGiltTack1';
  return m;
}

/**
 * An instanced mesh drawn only into the shadow map: it holds no instances
 * while the eyes are drawn, and `count` of them for the shadow pass alone
 * (three.js calls onBeforeShadow/onAfterShadow around exactly that draw).
 */
function shadowOnly(mesh, count) {
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.count = 0;
  mesh.onBeforeShadow = () => (mesh.count = count);
  mesh.onAfterShadow = () => (mesh.count = 0);
  return mesh;
}

// the barley-twist pole: spans -1.7 .. 2.05 relative to the horse
const POLE = { len: 3.75, y: (2.05 + -1.7) / 2, radius: 0.048, lobes: 4, depth: 0.22, twists: 9, rows: 46, top: 2.05 - 0.06 - 0.2 };
/**
 * The twist the near pole actually shows. Its mesh samples the nine nominal
 * turns only POLE.rows times, so each row advances a lobe by more than half
 * its spacing and the ridges you see run the other way, 2.5 turns over the
 * pole. The far pole shades that, so a pole does not change when its horse
 * changes level.
 */
const SEEN_TWISTS = POLE.twists - POLE.rows / POLE.lobes;

/** sleeve + knob at the top of a pole, where the crank rod attaches */
function poleTop(seg) {
  const top = lathe([[0, -0.2], [0.06, -0.2], [0.075, -0.15], [0.065, -0.1], [0.065, 0.0], [0.09, 0.02], [0.09, 0.06], [0.05, 0.08], [0, 0.09]], seg);
  top.translate(0, 2.05 - 0.06, 0);
  return top;
}

function buildPoleGeometry(hero) {
  const parts = [];
  const pole = twistedPole(POLE.len, POLE.radius, { lobes: POLE.lobes, depth: POLE.depth, twists: POLE.twists, radial: hero ? 10 : 6, rows: hero ? POLE.rows : 18 });
  pole.translate(0, POLE.y, 0);
  parts.push(pole, poleTop(hero ? 14 : 8));
  const g = mergeGeometries(parts.map((p) => normalizeGeometry(p)), false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** the far pole: a plain cylinder, about as wide as the twist's outline */
function buildPlainPoleGeometry() {
  const pole = new THREE.CylinderGeometry(POLE.radius * 0.96, POLE.radius * 0.96, POLE.len, 10, 1, true);
  pole.translate(0, POLE.y, 0);
  const parts = [pole, poleTop(8)];
  const g = mergeGeometries(parts.map((p) => normalizeGeometry(p)), false);
  parts.forEach((p) => p.dispose());
  return g;
}

/**
 * Brass for the far poles: shades the barley twist (the same lobes and
 * depth as twistedPole, the twist as seen: SEEN_TWISTS) onto a plain cylinder by bending its normal per
 * pixel, darkening the grooves a little, and fading the relief out where it
 * gets finer than a couple of pixels.
 */
function barleyTwistMaterial(kit, params) {
  const m = kit.brass(params);
  m.onBeforeCompile = (shader) => {
    // (lobes, length, twist in radians over the length, centre y); (depth/2, radius, groove shade, top of the twist)
    shader.uniforms.uTwist = { value: new THREE.Vector4(POLE.lobes, POLE.len, SEEN_TWISTS * Math.PI * 2, POLE.y) };
    shader.uniforms.uBump = { value: new THREE.Vector4(POLE.depth / 2, POLE.radius, 0.72, POLE.top) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vPolePos;
        varying vec3 vAxX;
        varying vec3 vAxY;
        varying vec3 vAxZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vPolePos = position;
        #ifdef USE_INSTANCING
          mat3 poleIm = mat3(instanceMatrix);
        #else
          mat3 poleIm = mat3(1.0);
        #endif
        vAxX = normalMatrix * (poleIm * vec3(1.0, 0.0, 0.0));
        vAxY = normalMatrix * (poleIm * vec3(0.0, 1.0, 0.0));
        vAxZ = normalMatrix * (poleIm * vec3(0.0, 0.0, 1.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec4 uTwist;
        uniform vec4 uBump;
        varying vec3 vPolePos;
        varying vec3 vAxX;
        varying vec3 vAxY;
        varying vec3 vAxZ;`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          // surface r(a, y) = R (1 - d + d cos(lobes (a - twist(y)))), d = uBump.x
          float a = atan(vPolePos.z, vPolePos.x);
          float k = uTwist.z / uTwist.y; // twist per unit length
          float ph = uTwist.x * (a - ((vPolePos.y - uTwist.w) / uTwist.y + 0.5) * uTwist.z);
          float s = sin(ph), c = cos(ph);
          float rr = 1.0 - uBump.x + uBump.x * c;          // r / R
          float ra = -uBump.x * uTwist.x * s;              // (dr/da) / R
          float ry = uBump.x * uTwist.x * k * s * uBump.y; // dr/dy
          // fade out where a lobe gets narrower than a couple of pixels, and on the knob
          float fw = uTwist.x * (length(fwidth(vPolePos.xz)) / uBump.y + fwidth(vPolePos.y) * k);
          float on = (1.0 - smoothstep(1.2, 2.6, fw)) * step(vPolePos.y, uBump.w);
          vec3 er = vec3(cos(a), 0.0, sin(a));
          vec3 et = vec3(-er.z, 0.0, er.x);
          vec3 n = normalize(er - on * (ra / rr) * et - on * ry * vec3(0.0, 1.0, 0.0));
          if (on > 0.0) normal = normalize(n.x * vAxX + n.y * vAxY + n.z * vAxZ);
          diffuseColor.rgb *= mix(1.0, mix(uBump.z, 1.0, 0.5 + 0.5 * c), on);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'barleyTwist1';
  return m;
}

export function easeOutBounce(x) {
  x = Math.min(1, Math.max(0, x));
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

