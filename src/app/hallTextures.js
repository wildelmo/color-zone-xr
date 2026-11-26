import { makeCanvas, canvasTexture, woodTexture } from '../../library/core/textures.js';
import { mulberry32 } from '../../library/core/random.js';

/** herringbone parquet */
export function parquet() {
  const s = 1024;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const wood = woodTexture({ w: 512, h: 96, base: '#5b3520', dark: '#2f190c', light: '#7a4a2c', seed: 31 });
  const rnd = mulberry32(4);
  ctx.fillStyle = '#2a170c';
  ctx.fillRect(0, 0, s, s);
  const L = 256, W = 64;
  for (let row = -4; row < 20; row++) {
    for (let col = -4; col < 12; col++) {
      for (const dir of [0, 1]) {
        ctx.save();
        const x = col * L * 0.5 * 2 + (dir ? W : 0) + row * W;
        const y = row * W * 2 - col * 0;
        ctx.translate(x, y);
        ctx.rotate(dir ? -Math.PI / 4 : Math.PI / 4);
        ctx.globalAlpha = 1;
        ctx.drawImage(wood, rnd() * 256, rnd() * 40, 256, 56, 0, 0, L * 0.7, W * 0.7);
        ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,210,160' : '20,10,4'},${rnd() * 0.12})`;
        ctx.fillRect(0, 0, L * 0.7, W * 0.7);
        ctx.strokeStyle = 'rgba(15,8,3,0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, 0, L * 0.7, W * 0.7);
        ctx.restore();
      }
    }
  }
  return canvasTexture(c, { repeat: [7, 7], anisotropy: 8 });
}

/** round rug: crimson field, gold rings and a medallion */
export function rug() {
  const s = 1024;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  ctx.translate(s / 2, s / 2);
  const ring = (r, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  };
  ring(512, '#9a7a3c');
  ring(500, '#2a0a0c');
  ring(470, '#9a7a3c');
  ring(462, '#4e1215');
  // border pattern
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = i % 2 ? '#a8894a' : '#173a37';
    ctx.beginPath();
    ctx.moveTo(0, -470);
    ctx.lineTo(14, -486);
    ctx.lineTo(0, -500);
    ctx.lineTo(-14, -486);
    ctx.fill();
    ctx.restore();
  }
  ring(400, '#9a7a3c');
  ring(392, '#5a1518');
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.fillStyle = '#3a0c0e';
    ctx.beginPath();
    ctx.ellipse(0, -250, 40, 110, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9a7a3c';
    ctx.beginPath();
    ctx.ellipse(0, -250, 14, 70, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ring(120, '#9a7a3c');
  ring(108, '#173a37');
  ring(60, '#9a7a3c');
  // wool fuzz
  const rnd = mulberry32(2);
  for (let i = 0; i < 9000; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 500;
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,230,200' : '0,0,0'},0.06)`;
    ctx.fillRect(Math.cos(a) * r, Math.sin(a) * r, 2, 2);
  }
  return canvasTexture(c, { anisotropy: 8 });
}

/** dark green damask wallpaper (tileable) */
export function wallpaper() {
  const w = 256, h = 512;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#11231f';
  ctx.fillRect(0, 0, w, h);
  const motif = (x, y, s) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = '#183530';
    ctx.beginPath();
    ctx.moveTo(0, -120);
    ctx.bezierCurveTo(60, -80, 70, -20, 20, 10);
    ctx.bezierCurveTo(70, 40, 60, 100, 0, 130);
    ctx.bezierCurveTo(-60, 100, -70, 40, -20, 10);
    ctx.bezierCurveTo(-70, -20, -60, -80, 0, -120);
    ctx.fill();
    ctx.fillStyle = '#11231f';
    ctx.beginPath();
    ctx.ellipse(0, 10, 16, 40, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7a6a3a';
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(0, -70, 6, 0, Math.PI * 2);
    ctx.arc(0, 80, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  motif(128, 128, 0.8);
  motif(0, 384, 0.8);
  motif(256, 384, 0.8);
  // stripes
  ctx.fillStyle = 'rgba(180,150,80,0.12)';
  ctx.fillRect(62, 0, 2, h);
  ctx.fillRect(192, 0, 2, h);
  return canvasTexture(c, { repeat: [56, 6] });
}

export function panelWood() {
  const c = woodTexture({ w: 1024, h: 256, base: '#3e2012', dark: '#1d0c05', light: '#5a3019', seed: 17 });
  return canvasTexture(c, { repeat: [10, 1] });
}

/** radial pool of light for the floor (additive) */
export function lightPool() {
  const s = 256;
  const c = makeCanvas(s, s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,214,150,0.32)');
  g.addColorStop(0.45, 'rgba(255,190,120,0.12)');
  g.addColorStop(1, 'rgba(255,170,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return canvasTexture(c);
}
