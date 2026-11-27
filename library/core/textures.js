import * as THREE from 'three';
import { mulberry32 } from './random.js';

/**
 * Procedural canvas textures: wood, gilt wear, painted panels, lettering.
 * Everything is generated at load time (no image files to fetch) and
 * disposed with the asset.
 */

/**
 * A 2D canvas (an OffscreenCanvas where there is one). `context` holds
 * attributes for its 2D context, e.g. { willReadFrequently: true } for a
 * canvas that is read back (kept on the CPU, so a read is a copy and not a
 * GPU round trip); a canvas's first getContext call fixes them.
 */
export function makeCanvas(w, h, context = undefined) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    if (c.getContext('2d', context)) return c;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  if (context) c.getContext('2d', context);
  return c;
}

export function canvasTexture(canvas, { srgb = true, repeat = null, anisotropy = 4, mipmaps = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = mipmaps;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

/** tileable value noise, grey, for roughness / wear maps */
export function noiseTexture(size = 256, { seed = 7, scale = 8, octaves = 4, contrast = 1, base = 0.5 } = {}) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rnd = mulberry32(seed);
  const grids = [];
  for (let o = 0; o < octaves; o++) {
    const n = scale << o;
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    grids.push({ n, g });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, tot = 0;
      for (const { n, g } of grids) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const a = g[(y0 % n) * n + (x0 % n)], b = g[(y0 % n) * n + ((x0 + 1) % n)];
        const c2 = g[((y0 + 1) % n) * n + (x0 % n)], d = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
        v += amp * (a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy);
        tot += amp;
        amp *= 0.5;
      }
      v = base + (v / tot - 0.5) * contrast;
      const k = Math.max(0, Math.min(255, v * 255));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(c, { srgb: false, repeat: [1, 1] });
}

/** long-grain wood (u along the grain), tileable horizontally */
export function woodTexture({ w = 1024, h = 256, base = '#5a2a18', dark = '#2e130a', light = '#7a3c22', seed = 3, figure = 1 } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // grain lines: wavy horizontal strokes
  for (let i = 0; i < 160 * figure; i++) {
    const y = rnd() * h;
    const amp = 2 + rnd() * 6;
    const freq = (1 + Math.floor(rnd() * 3)) * Math.PI * 2;
    const phase = rnd() * Math.PI * 2;
    ctx.strokeStyle = rnd() < 0.55 ? dark : light;
    ctx.globalAlpha = 0.05 + rnd() * 0.18;
    ctx.lineWidth = 0.6 + rnd() * 2.4;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const yy = y + Math.sin((x / w) * freq + phase) * amp + Math.sin((x / w) * freq * 3.1 + phase) * amp * 0.3;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // pores
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = dark;
  for (let i = 0; i < 2600; i++) ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 5, 1);
  ctx.globalAlpha = 1;
  return c;
}

/** simple lettering on a coloured ground */
export function lettering(lines, { w = 1024, h = 256, bg = '#2a1a10', fg = '#e8c27a', font = 'Georgia, "Times New Roman", serif', weight = '700', border = true, sizes = null, letterSpacing = 0 } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  } else ctx.clearRect(0, 0, w, h);
  if (border) {
    ctx.strokeStyle = fg;
    ctx.lineWidth = h * 0.03;
    ctx.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
    ctx.lineWidth = h * 0.01;
    ctx.strokeRect(h * 0.11, h * 0.11, w - h * 0.22, h - h * 0.22);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((line, i) => {
    const size = sizes ? sizes[i] : (h * 0.5) / n;
    ctx.font = `${weight} ${size}px ${font}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${letterSpacing}px`;
    ctx.fillText(line, w / 2, (h * (i + 0.5)) / n + (n === 1 ? h * 0.02 : 0));
  });
  return c;
}
