import * as THREE from 'three';
import { GeoBag, lathe, mat } from '../core/geometry.js';
import { mulberry32 } from '../core/random.js';
import { T, STREETS, edgeR, topHeight, angDist, terraceOf } from './terrain.js';
import { facadeAtlas, tileUV, roofTiles, stoneBlocks, roseWindow } from './townTextures.js';

/**
 * The castle town on the floating island (island-local coordinates).
 *
 * Everything static is merged into a handful of meshes (façades, roofs,
 * stone, wood, gold, glass). Shared shader uniforms drive the town-wide
 * effects: build-up during assembly (each part rises from its own base in
 * order from the keep outward), snow on upward faces, and windows lighting
 * one by one as night falls.
 */
export function townUniforms() {
  return { uBuild: { value: 1 }, uSnow: { value: 0.35 }, uNight: { value: 0.55 }, uTime: { value: 0 } };
}

/** a MeshStandardMaterial wired to the town uniforms */
export function townMaterial(kit, params, uniforms, { build = true, snow = true } = {}) {
  const m = kit.standard(params);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${build ? 'attribute vec2 build; attribute float lit;' : ''}
        uniform float uBuild;
        varying float vLit;
        varying float vUp;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        ${build ? 'float bk = clamp((uBuild - build.x) * 6.0, 0.0, 1.0); transformed.y = build.y + (transformed.y - build.y) * bk; transformed.xz *= mix(0.97, 1.0, bk); vLit = lit;' : 'vLit = 2.0;'}
        vUp = objectNormal.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uSnow;
        uniform float uNight;
        uniform float uTime;
        varying float vLit;
        varying float vUp;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        ${snow ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), smoothstep(0.55, 0.85, vUp) * uSnow);' : ''}
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.58, 0.64, 0.82), uNight * 0.75);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= step(vLit, uNight) * (0.88 + 0.12 * sin(uTime * 3.0 + vLit * 91.0)) * (0.6 + uNight * 0.8);`,
      );
  };
  m.customProgramCacheKey = () => `town:${build}:${snow}`;
  return m;
}

const ROOF_COLORS = ['#5b6b7c', '#8a4434', '#4f7468', '#6e4a3a', '#3f4a5a', '#9a5a3a'];
const TOWER_ROOFS = ['#3f5a8a', '#8a2e2e', '#2f6a5a', '#5a3a6a'];

export function buildTown(kit, uniforms, { lod = 'hero', seed = 11 } = {}) {
  const hero = lod === 'hero';
  const rnd = mulberry32(seed);
  const atlas = facadeAtlas();
  kit.trackTexture(atlas.map);
  kit.trackTexture(atlas.emissive);
  const roofTex = kit.trackTexture(roofTiles());
  const stoneTex = kit.trackTexture(stoneBlocks());
  const rose = kit.trackTexture(roseWindow());
  const mats = {
    walls: townMaterial(kit, { map: atlas.map, emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.8 }, uniforms),
    roof: townMaterial(kit, { map: roofTex, vertexColors: true, roughness: 0.7 }, uniforms),
    stone: townMaterial(kit, { map: stoneTex, vertexColors: true, roughness: 0.85 }, uniforms),
    wood: townMaterial(kit, { vertexColors: true, roughness: 0.7 }, uniforms),
    gold: townMaterial(kit, { color: 0xd9a84e, metalness: 1, roughness: 0.3 }, uniforms, { snow: false }),
    glass: townMaterial(kit, { map: rose, emissiveMap: rose, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.3 }, uniforms, { snow: false }),
  };
  const bag = new GeoBag();
  const hill = new THREE.Vector2(T.hill[0], T.hill[1]);
  const maxR = T.edge + 3;
  const orderOf = (x, z) => Math.min(0.85, Math.hypot(x - hill.x, z - hill.y) / maxR);
  const perches = [];
  const lanterns = [];
  let viewpoint = null;

  // ------------------------------------------------------------ helpers
  /** a façade wall from (x0,z0) to (x1,z1) at base y, floors, tiles per bay */
  const facade = (p0, p1, y, floors, style, doorBay, build, lit) => {
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const bays = Math.max(1, Math.round(len / 2.3));
    const bw = len / bays;
    const dir = new THREE.Vector3(p1.x - p0.x, 0, p1.z - p0.z).normalize();
    const nrm = new THREE.Vector3(-dir.z, 0, dir.x); // outward: dir x up
    const pos = [], uv = [], idx = [];
    let vi = 0;
    for (let f = 0; f < floors; f++) {
      const h0 = y + (f === 0 ? 0 : 3.1 + (f - 1) * 2.8), h1 = h0 + (f === 0 ? 3.1 : 2.8);
      for (let b = 0; b < bays; b++) {
        const kind = f === 0 ? (b === doorBay ? 0 : 1) : rnd() < 0.8 ? 2 : 3;
        const [u0, v0, u1, v1] = tileUV(style, kind);
        const a = p0.clone().addScaledVector(dir, b * bw), c = p0.clone().addScaledVector(dir, (b + 1) * bw);
        // jettied upper floors on timber houses
        const out = style % 2 === 0 && f > 0 ? 0.18 * f : 0;
        pos.push(a.x + nrm.x * out, h0, a.z + nrm.z * out, c.x + nrm.x * out, h0, c.z + nrm.z * out, c.x + nrm.x * out, h1, c.z + nrm.z * out, a.x + nrm.x * out, h1, a.z + nrm.z * out);
        uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
        idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        vi += 4;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    bag.add(g, null, 'walls', undefined, { build, lit });
  };

  /** a roof slab between two lines, with tile uv scaled to metres */
  const slab = (w, len, thick, m, key, color, build) => {
    const g = new THREE.BoxGeometry(w, thick, len);
    const uvA = g.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * w * 0.35, uvA.getY(i) * len * 0.35);
    bag.add(g, m, key, color, { build, lit: 2 });
  };

  /** a pitched roof over a w x d footprint centred at origin of matrix m (ridge along x) */
  const gableRoof = (m, w, d, pitchH, color, build) => {
    const oh = 0.35;
    const half = d / 2 + oh;
    const slope = Math.hypot(half, pitchH);
    const ang = Math.atan2(pitchH, half);
    for (const s of [1, -1]) {
      const mm = m.clone().multiply(mat(0, pitchH / 2, (s * half) / 2, s * ang, 0, 0));
      slab(w + oh * 2, slope + 0.1, 0.22, mm, 'roof', color, build);
    }
    // ridge cap
    bag.add(new THREE.BoxGeometry(w + oh * 2 + 0.1, 0.25, 0.32), m.clone().multiply(mat(0, pitchH + 0.08, 0)), 'roof', '#3a3a3a', { build, lit: 2 });
  };

  const gable = (m, w, pitchH, style, build, lit) => {
    // triangular gable end in plaster (uses the plain tile)
    const [u0, v0, u1, v1] = tileUV(style, 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0, 0, w / 2, 0, 0, 0, pitchH, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, (u0 + u1) / 2, v1], 2));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    bag.add(g, m, 'walls', undefined, { build, lit });
  };

  // --------------------------------------------------------------- houses
  const houses = [];
  const blocked = (x, z, rad) => {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    if (r + rad > edgeR(a) - 2.75) return true; // backing right up to the outer wall
    // ravine and streams
    if (angDist(a, T.ravineA) * r < T.ravineW + rad + 1.4 && r > T.tr[0] - 4) return true;
    for (const sa of T.streams) if (angDist(a, sa) * r < rad + 1.6 && r > T.edge - 9) return true;
    // lanes (around the hill centre)
    const ah = Math.atan2(z - hill.y, x - hill.x);
    const rh = Math.hypot(x - hill.x, z - hill.y);
    for (const l of STREETS.lanes) if (angDist(ah, l.a) * rh < rad + l.w * 0.5 + 0.4 && rh > l.r0) return true;
    // gate plaza and the cathedral / windmill plots
    const g = new THREE.Vector2(Math.cos(T.gateA) * (T.edge - 5.5), Math.sin(T.gateA) * (T.edge - 5.5));
    if (g.distanceTo(new THREE.Vector2(x, z)) < 4.2 + rad) return true;
    for (const [px, pz, pr] of plots) if (Math.hypot(x - px, z - pz) < pr + rad) return true;
    return false;
  };
  // plots reserved for landmarks: [x, z, radius]
  const cathA = T.lanes[1] + 0.42;
  const cath = new THREE.Vector2(hill.x + Math.cos(cathA) * 15.2, hill.y + Math.sin(cathA) * 15.2);
  const millA = T.streams[1] + 0.32;
  const mill = new THREE.Vector2(Math.cos(millA) * (T.edge - 6.5), Math.sin(millA) * (T.edge - 6.5));
  const plots = [
    [cath.x, cath.y, 7.2],
    [mill.x, mill.y, 3.4],
  ];

  // rows of houses around the hill, each facing the street (or back lane) inside it
  const overlaps = (x, z, rad) => houses.some((h) => Math.hypot(h.x - x, h.z - z) < (rad + Math.max(h.w, h.d) * 0.5) * 0.92);
  for (const row of STREETS.rows) {
    const cx = row.center === 'island' ? 0 : hill.x, cz = row.center === 'island' ? 0 : hill.y;
    let a = rnd() * 0.2;
    while (a < Math.PI * 2) {
      const w = 2.9 + rnd() * 1.9;
      const d = row.depth[0] + rnd() * (row.depth[1] - row.depth[0]);
      const da = (w + 0.3 + rnd() * 0.3) / row.r;
      const ac = a + da / 2;
      const x = cx + Math.cos(ac) * row.r, z = cz + Math.sin(ac) * row.r;
      const rad = Math.max(w, d) * 0.5;
      if (terraceOf(x, z) === row.terrace && !blocked(x, z, rad) && !overlaps(x, z, rad)) {
        // face the hill (where the streets are)
        const toHill = Math.atan2(hill.y - z, hill.x - x);
        houses.push({ x, z, a: toHill + Math.PI, w, d, facing: -1, t: row.terrace });
      }
      a += da;
    }
  }
  // a few cottages crowding the castle hill
  for (let i = 0; i < 9; i++) {
    const ac = (i / 9) * Math.PI * 2 + 0.3;
    const rr = 8.4 + rnd() * 1.4;
    const x = hill.x + Math.cos(ac) * rr, z = hill.y + Math.sin(ac) * rr;
    if (!blocked(x, z, 2)) houses.push({ x, z, a: ac, w: 3 + rnd(), d: 3.2 + rnd(), facing: -1, t: 2 });
  }

  for (const h of houses) {
    const y = Math.min(topHeight(h.x, h.z), topHeight(h.x + 1, h.z), topHeight(h.x - 1, h.z), topHeight(h.x, h.z + 1), topHeight(h.x, h.z - 1)) - 0.05;
    const floors = h.t === 2 ? 2 + (rnd() < 0.5 ? 1 : 0) : h.t === 1 ? 2 + (rnd() < 0.35 ? 1 : 0) : 1 + (rnd() < 0.6 ? 1 : 0);
    const style = Math.floor(rnd() * 4);
    const build = [orderOf(h.x, h.z), y];
    const lit = 0.15 + rnd() * 0.8;
    // local frame: +z faces the street
    const yaw = Math.atan2(Math.cos(h.a), Math.sin(h.a)) + (h.facing > 0 ? 0 : Math.PI);
    const m = mat(h.x, y, h.z, 0, yaw);
    const w = h.w, d = h.d;
    const height = 3.1 + (floors - 1) * 2.8;
    const corners = [new THREE.Vector3(-w / 2, 0, d / 2), new THREE.Vector3(w / 2, 0, d / 2), new THREE.Vector3(w / 2, 0, -d / 2), new THREE.Vector3(-w / 2, 0, -d / 2)].map((v) => v.applyMatrix4(m));
    const doorBay = Math.floor(rnd() * Math.max(1, Math.round(w / 2.3)));
    facade(corners[0], corners[1], y, floors, style, doorBay, build, lit); // front (street)
    facade(corners[1], corners[2], y, floors, style, -1, build, lit + 0.05);
    facade(corners[2], corners[3], y, floors, style, -1, build, lit + 0.1);
    facade(corners[3], corners[0], y, floors, style, -1, build, lit + 0.02);
    // roof: ridge along the street (x) or gable to the street
    const ridgeX = rnd() < 0.7;
    const roofCol = ROOF_COLORS[Math.floor(rnd() * ROOF_COLORS.length)];
    const top = m.clone().multiply(mat(0, height + (style % 2 === 0 ? 0.18 * (floors - 1) : 0), 0, 0, ridgeX ? 0 : Math.PI / 2));
    const rw = ridgeX ? w : d, rd = ridgeX ? d : w;
    const pitch = rd * (0.55 + rnd() * 0.25);
    gableRoof(top, rw + 0.05, rd + 0.05, pitch, roofCol, build);
    for (const s of [1, -1]) gable(top.clone().multiply(mat((s * rw) / 2, 0, 0, 0, s * Math.PI / 2)), rd + 0.02, pitch, style, build, lit);
    // chimney (stone) with a cap
    if (rnd() < 0.75) {
      const cx = (rnd() - 0.5) * rw * 0.6;
      const cz = (rnd() < 0.5 ? 1 : -1) * rd * 0.2;
      bag.add(new THREE.BoxGeometry(0.6, pitch + 1.4, 0.6), top.clone().multiply(mat(cx, (pitch + 1.4) / 2 - 0.2, cz)), 'stone', '#9a948a', { build, lit: 2 });
      bag.add(new THREE.BoxGeometry(0.85, 0.18, 0.85), top.clone().multiply(mat(cx, pitch + 1.25, cz)), 'stone', '#7a746a', { build, lit: 2 });
    }
    // stone foundation reaching down the slope
    bag.add(new THREE.BoxGeometry(w + 0.2, 2.2, d + 0.2), m.clone().multiply(mat(0, -1.0, 0)), 'stone', '#8a847a', { build, lit: 2 });
    // a hanging shop sign now and then
    if (hero && rnd() < 0.25) {
      bag.add(new THREE.BoxGeometry(0.06, 0.06, 0.8), m.clone().multiply(mat(w * 0.35, 2.6, d / 2 + 0.4)), 'wood', '#3a2618', { build, lit: 2 });
      bag.add(new THREE.BoxGeometry(0.06, 0.55, 0.65), m.clone().multiply(mat(w * 0.35, 2.25, d / 2 + 0.55)), 'wood', ['#7a2a22', '#2a4a6a', '#3a5a32'][Math.floor(rnd() * 3)], { build, lit: 2 });
    }
  }

  // ---------------------------------------------------------- town walls
  const stoneCol = '#a8a196';
  const wallTop = 4.2;
  const merlon = new THREE.BoxGeometry(0.6, 0.7, 0.35);
  const wallR = (a) => edgeR(a) - 2.2;
  const towerAngles = [];
  for (let i = 0; i < 12; i++) towerAngles.push(T.gateA + (i / 12) * Math.PI * 2);
  const segs = hero ? 120 : 60;
  for (let i = 0; i < segs; i++) {
    const a0 = T.gateA + (i / segs) * Math.PI * 2, a1 = T.gateA + ((i + 1) / segs) * Math.PI * 2;
    if (angDist((a0 + a1) / 2, T.gateA) < 0.09) continue; // the gate opening
    const p0 = new THREE.Vector3(Math.cos(a0) * wallR(a0), 0, Math.sin(a0) * wallR(a0));
    const p1 = new THREE.Vector3(Math.cos(a1) * wallR(a1), 0, Math.sin(a1) * wallR(a1));
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const len = p0.distanceTo(p1) + 0.05;
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z) - Math.PI / 2;
    const overRavine = angDist((a0 + a1) / 2, T.ravineA) * wallR(a0) < T.ravineW * 0.9;
    const g0 = Math.min(topHeight(p0.x, p0.z), topHeight(p1.x, p1.z));
    const bottom = overRavine ? -0.4 : g0 - 1.6;
    const h = wallTop - bottom;
    const build = [orderOf(mid.x, mid.z) + 0.05, g0];
    const g = new THREE.BoxGeometry(len, h, 1.1);
    const uvA = g.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) * len * 0.25, uvA.getY(k) * h * 0.25);
    bag.add(g, mat(mid.x, bottom + h / 2, mid.z, 0, yaw), 'stone', stoneCol, { build, lit: 2 });
    // merlons on the outer edge
    const out = new THREE.Vector3(mid.x, 0, mid.z).normalize();
    for (let k = 0; k < Math.max(1, Math.round(len / 1.25)); k++) {
      const t = (k + 0.5) / Math.max(1, Math.round(len / 1.25));
      const p = p0.clone().lerp(p1, t).addScaledVector(out, 0.38);
      bag.add(merlon.clone(), mat(p.x, wallTop + 0.35, p.z, 0, yaw), 'stone', stoneCol, { build, lit: 2 });
    }
  }
  merlon.dispose();
  // round towers with cone roofs (and a perch on two of them)
  const tower = (x, z, r, h, roofCol, build, perch = false, banner = true) => {
    const g0 = topHeight(x, z) - 1.5;
    const body = new THREE.CylinderGeometry(r, r * 1.08, h, hero ? 18 : 10, 1, true);
    const uvA = body.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) * r * 6.28 * 0.25, uvA.getY(k) * h * 0.25);
    bag.add(body, mat(x, g0 + h / 2, z), 'stone', stoneCol, { build, lit: 2 });
    bag.add(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.6, hero ? 18 : 10), mat(x, g0 + h - 0.2, z), 'stone', '#968f84', { build, lit: 2 });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      bag.add(new THREE.BoxGeometry(0.55, 0.65, 0.35), mat(x + Math.cos(a) * (r + 0.15), g0 + h + 0.4, z + Math.sin(a) * (r + 0.15), 0, Math.PI / 2 - a), 'stone', stoneCol, { build, lit: 2 });
    }
    const cone = new THREE.ConeGeometry(r + 0.4, r * 2.4, hero ? 18 : 10, 1, true);
    const cu = cone.attributes.uv;
    for (let k = 0; k < cu.count; k++) cu.setXY(k, cu.getX(k) * r * 6, cu.getY(k) * r * 2);
    bag.add(cone, mat(x, g0 + h + 0.2 + r * 1.2, z), 'roof', roofCol, { build, lit: 2 });
    bag.add(lathe([[0, 0], [0.12, 0], [0.18, 0.2], [0.05, 0.4], [0.03, 1.4], [0, 1.45]], 8), mat(x, g0 + h + 0.2 + r * 2.4, z), 'gold', undefined, { build, lit: 2 });
    if (banner && hero) bag.add(new THREE.BoxGeometry(0.04, 0.5, 0.9), mat(x, g0 + h + 0.4 + r * 2.4 + 0.8, z + 0.45), 'wood', roofCol, { build, lit: 2 });
    // arrow-slit windows that glow
    if (hero) {
      for (let k = 0; k < 3; k++) {
        const a = rnd() * Math.PI * 2;
        const [u0, v0, u1, v1] = tileUV(1, 3);
        const q = new THREE.PlaneGeometry(0.5, 0.9);
        const uv = q.attributes.uv;
        uv.setXY(0, u0 + 0.06, v1 - 0.06);
        uv.setXY(1, u1 - 0.06, v1 - 0.06);
        uv.setXY(2, u0 + 0.06, v0 + 0.06);
        uv.setXY(3, u1 - 0.06, v0 + 0.06);
        bag.add(q, mat(x + Math.cos(a) * (r + 0.02), g0 + h * (0.45 + k * 0.15), z + Math.sin(a) * (r + 0.02), 0, Math.PI / 2 - a), 'walls', undefined, { build, lit: 0.2 + rnd() * 0.6 });
      }
    }
    if (perch) perches.push({ p: new THREE.Vector3(x, g0 + h + 0.75, z), yaw: rnd() * Math.PI * 2, kind: 'tower' });
    return g0 + h;
  };
  towerAngles.forEach((a, i) => {
    if (i === 0) return; // gatehouse instead
    const r = wallR(a) + 0.2;
    tower(Math.cos(a) * r, Math.sin(a) * r, 2.0, 7.4, TOWER_ROOFS[i % TOWER_ROOFS.length], [orderOf(Math.cos(a) * r, Math.sin(a) * r), 0], i === 4);
  });
  // gatehouse: two big towers and an arch
  {
    const a = T.gateA, r = wallR(a) + 0.4;
    const t = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const c = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    for (const s of [1, -1]) tower(c.x + t.x * s * 3.2, c.z + t.z * s * 3.2, 2.4, 9, '#8a2e2e', [0.6, 0], false);
    const yaw = Math.atan2(t.x, t.z) - Math.PI / 2;
    const build = [0.62, 0];
    bag.add(new THREE.BoxGeometry(4.2, 2.6, 2.2), mat(c.x, 6.4, c.z, 0, yaw + Math.PI / 2), 'stone', stoneCol, { build, lit: 2 });
    for (let k = 0; k < 6; k++) bag.add(new THREE.BoxGeometry(0.08, 4.8, 0.08), mat(c.x + t.x * (k - 2.5) * 0.6, 2.6, c.z + t.z * (k - 2.5) * 0.6), 'wood', '#2a2420', { build, lit: 2 });
    for (let k = 0; k < 5; k++) bag.add(new THREE.BoxGeometry(3.6, 0.08, 0.08), mat(c.x, 0.6 + k * 0.9, c.z, 0, yaw + Math.PI / 2), 'wood', '#2a2420', { build, lit: 2 });
  }

  // inner wall on the first step, with towers and gate arches at the lanes
  for (let i = 0; i < (hero ? 80 : 40); i++) {
    const n = hero ? 80 : 40;
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    if (STREETS.lanes.some((l) => angDist((a0 + a1) / 2, l.a) < 0.11)) continue;
    const R = T.innerWallR;
    const p0 = new THREE.Vector3(hill.x + Math.cos(a0) * R, 0, hill.y + Math.sin(a0) * R);
    const p1 = new THREE.Vector3(hill.x + Math.cos(a1) * R, 0, hill.y + Math.sin(a1) * R);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const g0 = topHeight(mid.x, mid.z);
    const len = p0.distanceTo(p1) + 0.05;
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z) - Math.PI / 2;
    const build = [orderOf(mid.x, mid.z), g0];
    bag.add(new THREE.BoxGeometry(len, 4.2, 0.8), mat(mid.x, g0 + 0.6, mid.z, 0, yaw), 'stone', '#b0a99c', { build, lit: 2 });
    if (i % 2 === 0) bag.add(new THREE.BoxGeometry(0.5, 0.55, 0.3), mat(mid.x, g0 + 2.95, mid.z, 0, yaw), 'stone', '#b0a99c', { build, lit: 2 });
  }
  for (let i = 0; i < 6; i++) {
    const a = T.lanes[0] + 0.25 + (i / 6) * Math.PI * 2;
    const x = hill.x + Math.cos(a) * T.innerWallR, z = hill.y + Math.sin(a) * T.innerWallR;
    tower(x, z, 1.5, 6.5, TOWER_ROOFS[(i + 1) % TOWER_ROOFS.length], [orderOf(x, z), 0], false, false);
  }

  // ------------------------------------------------------------- the keep
  {
    const cx = hill.x, cz = hill.y;
    const g0 = topHeight(cx, cz) - 0.5;
    const build = [0.0, g0];
    const keepStone = '#bdb6a8';
    const box = (w, h, d, x, y, z, col = keepStone, key = 'stone') => {
      const g = new THREE.BoxGeometry(w, h, d);
      const uvA = g.attributes.uv;
      for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) * Math.max(w, d) * 0.25, uvA.getY(k) * h * 0.25);
      bag.add(g, mat(x, y, z), key, col, { build, lit: 2 });
    };
    box(9, 14, 9, cx, g0 + 7, cz);
    box(9.8, 0.6, 9.8, cx, g0 + 14.1, cz, '#a59e90');
    for (let k = 0; k < 24; k++) {
      const side = Math.floor(k / 6), t = ((k % 6) + 0.5) / 6 - 0.5;
      const off = [[t * 9, 4.75], [4.75, t * 9], [-t * 9, -4.75], [-4.75, -t * 9]][side];
      box(0.7, 0.8, 0.4, cx + off[0], g0 + 14.8, cz + off[1]);
    }
    // windows on the keep
    for (let f = 0; f < 3; f++) {
      for (const [ox, oz, yaw] of [[0, 4.52, 0], [4.52, 0, Math.PI / 2], [0, -4.52, Math.PI], [-4.52, 0, -Math.PI / 2]]) {
        const [u0, v0, u1, v1] = tileUV(1, 2);
        const q = new THREE.PlaneGeometry(2.2, 3);
        const uv = q.attributes.uv;
        uv.setXY(0, u0, v1);
        uv.setXY(1, u1, v1);
        uv.setXY(2, u0, v0);
        uv.setXY(3, u1, v0);
        bag.add(q, mat(cx + ox, g0 + 4 + f * 3.4, cz + oz, 0, yaw), 'walls', undefined, { build, lit: 0.1 + f * 0.15 });
      }
    }
    // corner turrets
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) tower(cx + sx * 4.4, cz + sz * 4.4, 1.25, 16.5, '#3f5a8a', build, false);
    // the tall central tower with a lookout platform (a dragon perch) and a spire to one side
    const tg = new THREE.CylinderGeometry(2.3, 2.4, 11, hero ? 20 : 12, 1, true);
    const tu = tg.attributes.uv;
    for (let k = 0; k < tu.count; k++) tu.setXY(k, tu.getX(k) * 3.6, tu.getY(k) * 2.8);
    bag.add(tg, mat(cx, g0 + 14 + 5.5, cz), 'stone', keepStone, { build: [0.02, g0], lit: 2 });
    bag.add(new THREE.CylinderGeometry(2.9, 2.6, 0.7, hero ? 20 : 12), mat(cx, g0 + 25.2, cz), 'stone', '#a59e90', { build: [0.02, g0], lit: 2 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      bag.add(new THREE.BoxGeometry(0.7, 0.8, 0.4), mat(cx + Math.cos(a) * 2.7, g0 + 25.9, cz + Math.sin(a) * 2.7, 0, Math.PI / 2 - a), 'stone', keepStone, { build: [0.02, g0], lit: 2 });
    }
    perches.push({ p: new THREE.Vector3(cx, g0 + 25.6, cz), yaw: 0.4, kind: 'keep' });
    // little spire turret on the platform's edge
    const sx = cx - 1.6, sz = cz - 1.2;
    bag.add(new THREE.CylinderGeometry(0.75, 0.75, 3.2, 12), mat(sx, g0 + 27.2, sz), 'stone', keepStone, { build: [0.03, g0], lit: 2 });
    bag.add(new THREE.ConeGeometry(1.0, 5.2, 12, 1, true), mat(sx, g0 + 31.4, sz), 'roof', '#3f5a8a', { build: [0.03, g0], lit: 2 });
    bag.add(lathe([[0, 0], [0.15, 0], [0.22, 0.3], [0.06, 0.5], [0.04, 2], [0, 2.1]], 8), mat(sx, g0 + 34, sz), 'gold', undefined, { build: [0.03, g0], lit: 2 });
    // great hall beside the keep
    const hx = cx + 7.2, hz = cz + 1.2;
    const hm = mat(hx, g0 + 0.2, hz, 0, Math.PI / 2);
    const corners = [new THREE.Vector3(-5, 0, 2.6), new THREE.Vector3(5, 0, 2.6), new THREE.Vector3(5, 0, -2.6), new THREE.Vector3(-5, 0, -2.6)].map((v) => v.applyMatrix4(hm));
    for (let k = 0; k < 4; k++) facade(corners[k], corners[(k + 1) % 4], g0 + 0.2, 2, 1, k === 0 ? 2 : -1, [0.08, g0], 0.25 + k * 0.05);
    gableRoof(hm.clone().multiply(mat(0, 6.1, 0)), 10.2, 5.4, 4.2, '#5b6b7c', [0.08, g0]);
    for (const s of [1, -1]) gable(hm.clone().multiply(mat(s * 5.1, 6.1, 0, 0, (s * Math.PI) / 2)), 5.4, 4.2, 1, [0.08, g0], 0.4);
  }

  // ----------------------------------------------------------- cathedral
  {
    const g0 = topHeight(cath.x, cath.y) - 0.3;
    const yaw = Math.atan2(Math.cos(cathA), Math.sin(cathA)) + Math.PI;
    const m = mat(cath.x, g0, cath.y, 0, yaw);
    const build = [orderOf(cath.x, cath.y), g0];
    const W = 5.2, L = 12;
    const c = [new THREE.Vector3(-W / 2, 0, L / 2), new THREE.Vector3(W / 2, 0, L / 2), new THREE.Vector3(W / 2, 0, -L / 2), new THREE.Vector3(-W / 2, 0, -L / 2)].map((v) => v.applyMatrix4(m));
    for (let k = 0; k < 4; k++) facade(c[k], c[(k + 1) % 4], g0, 2, 1, k === 0 ? 1 : -1, build, 0.2);
    const top = m.clone().multiply(mat(0, 5.9, 0, 0, Math.PI / 2));
    gableRoof(top, L + 0.1, W + 0.1, 4.8, '#3f4a5a', build);
    for (const s of [1, -1]) gable(top.clone().multiply(mat((s * L) / 2, 0, 0, 0, (s * Math.PI) / 2)), W, 4.8, 1, build, 0.2);
    // buttresses
    for (let k = 0; k < 4; k++) {
      for (const s of [1, -1]) {
        bag.add(new THREE.BoxGeometry(0.6, 5, 1.0), m.clone().multiply(mat(s * (W / 2 + 0.4), 2.4, -L / 2 + 2 + k * 2.8)), 'stone', '#b5ae9f', { build, lit: 2 });
        bag.add(new THREE.ConeGeometry(0.35, 1.2, 6), m.clone().multiply(mat(s * (W / 2 + 0.4), 5.5, -L / 2 + 2 + k * 2.8)), 'stone', '#b5ae9f', { build, lit: 2 });
      }
    }
    // rose window
    bag.add(new THREE.CircleGeometry(1.4, 24), m.clone().multiply(mat(0, 7.6, L / 2 + 0.06)), 'glass', undefined, { build, lit: 0.05 });
    bag.add(new THREE.TorusGeometry(1.45, 0.14, 6, 24), m.clone().multiply(mat(0, 7.6, L / 2 + 0.08)), 'stone', '#c8c0b0', { build, lit: 2 });
    // apse
    const apse = new THREE.CylinderGeometry(W / 2, W / 2, 6, 14, 1, false, Math.PI / 2, Math.PI);
    bag.add(apse, m.clone().multiply(mat(0, 3, -L / 2)), 'stone', '#b5ae9f', { build, lit: 2 });
    bag.add(new THREE.SphereGeometry(W / 2 + 0.2, 14, 6, Math.PI / 2, Math.PI, 0, Math.PI / 2), m.clone().multiply(mat(0, 6, -L / 2)), 'roof', '#3f4a5a', { build, lit: 2 });
    // bell tower and spire (a perch at the very top)
    const tm = m.clone().multiply(mat(0, 0, L / 2 + 1.6));
    bag.add(new THREE.BoxGeometry(3.2, 15, 3.2), tm.clone().multiply(mat(0, 7.5, 0)), 'stone', '#bdb6a8', { build, lit: 2 });
    for (const [ox, oz, ry] of [[0, 1.62, 0], [1.62, 0, Math.PI / 2], [0, -1.62, Math.PI], [-1.62, 0, -Math.PI / 2]]) {
      const [u0, v0, u1, v1] = tileUV(1, 2);
      const q = new THREE.PlaneGeometry(1.4, 2.4);
      const uv = q.attributes.uv;
      uv.setXY(0, u0, v1);
      uv.setXY(1, u1, v1);
      uv.setXY(2, u0, v0);
      uv.setXY(3, u1, v0);
      bag.add(q, tm.clone().multiply(mat(ox, 12.4, oz, 0, ry)), 'walls', undefined, { build, lit: 0.12 });
    }
    const spire = new THREE.ConeGeometry(2.3, 9, 8, 1, true);
    const su = spire.attributes.uv;
    for (let k = 0; k < su.count; k++) su.setXY(k, su.getX(k) * 6, su.getY(k) * 4);
    bag.add(spire, tm.clone().multiply(mat(0, 19.5, 0, 0, Math.PI / 8)), 'roof', '#3a5a6e', { build, lit: 2 });
    bag.add(lathe([[0, 0], [0.18, 0], [0.25, 0.3], [0.07, 0.6], [0.05, 1.6], [0, 1.7]], 8), tm.clone().multiply(mat(0, 24, 0)), 'gold', undefined, { build, lit: 2 });
    const sp = new THREE.Vector3(0, 15.2, 0).applyMatrix4(tm);
    perches.push({ p: sp, yaw: yaw + 1.2, kind: 'steeple' });
  }

  // ------------------------------------------------------------ windmill
  let sails = null;
  {
    const g0 = topHeight(mill.x, mill.y) - 0.3;
    const build = [orderOf(mill.x, mill.y), g0];
    bag.add(lathe([[0, 0], [2.0, 0], [1.9, 0.4], [1.5, 6.5], [1.6, 6.7], [0, 6.7]], hero ? 16 : 10), mat(mill.x, g0, mill.y), 'stone', '#d8d0c0', { build, lit: 2 });
    bag.add(new THREE.ConeGeometry(1.9, 2.4, hero ? 16 : 10), mat(mill.x, g0 + 7.9, mill.y), 'roof', '#6e4a3a', { build, lit: 2 });
    sails = new THREE.Group();
    const out = new THREE.Vector3(mill.x, 0, mill.y).normalize();
    sails.position.set(mill.x + out.x * 1.9, g0 + 6.4, mill.y + out.z * 1.9);
    sails.lookAt(sails.position.clone().add(out));
    const sb = new GeoBag();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      sb.add(new THREE.BoxGeometry(0.18, 5.6, 0.14), mat(Math.cos(a) * 2.8, Math.sin(a) * 2.8, 0, 0, 0, a - Math.PI / 2), 'wood', '#5a3a24');
      sb.add(new THREE.BoxGeometry(0.05, 4.4, 1.1), mat(Math.cos(a) * 3.2 + Math.cos(a + Math.PI / 2) * 0.55, Math.sin(a) * 3.2 + Math.sin(a + Math.PI / 2) * 0.55, 0, 0, 0, a - Math.PI / 2), 'wood', '#e8e0cc');
    }
    sb.add(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8).rotateX(Math.PI / 2), null, 'wood', '#3a2618');
    sails.add(sb.build({ wood: mats.wood }, { name: 'windmill:sails' }));
  }

  // -------------------------------------------------------- bridge, well
  {
    // the ring street crosses the ravine on an arched bridge
    const ring = STREETS.rings[0];
    let best = null;
    for (let k = 0; k < 720; k++) {
      const a = (k / 720) * Math.PI * 2;
      const x = hill.x + Math.cos(a) * ring.r, z = hill.y + Math.sin(a) * ring.r;
      const d = angDist(Math.atan2(z, x), T.ravineA);
      if (!best || d < best.d) best = { d, x, z, a };
    }
    const yaw = Math.atan2(Math.cos(best.a), -Math.sin(best.a));
    const build = [orderOf(best.x, best.z), -3];
    const bm = mat(best.x, 0, best.z, 0, yaw);
    bag.add(new THREE.BoxGeometry(2.2, 0.5, 7.5), bm.clone().multiply(mat(0, 0.15, 0)), 'stone', '#a8a196', { build, lit: 2 });
    for (const s of [1, -1]) bag.add(new THREE.BoxGeometry(0.3, 0.7, 7.5), bm.clone().multiply(mat(s * 1.0, 0.7, 0)), 'stone', '#a8a196', { build, lit: 2 });
    const arch = new THREE.TorusGeometry(2.6, 0.45, 6, 16, Math.PI);
    bag.add(arch, bm.clone().multiply(mat(0, -2.4, 0, 0, Math.PI / 2)), 'stone', '#968f84', { build, lit: 2 });
    lanterns.push(new THREE.Vector3(1.0, 1.6, 3.6).applyMatrix4(bm), new THREE.Vector3(-1.0, 1.6, -3.6).applyMatrix4(bm));
    // the best place to stand at life size: on the bridge, the river below, the keep ahead
    // face along the street (the bridge deck), houses and lanterns either side
    const bp = new THREE.Vector3(0, 0.4, 1.6).applyMatrix4(bm);
    const along = new THREE.Vector3(0, 0, 1).transformDirection(bm);
    viewpoint = { x: bp.x, y: bp.y, z: bp.z, yaw: Math.atan2(-along.x, -along.z) };
    // market well in the gate plaza
    const gx = Math.cos(T.gateA) * (T.edge - 6.4), gz = Math.sin(T.gateA) * (T.edge - 6.4);
    const wy = topHeight(gx, gz);
    const wb = [orderOf(gx, gz), wy];
    bag.add(new THREE.CylinderGeometry(0.9, 0.95, 0.9, 14, 1, true), mat(gx, wy + 0.45, gz), 'stone', '#a8a196', { build: wb, lit: 2 });
    for (const s of [1, -1]) bag.add(new THREE.BoxGeometry(0.12, 2.2, 0.12), mat(gx + s * 0.8, wy + 1.1, gz), 'wood', '#4a3020', { build: wb, lit: 2 });
    bag.add(new THREE.ConeGeometry(1.3, 0.9, 4, 1, true).rotateY(Math.PI / 4), mat(gx, wy + 2.55, gz), 'roof', '#8a4434', { build: wb, lit: 2 });
    lanterns.push(new THREE.Vector3(gx, wy + 2.1, gz + 0.9));
  }

  // ---------------------------------------------------------- snowy pines
  {
    let placed = 0;
    for (let k = 0; k < 400 && placed < (hero ? 46 : 24); k++) {
      const a = rnd() * Math.PI * 2;
      const zone = rnd();
      let r, x, z;
      if (zone < 0.55) {
        r = edgeR(a) - 1.4 - rnd() * 0.6; // just inside the cliff, outside the wall
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        if (r < edgeR(a) - 2.2 + 0.9) continue;
      } else {
        r = 3 + rnd() * 4.5; // the castle crag
        x = hill.x + Math.cos(a) * r;
        z = hill.y + Math.sin(a) * r;
        if (Math.abs(x - hill.x) < 5.2 && Math.abs(z - hill.y) < 5.2) continue;
      }
      if (blocked(x, z, 0.6) && zone >= 0.55) continue;
      if (angDist(Math.atan2(z, x), T.ravineA) * r < T.ravineW + 1) continue;
      const y = topHeight(x, z) - 0.2;
      const s = 0.7 + rnd() * 0.7;
      const build = [orderOf(x, z) + 0.05, y];
      bag.add(new THREE.CylinderGeometry(0.12 * s, 0.16 * s, 1.2 * s, 5), mat(x, y + 0.6 * s, z), 'wood', '#3a2618', { build, lit: 2 });
      for (let tier = 0; tier < 3; tier++) {
        const cone = new THREE.ConeGeometry((1.3 - tier * 0.32) * s, 1.6 * s, hero ? 9 : 6);
        // dark green body with snow on the upper face (vertex colours)
        bag.add(cone, mat(x, y + (1.3 + tier * 0.9) * s, z, 0, rnd() * 3), 'wood', tier === 2 ? '#e8eef4' : '#22402e', { build, lit: 2 });
      }
      placed++;
    }
  }

  // ------------------------------------------------------- street lanterns
  for (const ring of STREETS.rings) {
    const n = ring.terrace === 0 ? 22 : 14;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.13;
      const x = hill.x + Math.cos(a) * ring.r, z = hill.y + Math.sin(a) * ring.r;
      if (angDist(Math.atan2(z, x), T.ravineA) * Math.hypot(x, z) < T.ravineW + 0.6) continue;
      const y = topHeight(x, z);
      const ox = Math.cos(a) * (ring.w * 0.5 + 0.1), oz = Math.sin(a) * (ring.w * 0.5 + 0.1);
      const build = [orderOf(x, z) + 0.06, y];
      bag.add(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 5), mat(x + ox, y + 1.2, z + oz), 'wood', '#2a2420', { build, lit: 2 });
      bag.add(new THREE.BoxGeometry(0.35, 0.4, 0.35), mat(x + ox, y + 2.5, z + oz), 'wood', '#2a2420', { build, lit: 2 });
      lanterns.push(new THREE.Vector3(x + ox, y + 2.5, z + oz));
    }
  }

  const group = bag.build(mats, { name: 'town' });
  if (sails) group.add(sails);

  // lantern-bearers patrolling the outer wall walk
  const walkers = buildWalkers(kit, uniforms, wallR, wallTop, hero ? 8 : 0);
  if (walkers) group.add(walkers.mesh);

  return {
    group,
    perches,
    lanterns,
    viewpoint,
    houses: houses.length,
    update(t, dt, speed) {
      if (sails) sails.rotation.z -= dt * (0.4 + speed * 0.8);
      if (walkers) walkers.update(t);
    },
    walkers,
  };
}

function buildWalkers(kit, uniforms, wallR, wallTop, n) {
  if (!n) return null;
  const parts = [];
  const body = new THREE.CylinderGeometry(0.22, 0.32, 1.1, 8).translate(0, 0.55, 0);
  const head = new THREE.SphereGeometry(0.2, 8, 6).translate(0, 1.32, 0);
  const hood = new THREE.ConeGeometry(0.24, 0.4, 8).translate(0, 1.55, 0);
  const lamp = new THREE.BoxGeometry(0.16, 0.2, 0.16).translate(0.36, 0.85, 0.1);
  for (const [g, col] of [[body, '#5a2a2a'], [head, '#f0c9a8'], [hood, '#3a2a4a'], [lamp, '#ffcc66']]) {
    const c = new THREE.Color(col);
    const a = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    parts.push(g);
  }
  const geo = new THREE.BufferGeometry();
  const merged = parts.reduce((acc, g) => {
    acc.push(g.toNonIndexed());
    return acc;
  }, []);
  const total = merged.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of merged) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.concat(merged).forEach((g) => g.dispose());
  const m = townMaterial(kit, { vertexColors: true, roughness: 0.7, emissive: 0x000000 }, uniforms, { build: false, snow: false });
  const mesh = new THREE.InstancedMesh(geo, m, n);
  mesh.name = 'town:walkers';
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const offsets = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2, v: (0.012 + (i % 3) * 0.004) * (i % 2 ? 1 : -1) }));
  const mm = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  return {
    mesh,
    offsets,
    update(t) {
      offsets.forEach((w, i) => {
        const a = w.a + t * w.v;
        const r = wallR(a) - 0.15;
        p.set(Math.cos(a) * r, wallTop + Math.abs(Math.sin(t * 6 + i)) * 0.05, Math.sin(a) * r);
        q.setFromAxisAngle(up, -a + (w.v > 0 ? 0 : Math.PI));
        mm.compose(p, q, sc);
        mesh.setMatrixAt(i, mm);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    lampPositions(t, out) {
      offsets.forEach((w, i) => {
        const a = w.a + t * w.v;
        const r = wallR(a) - 0.15;
        const yaw = -a + (w.v > 0 ? 0 : Math.PI);
        const lx = 0.36, lz = 0.1;
        out[i].set(Math.cos(a) * r + Math.cos(yaw) * lx + Math.sin(yaw) * lz, wallTop + 0.85, Math.sin(a) * r - Math.sin(yaw) * lx + Math.cos(yaw) * lz);
      });
    },
  };
}
