import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WorldMaterial, addSmoothNormals } from '../world/WorldMaterial.js';
import { PropMaterial } from '../util/PropMaterial.js';
import { Rng } from '../util/random.js';
import { WORLD } from '../config.js';
import { damp, clamp, easeOutElastic } from '../util/math.js';
import * as Snd from '../audio/CritterSounds.js';

/**
 * Sleepyheads — a dozen pencil-sketch animals dozing around the island
 * (bunnies, frogs, birds). Zzz motes and soft snores lead you to them; a
 * wand poke only makes them twitch, but colour (a brush stroke, a paint
 * ball, or paint spreading under them) wakes them with an elastic pop and
 * they come alive in that colour: bunnies hop after you and sit looking up
 * at you, frogs hop to the pond bank and ribbit when booped, birds fly to
 * painted trees and swoop down to circle you.
 *
 * Rendering: per species one InstancedMesh for sleepers (WorldMaterial,
 * flat + graphite outline, so they are sketches that colour in with the
 * ground) and one for the awake ones (CritterMaterial: PropMaterial's toon
 * look + per-vertex colour/tint + instance colour + a hinge channel that
 * flaps wings and flops ears in the vertex shader). Closed eyes are drawn
 * by the outline pass: ink arcs with inverted winding that only the
 * back-face outline material renders. ≤ 9 draw calls, 14 matrices a frame.
 */

const CAP = 8; // instances per species
const HEIGHT = { bunny: 0.31, frog: 0.24, bird: 0.19 }; // body height at scale 1
const SIZE = { bunny: 1, frog: 1, bird: 1.3 }; // species scale (the bird is built small)
const BOOP_R = { bunny: 0.24, frog: 0.24, bird: 0.2 };
const WHITE = new THREE.Color(1, 1, 1);
const INK = new THREE.Color(0.14, 0.11, 0.2);
const PINK = new THREE.Color('#ff9ac4');
const ORANGE = new THREE.Color('#ffa03a');
const CREAM = new THREE.Color(1, 0.98, 0.9);
const ZZZ = new THREE.Color(0.42, 0.4, 0.62); // sleepy ink-lavender motes
const SKETCH = {
  bunny: new THREE.Color(0.95, 0.9, 0.82),
  frog: new THREE.Color(0.58, 0.82, 0.48),
  bird: new THREE.Color(0.62, 0.78, 0.96),
};
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const LINES = {
  bunny: ['You woke a bunny!', 'Good morning, bunny!', 'A bunny! So fluffy!'],
  frog: ['You woke a frog!', 'Ribbit! Hello, frog!', 'A sleepy frog! Hi!'],
  bird: ['You woke a little bird!', 'Tweet tweet! Good morning!', 'A bird! Look at it go!'],
};

// ---------------------------------------------------------------- geometry

const _P = new THREE.Vector3();
const _Q = new THREE.Quaternion();
const _S = new THREE.Vector3();
const _E = new THREE.Euler();

function trs(x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
  _P.set(x, y, z);
  _E.set(rx, ry, rz, 'XYZ');
  _Q.setFromEuler(_E);
  _S.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_P, _Q, _S);
}

/** a point offset from (cx,cy,cz) in a frame yawed around Y (eye parts) */
function at(cx, cy, cz, yaw, ox, oy, oz) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [cx + ox * c + oz * s, cy + oy, cz - ox * s + oz * c];
}

/**
 * Turn a primitive into a critter part. Attributes: color, tint (0 = keep
 * its own colour, 1 = take the paint / instance colour), sway (0, for the
 * WorldMaterial), hinge/axis/weight (vertex-shader rotation channel: the
 * awake mesh rotates these vertices by `anim * weight` around `axis`
 * through `hinge`). `ink` parts get inverted winding so only the outline
 * pass draws them (closed eyes, sleeping mouths). `smooth` keeps smooth
 * sphere normals for eyes; everything else is faceted like the flora.
 */
