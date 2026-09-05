import * as THREE from 'three';

/**
 * Instanced butterflies that arrive once a quarter of the island is
 * painted. They flutter between bloomed flowers (and sometimes circle you),
 * wings flapping in the vertex shader, coloured like the paint nearby.
 */
const vert = /* glsl */ `
attribute float side;
attribute vec2 flap; // phase, speed
uniform float time;
varying vec2 vUv;
varying vec3 vColor;
varying float vSide;
void main() {
  float a = sin(time * flap.y + flap.x) * 0.95 + 0.25;
  vec3 pos = position;
  float ca = cos(a);
  float sa = sin(a);
  // rotate each wing up around the body (Z) axis
  pos.y = abs(position.x) * sa;
  pos.x = position.x * ca;
  vec4 wp = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  vUv = uv;
  vSide = side;
  vColor = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const frag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vSide;
void main() {
  // vUv.x: 0 at body, 1 at wing tip; vUv.y: 0..1 chord
  float edge = smoothstep(0.0, 0.12, 1.0 - vUv.x) * smoothstep(0.0, 0.18, vUv.y) * smoothstep(0.0, 0.18, 1.0 - vUv.y);
  vec3 dark = vec3(0.16, 0.1, 0.22);
  vec3 col = mix(dark, vColor, edge);
  float spot = smoothstep(0.16, 0.08, length(vUv - vec2(0.62, 0.5)));
  col = mix(col, vec3(1.0), spot * 0.85);
  float spot2 = smoothstep(0.09, 0.03, length(vUv - vec2(0.35, 0.3)));
  col = mix(col, dark, spot2 * 0.8);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function wingGeometry() {
  // one wing outline in the +x half, mirrored for the other wing
  const outline = [
    [0, 0.35], [0.25, 0.75], [0.7, 0.95], [1.0, 0.7], [0.95, 0.35], [1.0, 0.05], [0.7, -0.45], [0.3, -0.5], [0.05, -0.25],
  ];
  const positions = [];
  const uvs = [];
  const sides = [];
  const indices = [];
  let base = 0;
  for (const s of [-1, 1]) {
    // fan from the body point
    positions.push(0, 0, 0);
    uvs.push(0, 0.5);
    sides.push(s);
    for (const [x, z] of outline) {
      positions.push(s * x * 0.05, 0, -z * 0.05);
      uvs.push(x, (z + 0.5) / 1.45);
      sides.push(s);
    }
    for (let i = 1; i < outline.length; i++) {
      if (s > 0) indices.push(base, base + i, base + i + 1);
      else indices.push(base, base + i + 1, base + i);
    }
    base += outline.length + 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('side', new THREE.Float32BufferAttribute(sides, 1));
  geo.setIndex(indices);
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _head = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector3();

export class Butterflies {
  constructor(app, capacity = 40) {
    this.app = app;
    this.capacity = capacity;
    const geo = wingGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
    for (let i = 0; i < capacity; i++) this.flap.setXY(i, Math.random() * 6.28, 14 + Math.random() * 8);
    geo.setAttribute('flap', this.flap);
    const mat = new THREE.ShaderMaterial({ uniforms: { time: app.world.uniforms.time }, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'butterflies';
    this.items = [];
    this.enabled = false;
    this.full = false; // the big swarm (25% milestone); before that just a few early visitors
    this.spawnT = 0;
    this.targetCount = 0;
    this.still = { left: 0, right: 0 }; // how long each wand has been held still
    this.catches = 0;
    // a few butterflies come early: the first creature you wake brings them
    app.events.on('critterwake', () => this.enable(false));
  }

  enable(full = true) {
    this.enabled = true;
    if (full) this.full = true;
  }

  reset() {
    this.enabled = false;
    this.full = false;
    this.items.length = 0;
    this.mesh.count = 0;
  }

  /** a butterfly is touched by a wand: a puff of its colour, colour on the ground, and it flutters off elsewhere */
  _catch(it, hand) {
    const app = this.app;
    if (app.fx) app.fx.burst(it.pos, it.color, 14, 0.8, 0.03);
    app.world.paintMap.stamp(it.pos.x, it.pos.z, 1.0, it.color, 0.7, 0.8);
    if (app.audio) app.audio.pop(0.05, it.pos);
    if (hand) hand.pulse(0.4, 30);
    this.catches++;
    app.events.emit('butterflycatch', { position: it.pos.clone(), color: it.color.clone() });
    // reappear somewhere on a flower
    const flowers = Array.from(app.world.flora.bloomedFlowers(40));
    const f = flowers.length ? flowers[app.rng.int(0, flowers.length - 1)] : [it.pos.x + app.rng.gauss() * 3, it.pos.z + app.rng.gauss() * 3];
    it.pos.set(f[0], app.world.heightAt(f[0], f[1]) + 0.3, f[1]);
    it.vel.set(0, 0, 0);
    it.perch = null;
    this._pickTarget(it);
  }

  _stillHand() {
    const h = this.app.hands;
    for (const key of ['right', 'left']) {
      const hand = h[key];
      if (!hand.connected || !hand.hasTip || hand.triggerDown || this.still[key] < 1.0) continue;
      if (this.items.some((it) => it.perch === hand)) continue;
      return hand;
    }
    return null;
  }

  _pickTarget(item) {
    const app = this.app;
    const rng = app.rng;
    const flowers = Array.from(app.world.flora.bloomedFlowers(80));
    // hold your wand still and one may come and land on it
    const still = rng.chance(0.3) ? this._stillHand() : null;
    if (still) {
      item.target.copy(still.tip);
      item.perchWanted = still;
      item.rest = 0;
      item.color.lerp(app.paint.color, 0.3);
      return;
    }
    item.perchWanted = null;
    if (rng.chance(0.18) || flowers.length === 0) {
      app.headPosition(_head);
      const a = rng.float() * Math.PI * 2;
      item.target.set(_head.x + Math.cos(a) * 0.9, _head.y - 0.2 + rng.float() * 0.5, _head.z + Math.sin(a) * 0.9);
      item.rest = 0;
    } else {
      const f = flowers[rng.int(0, flowers.length - 1)];
      item.target.set(f[0], app.world.heightAt(f[0], f[1]) + 0.25 + rng.float() * 0.5, f[1]);
      item.rest = 1.5 + rng.float() * 3;
    }
    app.world.paintMap.colorAt(item.target.x, item.target.z, _c);
    if (_c.r + _c.g + _c.b < 0.2) _c.copy(app.paint.palette[rng.int(0, 11)]);
    item.color.lerp(_c, 0.6);
  }

  update(dt, time) {
    const app = this.app;
    // a few come on their own once some colour is out there (in case no creature was woken)
    if (!this.enabled && app.world.progress > 0.08 && (!app.intro || app.intro.done)) this.enable(false);
    if (!this.enabled) return;
    const rng = app.rng;
    for (const key of ['left', 'right']) {
      const hand = app.hands[key];
      const stillNow = hand.connected && hand.hasTip && hand.tipVel.length() < 0.15 && !hand.triggerDown;
      this.still[key] = stillNow ? this.still[key] + dt : 0;
    }
    this.targetCount = Math.min(this.capacity, Math.floor(this.full ? 8 + app.world.progress * 34 : 3 + app.world.progress * 12));
    this.spawnT -= dt;
    if (this.items.length < this.targetCount && this.spawnT <= 0) {
      this.spawnT = 0.6;
      const flowers = Array.from(app.world.flora.bloomedFlowers(60));
      const f = flowers.length ? flowers[rng.int(0, flowers.length - 1)] : [0, 0];
      const item = {
        pos: new THREE.Vector3(f[0], app.world.heightAt(f[0], f[1]) + 0.3, f[1]),
        vel: new THREE.Vector3(),
        target: new THREE.Vector3(),
        color: app.paint.palette[rng.int(0, 11)].clone(),
        rest: 0,
        phase: rng.float() * 6.28,
        yaw: 0,
        perch: null,
        perchWanted: null,
      };
      this._pickTarget(item);
      this.items.push(item);
    }
    let n = 0;
    const L = app.hands.left;
    const R = app.hands.right;
    for (const it of this.items) {
      // perched on a wand: ride the tip, drink its colour, leave when the hand moves
      if (it.perch) {
        const h = it.perch;
        if (!h.connected || !h.hasTip || h.triggerDown || h.tipVel.length() > 0.6) {
          it.perch = null;
          it.vel.set(rng.gauss() * 0.3, 0.6, rng.gauss() * 0.3);
          if (app.fx) app.fx.burst(it.pos, it.color, 5, 0.3, 0.02);
          this._pickTarget(it);
        } else {
          it.pos.copy(h.tip);
          it.pos.y += 0.012;
          it.color.lerp(app.paint.color, 1 - Math.exp(-dt * 0.4));
          it.yaw += (Math.sin(time * 0.7 + it.phase) * 0.4 - it.yaw) * 0.02;
          _q.setFromAxisAngle(_up, it.yaw);
          _m.compose(it.pos, _q, _s);
          this.mesh.setMatrixAt(n, _m);
          this.mesh.setColorAt(n, it.color);
          n++;
          continue;
        }
      }
      // touched by a wand? poof!
      let caught = false;
      for (const hand of [L, R]) {
        if (!hand.connected || !hand.hasTip) continue;
        if (it.perchWanted === hand) continue;
        if (hand.tip.distanceTo(it.pos) < 0.09 && hand.tipVel.length() > 0.25) {
          this._catch(it, hand);
          caught = true;
          break;
        }
      }
      if (caught) continue;
      if (it.perchWanted) {
        const h = it.perchWanted;
        if (!h.connected || !h.hasTip || h.triggerDown || h.tipVel.length() > 0.5) {
          it.perchWanted = null;
          this._pickTarget(it);
        } else {
          it.target.copy(h.tip);
          it.target.y += 0.02;
        }
      }
      _dir.subVectors(it.target, it.pos);
      const d = _dir.length();
      if (it.perchWanted && d < 0.05) {
        it.perch = it.perchWanted;
        it.perchWanted = null;
        it.vel.set(0, 0, 0);
        it.perch.tick(0.12, 60);
        if (app.fx) app.fx.burst(it.pos, it.color, 6, 0.25, 0.018);
        app.events.emit('butterflyperch', { hand: it.perch });
      } else if (d < (it.perchWanted ? 0.05 : 0.25)) {
        it.rest -= dt;
        if (it.rest <= 0) this._pickTarget(it);
        it.vel.multiplyScalar(1 - 2 * dt);
      } else {
        _dir.divideScalar(d);
        it.vel.addScaledVector(_dir, 2.2 * dt);
        it.vel.x += Math.sin(time * 3 + it.phase) * 0.6 * dt;
        it.vel.z += Math.cos(time * 2.6 + it.phase) * 0.6 * dt;
        it.vel.y += Math.sin(time * 7 + it.phase) * 0.9 * dt;
        const sp = it.vel.length();
        const max = it.perchWanted && d < 0.5 ? 0.35 : 1.1;
        if (sp > max) it.vel.multiplyScalar(max / sp);
      }
      it.pos.addScaledVector(it.vel, dt);
      const gy = app.world.heightAt(it.pos.x, it.pos.z) + 0.15;
      if (it.pos.y < gy) it.pos.y = gy;
      if (it.vel.lengthSq() > 0.01) {
        const targetYaw = Math.atan2(it.vel.x, it.vel.z);
        let dy = targetYaw - it.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        it.yaw += dy * (1 - Math.exp(-dt * 5));
      }
      _q.setFromAxisAngle(_up, it.yaw);
      _m.compose(it.pos, _q, _s);
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, it.color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
