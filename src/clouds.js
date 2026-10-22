/**
 * Module 2b: painted cumulus clouds.
 *
 * Each cloud is painted procedurally onto a canvas the way a background artist
 * paints one: a stack of overlapping puffs, each with a shaded body and a lit
 * cap on the sun side, upper puffs first so the lower ones overlap them with a
 * crisp edge. The bases are flat and fall into blue-grey shadow.
 * The canvases are placed far away on panels that face the viewer, so they
 * read as solid in VR (at that distance both eyes see the same image).
 */
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const DEG = Math.PI / 180;
export const SUN = { azimuth: -40, elevation: 55 }; // degrees; azimuth 0 = straight ahead (-z)

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
  //          canvas        columns   height  puff r  peak spread
  tower: { size: [1024, 896], cols: [6, 9], tall: 1.9, r: 0.20, spread: 0.22 },
  hero: { size: [1024, 512], cols: [6, 9], tall: 0.9, r: 0.17, spread: 0.32 },
  small: { size: [512, 256], cols: [3, 5], tall: 0.7, r: 0.22, spread: 0.3 },
  bank: { size: [1536, 256], cols: [16, 22], tall: 0.5, r: 0.075, spread: 0.12, peaks: 3 },
};

/** Puff layout in abstract units: base line at y = 0, up is -y (canvas style). */
function layoutPuffs(rng, k) {
  const cols = k.cols[0] + Math.floor(rng() * (k.cols[1] - k.cols[0] + 1));
  const peaks = Array.from({ length: k.peaks || 1 }, () => 0.2 + rng() * 0.6);
  const puffs = [];
  for (let i = 0; i < cols; i++) {
    const t = (i + 0.5) / cols;
    const profile = Math.max(...peaks.map((c) => Math.exp(-(((t - c) / k.spread) ** 2))));
    const x = t + (rng() - 0.5) * (0.6 / cols);
    const top = -k.tall * (0.25 + 0.75 * profile) * (0.75 + 0.25 * rng());
    let r = k.r * (0.8 + 0.4 * rng()) * (0.75 + 0.45 * profile);
    let y = -r * 0.3;
    for (let guard = 0; guard < 12; guard++) {
      puffs.push({ x: x + (rng() - 0.5) * r * 0.6, y, r });
      if (y - r <= top) break;
      y -= r * (0.5 + 0.2 * rng());
      r *= 0.84 + 0.1 * rng();
    }
  }
  // Cauliflower nubs along the upper edges.
  for (const p of puffs.slice()) {
    if (rng() < 0.55) {
      const a = -Math.PI * (0.15 + 0.7 * rng());
      puffs.push({ x: p.x + Math.cos(a) * p.r * 0.8, y: p.y + Math.sin(a) * p.r * 0.8, r: p.r * (0.3 + 0.2 * rng()) });
    }
  }
  return puffs;
}

/** Fit the layout into the canvas: base line near the bottom, centred horizontally. */
function fitPuffs(puffs, w, h) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (const p of puffs) {
    minX = Math.min(minX, p.x - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    minY = Math.min(minY, p.y - p.r);
  }
  const baseY = h * 0.93;
  const s = Math.min((w * 0.96) / (maxX - minX), (baseY - h * 0.03) / -minY);
  const ox = (w - (maxX - minX) * s) / 2 - minX * s;
  for (const p of puffs) {
    p.x = p.x * s + ox;
    p.y = p.y * s + baseY;
    p.r *= s;
  }
  return { baseY, topY: baseY + minY * s };
}