function part(geo, color, { tint = 1, matrix = null, hinge = null, axis = null, weight = 0, ink = false, smooth = false } = {}) {
  if (smooth) geo.computeVertexNormals();
  if (geo.index) geo = geo.toNonIndexed();
  geo.deleteAttribute('uv');
  if (ink) geo.scale(-1, 1, 1);
  if (matrix) geo.applyMatrix4(matrix);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const tints = new Float32Array(n);
  const hinges = new Float32Array(n * 3);
  const axes = new Float32Array(n * 3);
  const weights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r;
    col[i * 3 + 1] = color.g;
    col[i * 3 + 2] = color.b;
    tints[i] = tint;
    weights[i] = weight;
    if (hinge) {
      hinges[i * 3] = hinge.x;
      hinges[i * 3 + 1] = hinge.y;
      hinges[i * 3 + 2] = hinge.z;
    }
    if (axis) {
      axes[i * 3] = axis.x;
      axes[i * 3 + 1] = axis.y;
      axes[i * 3 + 2] = axis.z;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('tint', new THREE.BufferAttribute(tints, 1));
  geo.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('hinge', new THREE.BufferAttribute(hinges, 3));
  geo.setAttribute('axis', new THREE.BufferAttribute(axes, 3));
  geo.setAttribute('weight', new THREE.BufferAttribute(weights, 1));
  if (!smooth) geo.computeVertexNormals();
  geo.userData.ink = ink;
  // ink parts are not inflated by the outline pass: they pop out rigidly along their facing direction
  if (ink) geo.userData.inkDir = matrix ? new THREE.Vector3(0, 0, 1).transformDirection(matrix) : new THREE.Vector3(0, 0, 1);
  return geo;
}

/** a flat fan polygon (wings, tail); points relative to the hinge, fan from points[0] */
function fan(points, mirror = false) {
  const pos = [];
  for (let i = 1; i < points.length - 1; i++) {
    const tri = [points[0], points[i], points[i + 1]];
    if (mirror) tri.reverse();
    for (const p of tri) pos.push(mirror ? -p[0] : p[0], p[1], p[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function merge(parts) {
  const geo = mergeGeometries(parts, false);
  const ranges = [];
  let off = 0;
  for (const p of parts) {
    const n = p.attributes.position.count;
    if (p.userData.ink) ranges.push([off, off + n, p.userData.inkDir]);
    off += n;
  }
  geo.userData.inkRanges = ranges;
  return geo;
}

/** closed eye: a sleepy "︶" arc drawn in ink by the outline pass (tilt follows the face's slope) */
function inkArc(r, tube, x, y, z, yaw, tilt = 0) {
  return part(new THREE.TorusGeometry(r, tube, 4, 10, Math.PI), INK, { tint: 0, ink: true, matrix: trs(x, y, z, 1, 1, 1, tilt, yaw, Math.PI) });
}

function openEye(P, cx, cy, cz, yaw, r, s) {
  P.push(part(new THREE.SphereGeometry(r, 8, 6), WHITE, { tint: 0, smooth: true, matrix: trs(cx, cy, cz, 1, 1.15, 0.6, 0, yaw, 0) }));
  const pu = at(cx, cy, cz, yaw, 0, r * 0.12, r * 0.62);
  P.push(part(new THREE.SphereGeometry(r * 0.55, 7, 5), INK, { tint: 0, smooth: true, matrix: trs(pu[0], pu[1], pu[2]) }));
  const hl = at(cx, cy, cz, yaw, s * r * 0.2, r * 0.4, r * 1.05);
  P.push(part(new THREE.SphereGeometry(r * 0.2, 5, 4), WHITE, { tint: 0, smooth: true, matrix: trs(hl[0], hl[1], hl[2]) }));
}

/** an egg with long ears, big eyes, a pink nose, paws and a puff tail */
function buildBunny(awake) {
  const P = [];
  const bc = awake ? WHITE : SKETCH.bunny;
  const bt = awake ? 1 : 0.85;
  const pts = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const r = 0.14 * Math.pow(Math.sin(t * Math.PI), 0.55) * (1.06 - 0.3 * t);
    pts.push(new THREE.Vector2(Math.max(0.004, r), t * 0.3));
  }
  P.push(part(new THREE.LatheGeometry(pts, 12), bc, { tint: bt }));
  for (const s of [-1, 1]) {
    const ear = new THREE.CapsuleGeometry(0.03, 0.12, 2, 6);
    ear.translate(0, 0.09, 0); // base at the hinge
    const hinge = new THREE.Vector3(s * 0.05, 0.275, -0.025);
    // awake: ears up and slightly flared; asleep: lop ears drooping down the sides of the head
    const m = awake ? trs(hinge.x, hinge.y, hinge.z, 1, 1, 0.7, -0.15, 0, -s * 0.28) : trs(hinge.x, hinge.y, hinge.z, 1, 1, 0.7, -0.25, 0, -s * 2.35);
    P.push(part(ear, bc, { tint: bt, matrix: m, hinge: awake ? hinge : null, axis: X_AXIS, weight: awake ? 1 : 0 }));
  }
  for (const s of [-1, 1]) {
    const yaw = s * 0.45;
    if (awake) openEye(P, s * 0.05, 0.2, 0.1, yaw, 0.03, s);
    else P.push(inkArc(0.022, 0.006, s * 0.05, 0.196, 0.116, yaw, -0.45));
  }
  P.push(part(new THREE.SphereGeometry(0.012, 6, 5), PINK, { tint: 0, smooth: true, matrix: trs(0, 0.165, 0.121, 1, 0.8, 0.7) }));
  if (awake) {
    P.push(part(new THREE.TorusGeometry(0.012, 0.0028, 3, 8, Math.PI), INK, { tint: 0, matrix: trs(0, 0.148, 0.129, 1, 1, 1, 0, 0, Math.PI) }));
    for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.013, 6, 5), PINK, { tint: 0.15, smooth: true, matrix: trs(s * 0.08, 0.15, 0.098, 1, 0.8, 0.45, 0, s * 0.65, 0) }));
  } else {
    P.push(part(new THREE.TorusGeometry(0.01, 0.0035, 3, 8, Math.PI), INK, { tint: 0, ink: true, matrix: trs(0, 0.146, 0.124, 1, 1, 1, 0, 0, Math.PI) }));
  }
  for (const s of [-1, 1]) P.push(part(new THREE.SphereGeometry(0.038, 6, 4), bc, { tint: awake ? 0.7 : bt, matrix: trs(s * 0.062, 0.022, 0.085, 1, 0.5, 1.3) }));
  P.push(part(new THREE.SphereGeometry(0.035, 6, 4), bc, { tint: awake ? 0.5 : bt, matrix: trs(0, 0.07, -0.12) }));
  return merge(P);
}

/** a squat blob with bulging eyes, a wide smile and splayed legs */
function buildFrog(awake) {
  const P = [];
  const bc = awake ? WHITE : SKETCH.frog;
  const bt = awake ? 1 : 0.85;
  P.push(part(new THREE.SphereGeometry(0.13, 10, 7), bc, { tint: bt, matrix: trs(0, 0.1, 0, 1.15, 0.78, 1.0) }));
  P.push(part(new THREE.SphereGeometry(0.1, 8, 5), CREAM, { tint: awake ? 0.45 : 0.5, matrix: trs(0, 0.075, 0.07, 1.0, 0.55, 0.7) }));
  for (const s of [-1, 1]) {
    const ex = s * 0.066;
    const ey = 0.2;
    const ez = 0.045;
    if (awake) {
      P.push(part(new THREE.SphereGeometry(0.042, 9, 7), WHITE, { tint: 0, smooth: true, matrix: trs(ex, ey, ez) }));
      P.push(part(new THREE.SphereGeometry(0.02, 7, 5), INK, { tint: 0, smooth: true, matrix: trs(ex, ey + 0.004, ez + 0.03) }));
      P.push(part(new THREE.SphereGeometry(0.007, 5, 4), WHITE, { tint: 0, smooth: true, matrix: trs(ex + s * 0.008, ey + 0.017, ez + 0.038) }));
    } else {
      P.push(part(new THREE.SphereGeometry(0.042, 8, 6), bc, { tint: bt, matrix: trs(ex, ey, ez) }));
      P.push(inkArc(0.022, 0.0055, ex, ey - 0.004, ez + 0.038, 0));
    }
  }
  P.push(part(new THREE.TorusGeometry(0.06, 0.0055, 4, 12, Math.PI), INK, { tint: 0, ink: !awake, matrix: trs(0, 0.105, awake ? 0.136 : 0.128, 1, 0.6, 1, 0, 0, Math.PI) }));
  for (const s of [-1, 1]) {
    P.push(part(new THREE.SphereGeometry(0.036, 6, 4), bc, { tint: bt, matrix: trs(s * 0.1, 0.016, 0.1, 1.4, 0.45, 1.3) }));
    P.push(part(new THREE.SphereGeometry(0.055, 7, 5), bc, { tint: bt, matrix: trs(s * 0.135, 0.05, -0.03, 1, 0.75, 1.2) }));
  }
  return merge(P);
}

/** a round bird: beak, crest, fan wings on hinges (awake) or folded (asleep) */
function buildBird(awake) {
  const P = [];
  const bc = awake ? WHITE : SKETCH.bird;
  const bt = awake ? 1 : 0.85;
  P.push(part(new THREE.SphereGeometry(0.08, 10, 7), bc, { tint: bt, matrix: trs(0, 0.095, 0, 1, 1, 1.15) }));
  P.push(part(new THREE.SphereGeometry(0.065, 8, 5), CREAM, { tint: 0.45, matrix: trs(0, 0.075, 0.045, 0.9, 0.8, 0.75) }));
  const beak = new THREE.ConeGeometry(0.018, 0.05, 5);
  beak.translate(0, 0.025, 0);
  P.push(part(beak, ORANGE, { tint: 0, matrix: trs(0, 0.1, 0.088, 1, 1, 1, Math.PI / 2, 0, 0) }));
  for (const s of [-1, 1]) {
    const yaw = s * 0.55;
    if (awake) openEye(P, s * 0.038, 0.125, 0.072, yaw, 0.02, s);
    else P.push(inkArc(0.014, 0.0045, s * 0.038, 0.122, 0.078, yaw));
  }
  P.push(part(new THREE.SphereGeometry(0.018, 6, 5), bc, { tint: bt, matrix: trs(0, 0.178, -0.01, 0.5, 1.3, 0.8, -0.5, 0, 0) }));
  const wing = [
    [0, 0, 0.03], [0.05, 0, 0.055], [0.12, 0, 0.035], [0.135, 0, -0.02], [0.09, 0, -0.06], [0, 0, -0.045],
  ];
  for (const s of [-1, 1]) {
    if (awake) {
      const hinge = new THREE.Vector3(s * 0.055, 0.11, 0);
      P.push(part(fan(wing, s < 0), bc, { tint: 0.9, matrix: new THREE.Matrix4().makeTranslation(hinge.x, hinge.y, hinge.z), hinge, axis: Z_AXIS, weight: s }));
    } else {
      P.push(part(new THREE.SphereGeometry(0.05, 7, 5), bc, { tint: bt, matrix: trs(s * 0.072, 0.1, -0.008, 0.35, 0.7, 1.1, 0, 0, s * 0.25) }));
    }
  }
  if (awake) {
    P.push(part(fan([[0, 0, 0], [-0.03, 0.005, -0.07], [0, 0.012, -0.09], [0.03, 0.005, -0.07]]), bc, { tint: 0.9, matrix: new THREE.Matrix4().makeTranslation(0, 0.1, -0.085) }));
  } else {
    P.push(part(new THREE.SphereGeometry(0.04, 6, 4), bc, { tint: bt, matrix: trs(0, 0.1, -0.1, 0.6, 0.3, 1.2, 0.3, 0, 0) }));
  }
  return merge(P);
}

const BUILDERS = { bunny: buildBunny, frog: buildFrog, bird: buildBird };

// ---------------------------------------------------------------- material

const critterVert = /* glsl */ `
attribute float tint;
attribute vec3 hinge;
attribute vec3 axis;
attribute float weight;
attribute float anim;
varying vec3 vN;
varying vec3 vV;
varying vec3 vVColor;
varying float vTint;
#ifdef INSTANCE_COLOR
varying vec3 vIColor;
#endif
vec3 rot(vec3 p, vec3 ax, float a) {
  float c = cos(a);
  float s = sin(a);
  return p * c + cross(ax, p) * s + ax * dot(ax, p) * (1.0 - c);
}
void main() {
  mat4 model = modelMatrix;
  #ifdef USE_INSTANCING
    model = modelMatrix * instanceMatrix;
  #endif
  vec3 pos = position;
  vec3 nrm = normal;
  if (weight != 0.0) {
    float a = anim * weight;
    pos = hinge + rot(position - hinge, axis, a);
    nrm = rot(normal, axis, a);
  }
  vec4 wp = model * vec4(pos, 1.0);
  vN = normalize(mat3(model) * nrm);
  vV = cameraPosition - wp.xyz;
  vVColor = color;
  vTint = tint;
  #ifdef INSTANCE_COLOR
    #ifdef USE_INSTANCING_COLOR
      vIColor = instanceColor;
    #else
      vIColor = vec3(1.0);
    #endif
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const critterFrag = /* glsl */ `
uniform vec3 color;
uniform vec3 emissive;
uniform float rim;
uniform float gloss;
uniform vec3 sunDir;
uniform vec3 fogColor;
uniform vec2 fogRange;
uniform float opacity;
varying vec3 vN;
varying vec3 vV;
varying vec3 vVColor;
varying float vTint;
#ifdef INSTANCE_COLOR
varying vec3 vIColor;
#endif
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vV);
  vec3 own = vVColor;
  #ifdef INSTANCE_COLOR
    vec3 painted = vIColor * (0.35 + 0.75 * luma(own));
  #else
    vec3 painted = own;
  #endif
  vec3 base = color * mix(own, painted, vTint);
  float ndl = dot(N, sunDir);
  float lit = smoothstep(-0.35, 0.65, ndl);
  vec3 hemi = mix(vec3(0.55, 0.5, 0.6), vec3(0.95, 0.95, 1.0), N.y * 0.5 + 0.5);
  vec3 col = base * (hemi * 0.55 + vec3(1.0, 0.96, 0.9) * lit * 0.7);
  float spec = pow(max(dot(reflect(-sunDir, N), V), 0.0), 48.0) * gloss;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0) * rim;
  col += vec3(1.0) * (spec + fres);
  col += emissive;
  float dist = length(vV);
  col = mix(col, fogColor, smoothstep(fogRange.x, fogRange.y, dist) * 0.85);
  gl_FragColor = vec4(col, opacity);
  #include <colorspace_fragment>
}
`;

/** PropMaterial's look with per-vertex colour/tint and the hinge animation channel */
class CritterMaterial extends PropMaterial {
  constructor(shared, opts = {}) {
    super(shared, { instanceColor: true, rim: 0.35, gloss: 0.9, ...opts });
    this.vertexShader = critterVert;
    this.fragmentShader = critterFrag;
    this.vertexColors = true;
    this.name = opts.name || 'CritterMaterial';
  }
}

// ---------------------------------------------------------------- system

const _m = new THREE.Matrix4();
const _head = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Color();
const _eul = new THREE.Euler();
const SAVE_KEY = 'colorzone:save:v1'; // SaveGame's key (fallback restore when SaveGame is built after the play layer)

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class Critters {
  constructor(app) {
    this.app = app;
    const shared = app.world.uniforms;
    this.group = new THREE.Group();
    this.group.name = 'critters';
    this.items = [];
    this.wakeCount = 0;
    this.boopCount = 0;
    this.teaseCount = 0;
    this.lastThud = -10;
    this.pollT = 0;
    this.warm = 3; // frames that show a hidden instance so every awake shader compiles at startup
    this.tips = [null, null];
    this.nTips = 0;
    this.brushes = [null, null];
    this.nBrush = 0;
    this.saveReady = false;

    this.sleepMat = new WorldMaterial(shared, { flat: true, name: 'critters' });
    this.outlineMat = new WorldMaterial(shared, { flat: true, outline: true, outlineWidth: 0.012, name: 'critters-outline' });
    this.awakeMat = new CritterMaterial(shared, { name: 'critters-awake' });
    this.awakeMatDouble = new CritterMaterial(shared, { name: 'critters-awake-2s', side: THREE.DoubleSide });
    this.kinds = {};
    this.kindList = [];
    for (const species of ['bunny', 'frog', 'bird']) {
      const build = BUILDERS[species];
      const sleepGeo = build(false);
      addSmoothNormals(sleepGeo);
      const sn = sleepGeo.attributes.snormal.array;
      for (const [a, b, dir] of sleepGeo.userData.inkRanges) {
        // a constant direction per ink part: the outline pass shifts it rigidly instead of inflating it
        // (a zero vector would hit normalize() in the shader and vanish)
        for (let i = a; i < b; i++) {
          sn[i * 3] = dir.x;
          sn[i * 3 + 1] = dir.y;
          sn[i * 3 + 2] = dir.z;
        }
      }
      const asleep = new THREE.InstancedMesh(sleepGeo, this.sleepMat, CAP);
      asleep.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const outline = new THREE.InstancedMesh(sleepGeo, this.outlineMat, CAP);
      outline.instanceMatrix = asleep.instanceMatrix;
      const awakeGeo = build(true);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1).setUsage(THREE.DynamicDrawUsage);
      awakeGeo.setAttribute('anim', anim);
      const awake = new THREE.InstancedMesh(awakeGeo, species === 'bird' ? this.awakeMatDouble : this.awakeMat, CAP);
      awake.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      awake.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
      for (const [mesh, name] of [[asleep, 'critters-' + species], [outline, 'critters-' + species + '-outline'], [awake, 'critters-' + species + '-awake']]) {
        mesh.frustumCulled = false;
        mesh.name = name;
        mesh.count = 0;
        this.group.add(mesh);
      }
      const kind = { species, asleep, outline, awake, anim, nA: 0, nW: 0 };
      this.kinds[species] = kind;
      this.kindList.push(kind);
    }

    this.build(app.world.seed);

    const ev = app.events;
    ev.on('splat', (e) => this._onSplat(e));
    ev.on('reset', () => {
      if (app.world.seed !== this.seed) this.build(app.world.seed);
      else this.sleepAll();
    });
    if (app.saveGame) this._registerSave();
  }

  // ---- placement

  /** seeded placement beside trees, rocks and the pond bank, spreading outward from the start */
  build(seed) {
    this.seed = seed;
    const app = this.app;
    const world = app.world;
    const terrain = world.terrain;
    const flora = world.flora;
    const rng = new Rng((seed + 9001) >>> 0);
    const pond = WORLD.pond;
    const waterY = terrain.waterLevel;
    this.items.length = 0;
    for (const k of this.kindList) k.nA = k.nW = 0;
    const taken = [];
    const ok = (x, z) => {
      if (!terrain.isOnIsland(x, z, 4.5)) return false;
      if (Math.hypot(x, z) < 2.2) return false;
      const pd = Math.hypot(x - pond.x, z - pond.z);
      if (pd < pond.radius * 1.03) return false;
      if (pd < pond.radius * 1.4 && terrain.heightAt(x, z) < waterY + 0.05) return false;
      if (terrain.slopeAt(x, z) > 0.38) return false;
      if (Math.hypot(x + 1.25, z + 2.6) < 1.8) return false; // help sign
      for (const t of flora.trees) if (Math.hypot(t.x - x, t.z - z) < 0.75) return false;
      for (const r of flora.rocks) if (Math.hypot(r.x - x, r.z - z) < r.s * 1.25 + 0.12) return false;
      for (const s of taken) if (Math.hypot(s[0] - x, s[1] - z) < 3.2) return false;
      return true;
    };
    const cands = [];
    for (const t of flora.trees) {
      for (let k = 0; k < 2; k++) {
        const a = rng.float() * Math.PI * 2;
        const d = rng.range(1.3, 1.7);
        cands.push([t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 'tree']);
      }
    }
    for (const r of flora.rocks) {
      const a = rng.float() * Math.PI * 2;
      const d = r.s * 1.25 + 0.32;
      cands.push([r.x + Math.cos(a) * d, r.z + Math.sin(a) * d, 'rock']);
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + rng.range(-0.2, 0.2);
      const d = pond.radius * 1.1;
      cands.push([pond.x + Math.cos(a) * d, pond.z + Math.sin(a) * d, 'pond']);
    }
    const dist0 = (c) => Math.hypot(c[0], c[1]);
    const pick = (species, dMin, dMax) => {
      const prefs = species === 'frog' ? ['pond', 'rock', 'tree'] : ['tree', 'rock'];
      for (const kind of prefs) {
        const pool = cands.filter((c) => c[2] === kind && dist0(c) >= dMin && dist0(c) <= dMax && ok(c[0], c[1]));
        if (pool.length) return rng.pick(pool);
      }
      for (let tries = 0; tries < 80; tries++) {
        const a = rng.float() * Math.PI * 2;
        const d = rng.range(dMin, dMax);
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (ok(x, z)) return [x, z, 'meadow'];
      }
      return null;
    };
    // the first sleeper is right in front of the start; the rest spread outward in bands
    const plan = [
      ['bunny', 'front'], ['bird', 3.2, 6], ['frog', 6, 9.5], ['bird', 8, 12], ['bunny', 10, 14], ['frog', 12, 16.5], ['bird', 14, 18.5],
      ['bunny', 16, 21], ['frog', 18, 24], ['bird', 20, 26], ['bunny', 22, 29], ['frog', 24, 31], ['bunny', 26, 33],
    ];
    const used = { bunny: 0, frog: 0, bird: 0 };
    for (const [species, a, b] of plan) {
      if (used[species] >= CAP) continue;
      let spot = null;
      if (a === 'front') {
        for (let tries = 0; tries < 60 && !spot; tries++) {
          const x = rng.range(0.1, 1.9);
          const z = -rng.range(3.6, 5.0);
          if (ok(x, z)) spot = [x, z, 'meadow'];
        }
        if (!spot) spot = pick(species, 3.5, 5.5);
      } else spot = pick(species, a, b) || pick(species, Math.max(2.5, a - 3), b + 4);
      if (!spot) continue;
      taken.push([spot[0], spot[1]]);
      used[species]++;
      this._add(species, spot[0], spot[1], rng);
    }
  }

  _add(species, x, z, rng) {
    const y = this.app.world.heightAt(x, z);
    const yaw = Math.atan2(-x, -z) + rng.range(-0.7, 0.7); // face inward: the player arrives from the middle
    const it = {
      index: this.items.length,
      species,
      home: new THREE.Vector3(x, y, z),
      pos: new THREE.Vector3(x, y, z),
      homeYaw: yaw,
      yaw,
      yawT: yaw,
      awake: false,
      color: SKETCH[species].clone(),
      scale: rng.range(0.92, 1.12) * SIZE[species],
      phase: rng.float() * Math.PI * 2,
      zzzT: rng.float() * 0.7,
      snoreT: rng.range(1, 4),
      stir: false,
      twitchT: 0,
      teaseT: 0,
      boopT: 0,
      wakeT: -1e9,
      squash: 0,
      pitch: 0,
      roll: 0,
      anim: 0,
      hopping: false,
      hop: { fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, t: 0, dur: 0.4, h: 0.2 },
      hops: 0,
      restT: 0,
      idleT: rng.range(2, 5),
      repaintT: 0,
      wiggleT: 0,
      startle: 0,
      atBank: false,
      mode: 'ground', // birds: circle | fly | perch | land | ground
      modeT: 0,
      vel: new THREE.Vector3(),
      perch: new THREE.Vector3(),
      tree: -1,
      circleA: 0,
      stay: 0,
      treeT: 0,
    };
    this.items.push(it);
    return it;
  }

  /** everything back to sleep at home (same island, painting cleared) */
  sleepAll() {
    for (const it of this.items) {
      it.awake = false;
      it.pos.copy(it.home);
      it.yaw = it.yawT = it.homeYaw;
      it.stir = false;
      it.twitchT = it.teaseT = it.boopT = it.squash = it.pitch = it.roll = it.anim = 0;
      it.hopping = false;
      it.wakeT = -1e9;
      it.mode = 'ground';
      it.vel.set(0, 0, 0);
    }
  }

  // ---- persistence

  _registerSave() {
    if (this.saveReady || !this.app.saveGame) return;
    this.saveReady = true;
    this.app.saveGame.register('critters', {
      serialize: () => ({ awake: this.items.filter((i) => i.awake).map((i) => [i.index, '#' + i.color.getHexString()]) }),
      restore: (d) => this._restore(d),
    });
  }

  _restore(d) {
    if (!d || !Array.isArray(d.awake)) return;
    for (const entry of d.awake) {
      if (!Array.isArray(entry)) continue;
      const [i, hex] = entry;
      if (typeof i === 'number' && typeof hex === 'string') this.wake(i, _c.set(hex), 'restore', null, true);
    }
  }

  /** SaveGame loads before play systems can register with it: read our slice of the save ourselves once */
  _restoreFromStorage() {
    try {
      const json = localStorage.getItem(SAVE_KEY);
      if (!json) return;
      const data = JSON.parse(json);
      if (data && data.seed === this.app.seedName && data.ext && data.ext.critters) this._restore(data.ext.critters);
    } catch (e) {
      /* no save, or an old one */
    }
  }

  // ---- public interface

  get awakeCount() {
    let n = 0;
    for (const it of this.items) if (it.awake) n++;
    return n;
  }

  get sleepingCount() {
    return this.items.length - this.awakeCount;
  }

  nearestSleeping(from) {
    let best = null;
    let bd = Infinity;
    for (const it of this.items) {
      if (it.awake) continue;
      const d = it.pos.distanceTo(from);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  /** wake a sleeper in a colour; by: 'paint' | 'ball' | 'spread' (| 'restore', silent) */
  wake(index, color, by = 'paint', hand = null, silent = false) {
    const it = this.items[index];
    if (!it || it.awake) return false;
    const app = this.app;
    it.awake = true;
    it.color.copy(color);
    it.wakeT = silent ? -1e9 : app.time;
    it.stir = false;
    it.twitchT = 0;
    it.squash = 0;
    it.pitch = 0;
    it.hopping = false;
    it.atBank = false;
    it.vel.set(0, 0, 0);
    it.modeT = 0;
    it.mode = it.species === 'bird' && !silent ? 'circle' : 'ground';
    app.headPosition(_head);
    it.circleA = Math.atan2(it.pos.z - _head.z, it.pos.x - _head.x);
    it.restT = silent ? 0 : 1.1; // a stretch before the first hop
    it.treeT = 0;
    it.yawT = Math.atan2(_head.x - it.pos.x, _head.z - it.pos.z);
    this.wakeCount++;
    if (silent) return true;
    _v.set(it.pos.x, it.pos.y + HEIGHT[it.species] * it.scale * 0.5, it.pos.z);
    if (app.fx) {
      app.fx.burst(_v, it.color, 28, 1.3, 0.045);
      app.fx.confetti(_v, 22, [it.color, WHITE], 1.5);
    }
    Snd.yawn(app.audio, _v);
    if (hand) hand.pulse(0.9, 120);
    else if (by === 'ball') {
      app.hands.left.pulse(0.6, 80);
      app.hands.right.pulse(0.6, 80);
    }
    if (app.buddy && !app.saveGame?.loading) {
      app.buddy.say(app.rng.pick(LINES[it.species]), 2.2);
      app.buddy.setMood?.('happy', 2.2);
      app.buddy.react?.(0.6);
      app.buddy.spinVel += 8;
    }
    app.bumpEnergy(0.5);
    app.saveGame?.markDirty();
    app.events.emit('critterwake', { index: it.index, species: it.species, position: it.pos.clone(), color: it.color.clone(), by });
    return true;
  }

  /** poke an awake critter: squash, a voice, a little hop, haptics */
  boop(index, hand = null) {
    const it = this.items[index];
    if (!it || !it.awake || it.boopT > 0) return false;
    const app = this.app;
    const rng = app.rng;
    it.boopT = 0.5;
    it.wiggleT = 0.5;
    this.boopCount++;
    _v.set(it.pos.x, it.pos.y + HEIGHT[it.species] * it.scale * 0.5, it.pos.z);
    // hop a little away from the hand
    let ax = 0;
    let az = 1;
    if (hand) {
      ax = it.pos.x - hand.tip.x;
      az = it.pos.z - hand.tip.z;
      const d = Math.hypot(ax, az) || 1;
      ax /= d;
      az /= d;
    }
    if (it.species === 'frog') {
      it.squash = -0.35;
      Snd.ribbit(app.audio, _v, rng.int(0, 4));
      if (!it.hopping && this._hopOk(it.pos.x + ax * 0.15, it.pos.z + az * 0.15)) this._hopTo(it, it.pos.x + ax * 0.15, it.pos.z + az * 0.15, 0.36, 0.22);
    } else if (it.species === 'bunny') {
      it.squash = 0.6;
      Snd.squeak(app.audio, _v, 1.15 + rng.float() * 0.2);
      if (!it.hopping && this._hopOk(it.pos.x + ax * 0.25, it.pos.z + az * 0.25)) this._hopTo(it, it.pos.x + ax * 0.25, it.pos.z + az * 0.25, 0.32, 0.16);
    } else {
      it.squash = 0.5;
      Snd.tweet(app.audio, _v);
      if (it.mode === 'ground') {
        // flutter up and settle back on the same spot
        it.perch.copy(it.pos);
        it.mode = 'land';
        it.modeT = 0;
        it.vel.set(ax * 0.6, 1.4, az * 0.6);
      } else if (it.mode === 'perch') {
        it.mode = 'circle';
        it.modeT = 0;
        it.circleA = Math.atan2(it.pos.z - _head.z, it.pos.x - _head.x);
        it.vel.set(ax * 0.5, 1.2, az * 0.5);
      } else it.vel.y += 1.5;
    }
    if (hand) hand.pulse(0.6, 45);
    if (app.fx) app.fx.burst(_v, it.color, 8, 0.6, 0.03);
    return true;
  }

  // ---- events

  _onSplat(e) {
    if (!e || !e.position) return;
    for (const it of this.items) {
      const d = Math.hypot(it.pos.x - e.position.x, it.pos.z - e.position.z);
      if (!it.awake) {
        if (d < 1.5 && e.color) this.wake(it.index, e.color, 'ball');
      } else if (d < 3 && it.species !== 'bird') it.startle = 1;
    }
  }

  // ---- update

  update(dt, time) {
    const app = this.app;
    if (!this.saveReady && app.saveGame) {
      this._registerSave();
      if (app.restored) this._restoreFromStorage();
    }
    if (!this.items.length) return;
    app.headPosition(_head);
    this.nTips = 0;
    for (const h of [app.hands.left, app.hands.right]) if (h.connected && h.hasTip) this.tips[this.nTips++] = h;
    this.nBrush = 0;
    for (const b of app.brushes) if (b.painting) this.brushes[this.nBrush++] = b;
    this.pollT -= dt;
    const poll = this.pollT <= 0;
    if (poll) this.pollT = 0.25;
    for (const k of this.kindList) k.nA = k.nW = 0;
    for (const it of this.items) {
      const dHead = Math.hypot(it.pos.x - _head.x, it.pos.z - _head.z);
      if (!it.awake) this._sleeper(it, dt, time, dHead, poll);
      else this._awake(it, dt, time, dHead, poll);
      this._place(it, time);
    }
    for (const k of this.kindList) {
      if (this.warm > 0 && k.nW === 0) {
        _m.makeScale(0.001, 0.001, 0.001).setPosition(0, -60, 0);
        k.awake.setMatrixAt(0, _m);
        k.awake.setColorAt(0, WHITE);
        k.nW = 1;
      }
      k.asleep.count = k.outline.count = k.nA;
      k.asleep.instanceMatrix.needsUpdate = true;
      k.awake.count = k.nW;
      k.awake.instanceMatrix.needsUpdate = true;
      k.awake.instanceColor.needsUpdate = true;
      k.anim.needsUpdate = true;
    }
    if (this.warm > 0) this.warm--;
  }

  /** compose this critter's instance matrix into its species mesh */
  _place(it, time) {
    const k = this.kinds[it.species];
    let s = it.scale;
    let sy = 1;
    let sxz = 1;
    let y = it.pos.y;
    let yaw = it.yaw;
    if (!it.awake) {
      const amp = it.stir ? 0.06 : 0.03;
      const br = Math.sin(time * (it.stir ? 2.4 : 1.4) + it.phase) * amp;
      sy = 1 + br;
      sxz = 1 - br * 0.5;
      if (it.twitchT > 0) {
        yaw += Math.sin(time * 42) * 0.1 * Math.min(1, it.twitchT * 4);
        sxz *= 1 + Math.sin(time * 33) * 0.05;
      }
      _eul.set(0, yaw, 0, 'YXZ');
      _Q.setFromEuler(_eul);
      _S.set(s * sxz, s * sy, s * sxz);
      _P.set(it.pos.x, y, it.pos.z);
      _m.compose(_P, _Q, _S);
      k.asleep.setMatrixAt(k.nA++, _m);
      return;
    }
    const w = (time - it.wakeT) / 1.1;
    if (w < 1) {
      s *= 0.6 + 0.4 * easeOutElastic(clamp(w, 0, 1));
      y += Math.sin(clamp(w * 2.2, 0, 1) * Math.PI) * 0.12;
    }
    sy = 1 + it.squash;
    sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    _eul.set(-it.pitch, yaw, it.roll, 'YXZ');
    _Q.setFromEuler(_eul);
    _S.set(s * sxz, s * sy, s * sxz);
    _P.set(it.pos.x, y, it.pos.z);
    _m.compose(_P, _Q, _S);
    k.awake.setMatrixAt(k.nW, _m);
    k.awake.setColorAt(k.nW, it.color);
    k.anim.array[k.nW] = it.anim;
    k.nW++;
  }

  _sleeper(it, dt, time, dHead, poll) {
    const app = this.app;
    const rng = app.rng;
    if (it.teaseT > 0) it.teaseT -= dt;
    if (it.twitchT > 0) it.twitchT -= dt;
    const h = HEIGHT[it.species] * it.scale;
    // Zzz motes drift up from the sleeper
    if (dHead < 25) {
      it.zzzT -= dt;
      if (it.zzzT <= 0) {
        it.zzzT = (it.stir ? 0.35 : 0.7) * (0.8 + rng.float() * 0.4);
        if (app.fx) {
          _v.set(it.pos.x + rng.gauss() * 0.05, it.pos.y + h + 0.06, it.pos.z + rng.gauss() * 0.05);
          _v2.set(rng.gauss() * 0.05, 0.22 + rng.float() * 0.1, rng.gauss() * 0.05);
          const life = 1.5 + rng.float() * 0.5;
          const size = 0.06 + rng.float() * 0.025 + dHead * 0.012; // a beacon: bigger when seen from afar
          // ink-tinted stars from the normal-blended pool: additive white would vanish on the paper
          if (app.fx.bits) app.fx.bits.emit(_v.x, _v.y, _v.z, _v2.x, _v2.y, _v2.z, ZZZ.r, ZZZ.g, ZZZ.b, app.time, life, size, 0, rng.float());
          else app.fx.sparkle(_v, _v2, ZZZ, life, size);
        }
      }
    }
    // a soft snore when you are close
    if (dHead < 8) {
      it.snoreT -= dt;
      if (it.snoreT <= 0) {
        it.snoreT = 3.6 + rng.float() * 1.6;
        Snd.snore(app.audio, it.pos);
      }
    }
    // colour under it: stir, then wake once it is really painted and you are near
    if (poll) {
      const cov = app.world.paintMap.coverageAt(it.home.x, it.home.z);
      it.stir = cov > 0.3;
      if (cov >= 0.6 && dHead < 6) {
        app.world.paintMap.colorAt(it.home.x, it.home.z, _c);
        if (_c.r + _c.g + _c.b > 0.05) {
          this.wake(it.index, _c, 'spread');
          return;
        }
      }
    }
    if (it.stir && it.twitchT <= 0 && rng.chance(dt * 0.4)) it.twitchT = 0.3;
    // a painting brush passing through wakes it in that colour
    _v.set(it.pos.x, it.pos.y + h * 0.5, it.pos.z);
    for (let i = 0; i < this.nBrush; i++) {
      const b = this.brushes[i];
      if (b.smooth.distanceTo(_v) < 0.45) {
        b.currentColor(_c);
        this.wake(it.index, _c, 'paint', b.hand);
        return;
      }
    }
    // a wand poke only makes it twitch ("it needs colour")
    if (it.teaseT <= 0) {
      for (let i = 0; i < this.nTips; i++) {
        const hand = this.tips[i];
        if (hand.tip.distanceTo(_v) < 0.2 + h * 0.15) {
          it.teaseT = 0.6;
          it.twitchT = 0.35;
          this.teaseCount++;
          Snd.squeak(app.audio, _v, 0.8 + rng.float() * 0.3);
          Snd.rustle(app.audio, _v);
          hand.tick(0.3, 40);
          break;
        }
      }
    }
  }

  _awake(it, dt, time, dHead, poll) {
    const app = this.app;
    it.squash = damp(it.squash, 0, 6, dt);
    if (it.boopT > 0) it.boopT -= dt;
    if (it.repaintT > 0) it.repaintT -= dt;
    if (it.wiggleT > 0) it.wiggleT -= dt;
    const h = HEIGHT[it.species] * it.scale;
    _v.set(it.pos.x, it.pos.y + h * 0.5, it.pos.z);
    if (it.boopT <= 0) {
      for (let i = 0; i < this.nTips; i++) {
        const hand = this.tips[i];
        if (hand.tip.distanceTo(_v) < BOOP_R[it.species] * it.scale) {
          this.boop(it.index, hand);
          break;
        }
      }
    }
    // a fresh coat of colour
    for (let i = 0; i < this.nBrush; i++) {
      const b = this.brushes[i];
      if (b.smooth.distanceTo(_v) < 0.45) {
        b.currentColor(_c);
        if (!it.color.equals(_c)) {
          it.color.copy(_c);
          app.saveGame?.markDirty();
        }
        if (it.repaintT <= 0) {
          it.repaintT = 0.7;
          it.squash += 0.45;
          it.wiggleT = 0.5;
          Snd.happy(app.audio, _v);
          if (it.species === 'bird' && it.mode !== 'perch' && it.mode !== 'ground') it.vel.y += 0.6;
          if (app.fx) app.fx.burst(_v, it.color, 10, 0.7, 0.03);
        }
        break;
      }
    }
    if (it.species === 'bunny') this._bunny(it, dt, time, dHead);
    else if (it.species === 'frog') this._frog(it, dt, time, dHead);
    else this._bird(it, dt, time, dHead, poll);
    const dy = wrapAngle(it.yawT - it.yaw);
    it.yaw += dy * (1 - Math.exp(-dt * 8));
  }

  // ---- hops (bunnies, frogs)

  _hopOk(x, z) {
    const world = this.app.world;
    const t = world.terrain;
    if (!t.isOnIsland(x, z, 2.5) || t.isWater(x, z)) return false;
    const pond = WORLD.pond;
    if (Math.hypot(x - pond.x, z - pond.z) < pond.radius * 1.4 && world.heightAt(x, z) < t.waterLevel + 0.04) return false;
    if (t.slopeAt(x, z) > 0.6) return false;
    const flora = world.flora;
    for (const tr of flora.trees) if (Math.hypot(tr.x - x, tr.z - z) < 0.45) return false;
    for (const r of flora.rocks) if (Math.hypot(r.x - x, r.z - z) < r.s * 1.15) return false;
    return true;
  }

  _hopTo(it, tx, tz, dur, h) {
    const hop = it.hop;
    hop.fx = it.pos.x;
    hop.fy = it.pos.y;
    hop.fz = it.pos.z;
    hop.tx = tx;
    hop.tz = tz;
    hop.ty = this.app.world.heightAt(tx, tz);
    hop.t = 0;
    hop.dur = dur;
    hop.h = h;
    it.hopping = true;
    it.squash = 0.3;
    it.yawT = Math.atan2(tx - it.pos.x, tz - it.pos.z);
  }

  _updateHop(it, dt, time, dHead) {
    const hop = it.hop;
    hop.t += dt;
    const k = Math.min(1, hop.t / hop.dur);
    it.pos.x = hop.fx + (hop.tx - hop.fx) * k;
    it.pos.z = hop.fz + (hop.tz - hop.fz) * k;
    it.pos.y = hop.fy + (hop.ty - hop.fy) * k + 4 * hop.h * k * (1 - k);
    it.squash = 0.22 * Math.sin(k * Math.PI);
    if (it.species === 'bunny') it.anim = -0.7 * Math.sin(k * Math.PI);
    if (k >= 1) {
      it.pos.set(hop.tx, hop.ty, hop.tz);
      it.hopping = false;
      it.squash = -0.28;
      it.hops++;
      it.restT = it.species === 'frog' ? 0.3 + this.app.rng.float() * 0.4 : 0.12 + this.app.rng.float() * 0.2;
      if (dHead < 7 && time - this.lastThud > 0.1) {
        this.lastThud = time;
        Snd.thud(this.app.audio, it.pos, it.species === 'frog' ? 0.8 : 1.1);
      }
    }
  }

  /** a hop toward (gx, gz) if the landing spot is fine, else a sidestep; returns whether a hop started */
  _hopToward(it, gx, gz, maxLen, dur, h) {
    const rng = this.app.rng;
    const tx = gx - it.pos.x;
    const tz = gz - it.pos.z;
    const td = Math.hypot(tx, tz);
    if (td < 1e-3) return false;
    const len = Math.min(td, maxLen);
    let hx = it.pos.x + (tx / td) * len;
    let hz = it.pos.z + (tz / td) * len;
    if (!this._hopOk(hx, hz)) {
      const a = Math.atan2(tx, tz) + (rng.chance(0.5) ? 1 : -1) * 1.05;
      hx = it.pos.x + Math.sin(a) * len * 0.6;
      hz = it.pos.z + Math.cos(a) * len * 0.6;
      if (!this._hopOk(hx, hz)) return false;
    }
    this._hopTo(it, hx, hz, dur, h);
    return true;
  }

  /** push a goal away from the other grounded critters so followers keep a loose formation */
  _separate(it, gx, gz, out) {
    let x = gx;
    let z = gz;
    for (const o of this.items) {
      if (o === it || !o.awake || o.mode !== 'ground') continue;
      const ox = x - o.pos.x;
      const oz = z - o.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 0.9 && od > 1e-3) {
        x += (ox / od) * (0.9 - od);
        z += (oz / od) * (0.9 - od);
      }
    }
    out.x = x;
    out.z = z;
    return out;
  }

  _startle(it) {
    it.startle = 0;
    if (it.hopping) return;
    const rng = this.app.rng;
    const a = rng.float() * Math.PI * 2;
    it.atBank = false;
    it.restT = 0;
    if (this._hopOk(it.pos.x + Math.sin(a) * 0.45, it.pos.z + Math.cos(a) * 0.45)) this._hopTo(it, it.pos.x + Math.sin(a) * 0.45, it.pos.z + Math.cos(a) * 0.45, 0.4, 0.3);
    else it.squash = 0.5;
    _v.set(it.pos.x, it.pos.y + 0.12, it.pos.z);
    if (it.species === 'frog') Snd.ribbit(this.app.audio, _v, rng.int(0, 4));
    else Snd.squeak(this.app.audio, _v, 1.2);
  }

  _bunny(it, dt, time, dHead) {
    const rng = this.app.rng;
    if (it.hopping) {
      this._updateHop(it, dt, time, dHead);
      return;
    }
    it.restT -= dt;
    if (it.startle > 0 && it.restT <= 0) {
      this._startle(it);
      return;
    }
    if (dHead > 1.9) {
      // follow: aim for a spot 1.2 m from you along your bearing, fast when far (teleports)
      if (it.restT <= 0) {
        let dx = it.pos.x - _head.x;
        let dz = it.pos.z - _head.z;
        let d = Math.hypot(dx, dz);
        if (d < 0.05) {
          dx = 0;
          dz = 1;
          d = 1;
        }
        this._separate(it, _head.x + (dx / d) * 1.2, _head.z + (dz / d) * 1.2, _v2);
        const len = clamp(0.35 + dHead * 0.22, 0.5, 1.6);
        if (!this._hopToward(it, _v2.x, _v2.z, len, 0.3 + len * 0.06, 0.1 + len * 0.1)) it.restT = 0.6;
      }
      it.pitch = damp(it.pitch, 0, 6, dt);
      it.anim = damp(it.anim, -0.1, 8, dt);
    } else {
      // sit and look up at you
      it.yawT = Math.atan2(_head.x - it.pos.x, _head.z - it.pos.z);
      const up = dHead < 1.5 ? clamp(Math.atan2(_head.y - (it.pos.y + 0.25), Math.max(0.3, dHead)) * 0.55, 0, 0.6) : 0;
      it.pitch = damp(it.pitch, up, 5, dt);
      it.anim = damp(it.anim, (dHead < 1.5 ? 0.12 : -0.05) + Math.sin(time * 1.7 + it.phase) * 0.05, 6, dt);
      it.idleT -= dt;
      if (it.idleT <= 0) {
        it.idleT = 3 + rng.float() * 4;
        if (rng.chance(0.5)) it.wiggleT = 0.5;
        else it.squash = 0.3;
      }
      // personal space
      if (it.restT <= 0) {
        for (const o of this.items) {
          if (o === it || !o.awake || o.mode !== 'ground') continue;
          const ox = it.pos.x - o.pos.x;
          const oz = it.pos.z - o.pos.z;
          const od = Math.hypot(ox, oz);
          if (od < 0.55 && od > 1e-3) {
            this._hopToward(it, it.pos.x + (ox / od) * 0.5, it.pos.z + (oz / od) * 0.5, 0.5, 0.32, 0.12);
            break;
          }
        }
      }
    }
    if (it.wiggleT > 0) it.anim += Math.sin(time * 30) * 0.35 * it.wiggleT;
  }

  _frog(it, dt, time, dHead) {
    const rng = this.app.rng;
    const pond = WORLD.pond;
    it.pitch = damp(it.pitch, 0, 6, dt);
    it.anim = 0;
    if (it.hopping) {
      this._updateHop(it, dt, time, dHead);
      return;
    }
    it.restT -= dt;
    if (it.startle > 0 && it.restT <= 0) {
      this._startle(it);
      return;
    }
    if (!it.atBank) {
      // the nearest dry spot on the bank, on this frog's side of the pond
      const a = Math.atan2(it.pos.z - pond.z, it.pos.x - pond.x);
      let bx = pond.x + Math.cos(a) * pond.radius * 1.1;
      let bz = pond.z + Math.sin(a) * pond.radius * 1.1;
      if (!this._hopOk(bx, bz)) {
        bx = pond.x + Math.cos(a + 0.25) * pond.radius * 1.2;
        bz = pond.z + Math.sin(a + 0.25) * pond.radius * 1.2;
      }
      const d = Math.hypot(bx - it.pos.x, bz - it.pos.z);
      if (d < 0.3) {
        it.atBank = true;
        it.restT = 0.8;
        it.idleT = 4 + rng.float() * 6;
        it.yawT = Math.atan2(pond.x - it.pos.x, pond.z - it.pos.z);
      } else if (it.restT <= 0 && !this._hopToward(it, bx, bz, 0.8, 0.42, 0.22)) it.restT = 0.8;
    } else {
      if (dHead < 3.5) it.yawT = Math.atan2(_head.x - it.pos.x, _head.z - it.pos.z);
      it.idleT -= dt;
      if (it.idleT <= 0 && it.restT <= 0) {
        it.idleT = 7 + rng.float() * 8;
        const a = Math.atan2(it.pos.z - pond.z, it.pos.x - pond.x) + (rng.chance(0.5) ? 1 : -1) * 0.12;
        const hx = pond.x + Math.cos(a) * pond.radius * 1.1;
        const hz = pond.z + Math.sin(a) * pond.radius * 1.1;
        if (this._hopOk(hx, hz)) this._hopTo(it, hx, hz, 0.4, 0.18);
      }
    }
  }

  // ---- birds

  _pickTree() {
    const app = this.app;
    const trees = app.world.flora.trees;
    const pm = app.world.paintMap;
    let best = -1;
    let bd = 28;
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const d = Math.hypot(t.x - _head.x, t.z - _head.z);
      if (d < bd && pm.coverageAt(t.x, t.z) > 0.3) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  _setPerch(it, ti) {
    const t = this.app.world.flora.trees[ti];
    let ux = _head.x - t.x;
    let uz = _head.z - t.z;
    const d = Math.hypot(ux, uz) || 1;
    ux /= d;
    uz /= d;
    it.tree = ti;
    it.perch.set(t.x + ux * t.r * 0.45, t.canopyY + t.r * 0.5, t.z + uz * t.r * 0.45);
  }

  /** a resting spot on the ground ~1.4 m from you (no painted tree to sit in yet) */
  _groundGoal(it) {
    let dx = it.pos.x - _head.x;
    let dz = it.pos.z - _head.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.05) {
      dx = 0;
      dz = 1;
      d = 1;
    }
    this._separate(it, _head.x + (dx / d) * 1.4, _head.z + (dz / d) * 1.4, _v2);
    if (!this._hopOk(_v2.x, _v2.z)) _v2.set(_head.x - (dx / d) * 1.4, 0, _head.z - (dz / d) * 1.4);
    it.perch.set(_v2.x, this.app.world.heightAt(_v2.x, _v2.z) + 0.01, _v2.z);
    it.tree = -1;
  }

  _steer(it, target, dt, time, maxSpeed, agility) {
    _v2.subVectors(target, it.pos);
    const d = _v2.length();
    if (d > 1e-4) _v2.multiplyScalar(Math.min(maxSpeed, 0.4 + d * 2.5) / d);
    it.vel.lerp(_v2, 1 - Math.exp(-dt * agility));
    it.pos.addScaledVector(it.vel, dt);
    it.pos.y += Math.sin(time * 15 + it.phase) * 0.003;
    const gy = this.app.world.heightAt(it.pos.x, it.pos.z) + 0.1;
    if (it.pos.y < gy) it.pos.y = gy;
    const hs = Math.hypot(it.vel.x, it.vel.z);
    if (hs > 0.15) it.yawT = Math.atan2(it.vel.x, it.vel.z);
    it.pitch = damp(it.pitch, clamp(Math.atan2(it.vel.y, Math.max(0.2, hs)) * 0.6, -0.7, 0.7), 5, dt);
    it.roll = damp(it.roll, clamp(-wrapAngle(it.yawT - it.yaw) * 0.5, -0.5, 0.5), 4, dt);
    return d;
  }

  _bird(it, dt, time, dHead, poll) {
    const app = this.app;
    const rng = app.rng;
    it.modeT += dt;
    let flying = true;
    if (it.mode === 'circle') {
      // a lap around you at chest height, below your eyes
      it.circleA += dt * 1.6;
      _v.set(_head.x + Math.cos(it.circleA) * 1.3, _head.y - 0.45, _head.z + Math.sin(it.circleA) * 1.3);
      const gy = app.world.heightAt(_v.x, _v.z) + 0.35;
      if (_v.y < gy) _v.y = gy;
      this._steer(it, _v, dt, time, 3.6, 5);
      if (it.modeT > 6.5) {
        const ti = this._pickTree();
        if (ti >= 0) {
          this._setPerch(it, ti);
          it.mode = 'fly';
        } else {
          this._groundGoal(it);
          it.mode = 'land';
        }
        it.modeT = 0;
      }
    } else if (it.mode === 'fly') {
      if (this._steer(it, it.perch, dt, time, 4, 4) < 0.2) {
        it.mode = 'perch';
        it.modeT = 0;
        it.stay = 14 + rng.float() * 12;
        it.vel.set(0, 0, 0);
        it.pos.copy(it.perch);
      }
    } else if (it.mode === 'land') {
      if (this._steer(it, it.perch, dt, time, 3, 4) < 0.15 && it.modeT > 0.4) {
        it.mode = 'ground';
        it.modeT = 0;
        it.vel.set(0, 0, 0);
        it.pos.copy(it.perch);
        it.pitch = 0;
        it.roll = 0;
      }
    } else if (it.mode === 'perch') {
      flying = false;
      it.yawT = Math.atan2(_head.x - it.pos.x, _head.z - it.pos.z);
      it.pitch = damp(it.pitch, 0, 5, dt);
      it.roll = damp(it.roll, 0, 5, dt);
      it.idleT -= dt;
      if (it.idleT <= 0) {
        it.idleT = 2.5 + rng.float() * 4;
        it.squash = 0.25;
      }
      const t = it.tree >= 0 ? app.world.flora.trees[it.tree] : null;
      const treeFar = !t || Math.hypot(t.x - _head.x, t.z - _head.z) > 22;
      if (it.modeT > it.stay || (treeFar && it.modeT > 3)) {
        it.mode = 'circle';
        it.modeT = 0;
        it.circleA = Math.atan2(it.pos.z - _head.z, it.pos.x - _head.x);
        if (dHead < 14) Snd.flutter(app.audio, it.pos);
      }
    } else {
      // resting on the ground near you until a painted tree shows up
      flying = false;
      it.yawT = Math.atan2(_head.x - it.pos.x, _head.z - it.pos.z);
      const up = dHead < 1.5 ? clamp(Math.atan2(_head.y - (it.pos.y + 0.15), Math.max(0.3, dHead)) * 0.55, 0, 0.6) : 0;
      it.pitch = damp(it.pitch, up, 5, dt);
      it.roll = damp(it.roll, 0, 5, dt);
      it.idleT -= dt;
      if (it.idleT <= 0) {
        it.idleT = 2 + rng.float() * 3;
        it.squash = 0.3;
      }
      it.treeT -= dt;
      if (dHead > 2.4 && it.modeT > 0.5) {
        this._groundGoal(it);
        it.mode = 'land';
        it.modeT = 0;
        if (dHead < 14) Snd.flutter(app.audio, it.pos);
      } else if (poll && it.treeT <= 0) {
        it.treeT = 3;
        const ti = this._pickTree();
        if (ti >= 0) {
          this._setPerch(it, ti);
          it.mode = 'fly';
          it.modeT = 0;
          if (dHead < 14) Snd.flutter(app.audio, it.pos);
        }
      }
    }
    const flap = flying ? 0.25 + Math.sin(time * 15 + it.phase) * 0.7 : -0.35;
    it.anim = damp(it.anim, flap, flying ? 30 : 6, dt);
    if (it.wiggleT > 0) it.anim += Math.sin(time * 28) * 0.4 * it.wiggleT;
  }
}
