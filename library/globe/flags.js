import * as THREE from 'three';

/**
 * Cloth that moves in the wind: pennants on the tower finials and long
 * banners on the gatehouse, all in one mesh. Each vertex knows how far it
 * is from the pole and which way its cloth faces, and the vertex shader
 * ripples it (more toward the free end) on the town's clock.
 *
 * spec: { p: pole point, along: unit vector the cloth hangs/flies along
 *         from the pole, across: unit vector of its other side (down for
 *         pennants, sideways for banners), len, wid, colors: [field, trim],
 *         pattern: 'pennant' | 'banner', phase }
 */
export function buildFlags(kit, uniforms, townMaterial, specs) {
  if (!specs.length) return null;
  const pos = [], nor = [], col = [], idx = [], amp = [], wdir = [];
  const segU = 8, segV = 3;
  const cA = new THREE.Color(), cB = new THREE.Color();
  for (const s of specs) {
    const n = new THREE.Vector3().crossVectors(s.along, s.across).normalize();
    cA.set(s.colors[0]);
    cB.set(s.colors[1]);
    const base = pos.length / 3;
    for (let j = 0; j <= segV; j++) {
      for (let i = 0; i <= segU; i++) {
        const u = i / segU, v = j / segV;
        let w = s.wid;
        // pennants taper to a swallowtail-ish point; banners end in a V
        if (s.pattern === 'pennant') w = s.wid * (1 - 0.65 * u);
        const vv = (v - 0.5) * w;
        let lu = u * s.len;
        if (s.pattern === 'banner') lu -= Math.abs(v - 0.5) * s.wid * 0.5 * (u > 0.85 ? 1 : 0); // notched end
        const p = s.p.clone().addScaledVector(s.along, lu).addScaledVector(s.across, s.pattern === 'banner' ? vv : v * w);
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        // a border stripe in the trim colour, the field inside
        const trim = s.pattern === 'banner' ? Math.abs(v - 0.5) > 0.36 || u > 0.9 || (u > 0.38 && u < 0.5) : v < 0.25 || v > 0.75;
        const c = trim ? cB : cA;
        col.push(c.r, c.g, c.b);
        amp.push(s.pattern === 'banner' ? u * 0.5 : u);
        wdir.push(n.x, n.y, n.z, s.phase);
      }
    }
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const a = base + j * (segU + 1) + i, b = a + 1, c = a + segU + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('flagAmp', new THREE.Float32BufferAttribute(amp, 1));
  g.setAttribute('flagDir', new THREE.Float32BufferAttribute(wdir, 4));
  g.setIndex(idx);
  const m = townMaterial(kit, { vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, uniforms, { build: false, snow: false });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    base(shader, r);
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float flagAmp;\nattribute vec4 flagDir;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float ph = flagDir.w;
          float wave = sin(uTime * 3.2 + flagAmp * 7.0 + ph) * 0.7 + sin(uTime * 5.1 + flagAmp * 13.0 + ph * 1.7) * 0.3;
          transformed += flagDir.xyz * wave * flagAmp * 0.32;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'town:flags';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'town:flags';
  mesh.castShadow = true;
  return mesh;
}