function paintCloud({ seed, kind, lightX = 0, backlit = 0 }) {
  const k = KINDS[kind];
  const [w, h] = k.size;
  const rng = mulberry32(seed);
  const C = PALETTE.cloud;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  const puffs = layoutPuffs(rng, k);
  const { baseY, topY } = fitPuffs(puffs, w, h);
  const span = baseY - topY;
  const bank = kind === 'bank';
  for (const p of puffs) {
    p.w1 = rng() * 6.28;
    p.w2 = rng() * 6.28;
  }

  // Upper puffs first; lower puffs overlap them.
  puffs.sort((a, b) => a.y - b.y);
  for (const p of puffs) {
    const v = (p.y - topY) / span; // 0 at the top of the cloud, 1 at the base
    const body = bank
      ? (v < 0.4 ? C.deep : v < 0.7 ? C.base : C.baseDeep)
      : (v < 0.3 ? C.shade : v < 0.55 ? C.shade2 : v < 0.78 ? C.deep : C.base);
    ctx.fillStyle = body;
    puffPath(ctx, p);
    ctx.fill();

    // Lit cap toward the sun, clipped to the puff so it never leaks outside.
    // Lower puffs keep a dimmer cap so the shadowed body still shows its puffs.
    const fade = 1 - smoothstep(bank ? 0.3 : 0.45, bank ? 0.8 : 0.9, v);
    const litStrength = (1 - 0.35 * backlit) * (bank ? fade : 0.3 + 0.7 * fade);
    if (litStrength <= 0.02) continue;
    const cx = p.x + lightX * p.r * 0.25;
    const cy = p.y - p.r * 0.3;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, p.r * 0.85);
    g.addColorStop(0, C.light);
    g.addColorStop(0.5, C.lit);
    g.addColorStop(0.8, C.lit);
    g.addColorStop(1, hexAlpha(C.lit, 0));
    ctx.save();
    puffPath(ctx, p);
    ctx.clip();
    ctx.globalAlpha = litStrength;
    ctx.fillStyle = g;
    ctx.fillRect(cx - p.r, cy - p.r, p.r * 2, p.r * 2);
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'source-atop';
  // Shadowed underside.
  const under = ctx.createLinearGradient(0, baseY - span * 0.25, 0, baseY);
  under.addColorStop(0, hexAlpha(C.baseDeep, 0));
  under.addColorStop(1, hexAlpha(bank ? C.bankDeep : C.baseDeep, 0.5));
  ctx.fillStyle = under;
  ctx.fillRect(0, baseY - span * 0.25, w, span * 0.25);

  // Faint brush strokes so the flat areas read as paint.
  const brush = [C.lit, C.shade, C.shade2, C.deep];
  for (let i = 0; i < (bank ? 500 : 700); i++) {
    const x = rng() * w;
    const y = topY + rng() * span;
    ctx.globalAlpha = 0.05 + rng() * 0.05;
    ctx.fillStyle = brush[Math.floor(rng() * brush.length)];
    ctx.beginPath();
    ctx.ellipse(x, y, h * (0.02 + rng() * 0.05), h * (0.004 + rng() * 0.01), (rng() - 0.5) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Flat base: fade out just below the base line (softer on small clouds).
  ctx.globalCompositeOperation = 'destination-out';
  const soft = kind === 'small' ? span * 0.12 : 2;
  const cut = ctx.createLinearGradient(0, baseY - soft, 0, baseY + 3);
  cut.addColorStop(0, 'rgba(0,0,0,0)');
  cut.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = cut;
  ctx.fillRect(0, baseY - soft, w, h - baseY + soft);
  ctx.globalCompositeOperation = 'source-over';

  return { canvas, baseFrac: baseY / h, aspect: h / w };
}

/** A slightly irregular, hand-drawn puff outline. */
function puffPath(ctx, p) {
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = p.r * (1 + 0.05 * Math.sin(3 * a + p.w1) + 0.03 * Math.sin(7 * a + p.w2));
    const x = p.x + Math.cos(a) * r;
    const y = p.y + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function smoothstep(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
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

/** One cloud: azimuth/elevation of its base centre (degrees), angular width, distance. */
function makeCloud({ az, el, width, kind, dist, seed, haze = 0 }) {
  const rel = ((az - SUN.azimuth + 540) % 360) - 180; // sun direction relative to this cloud
  const { canvas, baseFrac, aspect } = paintCloud({
    seed,
    kind,
    lightX: -Math.sin(rel * DEG),
    backlit: (1 - Math.cos(rel * DEG)) / 2,
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  const w = 2 * dist * Math.tan((width * DEG) / 2);
  const h = w * aspect;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), cloudMaterial(texture, haze));
  const base = new THREE.Vector3(
    Math.sin(az * DEG) * Math.cos(el * DEG),
    Math.sin(el * DEG),
    -Math.cos(az * DEG) * Math.cos(el * DEG),
  ).multiplyScalar(dist);
  mesh.position.copy(base);
  mesh.position.y += h * (baseFrac - 0.5);
  mesh.lookAt(0, 0, 0); // face the viewer squarely so high clouds don't skew
  mesh.name = `cloud-${kind}`;
  return mesh;
}

export function createClouds(seed = 7) {
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
  for (const c of heroes) group.add(makeCloud({ ...c, seed: s++ }));

  // Small fair-weather clouds higher up.
  for (let i = 0; i < 14; i++) {
    group.add(makeCloud({
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
    group.add(makeCloud({
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
