import * as THREE from 'three';

/**
 * Strings of little incandescent bulbs: one instanced mesh for the glass
 * bulbs and one for soft camera-facing glow halos (billboarded in the vertex
 * shader, so they work per-eye in WebXR and scale with the object).
 *
 * Bulbs are added with a ring id and an index along the ring so chase
 * patterns can run around each ring.
 */
export class BulbString {
  constructor({ radius = 0.05, glow = 0.42, detail = 1 } = {}) {
    this.items = []; // { p: Vector3, ring, idx, n, tint }
    this.radius = radius;
    this.glowSize = glow;
    this.detail = detail;
    this.level = 1; // overall brightness
    this.wave = 1; // assembly reveal 0..1 (sweeps around the rings)
  }

  add(p, ring = 0, idx = 0, n = 1, tint = null) {
    this.items.push({ p: p.clone(), ring, idx, n, tint: tint ? new THREE.Color(tint) : null });
  }

  build(kit) {
    const N = this.items.length;
    const group = new THREE.Group();
    group.name = 'bulbs';
    if (!N) {
      this.group = group;
      return group;
    }
    const geo = new THREE.SphereGeometry(this.radius, this.detail > 0 ? 7 : 5, this.detail > 0 ? 5 : 3);
    geo.scale(1, 1.25, 1);
    const mat = kit.track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const bulbs = new THREE.InstancedMesh(geo, mat, N);
    bulbs.name = 'bulbs:glass';
    bulbs.frustumCulled = false;
    const m = new THREE.Matrix4();
    this.items.forEach((it, i) => {
      m.makeTranslation(it.p.x, it.p.y, it.p.z);
      bulbs.setMatrixAt(i, m);
      bulbs.setColorAt(i, new THREE.Color(1, 1, 1));
    });
    group.add(bulbs);

    const quad = new THREE.PlaneGeometry(1, 1);
    const glowMat = kit.track(
      new THREE.ShaderMaterial({
        uniforms: { uSize: { value: this.glowSize } },
        vertexShader: /* glsl */ `
          uniform float uSize;
          varying vec2 vUv;
          varying vec3 vCol;
          void main() {
            vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
            float s = length(modelViewMatrix[0].xyz) * uSize;
            vec3 toCam = normalize(-mv.xyz);
            mv.xyz += toCam * s * 0.35;
            mv.xy += position.xy * s;
            gl_Position = projectionMatrix * mv;
            vUv = uv;
            #ifdef USE_INSTANCING_COLOR
              vCol = instanceColor;
            #else
              vCol = vec3(1.0);
            #endif
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vCol;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float core = exp(-d * d * 18.0);
            float halo = exp(-d * d * 4.0) * (1.0 - d);
            float a = max(0.0, core * 0.9 + halo * 0.55);
            gl_FragColor = vec4(vCol * a, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    glowMat.userData.noShadow = true;
    const glows = new THREE.InstancedMesh(quad, glowMat, N);
    glows.name = 'bulbs:glow';
    glows.frustumCulled = false;
    glows.renderOrder = 10;
    this.items.forEach((it, i) => {
      m.makeTranslation(it.p.x, it.p.y, it.p.z);
      glows.setMatrixAt(i, m);
      glows.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    group.add(glows);
    this.bulbs = bulbs;
    this.glows = glows;
    this.group = group;
    this._warm = new THREE.Color('#ffd49a');
    this._c = new THREE.Color();
    return group;
  }

  /**
   * @param {number} t     time (s)
   * @param {number} run   0..1 how fast the mechanism is running
   */
  update(t, run) {
    if (!this.bulbs) return;
    const pattern = Math.floor(t / 10) % 4;
    const c = this._c;
    const bulbCol = this.bulbs.instanceColor.array;
    const glowCol = this.glows.instanceColor.array;
    const chaseT = t * (2 + run * 6);
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const u = it.idx / Math.max(1, it.n);
      let b;
      if (run < 0.05) b = 0.8 + 0.05 * Math.sin(t * 1.3 + i);
      else if (pattern === 0) b = 0.82 + 0.18 * Math.sin(t * 7 + i * 2.3) * Math.sin(t * 3.1 + i);
      else if (pattern === 1) b = ((((it.idx - chaseT) % 4) + 4) % 4) < 1.6 ? 1 : 0.28;
      else if (pattern === 2) b = (it.idx + Math.floor(t * 2)) % 2 ? 1 : 0.3;
      else b = 0.55 + 0.45 * Math.sin(u * Math.PI * 2 * 3 - t * 4 + it.ring);
      b = THREE.MathUtils.lerp(0.8, b, Math.min(1, run * 3));
      // assembly reveal: bulbs switch on in a wave around each ring
      const reveal = THREE.MathUtils.clamp((this.wave * 1.25 - u) * 8, 0, 1);
      b *= reveal * this.level;
      c.copy(it.tint || this._warm);
      const k = 0.25 + b * 1.35;
      bulbCol[i * 3] = 0.18 + c.r * k;
      bulbCol[i * 3 + 1] = 0.14 + c.g * k;
      bulbCol[i * 3 + 2] = 0.1 + c.b * k;
      glowCol[i * 3] = c.r * b * 0.75;
      glowCol[i * 3 + 1] = c.g * b * 0.75;
      glowCol[i * 3 + 2] = c.b * b * 0.75;
    }
    this.bulbs.instanceColor.needsUpdate = true;
    this.glows.instanceColor.needsUpdate = true;
  }
}
