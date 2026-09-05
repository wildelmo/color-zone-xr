import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { dropGeometry } from './Buddy.js';
import { PropMaterial } from '../util/PropMaterial.js';
import { damp, clamp, easeOutElastic } from '../util/math.js';
import { wheee, giggle, popIn, whoop, boing } from '../audio/RiderSounds.js';

/**
 * Riders — Dot's tiny cousins ride your strokes like a roller coaster.
 *
 * Every long tube stroke you finish becomes a RAIL (a CPU copy of its
 * centreline with cumulative arc lengths). A rider pops onto the rail's
 * higher end with a sparkle, rolls along it — faster on the downhills
 * (with a little "wheee"), leaning into the bends, never falling off — and
 * flies off the end as a paint ball that splats colour where it lands.
 * Rails that continue where another ends are chained, so a room-scale
 * swoop that the brush split into pieces is ridden as one. Poke a rider
 * with the wand and it giggles and hops.
 *
 * Rendering: one InstancedMesh of drop bodies (per-instance colour) and
 * one of dark faces (eyes + smile) → at most 2 draw calls per eye, zero
 * while nobody is riding. No per-frame allocations.
 */
const MIN_RAIL_LENGTH = 1.5; // metres of stroke before it counts as a rail
const MAX_RAILS = 8; // newest rails kept
const MAX_RIDERS = 10;
const SPAWN_DELAY = 1.0; // s after a rail appears
const RESPAWN_MIN = 2.0;
const RESPAWN_MAX = 4.0;
const SPAWN_GAP = 1.0; // s between spawns across all rails (keeps things calm)
const NEAR_DISTANCE = 12; // rails only run while the player is this close
const TOUCH_RADIUS = 0.12;
const TOUCH_COOLDOWN = 0.6;
const GRAVITY = 6.5;
const DRAG = 0.35;
const MIN_SPEED = 0.7;
const LINK_DISTANCE = 0.15; // a rail starting this close to another's end continues it
const MAX_TRANSFERS = 12; // a closed loop of rails still lets the rider fly off eventually
const K = 0.27; // Dot is 0.3 m tall; riders are ~0.08 m
const EYE_Y = (0.03 + 0.12) * K; // eye height in face-local space (blink pivot)
const HOP_GRAVITY = 12;
const WARM_SECONDS = 3; // draw one hidden instance at startup so the instanced shader compiles early

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _k = new THREE.Vector3(); // curvature vector dT/ds
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _v = new THREE.Vector3();
const _head = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _mf = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);
const _worldUp = new THREE.Vector3(0, 1, 0);

function bodyGeometry() {
  const g = dropGeometry();
  g.translate(0, 0.12, 0); // origin at the bottom: squash & stretch pivot on the rail
  g.scale(K, K, K);
  return g;
}

/** two bead eyes and a smile, merged so all faces are one draw */
function faceGeometry() {
  const parts = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.027, 10, 8);
    eye.scale(1, 1.25, 0.7);
    eye.translate(sx * 0.04, 0.03, 0.102);
    parts.push(eye);
  }
  const mouth = new THREE.TorusGeometry(0.02, 0.006, 5, 10, Math.PI);
  mouth.rotateZ(Math.PI); // arc at the bottom = smile
  mouth.translate(0, -0.028, 0.118);
  parts.push(mouth);
  const g = mergeGeometries(parts, false);
  g.translate(0, 0.12, 0);
  g.scale(K, K, K);
  return g;
}

function makeRider() {
  return {
    rail: null,
    s: 0, // arc length along the rail
    v: 0, // speed along the rail
    i: 0, // current segment (monotonic walk)
    age: 0,
    phase: 0,
    roll: 0,
    hopY: 0,
    hopV: 0,
    squash: 0,
    blinkT: 2,
    blink: 0,
    lastWhee: -10,
    pokeT: -10,
    transfers: 0,
    pos: new THREE.Vector3(), // world position of the body's base (on the rail)
    tan: new THREE.Vector3(), // direction of travel
    up: new THREE.Vector3(0, 1, 0),
    color: new THREE.Color(),
  };
}

