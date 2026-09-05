import * as THREE from 'three';
import { PropMaterial, glowTexture } from '../util/PropMaterial.js';

/**
 * Paint balls: squeeze the grip to conjure one, let go to throw it. Where it
 * lands, colour explodes across the ground (big paint-map stamp + a
 * wobbly splat decal + droplets + a satisfying thud).
 */
const decalVert = /* glsl */ `
attribute float birth;
attribute float seed;
uniform float time;
varying vec3 vColor;
varying vec2 vUv;
varying float vSeed;
varying float vAge;
void main() {
  float age = clamp((time - birth) / 0.35, 0.0, 1.0);
  float s = birth > 1e8 ? 0.0 : (1.0 + 1.9 * pow(age - 1.0, 3.0) + 1.7 * pow(age - 1.0, 2.0));
  vec3 pos = position * s;
  vec4 wp = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  vColor = instanceColor;
  vUv = uv * 2.0 - 1.0;
  vSeed = seed;
  vAge = age;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const decalFrag = /* glsl */ `
varying vec3 vColor;
varying vec2 vUv;
varying float vSeed;
varying float vAge;
void main() {
  float r = length(vUv);
  float ang = atan(vUv.y, vUv.x);
  float edge = 0.62 + 0.16 * sin(ang * 7.0 + vSeed * 20.0) + 0.1 * sin(ang * 13.0 - vSeed * 9.0) + 0.06 * sin(ang * 23.0 + vSeed * 3.0);
  float a = 1.0 - smoothstep(edge - 0.05, edge, r);
  // a few satellite droplets
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float da = vSeed * 40.0 + fi * 1.7;
    vec2 c = vec2(cos(da), sin(da)) * (0.72 + 0.14 * fract(vSeed * 7.0 + fi * 0.37));
    a = max(a, 1.0 - smoothstep(0.05, 0.09 + 0.03 * fi, length(vUv - c)));
  }
  if (a < 0.01) discard;
  vec3 col = vColor * (1.05 - 0.15 * r) + vec3(0.15) * (1.0 - r);
  gl_FragColor = vec4(col, a * 0.95);
  #include <colorspace_fragment>
}
`;

const HIDDEN = 1e9;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();

export class Splats {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'splats';
    const shared = app.world.uniforms;
    this.ballGeo = new THREE.SphereGeometry(0.048, 20, 14);
    this.balls = []; // { mesh, glow, vel, color, flying, hand }
    this.held = { left: null, right: null };

    const cap = 64;
    this.cap = cap;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.birth = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(HIDDEN), 1).setUsage(THREE.DynamicDrawUsage);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('birth', this.birth);
    geo.setAttribute('seed', this.seed);
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: shared.time },
      vertexShader: decalVert,
      fragmentShader: decalFrag,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.decals = new THREE.InstancedMesh(geo, mat, cap);
    this.decals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 4;
    this.decals.name = 'splat-decals';
    this.decalNext = 0;
    this.decalData = [];
    this.group.add(this.decals);
    this.splatCount = 0;
  }

  _makeBall(color) {
    const mat = new PropMaterial(this.app.world.uniforms, { color: '#ffffff', rim: 0.4, gloss: 1.3 });
    mat.uniforms.color.value.copy(color).lerp(new THREE.Color(1, 1, 1), 0.15);
    mat.uniforms.emissive.value.copy(color).multiplyScalar(0.25);
    const mesh = new THREE.Mesh(this.ballGeo, mat);
    mesh.name = 'paintball';
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
    glow.scale.setScalar(0.22);
    mesh.add(glow);
    this.group.add(mesh);
    return { mesh, glow, vel: new THREE.Vector3(), color: color.clone(), flying: false, age: 0, spin: new THREE.Vector3(this.app.rng.gauss(), this.app.rng.gauss(), this.app.rng.gauss()).multiplyScalar(6) };
  }

  _removeBall(b) {
    this.group.remove(b.mesh);
    b.mesh.material.dispose();
    b.glow.material.dispose();
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
  }

  splat(b) {
    const app = this.app;
    const p = b.mesh.position;
    const world = app.world;
    const speed = b.vel.length();
    const r = 1.6 + Math.min(2.5, speed * 0.28);
    world.paintMap.stamp(p.x, p.z, r, b.color, 0.9, 0.7);
    if (app.fx) {
      app.fx.splash(p, b.color, 34, 2.4 + speed * 0.2);
      app.fx.burst(p, b.color, 26, 2.2, 0.05);
      app.fx.confetti(p, 12, [b.color], 1.5);
    }
    // decal on the terrain
    this._placeDecal(p.x, p.z, r, b.color, app.rng.float(), app.time);
    if (app.audio) app.audio.splat(speed);
    this.splatCount++;
    app.events.emit('splat', { position: p.clone(), color: b.color.clone(), radius: r });
    // pop bubbles nearby
    if (app.bubbles) {
      for (let k = 0; k < app.bubbles.capacity; k++) {
        if (app.bubbles.alive[k] && app.bubbles.pos[k].distanceTo(p) < 1.0) app.bubbles.pop(k);
      }
    }
    this._removeBall(b);
  }

  serialize() {
    const out = [];
    const n = Math.min(this.cap, this.decalNext);
    for (let i = 0; i < n; i++) out.push(this.decalData[i]);
    return out.filter(Boolean);
  }

  restore(items) {
    const app = this.app;
    const world = app.world;
    for (const d of items) {
      const c = new THREE.Color(d.c);
      world.paintMap.stamp(d.x, d.z, d.r, c, 0.9, 0.7);
      this._placeDecal(d.x, d.z, d.r, c, d.s, app.time - 5);
    }
  }

  _placeDecal(x, z, r, color, seed, time) {
    const world = this.app.world;
    const i = this.decalNext % this.cap;
    this.decalNext++;
    world.terrain.normalAt(x, z, _n);
    _q.setFromUnitVectors(_up, _n);
    const s = r * 0.8;
    _s.set(s, 1, s);
    _v.set(x, world.heightAt(x, z) + 0.015, z);
    _m.compose(_v, _q, _s);
    this.decals.setMatrixAt(i, _m);
    this.decals.setColorAt(i, color);
    this.birth.array[i] = time;
    this.seed.array[i] = seed;
    this.birth.needsUpdate = this.seed.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true;
    this.decals.instanceColor.needsUpdate = true;
    this.decals.count = Math.min(this.cap, this.decalNext);
    this.decalData[i] = { x: +x.toFixed(2), z: +z.toFixed(2), r: +r.toFixed(2), c: '#' + color.getHexString(), s: +seed.toFixed(3) };
  }

  clearDecals() {
    this.decalData.length = 0;
    this.birth.array.fill(HIDDEN);
    this.birth.needsUpdate = true;
    this.decals.count = 0;
    this.decalNext = 0;
  }

  update(dt, time) {
    const app = this.app;
    const world = app.world;
    for (const hand of [app.hands.left, app.hands.right]) {
      const key = hand.handedness;
      const held = this.held[key];
      if (!hand.connected) {
        if (held) {
          this._removeBall(held);
          this.held[key] = null;
        }
        continue;
      }
      if (hand.squeezePressed && !held && !hand.uiBlocked && !app.locomotionBusy) {
        const b = this._makeBall(app.paint.color);
        b.mesh.scale.setScalar(0.01);
        this.held[key] = b;
        hand.pulse(0.4, 40);
        if (app.audio) app.audio.conjure();
        if (app.fx) app.fx.burst(hand.tip, app.paint.color, 12, 0.6, 0.03);
      }
      if (held) {
        held.mesh.position.copy(hand.tip);
        held.mesh.scale.setScalar(Math.min(1, held.mesh.scale.x + dt * 6));
        held.mesh.quaternion.copy(hand.tipQuat);
        if (hand.squeezeReleased) {
          this.held[key] = null;
          held.vel.copy(hand.tipVel);
          const sp = held.vel.length();
          if (sp > 12) held.vel.multiplyScalar(12 / sp);
          if (sp < 0.6) held.vel.set(0, 0.5, 0); // gentle drop
          held.vel.y += 0.6;
          held.flying = true;
          held.age = 0;
          hand.pulse(0.6, 50);
          if (app.audio) app.audio.throwWhoosh(Math.min(1, sp / 8));
          this.balls.push(held);
        }
      }
    }
    for (const b of [...this.balls]) {
      if (!b.flying) continue;
      b.age += dt;
      b.vel.y -= 6.5 * dt;
      b.vel.multiplyScalar(1 - 0.08 * dt);
      const p = b.mesh.position;
      p.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      if (app.fx && app.rng.chance(0.6)) app.fx.sparkle(p, _v.set(0, 0.2, 0), b.color, 0.4, 0.03);
      const gy = world.heightAt(p.x, p.z);
      const onIsland = world.terrain.isOnIsland(p.x, p.z, 0.5);
      if (p.y <= gy + 0.04 && onIsland) {
        this.splat(b);
      } else if (b.age > 8 || p.y < -30) {
        this._removeBall(b);
      }
    }
  }
}
