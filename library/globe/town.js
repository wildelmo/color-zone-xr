import * as THREE from 'three';
import { GeoBag, lathe, mat } from '../core/geometry.js';
import { mulberry32 } from '../core/random.js';
import { T, STREETS, edgeR, topHeight, angDist, terraceOf, streetMask } from './terrain.js';
import { facadeAtlas, tileUV, roofTiles, stoneBlocks, woodGrain, roseWindow, signAtlas } from './townTextures.js';
import { makeDetailer, houseLook } from './details.js';

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

export async function buildTown(kit, uniforms, { lod = 'hero', seed = 11, step = null } = {}) {
  const hero = lod === 'hero';
  const rnd = mulberry32(seed);
  const atlas = facadeAtlas();
  kit.trackTexture(atlas.map);
  kit.trackTexture(atlas.emissive);
  // (made a piece at a time on first use, then remembered)
  const roofTex = roofTiles();
  if (step) await step();
  const stoneTex = stoneBlocks();
  if (step) await step();
  const woodTex = woodGrain();
  if (step) await step();
  for (const t of [roofTex, stoneTex, woodTex]) {
    kit.trackTexture(t.map);
    kit.trackTexture(t.normal);
  }
  const rose = kit.trackTexture(roseWindow());
  const signs = kit.trackTexture(signAtlas());
  const mats = {
    walls: townMaterial(kit, { map: atlas.map, emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.8 }, uniforms),
    roof: townMaterial(kit, { map: roofTex.map, normalMap: roofTex.normal, normalScale: new THREE.Vector2(1, 1), vertexColors: true, roughness: 0.65 }, uniforms, { snow: false }),
    stone: townMaterial(kit, { map: stoneTex.map, normalMap: stoneTex.normal, normalScale: new THREE.Vector2(1.2, 1.2), vertexColors: true, roughness: 0.85 }, uniforms),
    wood: townMaterial(kit, { map: woodTex.map, normalMap: woodTex.normal, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 0.72 }, uniforms),
    gold: townMaterial(kit, { color: 0xd9a84e, metalness: 1, roughness: 0.3 }, uniforms, { snow: false }),
    glass: townMaterial(kit, { map: rose, emissiveMap: rose, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.3 }, uniforms, { snow: false }),
    snow: townMaterial(kit, { vertexColors: true, roughness: 0.95 }, uniforms, { snow: false }),
    signs: townMaterial(kit, { map: signs, roughness: 0.55 }, uniforms, { snow: false }),
    ice: townMaterial(kit, { color: 0xd6eeff, roughness: 0.12, metalness: 0.1 }, uniforms, { snow: false }),
  };
  roofDrifts(mats.roof);
  const bag = new GeoBag();
  // stone, wood and roof parts get UVs in real-world units, so the blocks,
  // grain and tiles are the same size everywhere (not squeezed onto small
  // parts or smeared round big ones). Parts that set their own UVs say so.
  const UV_SCALE = { stone: 0.25, wood: 0.6, roof: 0.35 };
  const rawAdd = bag.add.bind(bag);
  bag.add = (geo, m, key, color, attrs) => {
    if (UV_SCALE[key] && !geo.userData.uv) worldUV(geo, UV_SCALE[key], key === 'wood');
    return rawAdd(geo, m, key, color, attrs);
  };
  // carved detail (its own random stream, so the town's layout doesn't change)
  const drnd = mulberry32(seed + 101);
  const DT = makeDetailer(bag, drnd, { hero });
  const plainLook = { shutter: '#3d5a3a', door: '#5a3420', barge: '#3a2618', roof: '#5b6b7c', lit: 0.3 };
  const hill = new THREE.Vector2(T.hill[0], T.hill[1]);
  const maxR = T.edge + 3;
  const orderOf = (x, z) => Math.min(0.85, Math.hypot(x - hill.x, z - hill.y) / maxR);
  const perches = [];
  const lanterns = [];
  let viewpoint = null;

  // ------------------------------------------------------------ helpers
  // obstacles for the dragons: circles with a top height (island-local)
  const obstacles = [];
  const obstacle = (x, z, r, top) => obstacles.push({ x, z, r, top });

  /**
   * One storey of walls: a closed ring of façade bays around a w x d
   * rectangle in the frame m (local y from y0 to y0 + h). Corners meet
   * exactly, so there are no gaps. kindOf(wall, bay, bays) picks the tile.
   */
  const storey = (m, w, d, y0, h, style, kindOf, build, lit, look = null, upper = false, floor = 0) => {
    const P = [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]];
    const pos = [], uv = [], idx = [];
    let vi = 0;
    const attrs = { build, lit: 2 };
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = P[k], [x1, z1] = P[(k + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const bays = Math.max(1, Math.round(len / 2.3));
      // the wall's frame: +x along it, +z out of it
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const fw = look ? m.clone().multiply(mat(x0, y0, z0, 0, Math.atan2(-uz, ux))) : null;
      if (look) DT.timbers(fw, len, h, bays, style, upper, attrs);
      for (let b = 0; b < bays; b++) {
        const kind = kindOf(k, b, bays);
        if (look) {
          const balcony = look.balcony && floor === 1 && k === 0 && kind === 2 && b === Math.floor(bays / 2);
          DT.bay(fw.clone().multiply(mat((len * b) / bays, 0, 0)), len / bays, h, style, kind, look, attrs, k === 2, { balcony });
        }
        const [u0, v0, u1, v1] = tileUV(style, kind);
        const ax = x0 + ((x1 - x0) * b) / bays, az = z0 + ((z1 - z0) * b) / bays;
        const cx = x0 + ((x1 - x0) * (b + 1)) / bays, cz = z0 + ((z1 - z0) * (b + 1)) / bays;
        pos.push(ax, y0, az, cx, y0, cz, cx, y0 + h, cz, ax, y0 + h, az);
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
    bag.add(g, m, 'walls', undefined, { build, lit });
  };

  const gable = (m, span, rise, style, build, lit) => {
    // triangular gable end in plaster (uses the plain tile), base at y = 0
    const [u0, v0, u1, v1] = tileUV(style, 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-span / 2, 0, 0, span / 2, 0, 0, 0, rise, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, (u0 + u1) / 2, v1], 2));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    bag.add(g, m, 'walls', undefined, { build, lit });
  };

  /**
   * A pitched roof sitting exactly on a W x D top (frame m, y = 0 at the
   * wall tops). The slabs' undersides run from the wall-top edges to the
   * ridge, so walls and gables meet them with no gaps. Returns the ridge
   * height above the wall tops.
   */
  const pitchedRoof = (m, W, Dp, alongX, tanA, color, style, build, lit, { small = false, look = null } = {}) => {
    const fr = alongX ? m : m.clone().multiply(mat(0, 0, 0, 0, Math.PI / 2));
    const span = alongX ? Dp : W, len = alongX ? W : Dp;
    const R = (span / 2) * tanA;
    const ang = Math.atan(tanA);
    const oh = small ? 0.14 : 0.35, ohg = small ? 0.1 : 0.25, thick = small ? 0.1 : 0.2;
    const run = span / 2 + oh, drop = oh * tanA;
    const L = Math.hypot(run, R + drop) + 0.14;
    for (const sgn of [1, -1]) {
      // underside from the ridge (0, R) down past the wall top to the eave
      const mz = (sgn * run) / 2 - sgn * 0.03, my = (R - drop) / 2 + 0.03;
      const cz = mz + sgn * Math.sin(ang) * (thick / 2), cy = my + Math.cos(ang) * (thick / 2);
      const gg = new THREE.BoxGeometry(len + 2 * ohg, thick, L);
      gg.userData.uv = true;
      const uvA = gg.attributes.uv;
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i) * (len + 2 * ohg) * 0.35, uvA.getY(i) * L * 0.35);
      bag.add(gg, fr.clone().multiply(mat(0, cy, cz, sgn * ang, 0, 0)), 'roof', color, { build, lit: 2 });
    }
    bag.add(new THREE.BoxGeometry(len + 2 * ohg + 0.1, small ? 0.12 : 0.24, small ? 0.2 : 0.38), fr.clone().multiply(mat(0, R + thick * 0.85, 0)), 'roof', '#3a3a3a', { build, lit: 2 });
    for (const sgn of [1, -1]) gable(fr.clone().multiply(mat(sgn * (len / 2 - 0.004), 0, 0, 0, (sgn * Math.PI) / 2)), span, R, style, build, lit);
    if (!small && look) DT.eaves(fr, span, len, R, tanA, oh, ohg, { build, lit: 2 }, look);
    return { R, fr, span, len };
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

  // built a few houses at a time, so the headset keeps drawing frames
  let built = 0;
  for (const h of houses) {
    if (step && ++built % 6 === 0) await step();
    const y = Math.min(topHeight(h.x, h.z), topHeight(h.x + 1, h.z), topHeight(h.x - 1, h.z), topHeight(h.x, h.z + 1), topHeight(h.x, h.z - 1)) - 0.05;
    const floors = h.t === 2 ? 2 + (rnd() < 0.5 ? 1 : 0) : h.t === 1 ? 2 + (rnd() < 0.35 ? 1 : 0) : 1 + (rnd() < 0.6 ? 1 : 0);
    const style = Math.floor(rnd() * 4);
    const build = [orderOf(h.x, h.z), y];
    const lit = 0.15 + rnd() * 0.8;
    // local frame: +z faces the street
    const yaw = Math.atan2(Math.cos(h.a), Math.sin(h.a)) + (h.facing > 0 ? 0 : Math.PI);
    const m = mat(h.x, y, h.z, 0, yaw);
    const jet = style % 2 === 0 ? 0.18 : 0; // timber houses step out at each upper floor
    const doorBay = Math.floor(rnd() * Math.max(1, Math.round(h.w / 2.3)));
    const look = { ...houseLook(drnd), lit };
    let y0 = 0;
    for (let f = 0; f < floors; f++) {
      const hh = f === 0 ? 3.1 : 2.8;
      const ww = h.w + 2 * jet * f, dd = h.d + 2 * jet * f;
      storey(m, ww, dd, y0, hh, style, (k, b) => (f === 0 ? (k === 0 && b === doorBay ? 0 : 1) : rnd() < 0.8 ? 2 : 3), build, lit + f * 0.04, look, f > 0, f);
      if (f > 0 && jet) bag.add(new THREE.BoxGeometry(ww + 0.1, 0.18, dd + 0.1), m.clone().multiply(mat(0, y0 + 0.02, 0)), 'wood', '#3a2618', { build, lit: 2 });
      y0 += hh;
    }
    const W = h.w + 2 * jet * (floors - 1), D = h.d + 2 * jet * (floors - 1);
    const alongX = rnd() < 0.7;
    const roofCol = ROOF_COLORS[Math.floor(rnd() * ROOF_COLORS.length)];
    look.roof = roofCol;
    const top = m.clone().multiply(mat(0, y0, 0));
    const roof = pitchedRoof(top, W, D, alongX, 0.95 + rnd() * 0.55, roofCol, style, build, lit, { look });
    // chimney (stone) rising through the roof, with a cap
    let chimneyTop = roof.R;
    let chim = null;
    if (rnd() < 0.75) {
      const cx = (rnd() - 0.5) * roof.len * 0.6;
      const cz = (rnd() < 0.5 ? 1 : -1) * roof.span * 0.22;
      const atRoof = roof.R * (1 - Math.abs(cz) / (roof.span / 2));
      const ch = atRoof + 1.3;
      bag.add(new THREE.BoxGeometry(0.6, ch, 0.6), roof.fr.clone().multiply(mat(cx, ch / 2, cz)), 'stone', '#9a948a', { build, lit: 2 });
      bag.add(new THREE.BoxGeometry(0.85, 0.18, 0.85), roof.fr.clone().multiply(mat(cx, ch, cz)), 'stone', '#7a746a', { build, lit: 2 });
      if (hero) {
        // a chimney pot, and smoke from it
        bag.add(new THREE.CylinderGeometry(0.14, 0.17, 0.35, 8), roof.fr.clone().multiply(mat(cx, ch + 0.26, cz)), 'stone', '#8a5a44', { build, lit: 2 });
        DT.chimney(new THREE.Vector3(cx, ch + 0.5, cz).applyMatrix4(roof.fr));
      }
      chimneyTop = Math.max(chimneyTop, ch + 0.45);
      chim = { cx, cz };
    }
    // a dormer on the street side of long roofs
    if (alongX && roof.len >= 3.8 && roof.span >= 3.4 && drnd() < 0.6) {
      const xd = (drnd() - 0.5) * (roof.len - 2.2);
      if (!chim || chim.cz < 0 || Math.abs(chim.cx - xd) > 1.3) DT.dormer(roof.fr, roof.span, roof.R, xd, style, pitchedRoof, look, { build, lit: 2 });
    }
    // stone foundation reaching down the slope
    bag.add(new THREE.BoxGeometry(h.w + 0.2, 2.2, h.d + 0.2), m.clone().multiply(mat(0, -1.0, 0)), 'stone', '#8a847a', { build, lit: 2 });
    // a hanging shop sign now and then: a wrought-iron bracket and a painted board
    if (hero && rnd() < 0.25) {
      rnd(); // (kept so the town's layout stays the same)
      h.sign = true;
      const sx = h.w * 0.35, sy = 2.75, sz = h.d / 2;
      const iron = '#1e1a18', sa = { build, lit: 2 };
      bag.add(new THREE.BoxGeometry(0.05, 0.05, 0.95), m.clone().multiply(mat(sx, sy, sz + 0.47)), 'wood', iron, sa);
      bag.add(new THREE.BoxGeometry(0.035, 0.035, 0.75), m.clone().multiply(mat(sx, sy - 0.27, sz + 0.27, 0.78)), 'wood', iron, sa);
      bag.add(new THREE.TorusGeometry(0.1, 0.015, 4, 10, Math.PI * 1.5).rotateY(Math.PI / 2), m.clone().multiply(mat(sx, sy - 0.1, sz + 0.75)), 'wood', iron, sa);
      for (const cz of [0.3, 0.82]) bag.add(new THREE.BoxGeometry(0.015, 0.1, 0.015), m.clone().multiply(mat(sx, sy - 0.07, sz + cz)), 'wood', iron, sa);
      const sym = Math.floor(drnd() * 8);
      const u0 = (sym % 4) / 4, v1 = 1 - Math.floor(sym / 4) / 2;
      for (const side of [1, -1]) {
        const q = new THREE.PlaneGeometry(0.62, 0.46);
        const uv = q.attributes.uv;
        for (let i = 0; i < 4; i++) uv.setXY(i, side > 0 ? u0 + uv.getX(i) * 0.25 : u0 + 0.25 - uv.getX(i) * 0.25, v1 - 0.5 + uv.getY(i) * 0.5);
        bag.add(q, m.clone().multiply(mat(sx + side * 0.026, sy - 0.38, sz + 0.56, 0, (side * Math.PI) / 2)), 'signs', undefined, sa);
      }
      bag.add(new THREE.BoxGeometry(0.045, 0.5, 0.66), m.clone().multiply(mat(sx, sy - 0.38, sz + 0.56)), 'wood', '#3a2618', sa);
    }
    obstacle(h.x, h.z, Math.hypot(W, D) / 2 + 0.4, y + y0 + chimneyTop + 0.3);
    Object.assign(h, { y, yaw, floors, style, wallsH: y0, roofH: roof.R, balcony: look.balcony && floors >= 2, lights: !!look.lights });
  }

  if (step) await step();
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
    g.userData.uv = true;
    const uvA = g.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) * len * 0.25, uvA.getY(k) * h * 0.25);
    bag.add(g, mat(mid.x, bottom + h / 2, mid.z, 0, yaw), 'stone', stoneCol, { build, lit: 2 });
    obstacle(mid.x, mid.z, Math.max(1.0, len * 0.6), wallTop + 0.8);
    // merlons on the outer edge
    const out = new THREE.Vector3(mid.x, 0, mid.z).normalize();
    if (hero) {
      // a cornice under the battlements and, now and then, an arrow slit
      const cp = mid.clone().addScaledVector(out, 0.6);
      bag.add(new THREE.BoxGeometry(len, 0.22, 0.2), mat(cp.x, wallTop - 0.12, cp.z, 0, yaw), 'stone', '#968f84', { build, lit: 2 });
      if (i % 3 === 0 && !overRavine) {
        const sp = mid.clone().addScaledVector(out, 0.56);
        bag.add(new THREE.BoxGeometry(0.16, 1.0, 0.06), mat(sp.x, wallTop - 1.7, sp.z, 0, yaw), 'stone', '#2a2622', { build, lit: 2 });
        bag.add(new THREE.BoxGeometry(0.5, 0.12, 0.08), mat(sp.x, wallTop - 1.7, sp.z, 0, yaw), 'stone', '#2a2622', { build, lit: 2 });
      }
    }
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
    body.userData.uv = true;
    const uvA = body.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) * r * 6.28 * 0.25, uvA.getY(k) * h * 0.25);
    bag.add(body, mat(x, g0 + h / 2, z), 'stone', stoneCol, { build, lit: 2 });
    bag.add(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.6, hero ? 18 : 10), mat(x, g0 + h - 0.2, z), 'stone', '#968f84', { build, lit: 2 });
    if (hero) {
      // corbels carrying the overhanging parapet, and a string course lower down
      const nc = Math.round(r * 7);
      for (let k = 0; k < nc; k++) {
        const a = ((k + 0.5) / nc) * Math.PI * 2;
        bag.add(new THREE.BoxGeometry(0.22, 0.42, 0.34), mat(x + Math.cos(a) * (r + 0.1), g0 + h - 0.7, z + Math.sin(a) * (r + 0.1), 0, Math.PI / 2 - a), 'stone', '#8a847a', { build, lit: 2 });
      }
      bag.add(new THREE.CylinderGeometry(r + 0.08, r + 0.1, 0.18, 18, 1, true), mat(x, g0 + h * 0.55, z), 'stone', '#968f84', { build, lit: 2 });
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      bag.add(new THREE.BoxGeometry(0.55, 0.65, 0.35), mat(x + Math.cos(a) * (r + 0.15), g0 + h + 0.4, z + Math.sin(a) * (r + 0.15), 0, Math.PI / 2 - a), 'stone', stoneCol, { build, lit: 2 });
    }
    // the cone roof sits on a short drum above the crenellations
    const cb = g0 + h + 0.78;
    bag.add(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.5, hero ? 18 : 10), mat(x, cb - 0.2, z), 'stone', '#968f84', { build, lit: 2 });
    const cone = new THREE.ConeGeometry(r + 0.25, r * 2.4, hero ? 18 : 10, 1, true);
    cone.userData.uv = true;
    const cu = cone.attributes.uv;
    for (let k = 0; k < cu.count; k++) cu.setXY(k, cu.getX(k) * r * 6, cu.getY(k) * r * 2);
    bag.add(cone, mat(x, cb + r * 1.2, z), 'roof', roofCol, { build, lit: 2 });
    bag.add(lathe([[0, 0], [0.12, 0], [0.18, 0.2], [0.05, 0.4], [0.03, 1.4], [0, 1.45]], 8), mat(x, cb + r * 2.4, z), 'gold', undefined, { build, lit: 2 });
    if (banner && hero) bag.add(new THREE.BoxGeometry(0.04, 0.5, 0.9), mat(x, cb + r * 2.4 + 0.8, z + 0.45), 'wood', roofCol, { build, lit: 2 });
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
    const tip = cb + r * 2.4;
    obstacle(x, z, r + 0.7, tip + 1.6);
    // a dragon can sit on top of the cone, by the finial
    if (perch) perches.push({ p: new THREE.Vector3(x, tip + 0.15, z), yaw: rnd() * Math.PI * 2, kind: 'tower' });
    return g0 + h;
  };
  towerAngles.forEach((a, i) => {
    if (i === 0) return; // gatehouse instead
    const r = wallR(a) + 0.2;
    tower(Math.cos(a) * r, Math.sin(a) * r, 2.0, 7.4, TOWER_ROOFS[i % TOWER_ROOFS.length], [orderOf(Math.cos(a) * r, Math.sin(a) * r), 0], i === 4 || i === 9);
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
    const len = p0.distanceTo(p1) + 0.06;
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z) - Math.PI / 2;
    const build = [orderOf(mid.x, mid.z), g0];
    // a level parapet: the top is the same all the way round, the foot follows the ground
    const top = T.t[1] + 2.7, bottom = g0 - 1.6;
    const g = new THREE.BoxGeometry(len, top - bottom, 0.8);
    g.userData.uv = true;
    const uvA = g.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setXY(k, uvA.getX(k) * len * 0.25, uvA.getY(k) * (top - bottom) * 0.25);
    bag.add(g, mat(mid.x, (top + bottom) / 2, mid.z, 0, yaw), 'stone', '#b0a99c', { build, lit: 2 });
    obstacle(mid.x, mid.z, Math.max(1.0, len * 0.6), top + 0.8);
    if (i % 2 === 0) bag.add(new THREE.BoxGeometry(0.5, 0.55, 0.3), mat(mid.x, top + 0.27, mid.z, 0, yaw), 'stone', '#b0a99c', { build, lit: 2 });
  }
  for (let i = 0; i < 6; i++) {
    const a = T.lanes[0] + 0.25 + (i / 6) * Math.PI * 2;
    const x = hill.x + Math.cos(a) * T.innerWallR, z = hill.y + Math.sin(a) * T.innerWallR;
    tower(x, z, 1.5, 6.5, TOWER_ROOFS[(i + 1) % TOWER_ROOFS.length], [orderOf(x, z), 0], false, false);
  }

  if (step) await step();
  // ------------------------------------------------------------- the keep
  {
    const cx = hill.x, cz = hill.y;
    const g0 = topHeight(cx, cz) - 0.5;
    const build = [0.0, g0];
    const keepStone = '#bdb6a8';
    const box = (w, h, d, x, y, z, col = keepStone, key = 'stone') => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.userData.uv = true;
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
    tg.userData.uv = true;
    const tu = tg.attributes.uv;
    for (let k = 0; k < tu.count; k++) tu.setXY(k, tu.getX(k) * 3.6, tu.getY(k) * 2.8);
    bag.add(tg, mat(cx, g0 + 14 + 5.5, cz), 'stone', keepStone, { build: [0.02, g0], lit: 2 });
    bag.add(new THREE.CylinderGeometry(2.9, 2.6, 0.7, hero ? 20 : 12), mat(cx, g0 + 25.2, cz), 'stone', '#a59e90', { build: [0.02, g0], lit: 2 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      bag.add(new THREE.BoxGeometry(0.7, 0.8, 0.4), mat(cx + Math.cos(a) * 2.7, g0 + 25.9, cz + Math.sin(a) * 2.7, 0, Math.PI / 2 - a), 'stone', keepStone, { build: [0.02, g0], lit: 2 });
    }
    // little spire turret on the platform's edge
    const sx = cx - 1.6, sz = cz - 1.2;
    {
      // the lookout platform is a perch: sit side-on to the turret so the tail clears it
      const tx = sx - cx, tz = sz - cz, tl = Math.hypot(tx, tz);
      const fx = -tz / tl, fz = tx / tl;
      perches.push({ p: new THREE.Vector3(cx + (-tx / tl) * 0.6, g0 + 25.6, cz + (-tz / tl) * 0.6), yaw: Math.atan2(-fz, fx), kind: 'keep' });
    }
    obstacle(cx, cz, 6.8, g0 + 15.4);
    obstacle(cx, cz, 3.2, g0 + 26.6);
    obstacle(sx, sz, 1.4, g0 + 36.2);
    bag.add(new THREE.CylinderGeometry(0.75, 0.75, 3.2, 12), mat(sx, g0 + 27.2, sz), 'stone', keepStone, { build: [0.03, g0], lit: 2 });
    bag.add(new THREE.ConeGeometry(1.0, 5.2, 12, 1, true), mat(sx, g0 + 31.4, sz), 'roof', '#3f5a8a', { build: [0.03, g0], lit: 2 });
    bag.add(lathe([[0, 0], [0.15, 0], [0.22, 0.3], [0.06, 0.5], [0.04, 2], [0, 2.1]], 8), mat(sx, g0 + 34, sz), 'gold', undefined, { build: [0.03, g0], lit: 2 });
    // great hall beside the keep
    const hx = cx + 7.2, hz = cz + 1.2;
    const hm = mat(hx, g0 + 0.2, hz, 0, Math.PI / 2);
    storey(hm, 10, 5.2, 0, 3.1, 1, (k, b) => (k === 0 && b === 2 ? 0 : 1), [0.08, g0], 0.25);
    storey(hm, 10, 5.2, 3.1, 2.8, 1, () => 2, [0.08, g0], 0.3);
    pitchedRoof(hm.clone().multiply(mat(0, 5.9, 0)), 10, 5.2, true, 1.6, '#5b6b7c', 1, [0.08, g0], 0.4, { look: plainLook });
    obstacle(hx, hz, 6.0, g0 + 0.2 + 5.9 + 4.4);
  }

  // ----------------------------------------------------------- cathedral
  {
    const g0 = topHeight(cath.x, cath.y) - 0.3;
    const yaw = Math.atan2(Math.cos(cathA), Math.sin(cathA)) + Math.PI;
    const m = mat(cath.x, g0, cath.y, 0, yaw);
    const build = [orderOf(cath.x, cath.y), g0];
    const W = 5.2, L = 12;
    storey(m, W, L, 0, 3.1, 1, (k, b, n) => (k === 0 && b === Math.floor(n / 2) ? 0 : 1), build, 0.2);
    storey(m, W, L, 3.1, 2.8, 1, () => 2, build, 0.2);
    pitchedRoof(m.clone().multiply(mat(0, 5.9, 0)), W, L, false, 1.85, '#3f4a5a', 1, build, 0.2, { look: plainLook });
    obstacle(cath.x, cath.y, 7.0, g0 + 5.9 + 5.2);
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
    spire.userData.uv = true;
    const su = spire.attributes.uv;
    for (let k = 0; k < su.count; k++) su.setXY(k, su.getX(k) * 6, su.getY(k) * 4);
    bag.add(spire, tm.clone().multiply(mat(0, 19.5, 0, 0, Math.PI / 8)), 'roof', '#3a5a6e', { build, lit: 2 });
    bag.add(lathe([[0, 0], [0.18, 0], [0.25, 0.3], [0.07, 0.6], [0.05, 1.6], [0, 1.7]], 8), tm.clone().multiply(mat(0, 24, 0)), 'gold', undefined, { build, lit: 2 });
    // the very tip of the spire is a perch
    const sp = new THREE.Vector3(0, 24.4, 0).applyMatrix4(tm);
    perches.push({ p: sp, yaw: yaw + 1.2, kind: 'steeple' });
    const tc = new THREE.Vector3(0, 0, 0).applyMatrix4(tm);
    obstacle(tc.x, tc.z, 2.8, g0 + 25.9);
  }

  // ------------------------------------------------------------ windmill
  let sails = null;
  {
    const g0 = topHeight(mill.x, mill.y) - 0.3;
    const build = [orderOf(mill.x, mill.y), g0];
    bag.add(lathe([[0, 0], [2.0, 0], [1.9, 0.4], [1.5, 6.5], [1.6, 6.7], [0, 6.7]], hero ? 16 : 10), mat(mill.x, g0, mill.y), 'stone', '#d8d0c0', { build, lit: 2 });
    bag.add(new THREE.ConeGeometry(1.9, 2.4, hero ? 16 : 10), mat(mill.x, g0 + 7.9, mill.y), 'roof', '#6e4a3a', { build, lit: 2 });
    obstacle(mill.x, mill.y, 5.2, g0 + 10.2);
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

  // --------------------------------------------------------- market stalls
  const stalls = [];
  if (hero) {
    const ga = T.gateA;
    const pc = new THREE.Vector2(Math.cos(ga) * (T.edge - 5.5), Math.sin(ga) * (T.edge - 5.5));
    const AWN = [['#c8b89a', '#8a2e2e'], ['#c8b89a', '#2f5a7a'], ['#c8b89a', '#3d6a3a']];
    const GOODS = ['#c8402a', '#e0a040', '#8a5a2a', '#e8d8b0', '#5a8a3a', '#a03a5a'];
    let n = 0;
    for (let k = 0; k < 8 && n < 3; k++) {
      // around the plaza's edge, away from the gate and the ring street
      const a = ga + Math.PI * 0.55 + k * 0.42;
      const x = pc.x + Math.cos(a) * 2.6, z = pc.y + Math.sin(a) * 2.6;
      const rh = Math.hypot(x - hill.x, z - hill.y);
      if (STREETS.rings.some((ring) => Math.abs(rh - ring.r) < ring.w * 0.5 + 0.9)) continue;
      if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < Math.max(h.w, h.d) * 0.5 + 1.0)) continue;
      const y = topHeight(x, z);
      stalls.push([x, z]);
      const build = [orderOf(x, z) + 0.05, y];
      const attrs = { build, lit: 2 };
      // face the middle of the plaza
      const sm = mat(x, y, z, 0, Math.atan2(pc.x - x, pc.y - z));
      const box = (w, hh, d, bx, by, bz, key, col, rx = 0) => bag.add(new THREE.BoxGeometry(w, hh, d), sm.clone().multiply(mat(bx, by, bz, rx)), key, col, attrs);
      box(1.6, 0.85, 0.75, 0, 0.42, 0, 'wood', '#6a4a2a');
      box(1.7, 0.06, 0.85, 0, 0.87, 0, 'wood', '#4a3020');
      for (const [px, pz] of [[-0.78, -0.35], [0.78, -0.35], [-0.78, 0.4], [0.78, 0.4]]) box(0.07, pz < 0 ? 2.15 : 1.8, 0.07, px, (pz < 0 ? 2.15 : 1.8) / 2, pz, 'wood', '#3a2618');
      // a striped awning sloping toward the front
      const [c0, c1] = AWN[n % AWN.length];
      for (let st = 0; st < 6; st++) box(0.3, 0.04, 1.2, -0.75 + st * 0.3, 1.98, 0.08, 'wood', st % 2 ? c1 : c0, -0.32);
      // goods on the counter, crates and a barrel beside
      for (let g = 0; g < 7; g++) box(0.14, 0.1 + drnd() * 0.08, 0.14, -0.6 + g * 0.2, 0.96, 0.12 + (drnd() - 0.5) * 0.2, 'wood', GOODS[Math.floor(drnd() * GOODS.length)]);
      box(0.5, 0.4, 0.5, 1.15, 0.2, 0.15, 'wood', '#7a5a34');
      box(0.42, 0.34, 0.42, 1.12, 0.57, 0.12, 'wood', '#6a4a2a');
      bag.add(new THREE.CylinderGeometry(0.24, 0.24, 0.62, 10), sm.clone().multiply(mat(-1.15, 0.31, 0.2)), 'wood', '#5a3a24', attrs);
      for (const by of [0.1, 0.52]) bag.add(new THREE.CylinderGeometry(0.255, 0.255, 0.05, 10, 1, true), sm.clone().multiply(mat(-1.15, by, 0.2)), 'gold', undefined, attrs);
      n++;
    }
  }

  // --------------------------------------------------------------- snowmen
  const snowmen = [];
  if (hero) {
    // open, level snow: off the streets, clear of houses, stalls, the well,
    // the landmarks, the river and the walls; one near the gate plaza (you
    // see it as you arrive), the others spread out
    const ga = T.gateA;
    const well = [Math.cos(ga) * (T.edge - 6.4), Math.sin(ga) * (T.edge - 6.4)];
    const plazaC = [Math.cos(ga) * (T.edge - 5.5), Math.sin(ga) * (T.edge - 5.5)];
    const open = [];
    for (let x = -T.edge; x <= T.edge; x += 0.75) {
      for (let z = -T.edge; z <= T.edge; z += 0.75) {
        const r = Math.hypot(x, z), a = Math.atan2(z, x);
        if (r > edgeR(a) - 3.6 || streetMask(x, z) > 0.05) continue;
        if (angDist(a, T.ravineA) * r < T.ravineW + 1.2 || T.streams.some((sa) => angDist(a, sa) * r < 1.8)) continue;
        if (houses.some((h) => Math.hypot(h.x - x, h.z - z) < Math.max(h.w, h.d) * 0.5 + 0.8)) continue;
        if (stalls.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 2.2) || Math.hypot(x - well[0], z - well[1]) < 1.8) continue;
        if (plots.some(([px, pz, pr]) => Math.hypot(x - px, z - pz) < pr + 0.6) || Math.hypot(x - hill.x, z - hill.y) < 8) continue;
        const y0 = topHeight(x, z);
        if ([[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].some(([dx, dz]) => Math.abs(topHeight(x + dx, z + dz) - y0) > 0.2)) continue;
        open.push([x, z]);
      }
    }
    const spots = [];
    const near = open.filter(([x, z]) => Math.hypot(x - plazaC[0], z - plazaC[1]) < 6).sort((p, q) => Math.hypot(p[0] - plazaC[0], p[1] - plazaC[1]) - Math.hypot(q[0] - plazaC[0], q[1] - plazaC[1]));
    if (near.length) spots.push(near[Math.min(near.length - 1, 2)]);
    while (spots.length < 3 && open.length) {
      // the open spot farthest from those already chosen
      let best = null, bd = -1;
      for (const p of open) {
        const d = spots.length ? Math.min(...spots.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))) : drnd();
        if (d > bd) [best, bd] = [p, d];
      }
      if (bd < 4) break;
      spots.push(best);
    }
    for (const [x, z] of spots) {
      const y = topHeight(x, z) - 0.05;
      snowmen.push([x, y, z]);
      const sa = { build: [orderOf(x, z) + 0.06, y], lit: 2 };
      const sm = mat(x, y, z, 0, Math.atan2(-x, -z) + (drnd() - 0.5));
      const ball = (r, yy) => bag.add(new THREE.IcosahedronGeometry(r, 2), sm.clone().multiply(mat(0, yy, 0, 0, drnd() * 3, 0, 1, 0.92, 1)), 'snow', '#f2f5fa', sa);
      ball(0.42, 0.36);
      ball(0.31, 0.95);
      ball(0.22, 1.38);
      const dot = (xx, yy, zz, r = 0.035) => bag.add(new THREE.IcosahedronGeometry(r, 0), sm.clone().multiply(mat(xx, yy, zz)), 'stone', '#151312', sa);
      dot(-0.08, 1.45, 0.19);
      dot(0.08, 1.45, 0.19);
      for (const yy of [0.82, 0.97, 1.12]) dot(0, yy, 0.3 - Math.abs(yy - 0.97) * 0.25, 0.03);
      bag.add(new THREE.ConeGeometry(0.035, 0.22, 6).rotateX(Math.PI / 2), sm.clone().multiply(mat(0, 1.38, 0.3)), 'wood', '#e8762a', sa);
      bag.add(new THREE.TorusGeometry(0.2, 0.05, 6, 14).rotateX(Math.PI / 2), sm.clone().multiply(mat(0, 1.2, 0)), 'wood', '#b8202a', sa);
      bag.add(new THREE.BoxGeometry(0.09, 0.32, 0.03), sm.clone().multiply(mat(0.12, 1.06, 0.19, 0.2, 0, 0.15)), 'wood', '#b8202a', sa);
      bag.add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 12), sm.clone().multiply(mat(0, 1.57, 0)), 'wood', '#1a1a1e', sa);
      bag.add(new THREE.CylinderGeometry(0.13, 0.14, 0.24, 12), sm.clone().multiply(mat(0, 1.7, 0)), 'wood', '#1a1a1e', sa);
      for (const sd of [-1, 1]) bag.add(new THREE.CylinderGeometry(0.015, 0.02, 0.55, 5), sm.clone().multiply(mat(sd * 0.48, 1.02, 0, 0, 0, sd * -1.0)), 'wood', '#3a2618', sa);
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

  for (const p of DT.lamps) lanterns.push(p);
  if (step) await step();
  const group = bag.build(mats, { name: 'town' });
  if (sails) group.add(sails);

  // lantern-bearers patrolling the outer wall walk
  const walkers = buildWalkers(kit, uniforms, wallR, wallTop, hero ? 8 : 0);
  if (walkers) group.add(walkers.mesh);

  const heights = heightGrid(obstacles);
  return {
    group,
    perches,
    lanterns,
    viewpoint,
    obstacles,
    /** highest solid thing at (x, z) (island-local); dilated adds a dragon-sized margin */
    heightAt: heights.heightAt,
    houses: houses.length,
    chimneys: DT.chimneys,
    fairy: DT.fairy,
    /** where each house stands (island-local), for inspection */
    houseList: houses.map(({ x, z, w, d, y, yaw, floors, style, wallsH, roofH, sign = false, balcony = false, lights = false }) => ({ x, z, w, d, y, yaw, floors, style, wallsH, roofH, sign, balcony, lights })),
    snowmen,
    update(t, dt, speed) {
      if (sails) sails.rotation.z -= dt * (0.4 + speed * 0.8);
      if (walkers) walkers.update(t);
    },
    walkers,
  };
}

