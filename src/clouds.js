/**
 * Module 2b: painted cumulus clouds.
 *
 * Studied from the sunflower still: light falls on the cloud as one big form
 * (whole lobes sink into a soft teal shadow), the shading inside is soft
 * watercolor washes with no hard lines, the values are close together and
 * pastel, and the fine bumpy detail lives only on the outline.
 *
 * So each cloud is a cluster of soft spheres ("puffs"). A GPU pass paints it
 * once at load time into a texture:
 *   - surface height = smooth union of the spheres, giving soft creases
 *   - normal = blend of that surface and a broad envelope, so the cloud is lit
 *     as one big volume with smaller lobes on top
 *   - each puff is shadowed by the puffs between it and the sun
 *   - the light value maps through the palette's cloud ramp, with faint brush grain
 * The painted textures go on far-away panels facing the viewer. At that
 * distance both eyes see the same image, so they read as solid in VR.
 */
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { COMMON_GLSL, rampGLSL } from './shaderlib.js';

const DEG = Math.PI / 180;
const MAX_PUFFS = 160;
// Degrees; azimuth 0 = straight ahead (-z). Off to the right, so the clouds
// out of the window split into a sunlit side and a shadow side like the stills.
export const SUN = { azimuth: 95, elevation: 38 };

function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = {
  //          texture        columns   height  puff r  peak spread
  tower: { size: [896, 784], cols: [6, 9], tall: 1.9, r: 0.20, spread: 0.22 },
  hero: { size: [896, 448], cols: [6, 9], tall: 0.9, r: 0.17, spread: 0.32 },
  small: { size: [448, 224], cols: [3, 5], tall: 0.7, r: 0.22, spread: 0.3 },
  bank: { size: [1280, 224], cols: [16, 22], tall: 0.5, r: 0.075, spread: 0.12, peaks: 3 },
};

/** Puff layout in abstract units: base line at y = 0, up is +y. */
function layoutPuffs(rng, k) {
  const cols = k.cols[0] + Math.floor(rng() * (k.cols[1] - k.cols[0] + 1));
  const peaks = Array.from({ length: k.peaks || 1 }, () => 0.2 + rng() * 0.6);
  const puffs = [];
  for (let i = 0; i < cols; i++) {
    const t = (i + 0.5) / cols;
    const profile = Math.max(...peaks.map((c) => Math.exp(-(((t - c) / k.spread) ** 2))));
    const x = t + (rng() - 0.5) * (0.6 / cols);
    const top = k.tall * (0.25 + 0.75 * profile) * (0.75 + 0.25 * rng());
    let r = k.r * (0.8 + 0.4 * rng()) * (0.75 + 0.45 * profile);
    let y = r * 0.3;
    for (let guard = 0; guard < 12; guard++) {
      puffs.push({ x: x + (rng() - 0.5) * r * 0.6, y, r });
      if (y + r >= top) break;
      y += r * (0.5 + 0.2 * rng());
      r *= 0.84 + 0.1 * rng();
    }
  }
  // Two rounds of cauliflower lobes on the upper and side edges.
  for (const scale of [0.45, 0.25]) {
    for (const p of puffs.slice()) {
      if (puffs.length >= MAX_PUFFS || rng() > 0.6) continue;
      const a = Math.PI * (0.05 + 0.9 * rng());
      puffs.push({ x: p.x + Math.cos(a) * p.r * 0.85, y: p.y + Math.sin(a) * p.r * 0.85, r: p.r * scale * (0.8 + 0.4 * rng()) });
    }
  }
  return puffs.slice(0, MAX_PUFFS);
}

