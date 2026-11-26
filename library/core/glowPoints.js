import * as THREE from 'three';

/**
 * Many camera-facing soft points in one draw call (snow, mist, sparks,
 * stars). Positions/colours/sizes live in instanced attributes that the
 * caller writes directly; the quads are billboarded in the vertex shader so
 * they work per eye in WebXR and scale with the object's world scale.
 *
 *   const p = new GlowPoints(kit, 2000, { additive: false, soft: 0.6 });
 *   p.set(i, x, y, z, r, g, b, size, alpha);  p.commit(count);
 */
export class GlowPoints {
  constructor(kit, max, { additive = true, soft = 1, core = 0.9, opacity = 1, name = 'glow-points', renderOrder = 12, depthTest = true } = {}) {
    this.max = max;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('ipos', this.aPos);
    geo.setAttribute('icol', this.aCol);
    geo.setAttribute('isize', this.aSize);
    geo.instanceCount = 0;
    this.material = kit.track(
      new THREE.ShaderMaterial({
        uniforms: { uSoft: { value: soft }, uCore: { value: core }, uOpacity: { value: opacity } },
        vertexShader: /* glsl */ `
          attribute vec3 ipos;
          attribute vec4 icol;
          attribute float isize;
          varying vec2 vUv;
          varying vec4 vCol;
          void main() {
            vec4 mv = modelViewMatrix * vec4(ipos, 1.0);
            float s = length(modelViewMatrix[0].xyz) * isize;
            mv.xy += position.xy * s;
            gl_Position = projectionMatrix * mv;
            vUv = uv;
            vCol = icol;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uSoft;
          uniform float uCore;
          uniform float uOpacity;
          varying vec2 vUv;
          varying vec4 vCol;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            if (d > 1.0) discard;
            float core = exp(-d * d * 14.0) * uCore;
            float halo = exp(-d * d * 3.5 / max(uSoft, 0.05)) * (1.0 - d);
            float a = clamp(core + halo * 0.6, 0.0, 1.0) * uOpacity * vCol.a;
            ${additive ? 'gl_FragColor = vec4(vCol.rgb * a, 1.0);' : 'gl_FragColor = vec4(vCol.rgb, a);'}
          }`,
        transparent: true,
        depthWrite: false,
        depthTest,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: false,
      }),
    );
    this.material.userData.noShadow = true;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.geo = geo;
  }

  set(i, x, y, z, r, g, b, size, alpha = 1) {
    const p = this.pos, c = this.col;
    p[i * 3] = x;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = z;
    c[i * 4] = r;
    c[i * 4 + 1] = g;
    c[i * 4 + 2] = b;
    c[i * 4 + 3] = alpha;
    this.size[i] = size;
  }

  commit(count = this.max) {
    this.geo.instanceCount = count;
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}
