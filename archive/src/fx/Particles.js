import * as THREE from 'three';

/**
 * GPU particle pool: the CPU only writes a particle's spawn state once; the
 * vertex shader integrates motion from time, so thousands of sparkles cost
 * almost nothing. Ring buffer with coalesced update ranges.
 *
 * Types: 0 sparkle (additive twinkling star), 1 confetti (tumbling square),
 * 2 droplet (round, gravity), 3 puff (soft cotton bit), 4 rocket (bright, rising)
 */
const vert = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec3 aColor;
attribute vec4 aInfo; // start, life, size, type
attribute float aSeed;
uniform float time;
uniform float uHeight;
varying vec3 vColor;
varying float vAlpha;
varying float vType;
varying float vSeed;
varying float vAge;
void main() {
  float age = time - aInfo.x;
  float life = aInfo.y;
  float type = aInfo.w;
  vType = type;
  vSeed = aSeed;
  if (age < 0.0 || age > life || life <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAlpha = 0.0;
    vColor = aColor;
    vAge = 0.0;
    return;
  }
  float t = age / life;
  vAge = age;
  vec3 g = vec3(0.0);
  float drag = 1.0;
  if (type < 0.5) { g = vec3(0.0, 0.25, 0.0); drag = 2.2; }
  else if (type < 1.5) { g = vec3(0.0, -1.1, 0.0); drag = 1.6; }
  else if (type < 2.5) { g = vec3(0.0, -4.0, 0.0); drag = 0.2; }
  else if (type < 3.5) { g = vec3(0.0, 0.12, 0.0); drag = 3.0; }
  else { g = vec3(0.0, 0.0, 0.0); drag = 0.15; }
  vec3 p = aPos + aVel * (1.0 - exp(-drag * age)) / drag + 0.5 * g * age * age;
  if (type > 0.5 && type < 1.5) {
    p.x += sin(age * 6.0 + aSeed * 20.0) * 0.06 * t;
    p.z += cos(age * 5.0 + aSeed * 13.0) * 0.06 * t;
  }
  float size = aInfo.z;
  float alpha = 1.0;
  if (type < 0.5) {
    size *= (1.0 - t * 0.7) * (0.65 + 0.35 * sin(age * 22.0 + aSeed * 40.0));
    alpha = (1.0 - t) * (1.0 - t);
  } else if (type < 1.5) {
    size *= 0.55 + 0.45 * abs(sin(age * 9.0 + aSeed * 30.0));
    alpha = 1.0 - smoothstep(0.8, 1.0, t);
  } else if (type < 2.5) {
    size *= 1.0 - t * 0.2;
    alpha = 1.0 - smoothstep(0.9, 1.0, t);
  } else if (type < 3.5) {
    size *= 0.5 + t * 1.5;
    alpha = (1.0 - t) * 0.6;
  } else {
    size *= 1.0 + t * 0.5;
    alpha = 1.0 - smoothstep(0.7, 1.0, t);
  }
  vColor = aColor;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * projectionMatrix[1][1] * uHeight * 0.5 / max(-mv.z, 0.05);
}
`;
const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vType;
varying float vSeed;
varying float vAge;
void main() {
  if (vAlpha <= 0.001) discard;
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float a = 0.0;
  vec3 col = vColor;
  if (vType < 0.5 || vType > 3.5) {
    float r = length(uv);
    float core = smoothstep(1.0, 0.0, r);
    float flare = pow(max(0.0, 1.0 - abs(uv.x)), 10.0) + pow(max(0.0, 1.0 - abs(uv.y)), 10.0);
    a = clamp(core * core * 1.2 + flare * 0.8, 0.0, 1.0);
    col = mix(vColor, vec3(1.0), core * 0.55);
  } else if (vType < 1.5) {
    float ang = vSeed * 6.2831 + vAge * 4.0;
    float c = cos(ang), s = sin(ang);
    vec2 r = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
    a = step(max(abs(r.x) * 1.6, abs(r.y)), 0.7);
    col = vColor * (0.85 + 0.3 * step(0.0, r.x));
  } else if (vType < 2.5) {
    float r = length(uv);
    a = smoothstep(1.0, 0.7, r);
    col = vColor + vec3(0.35) * smoothstep(0.7, 0.0, length(uv - vec2(-0.3, -0.3)));
  } else {
    float r = length(uv);
    a = smoothstep(1.0, 0.2, r) * 0.9;
    col = mix(vColor, vec3(1.0), 0.4);
  }
  gl_FragColor = vec4(col, a * vAlpha);
  #include <colorspace_fragment>
}
`;

export class ParticlePool {
  constructor(app, { capacity = 4000, additive = true } = {}) {
    this.app = app;
    this.capacity = capacity;
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.aInfo.array.fill(0);
    geo.setAttribute('position', this.aPos); // alias so three computes nothing weird
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aInfo', this.aInfo);
    geo.setAttribute('aSeed', this.aSeed);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.uniforms = { time: app.world.uniforms.time, uHeight: { value: 800 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
    this.points.name = additive ? 'particles-additive' : 'particles-normal';
    this.attrs = [this.aPos, this.aVel, this.aColor, this.aInfo, this.aSeed];
    this.minW = Infinity;
    this.maxW = -Infinity;
    this.wrapped = false;
  }

  emit(px, py, pz, vx, vy, vz, r, g, b, start, life, size, type, seed) {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.head === 0) this.wrapped = true;
    this.aPos.setXYZ(i, px, py, pz);
    this.aVel.setXYZ(i, vx, vy, vz);
    this.aColor.setXYZ(i, r, g, b);
    this.aInfo.setXYZW(i, start, life, size, type);
    this.aSeed.setX(i, seed);
    if (i < this.minW) this.minW = i;
    if (i > this.maxW) this.maxW = i;
  }

  flush(height) {
    this.uniforms.uHeight.value = height;
    if (this.maxW < 0) return;
    let start = this.minW;
    let count = this.maxW - this.minW + 1;
    if (this.wrapped) {
      start = 0;
      count = this.capacity;
      this.wrapped = false;
    }
    for (const a of this.attrs) {
      a.addUpdateRange(start * a.itemSize, count * a.itemSize);
      a.needsUpdate = true;
    }
    this.minW = Infinity;
    this.maxW = -Infinity;
  }
}