/** Fit into the texture in pixels (y up): base line near the bottom, centred. */
function fitPuffs(puffs, w, h) {
  let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of puffs) {
    minX = Math.min(minX, p.x - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  const baseY = h * 0.07;
  const s = Math.min((w * 0.94) / (maxX - minX), (h * 0.95 - baseY) / maxY);
  const ox = (w - (maxX - minX) * s) / 2 - minX * s;
  for (const p of puffs) {
    p.x = p.x * s + ox;
    p.y = p.y * s + baseY;
    p.r *= s;
  }
  return { baseY, topY: baseY + maxY * s };
}

/** How much of each puff the rest of the cloud hides from the sun (0..1, 1 = fully lit). */
function puffLight(puffs, sun2, strength) {
  for (const p of puffs) {
    let occ = 0;
    for (let j = 1; j <= 6; j++) {
      const qx = p.x + sun2.x * p.r * 0.5 * j;
      const qy = p.y + sun2.y * p.r * 0.5 * j;
      for (const o of puffs) {
        if (o === p) continue;
        const d = Math.hypot(qx - o.x, qy - o.y);
        occ += Math.min(Math.max((o.r - d) / (o.r * 0.6), 0), 1) * 0.25;
      }
    }
    p.light = Math.exp(-occ * strength);
  }
}

const C = PALETTE.cloud;
const CLOUD_RAMP = [
  [0.0, C.bankDeep],
  [0.16, C.baseDeep],
  [0.3, C.base],
  [0.44, C.deep],
  [0.56, C.shade2],
  [0.68, C.shade],
  [0.82, C.lit],
  [0.97, C.light],
];

const bakeMaterial = new THREE.ShaderMaterial({
  blending: THREE.NoBlending,
  depthTest: false,
  depthWrite: false,
  uniforms: {
    puffs: { value: Array.from({ length: MAX_PUFFS }, () => new THREE.Vector4()) },
    count: { value: 0 },
    size: { value: new THREE.Vector2() },
    baseY: { value: 0 },
    topY: { value: 0 },
    sun: { value: new THREE.Vector3() },
    backlit: { value: 0 },
    dim: { value: 1 },
    seed: { value: 0 },
    softBase: { value: 2 },
    form: { value: new THREE.Vector4() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    #define MAX_PUFFS ${MAX_PUFFS}
    uniform vec4 puffs[MAX_PUFFS]; // x, y, radius (px, y up), light
    uniform int count;
    uniform vec2 size;
    uniform float baseY, topY, backlit, dim, seed, softBase;
    uniform vec4 form;             // centre x, centre y, half width, half height of the whole cloud (px)
    uniform vec3 sun;              // toward the sun, in the panel's frame
    varying vec2 vUv;
    ${COMMON_GLSL}
    ${rampGLSL('cloudRamp', CLOUD_RAMP)}

    float smax(float a, float b, float k) {
      float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
      return mix(a, b, h) + k * h * (1.0 - h);
    }

    void main() {
      vec2 p = vUv * size;
      float H = size.y;
      // Organic, slightly wandering outline.
      p += (vec2(fbm(p / H * 9.0 + seed), fbm(p / H * 9.0 + seed + 17.0)) - 0.5) * H * 0.025;

      float hgt = 0.0, env = 0.0, lightSum = 0.0, rSum = 0.0, wSum = 1e-5;
      for (int i = 0; i < MAX_PUFFS; i++) {
        if (i >= count) break;
        vec4 b = puffs[i];
        vec2 d = p - b.xy;
        float dd = dot(d, d);
        float q = b.z * b.z - dd;
        if (q > 0.0) {
          float s = sqrt(q);
          hgt = smax(hgt, s, b.z * 0.18);
          float w = s * s * s;
          lightSum += b.w * w;
          rSum += b.z * w;
          wSum += w;
        }
        // Broad form: the same puffs inflated and blended into one rounded mass.
        float R = b.z * 2.2;
        float qb = R * R - dd;
        if (qb > 0.0) env = smax(env, sqrt(qb), b.z);
      }
      float puffLit = wSum > 1e-4 ? lightSum / wSum : 1.0;
      float rDom = wSum > 1e-4 ? rSum / wSum : 1.0;
      // Soft creases where lobes meet.
      float crease = mix(0.8, 1.0, smoothstep(0.0, 0.55, hgt / rDom));

      // Three scales of form: the whole cloud as one rounded volume, the
      // blended masses, and the individual puffs on top.
      vec2 g = clamp((p - form.xy) / form.zw, -1.0, 1.0) * vec2(0.95, 0.6);
      vec3 nWhole = normalize(vec3(g, sqrt(max(1.0 - dot(g, g), 0.0)) + 0.15));
      vec3 nBroad = normalize(vec3(-dFdx(env), -dFdy(env), 1.0));
      vec3 nFine = normalize(vec3(-dFdx(hgt), -dFdy(hgt), 1.0));
      vec3 n = normalize(nWhole * 0.55 + nBroad * 0.2 + nFine * 0.35);

      float lambert = clamp(dot(n, sun) * 1.1 + 0.38, 0.0, 1.0); // soft wrap
      float vert = smoothstep(baseY, topY, p.y);
      float v = lambert * mix(0.45, 1.0, puffLit) * crease;
      v *= mix(0.72, 1.0, vert);                              // lower body sits in shadow
      // Backlit clouds get a bright rim where the surface turns away from you.
      v += backlit * pow(1.0 - n.z, 2.0) * 0.5;
      // Watercolor grain: soft, mostly horizontal strokes.
      v += (fbm(vec2(p.x / H * 14.0, p.y / H * 40.0) + seed) - 0.5) * 0.07;
      v = clamp(v * dim, 0.0, 1.0);

      vec3 c = cloudRamp(v);
      float alpha = smoothstep(0.0, H * 0.008, hgt);
      alpha *= smoothstep(baseY - 2.0, baseY + softBase, p.y); // flat base
      gl_FragColor = vec4(srgbToLinear(c), alpha);
    }
  `,
});
const bakeScene = new THREE.Scene();
bakeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMaterial));
const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function bakeCloud(renderer, { seed, kind, sunLocal }) {
  const k = KINDS[kind];
  const [w, h] = k.size;
  const rng = mulberry32(seed);
  const puffs = layoutPuffs(rng, k);
  const { baseY, topY } = fitPuffs(puffs, w, h);

  const sun2 = new THREE.Vector2(sunLocal.x, sunLocal.y);
  const sideways = sun2.length();
  puffLight(puffs, sun2.normalize(), sideways * 1.4);

  const u = bakeMaterial.uniforms;
  puffs.forEach((p, i) => u.puffs.value[i].set(p.x, p.y, p.r, p.light));
  u.count.value = puffs.length;
  u.size.value.set(w, h);
  u.baseY.value = baseY;
  u.topY.value = topY;
  u.sun.value.copy(sunLocal);
  u.backlit.value = Math.max(0, -sunLocal.z);
  u.dim.value = kind === 'bank' ? 0.8 : 1;
  u.seed.value = (seed % 97) * 0.37;
  u.softBase.value = kind === 'small' ? (topY - baseY) * 0.15 : 3;
  const minX = Math.min(...puffs.map((p) => p.x - p.r));
  const maxX = Math.max(...puffs.map((p) => p.x + p.r));
  u.form.value.set((minX + maxX) / 2, (baseY + topY) / 2, Math.max((maxX - minX) / 2, 1), Math.max((topY - baseY) / 2, 1));

  const target = new THREE.WebGLRenderTarget(w, h, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
    anisotropy: 4,
    depthBuffer: false,
  });
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(bakeScene, bakeCamera);
  renderer.setRenderTarget(previous);
  return { texture: target.texture, baseFrac: baseY / h, aspect: h / w };
}

function cloudMaterial(texture, haze) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      map: { value: texture },
      hazeColor: { value: new THREE.Color(PALETTE.sky[1][1]) },
      haze: { value: haze },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 hazeColor;
      uniform float haze;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(map, vUv);
        if (t.a < 0.004) discard;
        // Aerial perspective: distant clouds and cloud bases sink into the haze.
        vec3 c = mix(t.rgb, hazeColor, haze * (1.0 - 0.5 * vUv.y));
        gl_FragColor = vec4(c, t.a);
        #include <colorspace_fragment>
      }
    `,
  });
}

const direction = (az, el) => new THREE.Vector3(
  Math.sin(az * DEG) * Math.cos(el * DEG),
  Math.sin(el * DEG),
  -Math.cos(az * DEG) * Math.cos(el * DEG),
);

/** One cloud: azimuth/elevation of its base centre (degrees), angular width, distance. */
function makeCloud(renderer, { az, el, width, kind, dist, seed, haze = 0 }) {
  const mesh = new THREE.Mesh();
  const base = direction(az, el).multiplyScalar(dist);
  mesh.position.copy(base);
  mesh.lookAt(0, 0, 0); // face the viewer squarely so high clouds don't skew
  mesh.updateMatrixWorld();

  // Light the way a background painter does rather than physically: the sun
  // always rakes across the cloud from the side it is really on, slightly
  // above and in front, so every cloud shows a sunlit side and a shadow side.
  // (Physically, clouds toward the sun would be backlit and nearly black.)
  const physical = direction(SUN.azimuth, SUN.elevation).applyQuaternion(mesh.quaternion.clone().invert());
  const side = Math.sign(physical.x) || 1;
  const sunLocal = new THREE.Vector3(side * 0.78, 0.55, 0.12).normalize(); // x right, y up, z toward the viewer

  const { texture, baseFrac, aspect } = bakeCloud(renderer, { seed, kind, sunLocal });
  const w = 2 * dist * Math.tan((width * DEG) / 2);
  const h = w * aspect;
  mesh.geometry = new THREE.PlaneGeometry(w, h);
  mesh.material = cloudMaterial(texture, haze);
  mesh.translateY(h * (0.5 - baseFrac));
  mesh.name = `cloud-${kind}`;
  return mesh;
}

export function createClouds(renderer, seed = 7) {
  const group = new THREE.Group();
  group.name = 'clouds';
  const rng = mulberry32(seed);
  let s = seed * 1000;

  // Big set pieces, placed by hand for a good composition out of the window.
  const heroes = [
    { az: -28, el: 3.0, width: 40, kind: 'tower', dist: 2200 },
    { az: 32, el: 5.0, width: 30, kind: 'hero', dist: 2000 },
    { az: 78, el: 4.0, width: 34, kind: 'tower', dist: 2100 },
    { az: -85, el: 7.0, width: 28, kind: 'hero', dist: 1900 },
    { az: 135, el: 3.5, width: 36, kind: 'tower', dist: 2300 },
    { az: -140, el: 9.0, width: 26, kind: 'hero', dist: 1900 },
    { az: 180, el: 14.0, width: 22, kind: 'hero', dist: 1800 },
  ];
  for (const c of heroes) group.add(makeCloud(renderer, { ...c, seed: s++ }));

  // Small fair-weather clouds higher up.
  for (let i = 0; i < 14; i++) {
    group.add(makeCloud(renderer, {
      az: -180 + (i + rng() * 0.8) * (360 / 14),
      el: 22 + rng() * 30,
      width: 7 + rng() * 9,
      kind: 'small',
      dist: 1600 + rng() * 400,
      seed: s++,
    }));
  }

  // A low bank of cloud right along the horizon, all the way round.
  for (let i = 0; i < 9; i++) {
    group.add(makeCloud(renderer, {
      az: i * 40 + rng() * 14,
      el: 0.2,
      width: 46 + rng() * 10,
      kind: 'bank',
      dist: 2800,
      seed: s++,
      haze: 0.5,
    }));
  }
  return group;
}
