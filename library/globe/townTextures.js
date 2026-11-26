import { makeCanvas, canvasTexture } from '../core/textures.js';
import { mulberry32 } from '../core/random.js';

/**
 * Painted façade atlas for the town: 4 styles (columns) x 4 tile kinds (rows).
 * Each tile is one bay of one storey (~2.2 m x 3 m). A matching emissive
 * atlas lights only the window panes, so windows glow at night.
 *
 * rows (top to bottom in the canvas): 0 door bay, 1 ground window,
 * 2 upper window, 3 plain / small window
 */
export const ATLAS = { cols: 4, rows: 4 };

const STYLES = [
  { wall: '#e9dcc0', beam: '#4a2c1a', trim: '#4a2c1a', timber: true }, // cream timber-frame
  { wall: '#b9b2a6', beam: '#8d857a', trim: '#5d564c', stone: true }, // pale stone
  { wall: '#d9a59a', beam: '#f1e6d6', trim: '#f1e6d6' }, // rose plaster
  { wall: '#a9b7c4', beam: '#3c2a1e', trim: '#3c2a1e', timber: true }, // blue-grey timber
];

function windowShape(ctx, x, y, w, h, arch) {
  ctx.beginPath();
  if (arch) {
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + w / 2);
    ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, y + h);
  } else ctx.rect(x, y, w, h);
  ctx.closePath();
}

function drawWindow(ctx, emis, x, y, w, h, st, arch, rnd) {
  // frame
  ctx.fillStyle = st.trim;
  windowShape(ctx, x - 6, y - 6, w + 12, h + 12, arch);
  ctx.fill();
  // glass (dark by day)
  ctx.fillStyle = '#2a3442';
  windowShape(ctx, x, y, w, h, arch);
  ctx.fill();
  // panes glow at night
  const warm = rnd() < 0.15 ? '#ffd9a0' : '#ffbf66';
  emis.fillStyle = warm;
  windowShape(emis, x, y, w, h, arch);
  emis.fill();
  // mullions
  for (const c of [ctx, emis]) {
    c.fillStyle = c === ctx ? st.trim : '#000';
    c.fillRect(x + w / 2 - 3, y, 6, h);
    c.fillRect(x, y + h * 0.45, w, 5);
  }
  // shutters and a sill with a flower box (day only)
  ctx.fillStyle = rnd() < 0.5 ? '#3d5a3a' : '#6a2a22';
  ctx.fillRect(x - 6 - w * 0.42, y - 2, w * 0.4, h + 4);
  ctx.fillRect(x + w + 6 + 2, y - 2, w * 0.4, h + 4);
  ctx.fillStyle = st.trim;
  ctx.fillRect(x - 10, y + h + 6, w + 20, 8);
  if (rnd() < 0.6) {
    ctx.fillStyle = '#e8eef4'; // a little snow on the box
    ctx.fillRect(x - 6, y + h + 2, w + 12, 5);
  }
}

