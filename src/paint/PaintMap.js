import * as THREE from 'three';
import { WORLD } from '../config.js';
import { smoothstep } from '../util/math.js';

/**
 * Top-down "where has colour landed" map. The GPU side is an RGBA render
 * target that environment shaders sample (rgb = paint colour premultiplied,
 * a = coverage). A coarse CPU grid mirrors it for gameplay questions like
 * "should this flower bloom yet?" and "what % of the island is painted?".
 */
const stampVert = /* glsl */ `
attribute vec2 iPos;
attribute float iRadius;
attribute vec3 iColor;
attribute vec2 iParams;
uniform vec4 mapRect;
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vParams;
void main() {
  vec2 world = iPos + position.xy * iRadius;
  vec2 ndc = (world - mapRect.xy) / mapRect.zw * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vUv = position.xy;
  vColor = iColor;
  vParams = iParams;
}
`;
const stampFrag = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vParams;
void main() {
  float d = length(vUv);
  float a = (1.0 - smoothstep(1.0 - vParams.y, 1.0, d)) * vParams.x;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

const MAX_STAMPS = 256;

const spreadVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const spreadFrag = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
uniform float rate;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(src, vUv);
  vec4 best = texture2D(src, vUv + vec2(texel.x, 0.0));
  vec4 n = texture2D(src, vUv - vec2(texel.x, 0.0));
  if (n.a > best.a) best = n;
  n = texture2D(src, vUv + vec2(0.0, texel.y));
  if (n.a > best.a) best = n;
  n = texture2D(src, vUv - vec2(0.0, texel.y));
  if (n.a > best.a) best = n;
  float grow = max(0.0, best.a - 0.45) * rate;
  if (grow <= 0.0 || c.a >= 0.999) {
    gl_FragColor = c;
    return;
  }
  vec3 bc = best.rgb / max(best.a, 0.002);
  float na = min(1.0, c.a + grow);
  gl_FragColor = vec4(c.rgb + bc * (na - c.a), na);
}
`;

export class PaintMap {
  constructor(renderer, terrain) {
    this.renderer = renderer;
    this.terrain = terrain;
    this.size = WORLD.mapSize;
    this.res = WORLD.mapRes;
    this.gridRes = WORLD.gridRes;
    this.half = this.size / 2;

    const makeTarget = (name) => {
      const t = new THREE.WebGLRenderTarget(this.res, this.res, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      t.texture.colorSpace = THREE.NoColorSpace;
      t.texture.name = name;
      return t;
    };
    this.target = makeTarget('paintMap');
    this.targetB = makeTarget('paintMapB');
    this.texture = this.target.texture;
    this.textureUniform = null; // set by World so materials follow the ping-pong
    this.spreadMat = new THREE.ShaderMaterial({
      uniforms: { src: { value: null }, texel: { value: new THREE.Vector2(1 / this.res, 1 / this.res) }, rate: { value: 0.1 } },
      vertexShader: spreadVert,
      fragmentShader: spreadFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.spreadScene = new THREE.Scene();
    const spreadQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.spreadMat);
    spreadQuad.frustumCulled = false;
    this.spreadScene.add(spreadQuad);
    this.spreadTimer = 0;
    this.cpuSpreadTimer = 0;
    this.covB = null;
    this.mapRect = new THREE.Vector4(-this.half, -this.half, this.size, this.size);

    // instanced stamp quads
    const quad = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.iRadius = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS), 1).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iParams = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iRadius', this.iRadius);
    geo.setAttribute('iColor', this.iColor);
    geo.setAttribute('iParams', this.iParams);
    geo.instanceCount = 0;
    this.stampGeo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { mapRect: { value: this.mapRect } },
      vertexShader: stampVert,
      fragmentShader: stampFrag,
      transparent: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.stampMesh = new THREE.Mesh(geo, mat);
    this.stampMesh.frustumCulled = false;
    this.stampScene = new THREE.Scene();
    this.stampScene.add(this.stampMesh);
    this.stampCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.queue = [];

    // CPU mirror
    const n = this.gridRes * this.gridRes;
    this.cov = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.islandMask = new Uint8Array(n);
    this.islandCells = 0;
    const cell = this.size / this.gridRes;
    for (let gz = 0; gz < this.gridRes; gz++) {
      for (let gx = 0; gx < this.gridRes; gx++) {
        const x = -this.half + (gx + 0.5) * cell;
        const z = -this.half + (gz + 0.5) * cell;
        if (terrain.isOnIsland(x, z, 6) && !terrain.isWater(x, z)) {
          this.islandMask[gz * this.gridRes + gx] = 1;
          this.islandCells++;
        }
      }
    }
    this.progress = 0;
    this._progressDirty = true;
    this.cleared = false;
    this.stampCount = 0;
  }

  _clearTarget() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    const prevXR = r.xr.enabled;
    r.xr.enabled = false;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.target);
    r.clear(true, false, false);
    r.setRenderTarget(this.targetB);
    r.clear(true, false, false);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    r.xr.enabled = prevXR;
    this.cleared = true;
  }

  /**
   * Let colour bleed outward from well-painted areas. energy (0..1) comes
   * from recent play, so the world only keeps blooming while you're active.
   */
  spread(dt, energy, rng) {
    if (energy < 0.12) return;
    this.spreadTimer -= dt;
    this.cpuSpreadTimer -= dt;
    if (this.spreadTimer <= 0) {
      this.spreadTimer = 0.12;
      if (rng.float() < Math.min(1, energy * 1.4)) this._spreadGPU();
    }
    if (this.cpuSpreadTimer <= 0) {
      this.cpuSpreadTimer = 0.5;
      this._spreadCPU(Math.min(1, energy * 1.4));
    }
  }

  _spreadGPU() {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const prevXR = r.xr.enabled;
    r.xr.enabled = false;
    r.autoClear = false;
    this.spreadMat.uniforms.src.value = this.target.texture;
    r.setRenderTarget(this.targetB);
    r.render(this.spreadScene, this.stampCamera);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    r.xr.enabled = prevXR;
    const t = this.target;
    this.target = this.targetB;
    this.targetB = t;
    this.texture = this.target.texture;
    if (this.textureUniform) this.textureUniform.value = this.texture;
  }

  _spreadCPU(strength) {
    const g = this.gridRes;
    const cov = this.cov;
    const col = this.col;
    if (!this.covB) this.covB = new Float32Array(cov.length);
    const out = this.covB;
    out.set(cov);
    const rate = 0.052 * strength;
    for (let z = 0; z < g; z++) {
      for (let x = 0; x < g; x++) {
        const i = z * g + x;
        if (cov[i] >= 0.999 || !this.islandMask[i]) continue;
        let best = -1;
        let bi = -1;
        if (x > 0 && cov[i - 1] > best) { best = cov[i - 1]; bi = i - 1; }
        if (x < g - 1 && cov[i + 1] > best) { best = cov[i + 1]; bi = i + 1; }
        if (z > 0 && cov[i - g] > best) { best = cov[i - g]; bi = i - g; }
        if (z < g - 1 && cov[i + g] > best) { best = cov[i + g]; bi = i + g; }
        const grow = Math.max(0, best - 0.45) * rate;
        if (grow <= 0) continue;
        const na = Math.min(1, cov[i] + grow);
        const w = (na - cov[i]) / Math.max(na, 1e-4);
        col[i * 3] += (col[bi * 3] - col[i * 3]) * w;
        col[i * 3 + 1] += (col[bi * 3 + 1] - col[i * 3 + 1]) * w;
        col[i * 3 + 2] += (col[bi * 3 + 2] - col[i * 3 + 2]) * w;
        out[i] = na;
      }
    }
    this.cov = out;
    this.covB = cov;
    this._progressDirty = true;
  }

  /** wipe the world back to sketch */
  clear() {
    this._clearTarget();
    this.cov.fill(0);
    this.col.fill(0);
    this.queue.length = 0;
    this.progress = 0;
    this._progressDirty = true;
    this.stampCount = 0;
  }

  /**
   * Queue a soft circular splash of colour.
   * @param x,z world position  @param radius metres  @param color THREE.Color (linear)
   * @param strength 0..1 opacity  @param soft 0..1 edge softness
   */
  stamp(x, z, radius, color, strength = 1, soft = 0.7) {
    if (radius <= 0) return;
    this.queue.push(x, z, radius, color.r, color.g, color.b, strength, soft);
    this.stampCount++;
    // CPU mirror
    const g = this.gridRes;
    const cell = this.size / g;
    const gx0 = Math.max(0, Math.floor((x - radius + this.half) / cell));
    const gx1 = Math.min(g - 1, Math.floor((x + radius + this.half) / cell));
    const gz0 = Math.max(0, Math.floor((z - radius + this.half) / cell));
    const gz1 = Math.min(g - 1, Math.floor((z + radius + this.half) / cell));
    for (let gz = gz0; gz <= gz1; gz++) {
      const cz = -this.half + (gz + 0.5) * cell;
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = -this.half + (gx + 0.5) * cell;
        const d = Math.hypot(cx - x, cz - z) / radius;
        if (d > 1) continue;
        const a = (1 - smoothstep(1 - soft, 1, d)) * strength;
        if (a <= 0.002) continue;
        const i = gz * g + gx;
        const prev = this.cov[i];
        this.cov[i] = a + prev * (1 - a);
        const j = i * 3;
        const w = a / Math.max(this.cov[i], 1e-4);
        this.col[j] += (color.r - this.col[j]) * w;
        this.col[j + 1] += (color.g - this.col[j + 1]) * w;
        this.col[j + 2] += (color.b - this.col[j + 2]) * w;
      }
    }
    this._progressDirty = true;
  }

  /** coverage 0..1 at a world position (CPU grid) */
  coverageAt(x, z) {
    const g = this.gridRes;
    const cell = this.size / g;
    const gx = Math.floor((x + this.half) / cell);
    const gz = Math.floor((z + this.half) / cell);
    if (gx < 0 || gz < 0 || gx >= g || gz >= g) return 0;
    return this.cov[gz * g + gx];
  }

  colorAt(x, z, out) {
    const g = this.gridRes;
    const cell = this.size / g;
    const gx = Math.floor((x + this.half) / cell);
    const gz = Math.floor((z + this.half) / cell);
    if (gx < 0 || gz < 0 || gx >= g || gz >= g) return out.setRGB(0, 0, 0);
    const j = (gz * g + gx) * 3;
    return out.setRGB(this.col[j], this.col[j + 1], this.col[j + 2]);
  }

  /** fraction of island cells that are (mostly) painted */
  computeProgress() {
    if (!this._progressDirty) return this.progress;
    let sum = 0;
    const n = this.cov.length;
    for (let i = 0; i < n; i++) {
      if (this.islandMask[i]) sum += Math.min(1, this.cov[i] * 1.25);
    }
    this.progress = this.islandCells ? sum / this.islandCells : 0;
    this._progressDirty = false;
    return this.progress;
  }

  /** Flush queued stamps into the render target. Call once per frame before rendering the scene. */
  flush() {
    if (!this.cleared) this._clearTarget();
    if (this.queue.length === 0) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const prevXR = r.xr.enabled;
    r.xr.enabled = false;
    r.autoClear = false;
    r.setRenderTarget(this.target);
    const q = this.queue;
    let offset = 0;
    while (offset < q.length) {
      const count = Math.min(MAX_STAMPS, (q.length - offset) / 8);
      for (let i = 0; i < count; i++) {
        const k = offset + i * 8;
        this.iPos.setXY(i, q[k], q[k + 1]);
        this.iRadius.setX(i, q[k + 2]);
        this.iColor.setXYZ(i, q[k + 3], q[k + 4], q[k + 5]);
        this.iParams.setXY(i, q[k + 6], q[k + 7]);
      }
      this.iPos.needsUpdate = true;
      this.iRadius.needsUpdate = true;
      this.iColor.needsUpdate = true;
      this.iParams.needsUpdate = true;
      this.stampGeo.instanceCount = count;
      r.render(this.stampScene, this.stampCamera);
      offset += count * 8;
    }
    q.length = 0;
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    r.xr.enabled = prevXR;
  }
}
