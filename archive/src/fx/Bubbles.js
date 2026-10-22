import * as THREE from 'three';

/**
 * Soap bubbles: blooming ground along the colour front near you blows them
 * (so there are always some within reach), the fountain adds more once it
 * has been fed, and the Bubble brush makes them by hand. They drift toward
 * you and pop with confetti, a chime and a splash of colour on the ground
 * below when you touch them with a wand.
 */
const vert = /* glsl */ `
attribute float wobble;
uniform float time;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying float vW;
void main() {
  vec3 pos = position;
  float w = wobble;
  pos *= 1.0 + 0.06 * sin(time * 5.0 + w * 10.0 + position.y * 4.0) * (w > 0.0 ? 1.0 : 0.0);
  pos.y *= 1.0 + 0.05 * sin(time * 3.7 + w * 7.0);
  vec4 wp = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vColor = instanceColor;
  vW = w;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const frag = /* glsl */ `
uniform float time;
uniform vec3 sunDir;
varying vec3 vN;
varying vec3 vV;
varying vec3 vColor;
varying float vW;
vec3 rainbow(float t) {
  return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)));
}
void main() {
  vec3 N = normalize(vN);
  bool back = !gl_FrontFacing;
  if (back) N = -N;
  vec3 V = normalize(vV);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 2.5);
  vec3 irid = rainbow(ndv * 1.6 + time * 0.08 + vW);
  vec3 col = mix(vColor, irid, 0.55) * (0.6 + 0.6 * fres) + vec3(0.25);
  float spec = pow(max(dot(reflect(-sunDir, N), V), 0.0), 80.0);
  col += vec3(1.0) * spec * 1.2;
  float a = 0.12 + 0.55 * fres + spec * 0.6;
  if (back) a *= 0.5;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _head = new THREE.Vector3();
const _c = new THREE.Color();

