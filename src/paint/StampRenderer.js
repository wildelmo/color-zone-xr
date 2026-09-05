import * as THREE from 'three';

/**
 * Batches soft circular "stamps" into a top-down render target with one
 * instanced draw. Shared by the PaintMap (colour) and the ShadowMap (baked
 * contact shadows).
 */
const vert = /* glsl */ `
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
const frag = /* glsl */ `
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

export class StampRenderer {
  constructor(renderer, mapRect) {
    this.renderer = renderer;
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
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { mapRect: { value: mapRect } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.queue = [];
  }

  stamp(x, z, radius, r, g, b, strength, soft) {
    this.queue.push(x, z, radius, r, g, b, strength, soft);
  }

  get pending() {
    return this.queue.length > 0;
  }

  /** draw all queued stamps into target (additively over its current content) */
  flush(target) {
    if (this.queue.length === 0) return;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    const prevXR = r.xr.enabled;
    r.xr.enabled = false;
    r.autoClear = false;
    r.setRenderTarget(target);
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
      this.geo.instanceCount = count;
      r.render(this.scene, this.camera);
      offset += count * 8;
    }
    q.length = 0;
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    r.xr.enabled = prevXR;
  }

  /** clear a target to transparent black */
  clear(target) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevColor = new THREE.Color();
    r.getClearColor(prevColor);
    const prevAlpha = r.getClearAlpha();
    const prevXR = r.xr.enabled;
    r.xr.enabled = false;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(target);
    r.clear(true, false, false);
    r.setRenderTarget(prevTarget);
    r.setClearColor(prevColor, prevAlpha);
    r.xr.enabled = prevXR;
  }
}

export function makeMapTarget(res, name) {
  const t = new THREE.WebGLRenderTarget(res, res, {
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
}
