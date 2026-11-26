import { makeCanvas, canvasTexture, woodTexture, lettering } from '../core/textures.js';
import { mulberry32 } from '../core/random.js';

/**
 * Hand-"painted" panels for the carousel, drawn procedurally on canvases:
 * pastoral scenes for the rounding boards, floral panels for the centre
 * column, the striped roof, the sunburst ceiling and the plank deck.
 */

const GOLD = '#d7a94e';
const CREAM = '#efe1c0';
const RED = '#8c1c1e';

function vgrad(ctx, x, y, h, stops) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

function hills(ctx, x, y, w, h, color, rnd, amp, base) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  const n = 6;
  const ph = rnd() * 6;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const yy = y + h * base - Math.sin(t * n + ph) * amp * h * 0.5 - Math.sin(t * n * 2.3 + ph * 2) * amp * h * 0.18;
    ctx.lineTo(x + t * w, yy);
  }
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

function tree(ctx, x, y, s, dark, light) {
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(x - s * 0.06, y - s * 0.5, s * 0.12, s * 0.5);
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(x, y - s * 0.75, s * 0.32, s * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(x - s * 0.1, y - s * 0.85, s * 0.16, s * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function castle(ctx, x, y, s) {
  ctx.fillStyle = '#d9cdb5';
  ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s * 0.5);
  for (const tx of [-0.5, 0.3]) {
    ctx.fillRect(x + tx * s, y - s * 0.95, s * 0.22, s * 0.95);
    ctx.fillStyle = '#7a2a2a';
    ctx.beginPath();
    ctx.moveTo(x + tx * s - s * 0.04, y - s * 0.95);
    ctx.lineTo(x + tx * s + s * 0.11, y - s * 1.25);
    ctx.lineTo(x + tx * s + s * 0.26, y - s * 0.95);
    ctx.fill();
    ctx.fillStyle = '#d9cdb5';
  }
  ctx.fillStyle = '#3a2a2a';
  ctx.fillRect(x - s * 0.08, y - s * 0.25, s * 0.16, s * 0.25);
}

/** one pastoral vignette into the rectangle */
function scene(ctx, x, y, w, h, variant, rnd) {
  const skies = [
    [[0, '#7fa7c9'], [0.6, '#e9d3a6'], [1, '#f2c48c']],
    [[0, '#5e7fb0'], [0.7, '#cfd8d2'], [1, '#efe2c2']],
    [[0, '#c98a6a'], [0.5, '#f0c690'], [1, '#f7e3b0']],
    [[0, '#6d93a8'], [0.65, '#d8e0c8'], [1, '#eedfb7']],
  ];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = vgrad(ctx, x, y, h, skies[variant % 4]);
  ctx.fillRect(x, y, w, h);
  // clouds
  ctx.fillStyle = 'rgba(255,250,240,0.7)';
  for (let i = 0; i < 4; i++) {
    const cx = x + rnd() * w, cy = y + h * (0.12 + rnd() * 0.25);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse(cx + k * w * 0.03, cy + Math.sin(k) * h * 0.02, w * 0.05, h * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  hills(ctx, x, y, w, h, '#8aa07a', rnd, 0.25, 0.62);
  if (variant % 2 === 0) {
    // lake
    ctx.fillStyle = vgrad(ctx, x, y + h * 0.66, h * 0.14, [[0, '#9fbcd0'], [1, '#6f93ad']]);
    ctx.beginPath();
    ctx.ellipse(x + w * 0.55, y + h * 0.74, w * 0.3, h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (variant === 1 || variant === 3) castle(ctx, x + w * (variant === 1 ? 0.7 : 0.3), y + h * 0.6, h * 0.28);
  hills(ctx, x, y, w, h, '#5f7d4e', rnd, 0.2, 0.8);
  for (let i = 0; i < 5; i++) tree(ctx, x + w * (0.08 + rnd() * 0.84), y + h * (0.78 + rnd() * 0.12), h * (0.22 + rnd() * 0.12), '#3f5f36', '#6f8f4f');
  if (variant === 2) {
    // windmill
    const mx = x + w * 0.72, my = y + h * 0.62;
    ctx.fillStyle = '#e6d8bc';
    ctx.beginPath();
    ctx.moveTo(mx - h * 0.06, my);
    ctx.lineTo(mx - h * 0.04, my - h * 0.25);
    ctx.lineTo(mx + h * 0.04, my - h * 0.25);
    ctx.lineTo(mx + h * 0.06, my);
    ctx.fill();
    ctx.strokeStyle = '#5a3a2a';
    ctx.lineWidth = h * 0.012;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(mx, my - h * 0.25);
      ctx.lineTo(mx + Math.cos(a) * h * 0.18, my - h * 0.25 + Math.sin(a) * h * 0.18);
      ctx.stroke();
    }
  }
  // birds
  ctx.strokeStyle = 'rgba(60,40,40,0.6)';
  ctx.lineWidth = h * 0.008;
  for (let i = 0; i < 3; i++) {
    const bx = x + w * (0.2 + rnd() * 0.6), by = y + h * (0.2 + rnd() * 0.2), s = h * 0.03;
    ctx.beginPath();
    ctx.moveTo(bx - s, by);
    ctx.quadraticCurveTo(bx - s * 0.5, by - s * 0.6, bx, by);
    ctx.quadraticCurveTo(bx + s * 0.5, by - s * 0.6, bx + s, by);
    ctx.stroke();
  }
  // varnish vignette
  const vg = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.2, x + w / 2, y + h / 2, w * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(60,30,10,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** 2x2 atlas of landscape vignettes (each cell 512x256) */
export function sceneAtlas() {
  const c = makeCanvas(1024, 512);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(42);
  for (let i = 0; i < 4; i++) scene(ctx, (i % 2) * 512, Math.floor(i / 2) * 256, 512, 256, i, rnd);
  return canvasTexture(c);
}

/** floral column panels: 2 tall cells (each 256x1024) */
export function floralAtlas() {
  const c = makeCanvas(512, 1024);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(9);
  for (let v = 0; v < 2; v++) {
    const x = v * 256, w = 256, h = 1024;
    ctx.fillStyle = v === 0 ? '#1f4d4a' : '#5a1517';
    ctx.fillRect(x, 0, w, h);
    ctx.fillStyle = vgrad(ctx, x, 0, h, [[0, 'rgba(255,240,200,0.12)'], [0.5, 'rgba(255,240,200,0)'], [1, 'rgba(0,0,0,0.2)']]);
    ctx.fillRect(x, 0, w, h);
    // gold inner border
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 14, 14, w - 28, h - 28);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 24, 24, w - 48, h - 48);
    // twining vine up the middle
    const cx = x + w / 2;
    ctx.strokeStyle = '#c99a45';
    ctx.lineWidth = 7;
    ctx.beginPath();
    for (let yy = h - 80; yy > 120; yy -= 6) {
      const xx = cx + Math.sin(yy / 70) * 38;
      if (yy === h - 80) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    // leaves and blossoms
    for (let yy = h - 110; yy > 140; yy -= 46) {
      const xx = cx + Math.sin(yy / 70) * 38;
      const side = Math.sin(yy / 70 + 1.2) > 0 ? 1 : -1;
      ctx.fillStyle = '#6f9a52';
      ctx.beginPath();
      ctx.ellipse(xx + side * 34, yy, 30, 12, side * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#9fc070';
      ctx.beginPath();
      ctx.ellipse(xx + side * 34, yy - 3, 16, 5, side * 0.5, 0, Math.PI * 2);
      ctx.fill();
      if (rnd() < 0.55) {
        const fx = xx - side * 30, fy = yy - 18;
        const col = ['#e8a0a8', '#f3e2b0', '#d8606a', '#f0c070'][Math.floor(rnd() * 4)];
        for (let p = 0; p < 6; p++) {
          const a = (p / 6) * Math.PI * 2;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.ellipse(fx + Math.cos(a) * 11, fy + Math.sin(a) * 11, 9, 6, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#f5d36a';
        ctx.beginPath();
        ctx.arc(fx, fy, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // urn at the bottom, sunburst medallion at the top
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(cx - 50, h - 60);
    ctx.quadraticCurveTo(cx - 70, h - 130, cx - 30, h - 150);
    ctx.lineTo(cx + 30, h - 150);
    ctx.quadraticCurveTo(cx + 70, h - 130, cx + 50, h - 60);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(cx - 40, h - 64, 80, 14);
    ctx.save();
    ctx.translate(cx, 110);
    for (let r = 0; r < 16; r++) {
      ctx.rotate(Math.PI / 8);
      ctx.fillStyle = r % 2 ? GOLD : '#f1d58c';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-9, -60);
      ctx.lineTo(9, -60);
      ctx.fill();
    }
    ctx.fillStyle = v === 0 ? '#1f4d4a' : '#5a1517';
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return canvasTexture(c);
}

/**
 * Roof tile: two gores (cream + red), v = 0 at the eaves. Repeated round the
 * lathe so each gore narrows naturally toward the crown.
 */
export function roofTexture() {
  const w = 512, h = 1024;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  for (let g = 0; g < 2; g++) {
    const x = g * 256;
    ctx.fillStyle = g === 0 ? CREAM : RED;
    ctx.fillRect(x, 0, 256, h);
    // soft shading across each gore (tent canvas sag)
    const sg = ctx.createLinearGradient(x, 0, x + 256, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0.18)');
    sg.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    sg.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = sg;
    ctx.fillRect(x, 0, 256, h);
    // painted swag + fleur near the eaves
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x + 10, h - 150);
    ctx.quadraticCurveTo(x + 128, h - 60, x + 246, h - 150);
    ctx.stroke();
    ctx.fillStyle = g === 0 ? RED : CREAM;
    const fx = x + 128, fy = h - 230;
    ctx.beginPath();
    ctx.moveTo(fx, fy - 70);
    ctx.quadraticCurveTo(fx + 26, fy - 30, fx + 6, fy + 10);
    ctx.quadraticCurveTo(fx + 50, fy - 20, fx + 54, fy + 20);
    ctx.quadraticCurveTo(fx + 30, fy + 26, fx + 8, fy + 36);
    ctx.lineTo(fx - 8, fy + 36);
    ctx.quadraticCurveTo(fx - 30, fy + 26, fx - 54, fy + 20);
    ctx.quadraticCurveTo(fx - 50, fy - 20, fx - 6, fy + 10);
    ctx.quadraticCurveTo(fx - 26, fy - 30, fx, fy - 70);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.fillRect(fx - 30, fy + 40, 60, 10);
    // pinstripes along the seams
    ctx.fillStyle = GOLD;
    ctx.fillRect(x + 4, 0, 5, h);
    ctx.fillRect(x + 247, 0, 5, h);
    // band at the eaves
    ctx.fillStyle = g === 0 ? RED : '#5a1314';
    ctx.fillRect(x, h - 40, 256, 40);
    ctx.fillStyle = GOLD;
    ctx.fillRect(x, h - 44, 256, 6);
  }
  const t = canvasTexture(c, { repeat: [12, 1] });
  t.wrapT = 1001; // ClampToEdge
  return t;
}

/** radial sunburst for the canopy ceiling (RingGeometry planar UVs) */
export function ceilingTexture() {
  const s = 1024;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  ctx.translate(s / 2, s / 2);
  const rays = 48;
  for (let i = 0; i < rays; i++) {
    const a0 = (i / rays) * Math.PI * 2, a1 = ((i + 1) / rays) * Math.PI * 2;
    ctx.fillStyle = i % 2 ? '#e9d6ae' : '#a3282b';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, s * 0.5, a0, a1);
    ctx.closePath();
    ctx.fill();
  }
  for (const [r, col, lw] of [[0.47, GOLD, 10], [0.33, GOLD, 6], [0.18, GOLD, 8]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(0, 0, s * r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // little stars between the rings
  ctx.fillStyle = '#f2d483';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = s * 0.4;
    star(ctx, Math.cos(a) * r, Math.sin(a) * r, 12, 5);
  }
  return canvasTexture(c);
}

function star(ctx, x, y, r, n) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/** deck planks: u = around (planks), v = radius (grain) */
export function deckTexture() {
  const w = 512, h = 512;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const wood = woodTexture({ w: 512, h: 128, base: '#8a5a34', dark: '#5a3418', light: '#a87444', seed: 21 });
  const planks = 8;
  const pw = w / planks;
  const rnd = mulberry32(5);
  for (let i = 0; i < planks; i++) {
    ctx.save();
    ctx.translate(i * pw + pw / 2, h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(wood, -h / 2 - 60 - rnd() * 200, -pw / 2 - rnd() * 40, h + 320, pw + 80);
    ctx.restore();
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,220,170' : '40,20,10'},${0.05 + rnd() * 0.08})`;
    ctx.fillRect(i * pw, 0, pw, h);
    ctx.fillStyle = 'rgba(30,15,6,0.85)';
    ctx.fillRect(i * pw, 0, 2, h);
    // nail heads near both ends
    ctx.fillStyle = 'rgba(40,30,20,0.9)';
    for (const yy of [24, h - 24]) {
      ctx.beginPath();
      ctx.arc(i * pw + pw * 0.3, yy, 2.2, 0, Math.PI * 2);
      ctx.arc(i * pw + pw * 0.7, yy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = canvasTexture(c, { repeat: [6, 1] });
  return t;
}

/** mahogany for the plinth (u around) */
export function plinthWoodTexture() {
  const c = woodTexture({ w: 1024, h: 256, base: '#4e1d10', dark: '#260b05', light: '#6e2c18', seed: 8 });
  return canvasTexture(c, { repeat: [6, 1] });
}

export function nameBoard(text, sub) {
  const c = lettering(sub ? [text, sub] : [text], { w: 1024, h: 192, bg: '#5a1314', fg: '#efc56a', sizes: sub ? [74, 34] : [88], letterSpacing: 6 });
  return canvasTexture(c);
}

/** the organ facade: arched panels with gilded fretwork, painted cream */
export function organFacadeTexture() {
  const w = 512, h = 512;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 150;
    ctx.fillStyle = i === 1 ? '#5a1314' : '#1f4d4a';
    ctx.beginPath();
    ctx.moveTo(x, h - 40);
    ctx.lineTo(x, 180);
    ctx.arc(x + 60, 180, 60, Math.PI, 0);
    ctx.lineTo(x + 120, h - 40);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.stroke();
    // fretwork lattice
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(215,169,78,0.75)';
    ctx.lineWidth = 3;
    for (let k = -10; k < 20; k++) {
      ctx.beginPath();
      ctx.moveTo(x + k * 20, 100);
      ctx.lineTo(x + k * 20 + 200, h);
      ctx.moveTo(x + k * 20 + 200, 100);
      ctx.lineTo(x + k * 20, h);
      ctx.stroke();
    }
    ctx.restore();
  }
  return canvasTexture(c);
}
