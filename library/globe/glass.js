import * as THREE from 'three';
import { GlowPoints } from '../core/glowPoints.js';
import { G } from './dimensions.js';

/**
 * The crystal sphere: a fresnel glass shader (clear face-on, bright and
 * reflective at grazing angles, a faint cool tint), drawn last. Inside it:
 * aurora curtains rippling across the top of the dome at night and a
 * scatter of twinkling stars.
 */
export function buildGlass(kit, { lod }) {
  const hero = lod === 'hero';
  const group = new THREE.Group();
  group.name = 'glass';
  const geo = new THREE.SphereGeometry(G.globeR, hero ? 96 : 48, hero ? 64 : 32);
  geo.translate(0, G.globeY, 0);
  const uniforms = { uFade: { value: 1 } };
  const mat = kit.standard({ color: 0xdfeefb, roughness: 0.03, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 });
  mat.userData.noShadow = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = uniforms.uFade;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.6);
          gl_FragColor.a = (0.035 + fres * 0.62) * uFade;
          gl_FragColor.rgb += vec3(0.06, 0.09, 0.12) * fres;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'globeGlass1';
  const glass = new THREE.Mesh(geo, mat);
  glass.name = 'glass:sphere';
  glass.renderOrder = 40;
  group.add(glass);

  // a little silver collar where the glass meets the rock
  const ringY = G.rimY + 1.2;
  const ringR = Math.sqrt(G.globeR * G.globeR - (G.globeY - ringY) ** 2) + 0.4;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.7, 8, hero ? 96 : 40).rotateX(Math.PI / 2), kit.standard({ color: 0xc8ccd4, metalness: 1, roughness: 0.25 }));
  collar.position.y = ringY;
  collar.name = 'glass:collar';
  group.add(collar);

  // aurora: a few curved curtains near the top of the dome
  const aurora = new THREE.Group();
  aurora.name = 'aurora';
  const auroraU = { uTime: { value: 0 }, uLevel: { value: 0.4 } };
  const amat = kit.track(
    new THREE.ShaderMaterial({
      uniforms: auroraU,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uLevel;
        varying vec2 vUv;
        float h(float x) { return fract(sin(x * 91.7) * 43758.5); }
        float n1(float x) { float i = floor(x), f = fract(x); return mix(h(i), h(i + 1.0), f * f * (3.0 - 2.0 * f)); }
        void main() {
          float x = vUv.x * 9.0;
          float folds = n1(x * 1.3 + uTime * 0.25) * 0.6 + n1(x * 3.1 - uTime * 0.4) * 0.4;
          float rays = 0.75 + 0.25 * sin(vUv.x * 90.0 + n1(x * 2.0 + uTime) * 6.0);
          float v = vUv.y;
          float body = smoothstep(0.0, 0.25, v) * (1.0 - smoothstep(0.35 + folds * 0.5, 1.0, v));
          vec3 green = vec3(0.25, 1.0, 0.55);
          vec3 violet = vec3(0.6, 0.3, 1.0);
          vec3 col = mix(green, violet, smoothstep(0.3, 0.9, v));
          float a = body * rays * (0.35 + folds * 0.8) * uLevel * 0.45;
          a *= smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
          gl_FragColor = vec4(col * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  amat.userData.noShadow = true;
  for (let k = 0; k < 3; k++) {
    // a ribbon following an arc across the dome, hanging downward
    const seg = 64;
    const pos = [], uv = [], idx = [];
    const a0 = k * 2.1, span = 2.2;
    const R = G.globeR - 4 - k * 3;
    const yTop = G.globeY + 42 - k * 3;
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const a = a0 + span * u;
      const wob = Math.sin(u * 9 + k) * 2.5;
      const x = Math.cos(a) * (R * 0.62 + wob), z = Math.sin(a) * (R * 0.62 + wob);
      pos.push(x, yTop, z, x * 1.12, yTop - 11, z * 1.12);
      uv.push(u, 1, u, 0);
    }
    for (let i = 0; i < seg; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, amat);
    m.renderOrder = 30;
    m.frustumCulled = false;
    aurora.add(m);
  }
  group.add(aurora);

  // stars twinkling in the upper dome
  const nStars = hero ? 120 : 40;
  const stars = new GlowPoints(kit, nStars, { additive: true, soft: 0.5, name: 'stars' });
  const starData = [];
  for (let i = 0; i < nStars; i++) {
    const u = Math.random(), v = 0.35 + Math.random() * 0.6;
    const th = u * Math.PI * 2, ph = Math.acos(v);
    const r = G.globeR - 2.5;
    starData.push([Math.cos(th) * Math.sin(ph) * r, G.globeY + Math.cos(ph) * r, Math.sin(th) * Math.sin(ph) * r, Math.random() * 6, 0.35 + Math.random() * 0.7]);
  }
  group.add(stars.mesh);

  return {
    group,
    glass,
    collar,
    uniforms,
    update(t, night) {
      auroraU.uTime.value = t;
      auroraU.uLevel.value = THREE.MathUtils.clamp((night - 0.35) * 1.6, 0, 1);
      for (let i = 0; i < nStars; i++) {
        const s = starData[i];
        const tw = (0.6 + 0.4 * Math.sin(t * 2 + s[3])) * night;
        stars.set(i, s[0], s[1], s[2], 0.85 * tw, 0.9 * tw, 1.0 * tw, s[4]);
      }
      stars.commit(nStars);
    },
  };
}
