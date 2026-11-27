import { makeCanvas, canvasTexture } from '../core/textures.js';
import { mulberry32 } from '../core/random.js';

/**
 * Painted façade atlas for the town: 4 styles (columns) x 4 tile kinds
 * (rows), plus a fifth row of carpentry. Each façade tile is one bay of one
 * storey (~2.3 m x 3 m). A matching emissive atlas lights only the window
 * panes, so windows glow at night, and a normal atlas carries the relief the
 * carved trim gives up close (deep window frames, sills, mullions, beams
 * standing proud, stone courses, door surrounds), so the fronts still catch
 * the light like carved ones when the trim is too small to draw.
 *
 * rows (top to bottom in the canvas): 0 door bay, 1 ground window,
 * 2 upper window, 3 plain / small window, 4 carpentry: a plank door with
 * iron straps, a louvred shutter, plain wood (light grey, tinted by vertex
 * colour where details.js builds doors and shutters from it)
 *
 * The relief is placed where details.js builds the matching trim, for a
 * nominal bay (BAY): a bay narrower or wider than that puts the fixed-size
 * members (frames 0.07 wide, posts 0.13) a pixel or two off.
 */
export const ATLAS = { cols: 4, rows: 5 };

const S = 256;
/** the bay the relief is drawn for: its length, and its height by row */
const BAY = { len: 2.3, h: [3.1, 3.1, 2.8, 2.8] };
const px = (m) => (m / BAY.len) * S; // metres along the wall -> pixels
const py = (m, row) => (m / BAY.h[row]) * S; // metres up the wall -> pixels

const STYLES = [
  { wall: '#e9dcc0', beam: '#4a2c1a', trim: '#4a2c1a', timber: true }, // cream timber-frame
  { wall: '#b9b2a6', beam: '#8d857a', trim: '#5d564c', stone: true }, // pale stone
  { wall: '#d9a59a', beam: '#f1e6d6', trim: '#f1e6d6' }, // rose plaster
  { wall: '#a9b7c4', beam: '#3c2a1e', trim: '#3c2a1e', timber: true }, // blue-grey timber
];

