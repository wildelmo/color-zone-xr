import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldMaterial, addSmoothNormals } from './WorldMaterial.js';
import { buildRoundTree } from './Flora.js';
import { Rng } from '../util/random.js';
import { WORLD } from '../config.js';
import { glowTexture } from '../util/PropMaterial.js';

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
const _fv = new THREE.Vector3();
const _fvel = new THREE.Vector3();

/**
 * A little stone fountain in the pond: the visible source of the bubbles
 * and a constant sparkle of spray. It can be FED: every colour thrown or
 * painted into the pond is remembered (`fed`), and each new one raises
 * `level` so the spray gushes higher, a coloured mist grows above the top and
 * bubbles in the fed colours rise from it. The pond play system hooks `app`.
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

    // ---- feeding (play layer): the fountain remembers every colour the pond is given ----
    this.app = null; // hooked by the pond system (fx, bubbles, rng, events)
    this.fed = new Set(); // '#rrggbb' palette keys of the colours it has been fed
    this.fedColors = []; // the same colours as THREE.Color, in feeding order
    this.level = 0; // 0..1: how many colours (cap 12) — spray height, mist size, bubble rate
    this.sprayAcc = 0;
    this.bubbleT = 2;
    this.mistT = 0;
    this.mistIndex = 0;
    this.mistColor = new THREE.Color('#ffffff');
    this.mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.mist.position.set(0, 2.2, 0); // group space: the group sits at the water level
    this.mist.scale.set(0.001, 0.001, 1);
    this.mist.visible = false;
    this.mist.name = 'fountain-mist';
    this.group.add(this.mist);
  }

  /** the palette colour nearest to `color`, as a key, so the 12-colour cap means the 12 orbs */
  _key(color) {
    const pal = this.app && this.app.paint ? this.app.paint.palette : null;
    if (!pal) return '#' + color.getHexString();
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const c = pal[i];
      const d = (c.r - color.r) ** 2 + (c.g - color.g) ** 2 + (c.b - color.b) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return '#' + pal[best].getHexString();
  }

  /**
   * Feed the fountain a colour. A new colour raises the level (cap 12) and, unless
   * quiet (restoring a save), sends up a column of bubbles + a burst and emits `pondfeed`.
   * Returns true when the colour was new.
   */
  feed(color, { quiet = false } = {}) {
    const key = this._key(color);
    const isNew = !this.fed.has(key);
    if (isNew) {
      this.fed.add(key);
      this.fedColors.push(new THREE.Color(key));
      this.level = Math.min(1, this.fed.size / 12);
    }
    const app = this.app;
    if (quiet || !app) return isNew;
    const top = this.top;
    const level = this.level;
    if (app.fx) {
      app.fx.burst(top, color, Math.round(24 + level * 30), 1.5 + level * 2, 0.05);
      app.fx.splash(top, color, 20, 2.5 + level * 2);
    }
    if (app.bubbles) {
      // a column of eight bubbles in the fed colour climbs out of the top
      const c = color.clone();
      const rng = app.rng;
      for (let k = 0; k < 8; k++) {
        const rise = () => {
          _fv.set(top.x + rng.gauss() * 0.1, top.y + 0.05, top.z + rng.gauss() * 0.1);
          const i = app.bubbles.spawn(_fv, c, 0.06 + rng.float() * 0.09);
          app.bubbles.vel[i].set(rng.gauss() * 0.25, 0.9 + k * 0.12 + level * 0.8, rng.gauss() * 0.25);
        };
        if (app.fx) app.fx.schedule(k * 0.09, rise);
        else rise();
      }
    }
    if (app.events) app.events.emit('pondfeed', { color: color.clone(), count: this.fed.size, isNew, level });
    return isNew;
  }

  /** forget every colour (the painting was wiped / a new island) */
  clearFed() {
    this.fed.clear();
    this.fedColors.length = 0;
    this.level = 0;
    this.sprayAcc = 0;
    this.mist.visible = false;
  }

  /** spray, mist and the odd bubble — all growing with the level; run every frame by the pond system */
  update(dt, time) {
    const app = this.app;
    const level = this.level;
    if (!app || level <= 0 || this.fedColors.length === 0) {
      this.mist.visible = false;
      return;
    }
    const rng = app.rng;
    const top = this.top;
    const fx = app.fx;
    // spray: sparkles and droplets shoot higher and thicker with every colour
    if (fx) {
      this.sprayAcc += dt * (4 + level * 20);
      let guard = 0;
      while (this.sprayAcc >= 1 && guard++ < 16) {
        this.sprayAcc -= 1;
        const c = this.fedColors[rng.int(0, this.fedColors.length - 1)];
        _fv.set(top.x + rng.gauss() * 0.06, top.y + 0.05, top.z + rng.gauss() * 0.06);
        _fvel.set(rng.gauss() * 0.5, 1.4 + level * 3.2 + rng.float() * 0.8, rng.gauss() * 0.5);
        if (rng.chance(0.55)) fx.sparkle(_fv, _fvel, c, 0.8 + rng.float() * 0.7, 0.03 + level * 0.03);
        else fx.bits.emit(_fv.x, _fv.y, _fv.z, _fvel.x * 0.6, _fvel.y * 1.1, _fvel.z * 0.6, c.r, c.g, c.b, app.time, 1.0 + level * 0.6, 0.03, 2, rng.float());
      }
    }
    // mist: an additive haze above the top that grows with the level and cycles through the fed colours
    const m = this.mist;
    m.visible = true;
    this.mistT -= dt;
    if (this.mistT <= 0) {
      this.mistT = 2.5;
      this.mistIndex = (this.mistIndex + 1) % this.fedColors.length;
    }
    this.mistColor.lerp(this.fedColors[this.mistIndex % this.fedColors.length], 1 - Math.exp(-dt * 0.8));
    m.material.color.copy(this.mistColor);
    m.material.opacity = 0.18 + level * 0.32 + Math.sin(time * 2.1) * 0.04;
    const h = 0.7 + level * 2.6;
    m.scale.set(0.5 + level * 1.6, h, 1);
    m.position.y = 1.85 + h * 0.35;
    // ambient bubbles: only once fed, one every ~2 s, in the fed colours
    if (app.bubbles) {
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) {
        this.bubbleT = 1.6 + rng.float() * 0.8;
        const c = this.fedColors[rng.int(0, this.fedColors.length - 1)];
        _fv.set(top.x + rng.gauss() * 0.12, top.y + 0.05, top.z + rng.gauss() * 0.12);
        const i = app.bubbles.spawn(_fv, c, 0.07 + rng.float() * 0.1);
        app.bubbles.vel[i].set(rng.gauss() * 0.15, 0.5 + level * 0.5, rng.gauss() * 0.15);
      }
    }
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
