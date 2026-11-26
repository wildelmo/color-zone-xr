import * as THREE from 'three';
import { GlowPoints } from '../core/glowPoints.js';
import { T, edgeR, topHeight } from './terrain.js';
import { G } from './dimensions.js';

/**
 * Water on the island: the river in its ravine and the two little streams,
 * each spilling off the cliff as a waterfall that thins into drifting mist
 * on its way down to the snowy floor. Island-local coordinates except the
 * mist, which drifts in asset space.
 */
export function buildWater(kit, { lod }) {
  const hero = lod === 'hero';
  const group = new THREE.Group();
  group.name = 'water';
  const U = { uTime: { value: 0 } };
  const flowMat = (alphaScale) => {
    const m = kit.track(
      new THREE.ShaderMaterial({
        uniforms: U,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
          float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
          void main() {
            // streaks running down the fall (v), shimmering across it (u)
            float s = n(vec2(vUv.x * 9.0, vUv.y * 3.0 - uTime * 2.2)) * 0.6 + n(vec2(vUv.x * 23.0, vUv.y * 7.0 - uTime * 3.4)) * 0.4;
            float edge = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
            float fade = ${alphaScale > 0 ? '1.0 - smoothstep(0.35, 1.0, vUv.y)' : '1.0'};
            vec3 col = mix(vec3(0.42, 0.62, 0.78), vec3(0.95, 0.98, 1.0), smoothstep(0.45, 0.85, s));
            float a = edge * fade * (0.45 + 0.5 * s) * ${Math.abs(alphaScale).toFixed(2)};
            gl_FragColor = vec4(col, a);
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.userData.noShadow = true;
    return m;
  };
  const fallMat = flowMat(0.9);
  const riverMat = flowMat(-0.8);

  const falls = [];
  // the ravine river: a ribbon along the channel floor out to the cliff
  const addRiver = (angle, width, depth) => {
    const pts = [];
    const r0 = angle === T.ravineA ? T.tr[0] - 1 : T.edge - 7.5;
    const r1 = edgeR(angle) + 0.4;
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const r = r0 + ((r1 - r0) * i) / n;
      const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
      pts.push(new THREE.Vector3(x, topHeight(x, z) + depth, z));
    }
    const across = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const pos = [], uv = [], idx = [];
    pts.forEach((p, i) => {
      pos.push(p.x - across.x * width / 2, p.y, p.z - across.z * width / 2, p.x + across.x * width / 2, p.y, p.z + across.z * width / 2);
      uv.push(0, (i / n) * 4, 1, (i / n) * 4);
    });
    for (let i = 0; i < n; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, riverMat);
    m.renderOrder = 6;
    group.add(m);
    // the fall: arcs out over the lip then drops, widening and thinning
    const lip = pts[pts.length - 1];
    const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const fpos = [], fuv = [], fidx = [];
    const fn = 28;
    const drop = 28;
    for (let i = 0; i <= fn; i++) {
      const t = i / fn;
      const p = lip.clone().addScaledVector(out, 1.6 * Math.sqrt(t) + 0.6 * t).add(new THREE.Vector3(0, -drop * t * t - 0.5 * t, 0));
      const w = width * (1 + t * 1.6);
      fpos.push(p.x - across.x * w / 2, p.y, p.z - across.z * w / 2, p.x + across.x * w / 2, p.y, p.z + across.z * w / 2);
      fuv.push(0, t, 1, t);
    }
    for (let i = 0; i < fn; i++) fidx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fg.setIndex(fidx);
    const fm = new THREE.Mesh(fg, fallMat);
    fm.renderOrder = 7;
    group.add(fm);
    falls.push({ lip: lip.clone().addScaledVector(out, 1.4), out, width, drop });
  };
  addRiver(T.ravineA, 2.2, -0.05);
  for (const a of T.streams) addRiver(a, 0.9, 0.12);

  // mist: drifting soft puffs beneath each fall (asset space: islandY offset applied by caller)
  const perFall = hero ? 40 : 12;
  const mist = new GlowPoints(kit, perFall * falls.length, { additive: false, soft: 1.2, core: 0.0, opacity: 0.55, name: 'mist', renderOrder: 8 });
  const motes = [];
  falls.forEach((f, k) => {
    for (let i = 0; i < perFall; i++) motes.push({ f: k, t: Math.random(), seed: Math.random() * 100 });
  });
  return {
    group,
    falls,
    mist,
    update(t, dt) {
      U.uTime.value = t;
      motes.forEach((m, i) => {
        const f = falls[m.f];
        m.t += dt * 0.06;
        if (m.t > 1) m.t -= 1;
        // start near the bottom of the visible fall, then drift down and spread
        const y = f.lip.y + G.islandY - f.drop * 0.55 - m.t * 22;
        const spread = 1.5 + m.t * 7;
        const x = f.lip.x + f.out.x * (2 + m.t * 4) + Math.sin(m.seed + t * 0.3) * spread;
        const z = f.lip.z + f.out.z * (2 + m.t * 4) + Math.cos(m.seed * 1.3 + t * 0.25) * spread;
        const a = Math.sin(Math.PI * m.t) * (f.width > 1.5 ? 1 : 0.6);
        mist.set(i, x, y, z, 0.86, 0.92, 1.0, (2.5 + m.t * 7) * (f.width > 1.5 ? 1 : 0.6), a);
      });
      mist.commit(motes.length);
    },
  };
}
