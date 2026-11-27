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

// --------------------------------------------------------------- surfaces
// Pixel-built, tileable surface textures with matching normal maps, so the
// stonework, roof tiles and timber catch the light like the real thing when
// the town is blown up and you lean right in.

// random lattices for the value noise, made once per (period, seed)
const LATTICES = new Map();
function lattice(p, seed) {
  const key = p * 4096 + seed;
  let g = LATTICES.get(key);
  if (!g) {
    g = new Float32Array(p * p);
    const rnd = mulberry32(seed * 7919 + p);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    LATTICES.set(key, g);
  }
  return g;
}
/** tileable value noise on a period-p grid */
function vnoise(x, y, p, seed) {
  p = Math.max(1, Math.round(p));
  const g = lattice(p, seed);
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p;
  const x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
  const a = g[y0 * p + x0], b = g[y0 * p + x1], c = g[y1 * p + x0], d = g[y1 * p + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, p, seed, oct = 3) {
  let s = 0, amp = 0.5, tot = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(x, y, p, seed + o * 13);
    tot += amp;
    x *= 2;
    y *= 2;
    p *= 2;
    amp *= 0.5;
  }
  return s / tot;
}

// finished surface canvases, kept so bringing the globe back out is instant
const SURFACES = new Map();

/** colour (sRGB) and normal (linear) textures from per-pixel callbacks */
function surface(name, S, fn, { strength = 4, repeat = [1, 1] } = {}) {
  const done = SURFACES.get(name);
  if (done) return { map: canvasTexture(done.col, { repeat }), normal: canvasTexture(done.nor, { repeat, srgb: false }) };
  const col = makeCanvas(S, S), nor = makeCanvas(S, S);
  const cctx = col.getContext('2d'), nctx = nor.getContext('2d');
  const ci = cctx.createImageData(S, S), ni = nctx.createImageData(S, S);
  const H = new Float32Array(S * S);
  const out = [0, 0, 0, 0];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      fn(x, y, out);
      const i = (y * S + x) * 4;
      ci.data[i] = out[0];
      ci.data[i + 1] = out[1];
      ci.data[i + 2] = out[2];
      ci.data[i + 3] = 255;
      H[y * S + x] = out[3];
    }
  }
  // normals from the height field (wrapping, so they tile); canvas y runs down, v runs up
  const k = 0.5 * strength;
  for (let y = 0; y < S; y++) {
    const yu = ((y - 1 + S) % S) * S, yd = ((y + 1) % S) * S, yc = y * S;
    for (let x = 0; x < S; x++) {
      const xl = (x - 1 + S) % S, xr = (x + 1) % S;
      const dx = (H[yc + xr] - H[yc + xl]) * k;
      const dy = (H[yd + x] - H[yu + x]) * k;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (y * S + x) * 4;
      ni.data[i] = (nx * 0.5 + 0.5) * 255;
      ni.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      ni.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      ni.data[i + 3] = 255;
    }
  }
  cctx.putImageData(ci, 0, 0);
  nctx.putImageData(ni, 0, 0);
  SURFACES.set(name, { col, nor });
  return { map: canvasTexture(col, { repeat }), normal: canvasTexture(nor, { repeat, srgb: false }) };
}

/** split a row of length S into block widths between lo and hi that sum to S */
function rowCuts(S, lo, hi, rnd) {
  const ws = [];
  let t = 0;
  while (t < S) {
    const w = lo + rnd() * (hi - lo);
    ws.push(w);
    t += w;
  }
  const k = S / t;
  const cuts = [0];
  for (const w of ws) cuts.push(cuts[cuts.length - 1] + w * k);
  return cuts;
}

/**
 * Roof tiles: rounded scallops in staggered rows, each lip standing proud
 * of the row below (grey; tinted per roof by vertex colour). Canvas-down is
 * down the slope.
 */
