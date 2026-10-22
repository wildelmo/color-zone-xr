import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldMaterial } from '../world/WorldMaterial.js';
import { WORLD } from '../config.js';
import { damp, lerp, TAU } from '../util/math.js';
import { blub, leapSplash } from '../audio/PondSounds.js';

/**
 * Six koi cruising the pond with their backs breaking the surface. They are
 * pencil sketches (WorldMaterial) until colour reaches the water, then they
 * colour in with the pond; a fish that leaps through a colour keeps it (a
 * second instanced mesh with a tiny lit shader that also wags its tail).
 *
 * Hold a wand tip on the water: the nearest three swim over, circle under
 * it and nibble (tickly haptics + blubs). After a moment one LEAPS through
 * your hand in a splashy arc, takes your paint colour and flings drips at
 * the bank. A paint ball hitting the pond makes them all rush and leap.
 * Two draw calls, ~130 triangles per fish.
 */
const CAPACITY = 6;
const Y_OFF = -0.012; // body centre just under the surface: back, eyes, fins and tail poke out of the water
const KOI_WHITE = new THREE.Color('#fbf6ee');
const KOI_ORANGE = new THREE.Color('#ff7a2e');
const KOI_DARK = new THREE.Color('#2a2036');

const koiVert = /* glsl */ `
attribute float tint;
attribute float phase;
uniform float time;
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
void main() {
  vec3 pos = position;
  // tail wag: bend the back half sideways, more toward the tail tip
  float back = smoothstep(-0.02, -0.28, pos.z);
  pos.x += sin(time * 9.0 + phase) * 0.07 * back * back;
  mat4 model = modelMatrix * instanceMatrix;
  vec4 wp = model * vec4(pos, 1.0);
  vN = normalize(mat3(model) * normal);
  vV = cameraPosition - wp.xyz;
  vC = mix(color, instanceColor, tint);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const koiFrag = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 fogColor;
uniform vec2 fogRange;
varying vec3 vN;
varying vec3 vV;
varying vec3 vC;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vV);
  float lit = smoothstep(-0.35, 0.65, dot(N, sunDir));
  vec3 hemi = mix(vec3(0.55, 0.5, 0.6), vec3(0.95, 0.95, 1.0), N.y * 0.5 + 0.5);
  vec3 col = vC * (hemi * 0.55 + vec3(1.0, 0.96, 0.9) * lit * 0.7);
  float spec = pow(max(dot(reflect(-sunDir, N), V), 0.0), 40.0) * 0.8;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.3;
  col += vec3(spec + fres) + vC * 0.15; // a little glow: they are magic fish now
  col = mix(col, fogColor, smoothstep(fogRange.x, fogRange.y, length(vV)) * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** primitive → part with the world-shader attributes (colour, tint, sway); patches = koi blotches per face */
function part(geo, color, tint, patches = false) {
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const tints = new Float32Array(n);
  for (let i = 0; i < n; i += 3) {
    let c = color;
    if (patches) {
      const cx = pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2);
      const cy = pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2);
      const cz = pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2);
      const h = Math.sin(cx * 12.9898 + cy * 78.233 + cz * 37.719) * 43758.5453;
      c = h - Math.floor(h) > 0.6 ? KOI_ORANGE : KOI_WHITE;
    }
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = c.r;
      col[(i + k) * 3 + 1] = c.g;
      col[(i + k) * 3 + 2] = c.b;
      tints[i + k] = tint;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tints, 1));
  geo.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.computeVertexNormals();
  return geo;
}

function tris(points) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  return geo;
}

/** a chunky koi, nose along +Z, ~0.37 m long */
function koiGeometry() {
  const profile = [
    [0.006, -0.16], [0.03, -0.12], [0.055, -0.05], [0.064, 0.03], [0.052, 0.1], [0.028, 0.15], [0.006, 0.185],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(profile, 7);
  body.rotateX(Math.PI / 2); // +Y → +Z
  body.scale(0.85, 1.15, 1);
  const parts = [part(body, KOI_WHITE, 0.9, true)];
  // tail: a forked fluke, flat so it reads from above
  parts.push(part(tris([[0, 0.035, -0.15], [-0.11, 0.035, -0.29], [0, 0.035, -0.24], [0, 0.035, -0.15], [0, 0.035, -0.24], [0.11, 0.035, -0.29]]), KOI_ORANGE, 0.9));
  // pectoral fins
  for (const s of [-1, 1]) {
    const fin = [[s * 0.045, 0.032, 0.06], [s * 0.13, 0.032, -0.02], [s * 0.05, 0.032, -0.04]];
    parts.push(part(tris(s > 0 ? fin : [fin[0], fin[2], fin[1]]), KOI_ORANGE, 0.9));
    const eye = new THREE.IcosahedronGeometry(0.016, 0);
    eye.translate(s * 0.042, 0.03, 0.125);
    parts.push(part(eye, KOI_DARK, 0));
  }
  return mergeGeometries(parts, false);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _head = new THREE.Vector3();
const _lures = [];
const _sorted = [];

export class Fish {
  constructor(app) {
    this.app = app;
    const shared = app.world.uniforms;
    const geo = koiGeometry();
    // sketch fish: pencil until the pond is painted, then tinted by the paint on the water
    this.sketch = new THREE.InstancedMesh(geo, new WorldMaterial(shared, { flat: true, tint: 0.9, double: true, name: 'koi-sketch' }), CAPACITY);
    this.sketch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sketch.frustumCulled = false;
    this.sketch.renderOrder = 5;
    this.sketch.name = 'koi-sketch';
    // coloured fish: their own colour after a leap, tail wagging in the shader
    const geo2 = geo.clone();
    this.phase = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
    geo2.setAttribute('phase', this.phase);
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: shared.time, sunDir: shared.sunDir, fogColor: shared.fogColor, fogRange: shared.fogRange },
      vertexShader: koiVert,
      fragmentShader: koiFrag,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    mat.name = 'koi';
    this.colored = new THREE.InstancedMesh(geo2, mat, CAPACITY);
    this.colored.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.colored.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colored.frustumCulled = false;
    this.colored.renderOrder = 5;
    this.colored.name = 'koi';
    this.sketch.count = this.colored.count = 0;

    this.items = [];
    for (let i = 0; i < CAPACITY; i++) {
      this.items.push({
        index: i,
        pos: new THREE.Vector3(),
        target: new THREE.Vector3(),
        yaw: 0,
        pitch: 0,
        speed: 0.3,
        cruise: 0.35,
        wanderT: 0,
        orbitDir: i % 2 ? 1 : -1,
        phase: 0,
        stretch: 0,
        colored: false,
        color: new THREE.Color(KOI_ORANGE),
        lure: null, // the hand this fish is interested in
        leap: { active: false, t: 0, dur: 0.7, fromX: 0, fromZ: 0, toX: 0, toZ: 0, h: 0.4, hasColor: false, color: new THREE.Color(), hand: null, started: false, apexDone: false },
      });
    }
    this.hands = [app.hands.left, app.hands.right];
    this.nib = { left: { t: 0, tick: 0 }, right: { t: 0, tick: 0 } };
    this.leaps = 0; // total leaps (the scenario's counter)
    this.nibbles = 0; // total nibbles felt in a hand
    this.warm = 3; // frames: draw one hidden coloured instance at startup so its shader compiles before the first leap
    this.reset();
  }

  get coloredCount() {
    let n = 0;
    for (const f of this.items) if (f.colored) n++;
    return n;
  }

  /** scatter the fish (new island / cleared painting): sketches again */
  reset() {
    const rng = this.app.rng;
    const P = WORLD.pond;
    for (const f of this.items) {
      const a = rng.float() * TAU;
      const d = Math.sqrt(rng.float()) * P.radius * 0.7;
      f.pos.set(P.x + Math.cos(a) * d, 0, P.z + Math.sin(a) * d);
      f.yaw = rng.float() * TAU;
      f.pitch = 0;
      f.speed = 0.3;
      f.stretch = 0;
      f.colored = false;
      f.color.copy(KOI_ORANGE);
      f.leap.active = false;
      f.lure = null;
      f.wanderT = 0;
      f.phase = rng.float() * TAU;
    }
    for (const n of Object.values(this.nib)) {
      n.t = 0;
      n.tick = 0;
    }
  }

  _clampInside(v, frac = 0.8) {
    const P = WORLD.pond;
    const cx = v.x - P.x;
    const cz = v.z - P.z;
    const cd = Math.hypot(cx, cz);
    const maxR = P.radius * frac;
    if (cd > maxR) {
      v.x = P.x + (cx / cd) * maxR;
      v.z = P.z + (cz / cd) * maxR;
    }
    return v;
  }

  _pickTarget(f, nearPond, head) {
    const rng = this.app.rng;
    const P = WORLD.pond;
    f.wanderT = 3 + rng.float() * 5;
    f.cruise = 0.25 + rng.float() * 0.25;
    if (nearPond && rng.chance(0.6)) {
      // drift to the player's side of the pond
      const dx = head.x - P.x;
      const dz = head.z - P.z;
      const d = Math.hypot(dx, dz) || 1;
      f.target.set(P.x + (dx / d) * P.radius * 0.66 + rng.gauss() * 1.0, 0, P.z + (dz / d) * P.radius * 0.66 + rng.gauss() * 1.0);
    } else {
      const a = rng.float() * TAU;
      const d = Math.sqrt(rng.float()) * P.radius * 0.75;
      f.target.set(P.x + Math.cos(a) * d, 0, P.z + Math.sin(a) * d);
    }
    this._clampInside(f.target, 0.78);
  }

  /**
   * Start a leap along a parabola from where the fish is to (toX, toZ), h metres high.
   * color = the colour it takes at the apex (null keeps it as it is); delay staggers a rush.
   */
  _startLeap(f, toX, toZ, h, dur, color, { hand = null, delay = 0 } = {}) {
    const L = f.leap;
    L.active = true;
    L.t = -delay;
    L.dur = dur;
    L.fromX = f.pos.x;
    L.fromZ = f.pos.z;
    L.toX = toX;
    L.toZ = toZ;
    L.h = h;
    L.hasColor = !!color;
    if (color) L.color.copy(color);
    L.hand = hand;
    L.started = false;
    L.apexDone = false;
    f.lure = null;
  }

  /** the nearest interested fish leaps through the wand tip and takes the paint colour */
  leapThrough(f, hand) {
    const app = this.app;
    const wl = app.world.terrain.waterLevel;
    const tip = hand.tip;
    _p.set(tip.x * 2 - f.pos.x, 0, tip.z * 2 - f.pos.z);
    if (Math.hypot(_p.x - f.pos.x, _p.z - f.pos.z) < 0.4) {
      // right under the tip: hop onward along its heading instead of straight up
      _p.set(f.pos.x + Math.sin(f.yaw) * 0.5, 0, f.pos.z + Math.cos(f.yaw) * 0.5);
    }
    this._clampInside(_p, 0.8);
    const h = Math.max(0.35, tip.y - wl + 0.06);
    this._startLeap(f, _p.x, _p.z, h, 0.7, app.paint.color, { hand });
  }

  /** a ball hit the water: every fish rushes toward it and leaps, taking its colour */
  leapAll(p, color) {
    const rng = this.app.rng;
    let k = 0;
    for (const f of this.items) {
      if (f.leap.active) continue;
      const dx = p.x - f.pos.x;
      const dz = p.z - f.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const reach = Math.min(0.9, d * 0.5 + 0.3);
      _p.set(f.pos.x + (dx / d) * reach, 0, f.pos.z + (dz / d) * reach);
      this._clampInside(_p, 0.8);
      this._startLeap(f, _p.x, _p.z, 0.35 + rng.float() * 0.3, 0.65, color, { delay: 0.05 + k * 0.07 + rng.float() * 0.05 });
      k++;
    }
  }

  _leapStep(f, dt, wl) {
    const app = this.app;
    const fx = app.fx;
    const rng = app.rng;
    const L = f.leap;
    L.t += dt;
    if (L.t < 0) {
      f.pos.y = wl + Y_OFF;
      return;
    }
    if (!L.started) {
      L.started = true;
      this.leaps++;
      f.yaw = Math.atan2(L.toX - L.fromX, L.toZ - L.fromZ);
      _p.set(L.fromX, wl + 0.01, L.fromZ);
      if (fx) fx.splash(_p, L.hasColor ? L.color : f.color, 12, 1.6);
      if (app.audio) leapSplash(app.audio, _p, 1);
      app.events.emit('fishleap', { index: f.index, position: _p.clone(), color: (L.hasColor ? L.color : f.color).clone(), byHand: !!L.hand });
    }
    const u = Math.min(1, L.t / L.dur);
    f.pos.x = lerp(L.fromX, L.toX, u);
    f.pos.z = lerp(L.fromZ, L.toZ, u);
    f.pos.y = wl + Y_OFF + L.h * 4 * u * (1 - u);
    const vy = (L.h * 4 * (1 - 2 * u)) / L.dur;
    const dxz = Math.hypot(L.toX - L.fromX, L.toZ - L.fromZ) / L.dur;
    f.pitch = Math.atan2(vy, Math.max(dxz, 0.15));
    f.stretch = 1;
    if (!L.apexDone && u >= 0.5) {
      L.apexDone = true;
      if (L.hasColor) {
        f.color.copy(L.color);
        f.colored = true;
      }
      if (fx) fx.burst(f.pos, f.color, 16, 1.0, 0.035);
      if (L.hand) L.hand.pulse(0.6, 45);
      // fling three drops of colour at the nearest bank so fish help paint
      if (fx) {
        const P = WORLD.pond;
        const cx = f.pos.x - P.x;
        const cz = f.pos.z - P.z;
        const base = Math.atan2(cz, cx);
        for (let k = 0; k < 3; k++) {
          const r = P.radius * (0.98 + k * 0.1) + rng.float() * 0.3;
          const a = base + rng.gauss() * 0.3;
          _p.set(P.x + Math.cos(a) * r, f.pos.y + 0.4 + k * 0.15, P.z + Math.sin(a) * r);
          fx.drip(_p, f.color, 0.8 + rng.float() * 0.4);
        }
      }
    }
    if (u >= 1) {
      L.active = false;
      f.pitch = 0;
      f.pos.y = wl + Y_OFF;
      _p.set(f.pos.x, wl + 0.01, f.pos.z);
      if (fx) fx.splash(_p, f.color, 10, 1.3);
      if (app.audio) leapSplash(app.audio, _p, 0.6);
      // a little of its colour swirls into the water where it lands
      if (f.colored) app.world.paintMap.stamp(f.pos.x, f.pos.z, 0.8, f.color, 0.35, 0.6);
    }
  }

  update(dt, time) {
    const app = this.app;
    const world = app.world;
    const terrain = world.terrain;
    const wl = terrain.waterLevel;
    const P = WORLD.pond;

    // wand tips resting on (or dipped into) the water lure the nearest three fish
    const lures = _lures;
    lures.length = 0;
    for (const hand of this.hands) {
      if (!hand.connected || !hand.hasTip) continue;
      const t = hand.tip;
      if (t.y > wl + 0.05 || !terrain.isWater(t.x, t.z)) continue;
      lures.push(hand);
    }
    for (const f of this.items) f.lure = null;
    for (const hand of lures) {
      _sorted.length = 0;
      for (const f of this.items) if (!f.leap.active && !f.lure) _sorted.push(f);
      _sorted.sort((a, b) => a.pos.distanceToSquared(hand.tip) - b.pos.distanceToSquared(hand.tip));
      for (let k = 0; k < 3 && k < _sorted.length; k++) _sorted[k].lure = hand;
    }

    app.headPosition(_head);
    const nearPond = Math.hypot(_head.x - P.x, _head.z - P.z) < P.radius + 5;

    for (const f of this.items) {
      if (f.leap.active) {
        this._leapStep(f, dt, wl);
        continue;
      }
      let desiredYaw;
      let speed;
      if (f.lure) {
        const tip = f.lure.tip;
        const dx = f.pos.x - tip.x;
        const dz = f.pos.z - tip.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          // dart over
          desiredYaw = Math.atan2(-dx, -dz);
          speed = 1.3;
        } else {
          // circle under the tip
          const a = Math.atan2(dx, dz) + f.orbitDir * 0.9;
          const tx = tip.x + Math.sin(a) * 0.22;
          const tz = tip.z + Math.cos(a) * 0.22;
          desiredYaw = Math.atan2(tx - f.pos.x, tz - f.pos.z);
          speed = 0.5;
        }
      } else {
        f.wanderT -= dt;
        if (f.wanderT <= 0 || Math.hypot(f.target.x - f.pos.x, f.target.z - f.pos.z) < 0.25) this._pickTarget(f, nearPond, _head);
        desiredYaw = Math.atan2(f.target.x - f.pos.x, f.target.z - f.pos.z);
        speed = f.cruise;
      }
      let dy = desiredYaw - f.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      f.yaw += dy * (1 - Math.exp(-dt * (f.lure ? 7 : 3.5)));
      f.speed = damp(f.speed, speed, 4, dt);
      f.pos.x += Math.sin(f.yaw) * f.speed * dt;
      f.pos.z += Math.cos(f.yaw) * f.speed * dt;
      this._clampInside(f.pos, 0.82);
      f.pos.y = wl + Y_OFF;
      f.pitch = damp(f.pitch, 0, 6, dt);
      f.stretch = damp(f.stretch, 0, 5, dt);
    }

    // nibbling: fish circling a tip tickle the hand every 0.25 s; after 1.5 s one leaps through it
    for (const hand of this.hands) {
      const n = this.nib[hand.handedness];
      if (!lures.includes(hand)) {
        n.t = 0;
        n.tick = 0;
        continue;
      }
      let nearest = null;
      let nd = 0.4;
      for (const f of this.items) {
        if (f.lure !== hand || f.leap.active) continue;
        const d = Math.hypot(f.pos.x - hand.tip.x, f.pos.z - hand.tip.z);
        if (d < nd) {
          nd = d;
          nearest = f;
        }
      }
      if (!nearest) {
        n.tick = 0;
        continue;
      }
      n.t += dt;
      n.tick -= dt;
      if (n.tick <= 0) {
        n.tick = 0.25;
        this.nibbles++;
        hand.tick(0.1, 60);
        _p.set(hand.tip.x, wl + 0.01, hand.tip.z);
        if (app.audio) blub(app.audio, _p);
        if (app.fx) app.fx.splash(_p, nearest.colored ? nearest.color : KOI_WHITE, 2, 0.5);
      }
      if (n.t >= 1.5) {
        n.t = -1.3; // a breather before the next one
        this.leapThrough(nearest, hand);
      }
    }

    // instance matrices: sketch fish in one mesh, coloured fish in the other
    let ns = 0;
    let nc = 0;
    for (const f of this.items) {
      const wag = f.leap.active ? 0 : Math.sin(time * 9 + f.phase) * (0.08 + 0.1 * Math.min(1, f.speed / 0.8));
      _e.set(-f.pitch, f.yaw + wag, 0, 'YXZ');
      _q.setFromEuler(_e);
      _s.set(1, 1 - 0.1 * f.stretch, 1 + 0.12 * f.stretch);
      _m.compose(f.pos, _q, _s);
      if (f.colored) {
        this.colored.setMatrixAt(nc, _m);
        this.colored.setColorAt(nc, f.color);
        this.phase.array[nc] = f.phase;
        nc++;
      } else {
        this.sketch.setMatrixAt(ns, _m);
        ns++;
      }
    }
    if (this.warm > 0) {
      this.warm--;
      if (nc === 0) {
        _s.setScalar(0.0001);
        _m.compose(this.items[0].pos, _q, _s);
        this.colored.setMatrixAt(0, _m);
        this.colored.setColorAt(0, KOI_ORANGE);
        nc = 1;
      }
    }
    this.sketch.count = ns;
    this.colored.count = nc;
    this.sketch.instanceMatrix.needsUpdate = true;
    this.colored.instanceMatrix.needsUpdate = true;
    this.colored.instanceColor.needsUpdate = true;
    this.phase.needsUpdate = true;
  }
}