export class Riders {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'riders';
    const shared = app.world.uniforms;

    this.bodyMat = new PropMaterial(shared, { color: '#ffffff', emissive: '#141414', rim: 0.45, gloss: 1.3, instanceColor: true });
    this.body = new THREE.InstancedMesh(bodyGeometry(), this.bodyMat, MAX_RIDERS);
    this.body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RIDERS * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    this.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.body.count = 0;
    this.body.frustumCulled = false;
    this.body.name = 'riders';
    this.faceMat = new PropMaterial(shared, { color: '#241b33', rim: 0.0, gloss: 2.0 });
    this.face = new THREE.InstancedMesh(faceGeometry(), this.faceMat, MAX_RIDERS);
    this.face.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.face.count = 0;
    this.face.frustumCulled = false;
    this.face.name = 'rider-faces';
    this.group.add(this.body, this.face);

    this.rails = []; // { id, entry, n, pts, radii, cols, cum, tan, len, bounds, start, end, color, spawnAt, riderCount, spawned, launches, quiet, next }
    this.riders = []; // alive riders (see makeRider)
    this.pool = [];
    for (let i = 0; i < MAX_RIDERS; i++) this.pool.push(makeRider());
    this.launches = 0; // riders that flew off the end
    this.pokes = 0;
    this.spawned = 0;
    this.commented = false; // Dot's once-per-session line
    this.lastSpawnT = -10;
    this.lastWheeT = -10;
    this.warmT = WARM_SECONDS;
    this.railSeq = 0;