export function roofTiles() {
  const S = 256, rows = 8, cols = 8;
  const rh = S / rows, cw = S / cols;
  const shade = [];
  const rnd = mulberry32(3);
  for (let i = 0; i < rows * (cols + 1); i++) shade.push(0.78 + rnd() * 0.3);
  return surface(
    'roof',
    S,
    (x, y, out) => {
      // the topmost tile covering this pixel: tiles hang down 1.25 rows, upper rows lie over lower ones
      let best = null;
      for (const dr of [0, 1]) {
        const r = Math.floor(y / rh) - dr;
        const ty = (y - r * rh) / rh; // 0 at the tile's top, ~1.25 at its lip
        const off = (((r % 2) + 2) % 2) * 0.5;
        const c = Math.floor(x / cw - off);
        const tx = x / cw - off - c; // 0..1 across the tile
        const lip = 0.95 + 0.3 * Math.sqrt(Math.max(0, 1 - (2 * tx - 1) ** 2)); // rounded bottom edge
        if (ty >= 0 && ty <= lip) {
          best = { r, c, tx, ty, lip };
          break; // dr = 0 is the row this pixel's top falls in; an upper row (dr = 1) lies on top only if it reaches down
        }
      }
      // an upper row's lip overlaps the top of this row
      const up = Math.floor(y / rh) - 1;
      {
        const ty = (y - up * rh) / rh;
        const off = (((up % 2) + 2) % 2) * 0.5;
        const c = Math.floor(x / cw - off);
        const tx = x / cw - off - c;
        const lip = 0.95 + 0.3 * Math.sqrt(Math.max(0, 1 - (2 * tx - 1) ** 2));
        if (ty <= lip) best = { r: up, c, tx, ty, lip };
      }
      if (!best) {
        out[0] = out[1] = out[2] = 60;
        out[3] = 0;
        return;
      }
      const { r, c, tx, ty, lip } = best;
      const sh = shade[(((r % rows) + rows) % rows) * (cols + 1) + (((c % cols) + cols) % cols)];
      const edge = Math.min(tx, 1 - tx) * cw; // px from the tile's sides
      const toLip = (lip - ty) * rh; // px above the lip
      const bevel = Math.min(1, edge / 2.5) * Math.min(1, toLip / 2.5);
      const grain = 0.94 + 0.12 * fbm(x / 9, y / 9, S / 9, 31);
      // a tile thickens toward its lip, which casts a little shadow on the row below
      const h = 0.25 + 0.7 * Math.min(1, ty / lip) * bevel;
      const v = 255 * sh * grain * (0.72 + 0.28 * bevel) * (0.88 + 0.12 * (ty / lip));
      out[0] = out[1] = out[2] = Math.min(255, v);
      out[3] = h;
    },
    { strength: 3 },
  );
}

/**
 * Castle stonework: courses of dressed blocks with chamfered edges, some
 * weathered darker, frost settled in the mortar joints (grey; tinted by
 * vertex colour).
 */
export function stoneBlocks() {
  const S = 512, rowH = 32;
  const rows = S / rowH;
  const rnd = mulberry32(5);
  const cuts = [];
  const tones = [];
  for (let r = 0; r < rows; r++) {
    cuts.push(rowCuts(S, 46, 92, rnd));
    tones.push(cuts[r].map(() => (rnd() < 0.12 ? 0.68 + rnd() * 0.1 : 0.84 + rnd() * 0.2)));
  }
  return surface(
    'stone',
    S,
    (x, y, out) => {
      const r = Math.floor(y / rowH);
      const cs = cuts[r];
      let k = 0;
      while (k < cs.length - 2 && x >= cs[k + 1]) k++;
      const dEdge = Math.min(x - cs[k], cs[k + 1] - x, y - r * rowH, (r + 1) * rowH - y);
      const mortar = 1.6;
      const face = Math.min(1, Math.max(0, (dEdge - mortar) / 3.2)); // chamfer
      const chisel = fbm(x / 6, y / 6, S / 6, 7 + r, 2);
      const tone = tones[r][k] * (0.92 + 0.16 * chisel);
      if (dEdge < mortar) {
        // frosty mortar
        const m = 200 + 25 * chisel;
        out[0] = m;
        out[1] = m + 2;
        out[2] = m + 6;
        out[3] = 0;
      } else {
        const v = 215 * tone * (0.8 + 0.2 * face);
        out[0] = v;
        out[1] = v * 0.985;
        out[2] = v * 0.955;
        out[3] = 0.35 + 0.65 * face + (chisel - 0.5) * 0.25;
      }
    },
    { strength: 2.2 },
  );
}

