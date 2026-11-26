import * as THREE from 'three';
import { mulberry32 } from '../core/random.js';
import { T, STREETS, topHeight, angDist } from './terrain.js';

/**
 * Townsfolk in hooded winter cloaks, strolling the ring streets: they amble,
 * stop to chat or look in a window, and walk on. One
 * instanced mesh; each person's cloak takes its own colour (the face and
 * hands keep theirs).
 */
const CLOAKS = ['#7a2a2a', '#2f4a6a', '#3d5a3a', '#6a4a2a', '#5a3a6a', '#8a6a2a', '#3a3a4a', '#9a4a3a'];

export function buildTownfolk(kit, uniforms, townMaterial, { count = 26, seed = 7 } = {}) {
  if (!count) return null;
  const rnd = mulberry32(seed);
  // one figure, about 1.7 m tall: cloak (tinted per person), cape, head, hood, hands
  const parts = [];
  const add = (g, col, tint = 0) => parts.push({ g, col, tint });
  add(new THREE.CylinderGeometry(0.17, 0.36, 1.2, 9, 1).translate(0, 0.6, 0), '#ffffff', 1);
  add(new THREE.SphereGeometry(0.25, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.18, -0.02), '#ffffff', 1); // shoulders / cape
  add(new THREE.SphereGeometry(0.16, 9, 7).translate(0, 1.42, 0.02), '#e8c0a0');
  add(new THREE.ConeGeometry(0.21, 0.5, 9, 1, true).translate(0, 1.6, -0.03).rotateX(-0.12), '#ffffff', 0.8); // hood
  for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.06, 6, 4).translate(s * 0.2, 0.92, 0.14), '#e8c0a0');
  add(new THREE.BoxGeometry(0.34, 0.06, 0.02).translate(0, 1.22, 0.19), '#ffffff', 0.4); // scarf
  const geos = parts.map(({ g, col, tint }) => {
    const ng = g.toNonIndexed();
    g.dispose();
    ng.computeVertexNormals();
    const n = ng.attributes.position.count;
    const c = new THREE.Color(col);
    const ca = new Float32Array(n * 3), ta = new Float32Array(n).fill(tint);
    for (let i = 0; i < n; i++) ca.set([c.r, c.g, c.b], i * 3);
    ng.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    ng.setAttribute('tint', new THREE.BufferAttribute(ta, 1));
    return ng;
  });
  const total = geos.reduce((s, g) => s + g.attributes.position.count, 0);
  const geo = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ['tint', 1]]) {
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of geos) {
      arr.set(g.attributes[name].array, o);
      o += g.attributes[name].array.length;
    }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  geos.forEach((g) => g.dispose());

  const m = townMaterial(kit, { vertexColors: true, roughness: 0.85 }, uniforms, { build: false, snow: false });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    base(shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tint;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, tint);
        #endif`,
      );
  };
  m.customProgramCacheKey = () => 'town:folk';
  const mesh = new THREE.InstancedMesh(geo, m, count);
  mesh.name = 'town:folk';
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const hill = T.hill;
  const people = [];
  for (let i = 0; i < count; i++) {
    const ring = STREETS.rings[i % 3 === 2 ? 1 : 0];
    people.push({
      ring,
      a: rnd() * Math.PI * 2,
      dir: rnd() < 0.5 ? 1 : -1,
      speed: (0.9 + rnd() * 0.5) / ring.r, // about a metre a second
      side: (rnd() - 0.5) * ring.w * 0.7,
      phase: rnd() * 100,
      rest: 0.05 + rnd() * 0.12,
      s: 0.9 + rnd() * 0.15,
    });
    mesh.setColorAt(i, new THREE.Color(CLOAKS[Math.floor(rnd() * CLOAKS.length)]));
  }
  mesh.instanceColor.needsUpdate = true;

  const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let last = 0;
  return {
    mesh,
    people,
    update(t) {
      const dt = Math.min(0.1, Math.max(0, t - last));
      last = t;
      people.forEach((w, i) => {
        // amble, with pauses: speed eases to zero now and then
        const go = THREE.MathUtils.clamp(Math.sin(t * w.rest + w.phase) * 2.5 + 0.9, 0, 1);
        w.a += w.dir * w.speed * go * dt;
        const r = w.ring.r + w.side;
        const x = hill[0] + Math.cos(w.a) * r, z = hill[1] + Math.sin(w.a) * r;
        let y = topHeight(x, z);
        // the lower ring crosses the ravine on the bridge deck
        if (angDist(Math.atan2(z, x), T.ravineA) * Math.hypot(x, z) < T.ravineW + 0.8) y = Math.max(y, 0.4);
        const bob = go * Math.abs(Math.sin(t * 7 + w.phase)) * 0.05;
        p.set(x, y + bob, z);
        // face along the street (tangent, in the walking direction), swaying a little
        const yaw = Math.atan2(-Math.sin(w.a) * w.dir, Math.cos(w.a) * w.dir);
        q.setFromAxisAngle(up, yaw + Math.sin(t * 3.5 + w.phase) * 0.06 * go);
        sc.setScalar(w.s);
        mm.compose(p, q, sc);
        mesh.setMatrixAt(i, mm);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