export class Bubbles {
  constructor(app, capacity = 40) {
    this.app = app;
    this.capacity = capacity;
    this.pos = [];
    this.vel = [];
    this.radius = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.colors = [];
    for (let i = 0; i < capacity; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.colors.push(new THREE.Color());
    }
    const geo = new THREE.SphereGeometry(1, 20, 14);
    this.wobble = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('wobble', this.wobble);
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: app.world.uniforms.time, sunDir: app.world.uniforms.sunDir },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 15;
    this.mesh.name = 'bubbles';
    this.spawnTimer = 1.5;
    this.aliveCount = 0;
    this.popCount = 0;
    this.spawnCount = 0; // every bubble ever blown
    this.ambientCount = 0; // bubbles blown by the ground near the player
    this.lastAmbient = new THREE.Vector3(); // where the newest ambient bubble rose
  }

  /** blow a bubble at p; life in seconds (default 14–24 s) */
  spawn(p, color, radius = 0.1, vel = null, life = null) {
    let i = -1;
    let oldest = -1;
    let oldestAge = -1;
    for (let k = 0; k < this.capacity; k++) {
      if (!this.alive[k]) {
        i = k;
        break;
      }
      if (this.age[k] > oldestAge) {
        oldestAge = this.age[k];
        oldest = k;
      }
    }
    if (i < 0) {
      i = oldest;
      this.alive[i] = 0;
    }
    this.alive[i] = 1;
    this.spawnCount++;
    this.pos[i].copy(p);
    this.vel[i].set(0, 0.12, 0);
    if (vel) this.vel[i].addScaledVector(vel, 0.25);
    this.radius[i] = radius;
    this.age[i] = 0;
    this.life[i] = life !== null ? life : 14 + this.app.rng.float() * 10;
    this.colors[i].copy(color);
    this.wobble.array[i] = this.app.rng.float() * 3;
    this.wobble.needsUpdate = true;
    return i;
  }

  pop(i, hand = null, quiet = false) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    const p = this.pos[i];
    const r = this.radius[i];
    const c = this.colors[i];
    const app = this.app;
    this.popCount++;
    if (app.fx) {
      app.fx.burst(p, c, Math.round(14 + r * 120), 0.9 + r * 4, 0.02 + r * 0.15);
      app.fx.confetti(p, Math.round(6 + r * 60), null, 1.2 + r * 3);
      for (let k = 0; k < 4; k++) {
        _p.copy(p);
        _p.x += app.rng.gauss() * r;
        _p.z += app.rng.gauss() * r;
        app.fx.drip(_p, c, 0.8 + r * 3);
      }
    }
    app.world.paintMap.stamp(p.x, p.z, 1.2 + r * 6, c, 0.7, 0.8);
    if (app.audio && !quiet) app.audio.pop(r, p);
    if (hand) hand.pulse(0.7, 50);
    app.events.emit('bubblepop', { position: p.clone(), color: c.clone(), radius: r, byHand: !!hand });
  }

  popAll() {
    for (let i = 0; i < this.capacity; i++) if (this.alive[i]) this.pop(i, null, true);
  }

  /**
   * A spot within 6 m of the head where colour is blooming, or null. Samples the
   * disc around the player directly (a global randomFrontCell almost never lands
   * near a fresh player) and prefers the colour front (coverage 0.12–0.55) over
   * fully painted ground, so bubbles rise where the flowers are popping up.
   */
  _frontNearHead(head, out, colorOut) {
    const world = this.app.world;
    const pm = world.paintMap;
    const terrain = world.terrain;
    const rng = this.app.rng;
    let bestX = 0;
    let bestZ = 0;
    let bestScore = 0;
    for (let k = 0; k < 8; k++) {
      const a = rng.float() * Math.PI * 2;
      const d = 1.5 + Math.sqrt(rng.float()) * 4.5;
      const x = head.x + Math.cos(a) * d;
      const z = head.z + Math.sin(a) * d;
      if (!terrain.isOnIsland(x, z, 6) || terrain.isWater(x, z)) continue;
      const c = pm.coverageAt(x, z);
      if (c < 0.12) continue;
      const score = c <= 0.55 ? 2 : 1;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestZ = z;
        if (score === 2) break;
      }
    }
    if (!bestScore) return null;
    out.set(bestX, terrain.heightAt(bestX, bestZ) + 0.08, bestZ);
    pm.colorAt(bestX, bestZ, colorOut);
    const pal = this.app.paint.palette;
    if (colorOut.r + colorOut.g + colorOut.b < 0.15) colorOut.copy(pal[rng.int(0, pal.length - 1)]);
    return out;
  }

  update(dt, time) {
    const app = this.app;
    const world = app.world;
    const rng = app.rng;
    const head = app.headPosition(_head);
    const wl = world.terrain.waterLevel;
    // ambient bubbles: blooming ground along the colour front near the player blows them
    // (from minute one, wherever you are painting); the fountain only bubbles once fed (Props.js)
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2 + rng.float() * 2;
      if (this._frontNearHead(head, _p, _c)) {
        const i = this.spawn(_p, _c, 0.07 + rng.float() * 0.1, null, 10 + rng.float() * 10);
        this.vel[i].set(rng.gauss() * 0.15, 0.45, rng.gauss() * 0.15);
        this.ambientCount++;
        this.lastAmbient.copy(_p);
        if (app.audio) app.audio.bubbleBlow(0.35);
      }
    }
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const p = this.pos[i];
      const v = this.vel[i];
      const r = this.radius[i];
      this.age[i] += dt;
      if (this.age[i] > this.life[i]) {
        this.pop(i, null, true);
        continue;
      }
      // buoyancy, a steady drift toward the player (terminal ~0.7 m/s so they actually arrive), wind wobble
      const targetY = 0.9 + Math.sin(time * 0.5 + this.wobble.array[i] * 5) * 0.4 + r * 3;
      let gy = world.heightAt(p.x, p.z);
      if (gy < wl && world.terrain.isWater(p.x, p.z)) gy = wl; // bubbles float on the pond, not into it
      const h = p.y - gy;
      v.y += ((targetY - h) * 0.25 - v.y * 0.6) * dt;
      const dx = head.x - p.x;
      const dz = head.z - p.z;
      const dist = Math.hypot(dx, dz) + 1e-3;
      if (dist > 1.2) {
        v.x += ((dx / dist) * 0.35 - v.x * 0.5) * dt;
        v.z += ((dz / dist) * 0.35 - v.z * 0.5) * dt;
      } else {
        v.x -= v.x * 0.5 * dt;
        v.z -= v.z * 0.5 * dt;
      }
      v.x += Math.sin(time * 0.9 + this.wobble.array[i] * 6) * 0.05 * dt;
      v.z += Math.cos(time * 0.7 + this.wobble.array[i] * 4) * 0.05 * dt;
      p.addScaledVector(v, dt);
      if (p.y < gy + r * 0.5) {
        this.pop(i, null, false);
        continue;
      }
      // touched by a wand tip? (freshly blown bubbles get a moment to float away)
      let popped = false;
      if (this.age[i] > 1.2) for (const hand of [app.hands.left, app.hands.right]) {
        if (!hand.connected || !hand.hasTip) continue;
        if (hand.tip.distanceTo(p) < r + 0.025) {
          this.pop(i, hand);
          popped = true;
          break;
        }
      }
      if (popped) continue;
      _q.identity();
      _s.setScalar(r);
      _m.compose(p, _q, _s);
      this.mesh.setMatrixAt(count, _m);
      this.mesh.setColorAt(count, this.colors[i]);
      this.wobble.array[count] = this.wobble.array[i] > 0 ? this.wobble.array[i] : 0.01;
      count++;
    }
    // compact: instances are rewritten each frame in order (wobble stays aligned via copy above)
    this.mesh.count = count;
    this.aliveCount = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.wobble.needsUpdate = true;
  }
}