// relief heights (0..1, the wall at 0.42); the trim's depth out of the wall
// sets the order: sills 0.2 m, frames 0.125, lintels 0.1, beams 0.06
const R = { wall: 0.42, joint: 0.33, glass: 0.16, frame: 0.8, sill: 0.86, lintel: 0.72, mullion: 0.6, beam: 0.64, band: 0.5, surround: 0.78, door: 0.24, step: 0.62 };
const grey = (v) => {
  const g = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgb(${g},${g},${g})`;
};

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

/** the members of a timber frame (as details.js timbers() builds them), in tile pixels */
function timberShapes(x0, y0, row) {
  const post = px(0.065); // half of a 0.13 post, either side of the bay's edge
  const top = py(0.11, row), bottom = py(0.16, row);
  const rects = [
    [x0, y0, post, S],
    [x0 + S - post, y0, post, S],
    [x0, y0, S, top],
    [x0, y0 + S - bottom, S, bottom],
  ];
  // braces on upper storeys, from the sill beam up to the posts either side of the window
  const braces = [];
  if (row >= 2) {
    const yb = y0 + S - bottom, rise = 0.45 * S, run = 0.22 * S;
    braces.push([x0 + post, yb, x0 + post + run, yb - rise], [x0 + S - post, yb, x0 + S - post - run, yb - rise]);
  }
  return { rects, braces, width: px(0.1) };
}

/**
 * One window (rows 1, 2) as details.js frames it: x, y, w, h are the pane
 * (the painted glass), the frame 0.07 round it with its sides reaching down
 * to the sill, a sill 0.3 wider than the pane, and a stone lintel over it on
 * the stone style.
 */
function windowParts(x, y, w, h, row) {
  const fx = px(0.07), fy = py(0.07, row);
  const sillTop = y + h + py(0.025, row);
  return {
    frame: [x - fx, y - fy, w + 2 * fx, sillTop - (y - fy)],
    sill: [x + w / 2 - (w + px(0.3)) / 2, sillTop, w + px(0.3), py(0.07, row)],
    lintel: [x + w / 2 - (w + px(0.34)) / 2, y - py(0.21, row), w + px(0.34), py(0.16, row)],
    mullions: [
      [x + w / 2 - 3, y, 6, h],
      [x, y + h * 0.45, w, 5],
    ],
  };
}

function drawWindow(ctx, emis, hgt, x, y, w, h, st, arch, rnd, row) {
  const parts = windowParts(x, y, w, h, row);
  // a stone lintel over the stone style's windows
  if (st.stone) {
    ctx.fillStyle = '#9a948a';
    ctx.fillRect(...parts.lintel);
    hgt.fillStyle = grey(R.lintel);
    hgt.fillRect(...parts.lintel);
  }
  // frame (square, as built; an arched pane sits in it under a stone tympanum)
  ctx.fillStyle = st.trim;
  ctx.fillRect(...parts.frame);
  hgt.fillStyle = grey(R.frame);
  hgt.fillRect(...parts.frame);
  hgt.fillStyle = grey(R.wall);
  hgt.fillRect(x, y, w, h);
  // glass (dark by day), set in behind the frame
  ctx.fillStyle = '#2a3442';
  windowShape(ctx, x, y, w, h, arch);
  ctx.fill();
  hgt.fillStyle = grey(R.glass);
  windowShape(hgt, x, y, w, h, arch);
  hgt.fill();
  // panes glow at night
  const warm = rnd() < 0.15 ? '#ffd9a0' : '#ffbf66';
  emis.fillStyle = warm;
  windowShape(emis, x, y, w, h, arch);
  emis.fill();
  // the reveal: the frame's inner faces darken the edge of the pane
  for (const c of [ctx, emis]) {
    c.save();
    windowShape(c, x, y, w, h, arch);
    c.clip();
    c.strokeStyle = c === ctx ? 'rgba(12,10,8,0.6)' : '#000';
    c.lineWidth = 7;
    windowShape(c, x, y, w, h, arch);
    c.stroke();
    c.restore();
  }
  // mullions
  for (const c of [ctx, emis, hgt]) {
    c.fillStyle = c === ctx ? st.trim : c === emis ? '#000' : grey(R.mullion);
    for (const m of parts.mullions) c.fillRect(...m);
  }
  // shutters (day only), louvred
  ctx.fillStyle = rnd() < 0.5 ? '#3d5a3a' : '#6a2a22';
  const sw = w * 0.42;
  const shutters = [
    [x - px(0.07) - sw, y - 2, sw, h + 4],
    [x + w + px(0.07), y - 2, sw, h + 4],
  ];
  for (const s of shutters) {
    ctx.fillRect(...s);
    louvres(ctx, hgt, ...s, 0.5, 'rgba(0,0,0,0.22)');
  }
  // the sill, with a little snow on it now and then
  ctx.fillStyle = st.stone ? '#a8a196' : st.trim;
  ctx.fillRect(...parts.sill);
  hgt.fillStyle = grey(R.sill);
  hgt.fillRect(...parts.sill);
  if (rnd() < 0.6) {
    ctx.fillStyle = '#e8eef4';
    ctx.fillRect(parts.sill[0] + 2, parts.sill[1] - 1, parts.sill[2] - 4, 3);
  }
}

/** horizontal louvre slats over a rectangle: shading in ctx, a sawtooth in the relief */
function louvres(ctx, hgt, x, y, w, h, base, shade, frame = 0) {
  const n = Math.max(3, Math.round((h - 2 * frame) / 9));
  const sh = (h - 2 * frame) / n;
  if (frame) {
    hgt.fillStyle = grey(base + 0.2);
    hgt.fillRect(x, y, w, h);
  }
  for (let k = 0; k < n; k++) {
    const sy = y + frame + k * sh;
    // each slat tilts out toward its foot, so its face catches the light from above
    const g = hgt.createLinearGradient(0, sy, 0, sy + sh);
    g.addColorStop(0, grey(base - 0.08));
    g.addColorStop(0.85, grey(base + 0.1));
    g.addColorStop(1, grey(base - 0.08));
    hgt.fillStyle = g;
    hgt.fillRect(x + frame, sy, w - 2 * frame, sh);
    ctx.fillStyle = shade;
    ctx.fillRect(x + frame, sy + sh * 0.8, w - 2 * frame, Math.max(1, sh * 0.2));
  }
}

function tile(ctx, emis, hgt, col, row, rnd, hrnd) {
  const x0 = col * S, y0 = row * S;
  const st = STYLES[col];
  for (const c of [ctx, emis, hgt]) {
    c.save();
    c.beginPath();
    c.rect(x0, y0, S, S);
    c.clip();
  }
  emis.fillStyle = '#000';
  emis.fillRect(x0, y0, S, S);
  ctx.fillStyle = st.wall;
  ctx.fillRect(x0, y0, S, S);
  hgt.fillStyle = grey(st.stone ? R.joint : R.wall);
  hgt.fillRect(x0, y0, S, S);
  // plaster mottling / stone courses
  if (st.stone) {
    for (let yy = 0; yy < S; yy += 26) {
      const off = (yy / 26) % 2 ? 0 : 30;
      for (let xx = -60; xx < S; xx += 60) {
        ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '40,30,20'},${0.04 + rnd() * 0.08})`;
        ctx.fillRect(x0 + xx + off, y0 + yy, 58, 24);
        // each block a touch proud of the mortar, some more than others
        hgt.fillStyle = grey(R.wall + 0.02 + (hrnd() - 0.5) * 0.05);
        hgt.fillRect(x0 + xx + off, y0 + yy, 58, 24);
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
    // the plaster is hand-laid: soft swells and hollows
    for (let i = 0; i < 40; i++) {
      const c = hrnd() < 0.5 ? '255,255,255' : '0,0,0', a = 0.04 + hrnd() * 0.05;
      const x = x0 + hrnd() * S, y = y0 + hrnd() * S, r = 8 + hrnd() * 20;
      const g = hgt.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${c},${a})`);
      g.addColorStop(1, `rgba(${c},0)`);
      hgt.fillStyle = g;
      hgt.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
  }
  // timber framing, where details.js puts the beams
  if (st.timber) {
    const t = timberShapes(x0, y0, row);
    for (const [c, fill] of [[ctx, st.beam], [hgt, grey(R.beam)]]) {
      c.fillStyle = fill;
      for (const r of t.rects) c.fillRect(...r);
      c.save();
      c.lineWidth = t.width;
      c.strokeStyle = fill;
      c.beginPath();
      for (const [ax, ay, bx, by] of t.braces) {
        c.moveTo(ax, ay);
        c.lineTo(bx, by);
      }
      c.stroke();
      c.restore();
    }
  } else {
    ctx.fillStyle = st.trim;
    ctx.fillRect(x0, y0 + S - 10, S, 10);
    hgt.fillStyle = grey(R.band);
    hgt.fillRect(x0, y0 + S - 10, S, 10);
  }
  const arch = col === 1;
  if (row === 0) {
    // door with a lantern-lit transom, in a stone surround with a step (as details.js builds it)
    const dw = 84, dh = 150;
    const dx = x0 + (S - dw) / 2, dy = y0 + S - 16 - dh;
    const pw = px(0.12);
    const posts = [
      [dx - pw, dy - py(0.05, 0), pw, dh + py(0.1, 0)],
      [dx + dw, dy - py(0.05, 0), pw, dh + py(0.1, 0)],
    ];
    const lintel = [x0 + S / 2 - (dw + px(0.44)) / 2, dy - py(0.18, 0), dw + px(0.44), py(0.16, 0)];
    const step = [x0 + S / 2 - (dw + px(0.5)) / 2, y0 + S - py(0.11, 0), dw + px(0.5), py(0.11, 0)];
    ctx.fillStyle = '#a8a196';
    for (const p of posts) ctx.fillRect(...p);
    ctx.fillStyle = '#9a948a';
    ctx.fillRect(...lintel);
    ctx.fillStyle = '#8a847a';
    ctx.fillRect(...step);
    hgt.fillStyle = grey(R.surround);
    for (const p of [...posts, lintel]) hgt.fillRect(...p);
    hgt.fillStyle = grey(R.step);
    hgt.fillRect(...step);
    ctx.fillStyle = ['#5a3420', '#2f4a5a', '#6a2a22', '#3d5a3a'][Math.floor(rnd() * 4)];
    windowShape(ctx, dx, dy, dw, dh, true);
    ctx.fill();
    hgt.fillStyle = grey(R.door);
    windowShape(hgt, dx, dy, dw, dh, true);
    hgt.fill();
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
    hgt.fillStyle = grey(R.glass);
    windowShape(hgt, dx + 10, dy + 6, dw - 20, 30, true);
    hgt.fill();
  } else if (row === 1 || row === 2) {
    drawWindow(ctx, emis, hgt, x0 + 80, y0 + 64, 96, row === 1 ? 110 : 120, st, arch, rnd, row);
  } else {
    // small round window in a ring of trim (details.js: a torus 0.34 m across a
    // 2.3 m bay, which the tile squeezes into an ellipse)
    const cx = x0 + S / 2, cy = y0 + 110;
    const rx = px(0.34), ry = py(0.34, row);
    for (const [c, fill] of [[ctx, st.trim], [hgt, grey(R.frame)]]) {
      c.strokeStyle = fill;
      c.lineWidth = px(0.1);
      c.beginPath();
      c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      c.stroke();
    }
    ctx.fillStyle = '#2a3442';
    hgt.fillStyle = grey(R.glass);
    for (const c of [ctx, hgt]) {
      c.beginPath();
      c.arc(cx, cy, 26, 0, Math.PI * 2);
      c.fill();
    }
    emis.fillStyle = '#ffbf66';
    emis.beginPath();
    emis.arc(cx, cy, 26, 0, Math.PI * 2);
    emis.fill();
  }
  for (const c of [ctx, emis, hgt]) c.restore();
}

/**
 * The carpentry row (4): light grey, tinted by the vertex colour of the
 * door or shutter built from it. Col 0 a door leaf of four planks with two
 * iron straps, nails and a ring pull (maps onto a leaf ~0.75 x 1.6 m); col 1 a
 * louvred shutter in its frame (~0.4 x 1.35 m); cols 2, 3 plain wood for the
 * edges.
 */
function carpentry(ctx, hgt, hrnd) {
  const y0 = 4 * S;
  // plain wood with a faint vertical grain everywhere first
  ctx.fillStyle = '#d6d0c6';
  ctx.fillRect(0, y0, S * 4, S);
  hgt.fillStyle = grey(0.5);
  hgt.fillRect(0, y0, S * 4, S);
  for (let i = 0; i < 260; i++) {
    const x = hrnd() * S * 2, w = 1 + hrnd() * 2;
    ctx.fillStyle = `rgba(${hrnd() < 0.5 ? '255,255,255' : '60,40,20'},${0.04 + hrnd() * 0.06})`;
    ctx.fillRect(x, y0, w, S);
  }
  // the door: four planks, grooves between them
  for (let k = 0; k < 4; k++) {
    const x = (k * S) / 4;
    hgt.fillStyle = grey(0.5 + (hrnd() - 0.5) * 0.04);
    hgt.fillRect(x + 2, y0, S / 4 - 4, S);
    for (const c of [ctx, hgt]) {
      c.fillStyle = c === ctx ? 'rgba(30,20,12,0.75)' : grey(0.22);
      c.fillRect(x - 2, y0, 4, S);
    }
  }
  // iron straps from the hinge side, with nails, and a ring pull
  for (const sy of [y0 + 26, y0 + S - 40]) {
    for (const [c, fill] of [[ctx, '#2a2622'], [hgt, grey(0.74)]]) {
      c.fillStyle = fill;
      c.beginPath();
      c.moveTo(4, sy);
      c.lineTo(S * 0.72, sy + 2);
      c.arc(S * 0.72, sy + 7, 5, -Math.PI / 2, Math.PI / 2);
      c.lineTo(4, sy + 12);
      c.closePath();
      c.fill();
    }
    for (let k = 0; k < 5; k++) {
      const nx = 18 + k * ((S * 0.72 - 24) / 4);
      for (const [c, fill] of [[ctx, '#5a544c'], [hgt, grey(0.9)]]) {
        c.fillStyle = fill;
        c.beginPath();
        c.arc(nx, sy + 6, 2.2, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  for (const [c, fill] of [[ctx, '#2a2622'], [hgt, grey(0.8)]]) {
    c.strokeStyle = fill;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(S * 0.8, y0 + S * 0.56, 11, 0, Math.PI * 2);
    c.stroke();
  }
  // the shutter: a frame round louvres
  const sx = S;
  ctx.fillStyle = '#dcd6cc';
  ctx.fillRect(sx, y0, S, S);
  louvres(ctx, hgt, sx, y0, S, S, 0.48, 'rgba(0,0,0,0.3)', 18);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(sx + 18, y0 + 18, S - 36, S - 36);
}

/**
 * Height canvas -> normal canvas, each tile on its own (no slopes across
 * tile seams). Everything, the read-back included, is worked through in
 * bands of rows with `step` between them, so a headset keeps drawing frames
 * while it runs. (The height canvas is CPU-backed, so reading a band is a
 * copy, not a GPU round trip.)
 */
async function reliefNormals(hgt, W, H, strength, step) {
  const hctx = hgt.getContext('2d');
  let a = new Float32Array(W * H), b = new Float32Array(W * H);
  const BAND = 32; // rows per slice (a few ms each on a headset)
  const bands = async (fn) => {
    for (let y0 = 0; y0 < H; y0 += BAND) {
      fn(y0, Math.min(H, y0 + BAND));
      if (step) await step();
    }
  };
  // the heights, a band at a time
  await bands((ya, yb) => {
    const src = hctx.getImageData(0, ya, W, yb - ya).data;
    for (let i = 0, o = ya * W; i < src.length; i += 4, o++) a[o] = src[i] / 255;
  });
  const lo = (v) => v - (v % S); // first pixel of v's tile
  // two passes of a 3-tap box blur each way: edges become bevels a few
  // pixels wide, which survive a couple of mip levels instead of averaging out
  for (let pass = 0; pass < 2; pass++) {
    await bands((ya, yb) => {
      for (let y = ya; y < yb; y++) {
        const r = y * W;
        for (let x = 0; x < W; x++) {
          const t = lo(x);
          const xl = x > t ? x - 1 : x, xr = x < t + S - 1 ? x + 1 : x;
          b[r + x] = (a[r + xl] + a[r + x] + a[r + xr]) / 3;
        }
      }
    });
    await bands((ya, yb) => {
      for (let y = ya; y < yb; y++) {
        const t = lo(y);
        const yu = y > t ? y - 1 : y, yd = y < t + S - 1 ? y + 1 : y;
        for (let x = 0; x < W; x++) a[y * W + x] = (b[yu * W + x] + b[y * W + x] + b[yd * W + x]) / 3;
      }
    });
  }
  // (CPU-backed too: each band goes in with a copy)
  const nor = makeCanvas(W, H, { willReadFrequently: true });
  const nctx = nor.getContext('2d');
  // a pixel is ~9 mm along the wall and ~12 mm up it
  const kx = strength, ky = strength * 0.78;
  await bands((ya, yb) => {
    const out = nctx.createImageData(W, yb - ya);
    for (let y = ya; y < yb; y++) {
      const t = lo(y);
      const yu = y > t ? y - 1 : y, yd = y < t + S - 1 ? y + 1 : y;
      for (let x = 0; x < W; x++) {
        const tx = lo(x);
        const xl = x > tx ? x - 1 : x, xr = x < tx + S - 1 ? x + 1 : x;
        // slopes per two pixels; canvas y runs down, v runs up (as surface() below)
        const nx = -((a[y * W + xr] - a[y * W + xl]) / (xr - xl)) * 2 * kx;
        const ny = ((a[yd * W + x] - a[yu * W + x]) / (yd - yu)) * 2 * ky;
        const l = Math.sqrt(nx * nx + ny * ny + 1); // (Math.hypot is several times slower here)
        const i = ((y - ya) * W + x) * 4;
        out.data[i] = (nx / l) * 127.5 + 127.5;
        out.data[i + 1] = (ny / l) * 127.5 + 127.5;
        out.data[i + 2] = (1 / l) * 127.5 + 127.5;
        out.data[i + 3] = 255;
      }
    }
    nctx.putImageData(out, 0, ya);
  });
  return nor;
}

// the atlas canvases, made once (painting, then the relief) and kept, so
// bringing the globe back out is instant; promises, so two builds at once share them
let PAINTED = null;
let RELIEF = null;

/** paint the atlas a tile at a time (with `step` between) */
async function paintAtlas(W, H, step) {
  const c = makeCanvas(W, H);
  const e = makeCanvas(W, H);
  // (the heights are read back, so that canvas is kept on the CPU)
  const h = makeCanvas(W, H, { willReadFrequently: true });
  const ctx = c.getContext('2d');
  const emis = e.getContext('2d');
  const hgt = h.getContext('2d');
  emis.fillStyle = '#000';
  emis.fillRect(0, 0, W, H);
  const rnd = mulberry32(17);
  const hrnd = mulberry32(29); // (its own stream, so the painting stays as it was)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      tile(ctx, emis, hgt, col, row, rnd, hrnd);
      if (step) await step();
    }
  }
  carpentry(ctx, hgt, hrnd);
  return { col: c, emis: e, hgt: h };
}

/**
 * The façade atlas: colour, emissive and (with relief) the normal map, one
 * mipmapped texture each. The canvases are made once and kept; each call
 * returns new textures for the caller's MaterialKit to track and dispose.
 */
export async function facadeAtlas({ relief = false, step = null } = {}) {
  const W = S * ATLAS.cols, H = S * ATLAS.rows;
  PAINTED ||= paintAtlas(W, H, step);
  const f = await PAINTED;
  if (relief) RELIEF ||= reliefNormals(f.hgt, W, H, 5, step);
  const nor = relief ? await RELIEF : null;
  return {
    map: canvasTexture(f.col),
    emissive: canvasTexture(f.emis),
    normal: nor ? canvasTexture(nor, { srgb: false }) : null,
  };
}

/** UV rect [u0, v0, u1, v1] of an atlas tile (v up, canvas flipped) */
export function tileUV(style, kind) {
  const pad = 0.004;
  const u0 = style / ATLAS.cols + pad, u1 = (style + 1) / ATLAS.cols - pad;
  const v1 = 1 - kind / ATLAS.rows - pad, v0 = 1 - (kind + 1) / ATLAS.rows + pad;
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