    const ev = app.events;
    ev.on('strokeend', (entry) => this._onStrokeEnd(entry));
    ev.on('undo', (entry) => this._onUndo(entry));
    ev.on('clear', () => this.clear());
    ev.on('reset', () => this.clear());
  }

  // ---------------------------------------------------------------- rails

  _onStrokeEnd(entry) {
    if (!entry || entry.kind !== 'tube' || entry.brushId === 'cotton') return;
    const st = entry.stroke;
    if (!st || st.count < 4 || st.length < MIN_RAIL_LENGTH) return;
    const loading = !!(this.app.saveGame && this.app.saveGame.loading);
    this.addRail(entry, loading);
  }

  _onUndo(entry) {
    if (!entry) return;
    const rail = this.rails.find((r) => r.entry === entry);
    if (rail) this._retire(rail, true);
  }

  /** register a finished stroke as a rail; riders travel from its higher end */
  addRail(entry, quiet = false) {
    const st = entry.stroke;
    const n = st.count;
    const src = st.pts;
    const rev = src[(n - 1) * 3 + 1] > src[1] + 0.02;
    const pts = new Float32Array(n * 3);
    const radii = new Float32Array(n);
    const cols = new Float32Array(n * 3);
    const cum = new Float32Array(n);
    const tan = new Float32Array(n * 3);
    const bounds = new THREE.Box3();
    for (let i = 0; i < n; i++) {
      const j = rev ? n - 1 - i : i;
      pts[i * 3] = src[j * 3];
      pts[i * 3 + 1] = src[j * 3 + 1];
      pts[i * 3 + 2] = src[j * 3 + 2];
      radii[i] = st.radii[j];
      cols[i * 3] = st.cols[j * 3];
      cols[i * 3 + 1] = st.cols[j * 3 + 1];
      cols[i * 3 + 2] = st.cols[j * 3 + 2];
      _p.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      bounds.expandByPoint(_p);
      if (i > 0) {
        const dx = pts[i * 3] - pts[i * 3 - 3];
        const dy = pts[i * 3 + 1] - pts[i * 3 - 2];
        const dz = pts[i * 3 + 2] - pts[i * 3 - 1];
        cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
    const len = cum[n - 1];
    if (len < MIN_RAIL_LENGTH) return null;
    // per-point tangents (central differences) so orientation glides instead of stepping
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1) * 3;
      const b = Math.min(n - 1, i + 1) * 3;
      _t.set(pts[b] - pts[a], pts[b + 1] - pts[a + 1], pts[b + 2] - pts[a + 2]);
      if (_t.lengthSq() < 1e-10) _t.set(0, 0, -1);
      _t.normalize();
      tan[i * 3] = _t.x;
      tan[i * 3 + 1] = _t.y;
      tan[i * 3 + 2] = _t.z;
    }
    const now = this.app.time || 0;
    const rail = {
      id: ++this.railSeq,
      entry,
      n,
      pts,
      radii,
      cols,
      cum,
      tan,
      len,
      bounds,
      start: new THREE.Vector3(pts[0], pts[1], pts[2]),
      end: new THREE.Vector3(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], pts[(n - 1) * 3 + 2]),
      color: new THREE.Color(st.cols[0], st.cols[1], st.cols[2]),
      spawnAt: now + SPAWN_DELAY,
      riderCount: 0,
      spawned: 0,
      launches: 0,
      quiet, // restored from a save: no sounds until the intro is over, no Dot comment
      next: null, // a rail that continues where this one ends
    };
    // chain rails that pick up where another leaves off (the brush splits long strokes; kids draw continuations)
    const link2 = LINK_DISTANCE * LINK_DISTANCE;
    for (const o of this.rails) {
      if (!o.next && o.end.distanceToSquared(rail.start) < link2) o.next = rail;
      if (!rail.next && rail.end.distanceToSquared(o.start) < link2) rail.next = o;
    }
    this.rails.push(rail);
    while (this.rails.length > MAX_RAILS) this._retire(this.rails[0], !quiet);
    return rail;
  }

  _retire(rail, sparkle = true) {
    const fx = this.app.fx;
    for (let k = this.riders.length - 1; k >= 0; k--) {
      const r = this.riders[k];
      if (r.rail !== rail) continue;
      if (sparkle && fx) fx.burst(r.pos, r.color, 10, 0.6, 0.02);
      this._release(r, k);
    }
    for (const o of this.rails) if (o.next === rail) o.next = null;
    const i = this.rails.indexOf(rail);
    if (i >= 0) this.rails.splice(i, 1);
  }

  /** drop every rail and rider (painting cleared / new island) */
  clear() {
    const loading = !!(this.app.saveGame && this.app.saveGame.loading);
    while (this.rails.length) this._retire(this.rails[this.rails.length - 1], !loading);
    // riders whose rail was already gone (defensive; should not happen)
    for (let k = this.riders.length - 1; k >= 0; k--) this._release(this.riders[k], k);
    this.body.count = 0;
    this.face.count = 0;
  }

  _release(r, k) {
    r.rail = null;
    this.riders.splice(k, 1);
    this.pool.push(r);
  }

  // --------------------------------------------------------------- riders

  _spawn(rail, time) {
    const app = this.app;
    const r = this.pool.pop();
    if (!r) return null;
    const rng = app.rng;
    r.rail = rail;
    r.s = 0;
    r.v = MIN_SPEED;
    r.i = 0;
    r.age = 0;
    r.phase = rng.float() * Math.PI * 2;
    r.roll = 0;
    r.hopY = 0;
    r.hopV = 0;
    r.squash = 0;
    r.blinkT = 1 + rng.float() * 3;
    r.blink = 0;
    r.lastWhee = time;
    r.pokeT = -10;
    r.transfers = 0;
    r.up.set(0, 1, 0);
    r.tan.set(rail.tan[0], rail.tan[1], rail.tan[2]);
    r.color.setRGB(rail.cols[0], rail.cols[1], rail.cols[2]).lerp(_white, 0.25);
    r.pos.copy(rail.start);
    rail.riderCount++;
    rail.spawned++;
    this.riders.push(r);
    this.spawned++;
    this.lastSpawnT = time;
    const introDone = !app.intro || app.intro.done;
    const quiet = rail.quiet && !introDone;
    _v.copy(rail.start).addScaledVector(_worldUp, 0.05);
    if (app.fx) app.fx.burst(_v, r.color, 14, 0.6, 0.025);
    if (!quiet && this._audible(_v)) popIn(app.audio, _v);
    app.events.emit('ride', { rail, position: r.pos.clone() });
    if (!this.commented && introDone && !rail.quiet && app.buddy) {
      this.commented = true;
      if (app.buddy.say) app.buddy.say("Wheee! It's riding your line!", 2.6);
      if (app.buddy.setMood) app.buddy.setMood('happy', 2.2);
      if (app.buddy.react) app.buddy.react(0.6);
    }
    return r;
  }

  /** walk the rail to the rider's arc length: fills _p (point), _t (tangent), _k (curvature); returns the tube radius */
  _place(r) {
    const rail = r.rail;
    const pts = rail.pts;
    const cum = rail.cum;
    const tan = rail.tan;
    const last = rail.n - 2;
    let i = r.i;
    while (i < last && r.s >= cum[i + 1]) i++;
    r.i = i;
    const seg = cum[i + 1] - cum[i];
    const t = seg > 1e-6 ? clamp((r.s - cum[i]) / seg, 0, 1) : 0;
    const a = i * 3;
    const b = a + 3;
    _p.set(pts[a] + (pts[b] - pts[a]) * t, pts[a + 1] + (pts[b + 1] - pts[a + 1]) * t, pts[a + 2] + (pts[b + 2] - pts[a + 2]) * t);
    _t.set(tan[a] + (tan[b] - tan[a]) * t, tan[a + 1] + (tan[b + 1] - tan[a + 1]) * t, tan[a + 2] + (tan[b + 2] - tan[a + 2]) * t);
    if (_t.lengthSq() < 1e-6) _t.set(tan[a], tan[a + 1], tan[a + 2]);
    _t.normalize();
    const inv = 1 / Math.max(seg, 0.01);
    _k.set((tan[b] - tan[a]) * inv, (tan[b + 1] - tan[a + 1]) * inv, (tan[b + 2] - tan[a + 2]) * inv);
    const cols = rail.cols;
    _c.setRGB(cols[a] + (cols[b] - cols[a]) * t, cols[a + 1] + (cols[b + 1] - cols[a + 1]) * t, cols[a + 2] + (cols[b + 2] - cols[a + 2]) * t);
    return rail.radii[i] + (rail.radii[i + 1] - rail.radii[i]) * t;
  }

  /** the rider reached the end of its rail: hop onto a continuation, or fly! */
  _finish(r, k, time) {
    const app = this.app;
    const rail = r.rail;
    const next = rail.next;
    const respawn = time + RESPAWN_MIN + app.rng.float() * (RESPAWN_MAX - RESPAWN_MIN);
    if (next && next.riderCount === 0 && r.transfers < MAX_TRANSFERS && this.rails.includes(next)) {
      r.s = Math.max(0, r.s - rail.len);
      r.i = 0;
      r.transfers++;
      r.hopV = 1.0;
      r.squash = 0.6;
      rail.riderCount--;
      rail.spawnAt = respawn;
      r.rail = next;
      next.riderCount++;
      if (this._audible(r.pos)) boing(app.audio, r.pos);
      return;
    }
    const n = rail.n;
    const e = (n - 1) * 3;
    _t.set(rail.tan[e], rail.tan[e + 1], rail.tan[e + 2]);
    _up.copy(_worldUp).addScaledVector(_t, -_t.y);
    if (_up.lengthSq() < 0.05) _up.copy(r.up);
    _up.normalize();
    _p.copy(rail.end).addScaledVector(_up, rail.radii[n - 1] + 0.03);
    _v.copy(_t).multiplyScalar(r.v * 1.2);
    _v.y += 1.2;
    if (app.splats && app.splats.launch) app.splats.launch(_p, _v, r.color, { scale: 0.7 });
    if (app.fx) app.fx.burst(_p, r.color, 10, 1.0, 0.03);
    if (this._audible(_p)) whoop(app.audio, _p, r.v);
    this.launches++;
    rail.launches++;
    rail.riderCount--;
    rail.spawnAt = respawn;
    app.events.emit('ridelaunch', { rail, position: _p.clone(), velocity: _v.clone(), color: r.color.clone() });
    this._release(r, k);
  }

  _poke(r, hand, time) {
    const app = this.app;
    r.pokeT = time;
    r.v += 1.4;
    r.hopV = 1.0;
    r.squash = 1.0;
    hand.tick(0.4, 40);
    _v.copy(r.pos).addScaledVector(r.up, 0.04);
    if (app.fx) app.fx.burst(_v, r.color, 8, 0.6, 0.02);
    giggle(app.audio, _v);
    this.pokes++;
    app.events.emit('ridepoke', { rail: r.rail, position: _v.clone() });
  }

  _audible(p) {
    return p.distanceToSquared(_head) < 15 * 15;
  }

  update(dt, time) {
    const app = this.app;
    const rng = app.rng;
    app.headPosition(_head);

    // spawn: one rider per rail, one spawn per second overall, only near the player
    if (this.rails.length && this.riders.length < MAX_RIDERS && time - this.lastSpawnT >= SPAWN_GAP) {
      for (const rail of this.rails) {
        if (rail.riderCount > 0 || time < rail.spawnAt) continue;
        if (rail.bounds.distanceToPoint(_head) > NEAR_DISTANCE) {
          rail.spawnAt = time + 0.5; // dormant until the player comes back
          continue;
        }
        this._spawn(rail, time);
        break;
      }
    }

    const hands = app.hands;
    const fx = app.fx;
    let n = 0;
    for (let k = this.riders.length - 1; k >= 0; k--) {
      const r = this.riders[k];
      const rail = r.rail;
      if (!rail) {
        this._release(r, k);
        continue;
      }
      // roll along: gravity along the slope, drag, and a floor so nobody ever stalls
      const slope = r.tan.y;
      r.v += (-GRAVITY * slope - DRAG * r.v) * dt;
      if (r.v < MIN_SPEED) r.v = MIN_SPEED;
      r.s += r.v * dt;
      if (r.s >= rail.len) {
        this._finish(r, k, time);
        if (!r.rail) continue; // flew off
      }
      const radius = this._place(r);
      r.tan.copy(_t);
      r.color.copy(_c).lerp(_white, 0.25);

      // a stable "up" perpendicular to the rail (eased through vertical bits and loops)
      _up.copy(_worldUp).addScaledVector(_t, -_t.y);
      if (_up.lengthSq() < 0.05) _up.copy(r.up).addScaledVector(_t, -r.up.dot(_t));
      if (_up.lengthSq() < 1e-4) _up.copy(_axisX).addScaledVector(_t, -_t.x);
      _up.normalize();
      r.up.lerp(_up, 1 - Math.exp(-dt * 14)).addScaledVector(_t, -r.up.dot(_t));
      if (r.up.lengthSq() < 1e-6) r.up.copy(_up); // flipped straight through a loop: snap instead of NaN
      r.up.normalize();
      _right.crossVectors(r.up, _t);

      // lean into the bend: lateral acceleration v²κ against gravity
      const lateral = _k.dot(_right);
      const rollTarget = clamp(-Math.atan2(r.v * r.v * lateral, 9.8), -0.75, 0.75);
      r.roll = damp(r.roll, rollTarget, 9, dt);

      // wheee on the downhills (pitched by speed, one per second per rider)
      if (slope < -0.3 && r.v > 1.2 && time - r.lastWhee > 1.0 && time - this.lastWheeT > 0.3 && this._audible(_p)) {
        r.lastWhee = time;
        this.lastWheeT = time;
        wheee(app.audio, _p, r.v);
      }

      // hops (poke, hopping onto the next rail) and a little bob when going fast
      const speedT = clamp((r.v - MIN_SPEED) / 3.5, 0, 1);
      if (r.hopY > 0 || r.hopV > 0) {
        r.hopV -= HOP_GRAVITY * dt;
        r.hopY += r.hopV * dt;
        if (r.hopY <= 0) {
          r.hopY = 0;
          r.hopV = 0;
        }
      }
      const bob = 0.004 * (0.5 + 0.5 * Math.sin(time * 13 + r.phase)) * speedT;
      r.pos.copy(_p).addScaledVector(r.up, radius + r.hopY + bob);
      r.age += dt;
      r.squash = damp(r.squash, 0, 5, dt);
      r.blinkT -= dt;
      if (r.blinkT <= 0) {
        r.blink = 1;
        r.blinkT = 1.8 + rng.float() * 3.5;
      }
      r.blink = Math.max(0, r.blink - dt * 9);

      // sparkles stream off a fast rider
      if (fx && r.v > 1.6 && rng.chance(0.35)) {
        _v.copy(_t).multiplyScalar(-0.3).addScaledVector(r.up, 0.15);
        fx.sparkle(r.pos, _v, r.color, 0.35, 0.014);
      }

      // poked by a wand tip?
      _v.copy(r.pos).addScaledVector(r.up, 0.04); // body centre
      if (time - r.pokeT > TOUCH_COOLDOWN) {
        for (const hand of [hands.left, hands.right]) {
          if (!hand.connected || !hand.hasTip) continue;
          if (hand.tip.distanceToSquared(_v) < TOUCH_RADIUS * TOUCH_RADIUS) {
            this._poke(r, hand, time);
            break;
          }
        }
      }

      // pose: face along the rail, banked into bends, leaning back a touch at speed
      _m.makeBasis(_right, r.up, _t);
      _q.setFromRotationMatrix(_m);
      _q2.setFromAxisAngle(_axisZ, r.roll + Math.sin(time * 9 + r.phase) * 0.04 * speedT);
      _q.multiply(_q2);
      _q2.setFromAxisAngle(_axisX, -0.12 * speedT);
      _q.multiply(_q2);
      const pop = Math.max(0.02, easeOutElastic(Math.min(1, r.age / 0.55)));
      const sy = (1 + 0.15 * speedT) * (1 + r.squash * 0.35 * Math.sin(time * 18));
      const sxz = 1 / Math.sqrt(sy);
      _s.set(sxz * pop, sy * pop, sxz * pop);
      _m.compose(r.pos, _q, _s);
      this.body.setMatrixAt(n, _m);
      this.body.setColorAt(n, r.color);
      // face: same pose, eyes squeezed shut about their own height when blinking
      const b = r.blink > 0.5 ? 0.12 : 1;
      _m2.makeScale(1, b, 1);
      _m2.setPosition(0, EYE_Y * (1 - b), 0);
      _mf.multiplyMatrices(_m, _m2);
      this.face.setMatrixAt(n, _mf);
      n++;
    }
    if (n === 0 && this.warmT > 0) {
      // compile the instanced shader during the loading frames, not on the first ride
      this.warmT -= dt;
      _m.makeScale(0.001, 0.001, 0.001).setPosition(0, -80, 0);
      this.body.setMatrixAt(0, _m);
      this.face.setMatrixAt(0, _m);
      n = 1;
    }
    this.body.count = n;
    this.face.count = n;
    if (n > 0) {
      this.body.instanceMatrix.needsUpdate = true;
      this.body.instanceColor.needsUpdate = true;
      this.face.instanceMatrix.needsUpdate = true;
    }
  }
}
