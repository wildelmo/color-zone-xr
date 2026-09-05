import * as THREE from 'three';

/**
 * Sticker brush: instanced stars and hearts dropped along the stroke path.
 * Each instance bounces in when placed (birth attribute) and can be undone
 * as a range (stickers are appended in stroke order).
 */
const vert = /* glsl */ `
attribute float birth;
uniform float time;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vV;
varying float vDist;
float backOut(float t) { float c = 1.70158; return 1.0 + (c + 1.0) * pow(t - 1.0, 3.0) + c * pow(t - 1.0, 2.0); }
void main() {
  float age = clamp((time - birth) / 0.45, 0.0, 1.0);
  float s = birth > 1e8 ? 0.0 : backOut(age);
  vec3 pos = position * s;
  vec4 wp = modelMatrix * instanceMatrix * vec4(pos, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vDist = length(vV);
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const frag = /* glsl */ `
uniform vec3 sunDir;
uniform vec3 fogColor;
uniform vec2 fogRange;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vV;
varying float vDist;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vV);
  float lit = smoothstep(-0.3, 0.7, dot(N, sunDir));
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  vec3 col = vColor * (0.6 + 0.55 * lit) + vec3(1.0) * fres * 0.45 + vColor * 0.1;
  col = mix(col, fogColor, smoothstep(fogRange.x, fogRange.y, vDist) * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

function starShape(outer = 1, inner = 0.45, points = 5) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function heartShape() {
  const s = new THREE.Shape();
  const x = 0;
  const y = 0;
  s.moveTo(x, y + 0.5);
  s.bezierCurveTo(x, y + 0.5, x - 0.1, y + 0.9, x - 0.5, y + 0.9);
  s.bezierCurveTo(x - 1.1, y + 0.9, x - 1.1, y + 0.2, x - 1.1, y + 0.2);
  s.bezierCurveTo(x - 1.1, y - 0.3, x - 0.6, y - 0.8, x, y - 1.15);
  s.bezierCurveTo(x + 0.6, y - 0.8, x + 1.1, y - 0.3, x + 1.1, y + 0.2);
  s.bezierCurveTo(x + 1.1, y + 0.2, x + 1.1, y + 0.9, x + 0.5, y + 0.9);
  s.bezierCurveTo(x + 0.1, y + 0.9, x, y + 0.5, x, y + 0.5);
  return s;
}

const HIDDEN = 1e9;

export class StampLayer {
  constructor(shared, capacity = 1200) {
    this.capacity = capacity;
    this.group = new THREE.Group();
    this.group.name = 'stickers';
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: shared.time, sunDir: shared.sunDir, fogColor: shared.fogColor, fogRange: shared.fogRange },
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.DoubleSide,
    });
    const shapes = {
      star: new THREE.ExtrudeGeometry(starShape(), { depth: 0.35, bevelEnabled: false, curveSegments: 3 }),
      heart: new THREE.ExtrudeGeometry(heartShape(), { depth: 0.3, bevelEnabled: false, curveSegments: 5 }),
    };
    this.kinds = {};
    for (const [name, geo] of Object.entries(shapes)) {
      geo.center();
      geo.scale(0.02, 0.02, 0.02);
      const birth = new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(HIDDEN), 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('birth', birth);
      const mesh = new THREE.InstancedMesh(geo, mat, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = 'stickers-' + name;
      this.group.add(mesh);
      this.kinds[name] = { mesh, birth, next: 0 };
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
  }

  /** @returns index placed or -1 */
  place(kind, position, quaternion, scale, color, time) {
    const k = this.kinds[kind];
    if (!k || k.next >= this.capacity) return -1;
    const i = k.next++;
    this._s.setScalar(scale);
    this._m.compose(position, quaternion, this._s);
    k.mesh.setMatrixAt(i, this._m);
    k.mesh.setColorAt(i, color);
    k.birth.array[i] = time;
    k.birth.needsUpdate = true;
    k.mesh.instanceMatrix.needsUpdate = true;
    k.mesh.instanceColor.needsUpdate = true;
    k.mesh.count = k.next;
    return i;
  }

  /** remove the most recently placed stickers of a kind */
  removeLast(kind, count) {
    const k = this.kinds[kind];
    if (!k) return;
    k.next = Math.max(0, k.next - count);
    for (let i = k.next; i < k.next + count && i < this.capacity; i++) k.birth.array[i] = HIDDEN;
    k.birth.needsUpdate = true;
    k.mesh.count = k.next;
  }

  clear() {
    for (const k of Object.values(this.kinds)) {
      k.next = 0;
      k.birth.array.fill(HIDDEN);
      k.birth.needsUpdate = true;
      k.mesh.count = 0;
    }
  }

  get total() {
    let n = 0;
    for (const k of Object.values(this.kinds)) n += k.next;
    return n;
  }
}
