import * as THREE from 'three';
import { WORLD } from '../config.js';
import { smoothstep } from '../util/math.js';
import { StampRenderer, makeMapTarget } from './StampRenderer.js';

/**
 * Top-down "where has colour landed" map. The GPU side is an RGBA render
 * target that environment shaders sample (rgb = paint colour premultiplied,
 * a = coverage). A coarse CPU grid mirrors it for gameplay questions like
 * "should this flower bloom yet?" and "what % of the island is painted?".
 * A ping-pong pass lets colour bleed outward while the player is active.
 */
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
    this.mapRect = new THREE.Vector4(-this.half, -this.half, this.size, this.size);

    this.target = makeMapTarget(this.res, 'paintMap');
    this.targetB = makeMapTarget(this.res, 'paintMapB');
    this.texture = this.target.texture;
    this.textureUniform = null; // set by World so materials follow the ping-pong
    this.stamper = new StampRenderer(renderer, this.mapRect);

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
    this.spreadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.spreadTimer = 0;
    this.cpuSpreadTimer = 0;
    this.covB = null;

    // CPU mirror
    const n = this.gridRes * this.gridRes;
    this.cov = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    this.islandMask = new Uint8Array(n);
    this.islandCells = 0;
    this.rebuildMask(terrain);
    this.progress = 0;
    this._progressDirty = true;
    this.cleared = false;
    this.stampCount = 0;
  }

  rebuildMask(terrain) {
    this.terrain = terrain;
    const cell = this.size / this.gridRes;
    this.islandMask.fill(0);
    this.islandCells = 0;
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
  }

  _clearTargets() {
    this.stamper.clear(this.target);
    this.stamper.clear(this.targetB);
    this.cleared = true;
  }

  /** wipe the world back to sketch */
  clear() {
    this._clearTargets();
    this.cov.fill(0);
    this.col.fill(0);
    this.stamper.queue.length = 0;
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
    this.stamper.stamp(x, z, radius, color.r, color.g, color.b, strength, soft);
    this.stampCount++;
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

  /** world position + colour of a random cell on the colour front (for sparkles), or null */
  randomFrontCell(rng, out, colorOut) {
    const g = this.gridRes;
    const i = rng.int(0, g * g - 1);
    const c = this.cov[i];
    if (c < 0.12 || c > 0.55 || !this.islandMask[i]) return null;
    const cell = this.size / g;
    const gx = i % g;
    const gz = Math.floor(i / g);
    out.set(-this.half + (gx + rng.float()) * cell, 0, -this.half + (gz + rng.float()) * cell);
    out.y = this.terrain.heightAt(out.x, out.z) + 0.05;
    colorOut.setRGB(this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]);
    return out;
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
    if (!this.cleared) this._clearTargets();
    this.stamper.flush(this.target);
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
    r.render(this.spreadScene, this.spreadCamera);
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

  get queue() {
    return this.stamper.queue;
  }
}