/** wood grain for beams, shutters, doors and posts (light grey, tinted by vertex colour) */
export function woodGrain() {
  const S = 256;
  return surface(
    'wood',
    S,
    (x, y, out) => {
      // fibres run along u; a slow wobble and the odd knot
      const wob = fbm(x / 64, y / 16, 4, 3, 2) * 18;
      const f = fbm(x / 40, (y + wob) / 1.6, S / 40, 9, 3);
      const ring = 0.5 + 0.5 * Math.sin((y + wob) * 0.9 + f * 6);
      const v = 205 + 38 * (f - 0.5) + 16 * (ring - 0.5);
      out[0] = Math.min(255, v + 4);
      out[1] = Math.min(255, v);
      out[2] = Math.min(255, v - 6);
      out[3] = ring * 0.6 + f * 0.4;
    },
    { strength: 1.4 },
  );
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

/**
 * Painted shop signs, 4 x 2: key, boot, loaf, mug, fish, scissors, candle,
 * pretzel, in gilt on dark boards with a border.
 */
export function signAtlas() {
  const W = 128, H = 96;
  const c = makeCanvas(W * 4, H * 2);
  const ctx = c.getContext('2d');
  const boards = ['#2a3a5a', '#5a2a22', '#2f4a32', '#3a2a1a'];
  for (let i = 0; i < 8; i++) {
    const x0 = (i % 4) * W, y0 = Math.floor(i / 4) * H;
    ctx.save();
    ctx.translate(x0, y0);
    ctx.fillStyle = boards[i % 4];
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#d9a84e';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.fillStyle = '#e8c070';
    ctx.strokeStyle = '#e8c070';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.translate(W / 2, H / 2);
    ctx.beginPath();
    if (i === 0) {
      // key
      ctx.arc(-26, 0, 12, 0, Math.PI * 2);
      ctx.moveTo(-14, 0);
      ctx.lineTo(30, 0);
      ctx.moveTo(22, 0);
      ctx.lineTo(22, 12);
      ctx.moveTo(30, 0);
      ctx.lineTo(30, 10);
      ctx.stroke();
    } else if (i === 1) {
      // boot
      ctx.moveTo(-10, -26);
      ctx.lineTo(4, -26);
      ctx.lineTo(4, 8);
      ctx.lineTo(30, 14);
      ctx.lineTo(30, 24);
      ctx.lineTo(-12, 24);
      ctx.closePath();
      ctx.fill();
    } else if (i === 2) {
      // loaf with slashes
      ctx.ellipse(0, 4, 34, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = boards[2];
      ctx.lineWidth = 3;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(k * 14 - 6, -6);
        ctx.lineTo(k * 14 + 6, 12);
        ctx.stroke();
      }
    } else if (i === 3) {
      // mug with foam
      ctx.fillRect(-18, -14, 30, 36);
      ctx.beginPath();
      ctx.arc(-3, -16, 16, Math.PI, 0);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(14, 4, 10, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    } else if (i === 4) {
      // fish
      ctx.ellipse(-4, 0, 26, 13, 0, 0, Math.PI * 2);
      ctx.moveTo(18, 0);
      ctx.lineTo(34, -14);
      ctx.lineTo(34, 14);
      ctx.closePath();
      ctx.fill();
    } else if (i === 5) {
      // scissors
      ctx.arc(-18, -12, 9, 0, Math.PI * 2);
      ctx.moveTo(-9, 12);
      ctx.arc(-18, 12, 9, 0, Math.PI * 2);
      ctx.moveTo(-10, -8);
      ctx.lineTo(32, 10);
      ctx.moveTo(-10, 8);
      ctx.lineTo(32, -10);
      ctx.stroke();
    } else if (i === 6) {
      // candle with a flame
      ctx.fillRect(-8, -6, 16, 32);
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.quadraticCurveTo(10, -14, 0, -10);
      ctx.quadraticCurveTo(-10, -14, 0, -30);
      ctx.fill();
    } else {
      // pretzel
      ctx.arc(-12, 0, 14, 0, Math.PI * 2);
      ctx.moveTo(26, 0);
      ctx.arc(12, 0, 14, 0, Math.PI * 2);
      ctx.moveTo(-6, 18);
      ctx.lineTo(0, 26);
      ctx.lineTo(6, 18);
      ctx.stroke();
    }
    ctx.restore();
  }
  return canvasTexture(c);
}