function tile(ctx, emis, col, row, rnd) {
  const S = 256;
  const x0 = col * S, y0 = row * S;
  const st = STYLES[col];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, S, S);
  ctx.clip();
  emis.save();
  emis.beginPath();
  emis.rect(x0, y0, S, S);
  emis.clip();
  emis.fillStyle = '#000';
  emis.fillRect(x0, y0, S, S);
  ctx.fillStyle = st.wall;
  ctx.fillRect(x0, y0, S, S);
  // plaster mottling / stone courses
  if (st.stone) {
    for (let yy = 0; yy < S; yy += 26) {
      const off = (yy / 26) % 2 ? 0 : 30;
      for (let xx = -60; xx < S; xx += 60) {
        ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '40,30,20'},${0.04 + rnd() * 0.08})`;
        ctx.fillRect(x0 + xx + off, y0 + yy, 58, 24);
      }
      ctx.fillStyle = 'rgba(60,50,40,0.35)';
      ctx.fillRect(x0, y0 + yy, S, 2);
    }
  } else {
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '80,60,40'},${0.03 + rnd() * 0.05})`;
      ctx.beginPath();
      ctx.arc(x0 + rnd() * S, y0 + rnd() * S, 6 + rnd() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // timber framing
  if (st.timber) {
    ctx.fillStyle = st.beam;
    ctx.fillRect(x0, y0, 14, S);
    ctx.fillRect(x0 + S - 14, y0, 14, S);
    ctx.fillRect(x0, y0 + S - 16, S, 16);
    ctx.fillRect(x0, y0, S, 10);
    if (row >= 2) {
      ctx.save();
      ctx.lineWidth = 12;
      ctx.strokeStyle = st.beam;
      ctx.beginPath();
      ctx.moveTo(x0 + 14, y0 + S - 16);
      ctx.lineTo(x0 + 70, y0 + 140);
      ctx.moveTo(x0 + S - 14, y0 + S - 16);
      ctx.lineTo(x0 + S - 70, y0 + 140);
      ctx.stroke();
      ctx.restore();
    }
  } else {
    ctx.fillStyle = st.trim;
    ctx.fillRect(x0, y0 + S - 10, S, 10);
  }
  const arch = col === 1;
  if (row === 0) {
    // door with a lantern-lit transom
    const dw = 84, dh = 150;
    const dx = x0 + (S - dw) / 2, dy = y0 + S - 16 - dh;
    ctx.fillStyle = st.trim;
    windowShape(ctx, dx - 8, dy - 8, dw + 16, dh + 8, true);
    ctx.fill();
    ctx.fillStyle = ['#5a3420', '#2f4a5a', '#6a2a22', '#3d5a3a'][Math.floor(rnd() * 4)];
    windowShape(ctx, dx, dy, dw, dh, true);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(dx + dw / 2 - 2, dy + 30, 4, dh - 30);
    ctx.fillStyle = '#d9a64c';
    ctx.beginPath();
    ctx.arc(dx + dw - 16, dy + dh * 0.6, 5, 0, Math.PI * 2);
    ctx.fill();
    emis.fillStyle = '#ffb35a';
    windowShape(emis, dx + 10, dy + 6, dw - 20, 30, true);
    emis.fill();
    ctx.fillStyle = '#ffcc80';
    windowShape(ctx, dx + 10, dy + 6, dw - 20, 30, true);
    ctx.fill();
  } else if (row === 1 || row === 2) {
    drawWindow(ctx, emis, x0 + 80, y0 + 64, 96, row === 1 ? 110 : 120, st, arch, rnd);
  } else {
    // small round window
    ctx.fillStyle = st.trim;
    ctx.beginPath();
    ctx.arc(x0 + S / 2, y0 + 110, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a3442';
    ctx.beginPath();
    ctx.arc(x0 + S / 2, y0 + 110, 26, 0, Math.PI * 2);
    ctx.fill();
    emis.fillStyle = '#ffbf66';
    emis.beginPath();
    emis.arc(x0 + S / 2, y0 + 110, 26, 0, Math.PI * 2);
    emis.fill();
  }
  ctx.restore();
  emis.restore();
}

export function facadeAtlas() {
  const S = 256;
  const c = makeCanvas(S * 4, S * 4);
  const e = makeCanvas(S * 4, S * 4);
  const ctx = c.getContext('2d');
  const emis = e.getContext('2d');
  const rnd = mulberry32(17);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) tile(ctx, emis, col, row, rnd);
  return { map: canvasTexture(c), emissive: canvasTexture(e) };
}

/** UV rect [u0, v0, u1, v1] of an atlas tile (v up, canvas flipped) */
export function tileUV(style, kind) {
  const pad = 0.004;
  const u0 = style / 4 + pad, u1 = (style + 1) / 4 - pad;
  const v1 = 1 - kind / 4 - pad, v0 = 1 - (kind + 1) / 4 + pad;
  return [u0, v0, u1, v1];
}

/** scalloped roof tiles (grey; tinted per roof by vertex colour) */
export function roofTiles() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(3);
  const rows = 8, cols = 8;
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k < cols + 1; k++) {
      const x = ((k + (r % 2) * 0.5) * S) / cols, y = (r * S) / rows;
      const v = 150 + rnd() * 70;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + S / cols, y);
      ctx.lineTo(x + S / cols, y + (S / rows) * 0.7);
      ctx.arc(x + S / cols / 2, y + (S / rows) * 0.7, S / cols / 2, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,40,40,0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

/** castle stone blocks (grey; tinted by vertex colour) */
export function stoneBlocks() {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b6b6b';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(5);
  const h = 32;
  for (let y = 0; y < S; y += h) {
    let x = (y / h) % 2 ? -30 : 0;
    while (x < S) {
      const w = 50 + rnd() * 40;
      const v = 150 + rnd() * 60;
      ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      // also draw the wrap-around copy so it tiles horizontally
      ctx.fillRect(x + 2 - S, y + 2, w - 4, h - 4);
      x += w;
    }
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

/** a rose window of stained glass */
export function roseWindow() {
  const S = 256;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.translate(S / 2, S / 2);
  const cols = ['#d23a3a', '#2a5ad8', '#e8c040', '#3aa860', '#9a4ad0', '#e87a2a'];
  for (let ring = 0; ring < 3; ring++) {
    const n = 8 * (ring + 1);
    const r0 = 20 + ring * 36, r1 = r0 + 34;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      ctx.fillStyle = cols[(i + ring * 2) % cols.length];
      ctx.beginPath();
      ctx.arc(0, 0, r1, a0, a1);
      ctx.arc(0, 0, r0, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1a1410';
      ctx.lineWidth = 4;
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#f2d483';
  ctx.beginPath();
  ctx.arc(0, 0, 20, 0, Math.PI * 2);
  ctx.fill();
  return canvasTexture(c);
}