/**
 * A 1 m grid over the island holding the highest roof / spire / wall /
 * ground in each cell, plus a copy dilated by a few metres so a flying
 * dragon (about 8 m across) keeps clear of everything.
 */
function heightGrid(obstacles, extent = 38, dilate = 4) {
  const n = extent * 2 + 1;
  const raw = new Float32Array(n * n);
  const NONE = -1e6;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i - extent, z = j - extent;
      const inside = Math.hypot(x, z) < edgeR(Math.atan2(z, x)) + 0.5;
      raw[j * n + i] = inside ? topHeight(x, z) + 0.5 : NONE;
    }
  }
  for (const o of obstacles) {
    const r = Math.ceil(o.r);
    const ci = Math.round(o.x + extent), cj = Math.round(o.z + extent);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || Math.hypot(di, dj) > o.r + 0.5) continue;
        raw[j * n + i] = Math.max(raw[j * n + i], o.top);
      }
    }
  }
  const dil = new Float32Array(n * n).fill(NONE);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = raw[j * n + i];
      if (v <= NONE) continue;
      for (let dj = -dilate; dj <= dilate; dj++) {
        for (let di = -dilate; di <= dilate; di++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= n || b >= n || di * di + dj * dj > dilate * dilate) continue;
          if (dil[b * n + a] < v) dil[b * n + a] = v;
        }
      }
    }
  }
  return {
    heightAt(x, z, dilated = true) {
      const i = Math.round(x + extent), j = Math.round(z + extent);
      if (i < 0 || j < 0 || i >= n || j >= n) return NONE;
      return (dilated ? dil : raw)[j * n + i];
    },
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

/**
 * Rescale a primitive's UVs to real-world size (k texture repeats per unit):
 * boxes per face, cylinders and cones round the side and across the caps.
 * With grain, each box face's texture u follows its longer side.
 */
function worldUV(g, k, grain = false) {
  const p = g.parameters || {};
  const uv = g.attributes.uv;
  if (!uv) return;
  if (g.type === 'BoxGeometry') {
    const { width: w, height: h, depth: d } = p;
    // faces in order +x, -x, +y, -y, +z, -z, four vertices each
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) {
      const [su, sv] = dims[Math.min(5, Math.floor(i / 4))];
      // wood grain runs along each face's longer side
      if (grain && sv > su) uv.setXY(i, uv.getY(i) * sv * k, uv.getX(i) * su * k);
      else uv.setXY(i, uv.getX(i) * su * k, uv.getY(i) * sv * k);
    }
  } else if (g.type === 'CylinderGeometry' || g.type === 'ConeGeometry') {
    const r = Math.max(p.radiusTop ?? 0, p.radiusBottom ?? p.radius ?? 0);
    const n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getY(i)) > 0.999) uv.setXY(i, (uv.getX(i) - 0.5) * 2 * r * k, (uv.getY(i) - 0.5) * 2 * r * k);
      else uv.setXY(i, uv.getX(i) * Math.PI * 2 * r * k, uv.getY(i) * p.height * k);
    }
  }
  g.userData.uv = true;
}

/**
 * Snow lying on the roofs in drifts: thin just after a shake (the flakes
 * are all in the air), building up to about half the roof as they settle
 * (uSnow), so the tiles' colours still show; the steepest faces stay bare.
 */
function roofDrifts(m) {
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    base(shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRoofP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoofP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRoofP;
        float rdHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float rdNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(rdHash(i), rdHash(i + vec2(1, 0)), u.x), mix(rdHash(i + vec2(0, 1)), rdHash(i + vec2(1, 1)), u.x), u.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float n = rdNoise(vRoofP.xz * 0.55 + vRoofP.y * 0.4) * 0.7 + rdNoise(vRoofP.xz * 2.3) * 0.3;
          // uSnow runs ~0.35 (just shaken, the flakes all in the air) to ~0.9 (all settled);
          // patches with crisp edges, like snow half melted off a roof
          float level = 0.72 - (uSnow - 0.35) * 0.55;
          float cover = smoothstep(level - 0.03, level + 0.03, n) * smoothstep(0.3, 0.55, vUp);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), cover);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'town:roof-drifts';
}
