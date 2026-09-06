import * as THREE from 'three';

/**
 * Canvas-drawn text and panels for in-world UI. Rounded, chunky and
 * high-contrast so it reads well at Quest resolutions.
 */
export const FONT = '"Nunito", "Segoe UI", "Avenir Next", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** draw text with word wrapping; returns the height used */
export function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, align = 'left') {
  const words = String(text).split(' ');
  let line = '';
  let yy = y;
  ctx.textAlign = align;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
  return yy - y + lineHeight;
}

/**
 * A speech-bubble style label sprite.
 * @returns {THREE.Sprite} with .setText(text) and .userData.aspect
 */
export function makeLabel({ text = '', size = 64, color = '#2b2140', bg = 'rgba(255,255,255,0.96)', padding = 28, width = 1024, bold = true, radius = 48, accent = null, tail = false } = {}) {
  const canvas = makeCanvas(width, 256);
  const tex = canvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  const draw = (t) => {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let fs = size;
    ctx.font = `${bold ? '900' : '600'} ${fs}px ${FONT}`;
    // shrink long messages so they never run off the label
    const maxText = width - padding * 2;
    let tw = ctx.measureText(t).width;
    if (tw > maxText) {
      fs = Math.max(28, Math.floor((size * maxText) / tw));
      ctx.font = `${bold ? '900' : '600'} ${fs}px ${FONT}`;
      tw = ctx.measureText(t).width;
    }
    const bw = tw + padding * 2;
    const bh = fs + padding * 1.6;
    const x0 = (width - bw) / 2;
    const y0 = (256 - bh) / 2 - (tail ? 14 : 0);
    ctx.fillStyle = bg;
    ctx.shadowColor = 'rgba(40,20,80,0.25)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, x0, y0, bw, bh, radius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (tail) {
      ctx.beginPath();
      ctx.moveTo(width / 2 - 22, y0 + bh - 2);
      ctx.lineTo(width / 2 + 22, y0 + bh - 2);
      ctx.lineTo(width / 2, y0 + bh + 26);
      ctx.closePath();
      ctx.fill();
    }
    if (accent) {
      ctx.fillStyle = accent;
      roundRect(ctx, x0 + 14, y0 + 14, 14, bh - 28, 7);
      ctx.fill();
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, width / 2 + (accent ? 10 : 0), y0 + bh / 2 + 2, width - padding * 2);
    tex.needsUpdate = true;
    sprite.userData.aspect = width / 256;
  };
  sprite.setText = (t) => draw(t);
  draw(text);
  sprite.scale.set(sprite.userData.aspect * 0.25, 0.25, 1);
  return sprite;
}

/** simple vector icons for the brushes and actions (no emoji dependency) */
export function drawIcon(ctx, id, cx, cy, s, color = '#ffffff') {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  switch (id) {
    case 'glow': {
      ctx.lineWidth = s * 0.22;
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, s * 0.3);
      ctx.bezierCurveTo(-s * 0.4, -s * 0.5, s * 0.1, s * 0.6, s * 0.45, -s * 0.3);
      ctx.stroke();
      break;
    }
    case 'rainbow': {
      const cols = ['#ff3b5c', '#ff8c2a', '#ffd93d', '#33d872', '#3ec9ff', '#a05cff'];
      ctx.lineWidth = s * 0.1;
      cols.forEach((c, i) => {
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.arc(0, s * 0.3, s * 0.55 - i * s * 0.1, Math.PI, 0);
        ctx.stroke();
      });
      break;
    }
    case 'sparkle': {
      const star = (r, n, inner) => {
        ctx.beginPath();
        for (let i = 0; i < n * 2; i++) {
          const rr = i % 2 ? r * inner : r;
          const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
      };
      star(s * 0.5, 4, 0.35);
      ctx.translate(s * 0.35, -s * 0.35);
      star(s * 0.2, 4, 0.35);
      break;
    }
    case 'cotton': {
      for (const [x, y, r] of [[-0.25, 0.1, 0.28], [0.05, -0.12, 0.34], [0.32, 0.12, 0.26], [0, 0.2, 0.3]]) {
        ctx.beginPath();
        ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'stamp': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? s * 0.22 : s * 0.5;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'bubble': {
      ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      ctx.arc(-s * 0.15, s * 0.1, s * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.32, -s * 0.28, s * 0.18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.28, -s * 0.05, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'minus': {
      ctx.lineWidth = s * 0.18;
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, 0);
      ctx.lineTo(s * 0.4, 0);
      ctx.stroke();
      break;
    }
    case 'plus': {
      ctx.lineWidth = s * 0.18;
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, 0);
      ctx.lineTo(s * 0.4, 0);
      ctx.moveTo(0, -s * 0.4);
      ctx.lineTo(0, s * 0.4);
      ctx.stroke();
      break;
    }
    case 'sound': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.18);
      ctx.lineTo(-s * 0.2, -s * 0.18);
      ctx.lineTo(s * 0.05, -s * 0.42);
      ctx.lineTo(s * 0.05, s * 0.42);
      ctx.lineTo(-s * 0.2, s * 0.18);
      ctx.lineTo(-s * 0.45, s * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = s * 0.09;
      ctx.beginPath();
      ctx.arc(s * 0.1, 0, s * 0.3, -0.9, 0.9);
      ctx.stroke();
      break;
    }
    case 'mute': {
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.18);
      ctx.lineTo(-s * 0.2, -s * 0.18);
      ctx.lineTo(s * 0.05, -s * 0.42);
      ctx.lineTo(s * 0.05, s * 0.42);
      ctx.lineTo(-s * 0.2, s * 0.18);
      ctx.lineTo(-s * 0.45, s * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(s * 0.18, -s * 0.2);
      ctx.lineTo(s * 0.48, s * 0.2);
      ctx.moveTo(s * 0.48, -s * 0.2);
      ctx.lineTo(s * 0.18, s * 0.2);
      ctx.stroke();
      break;
    }
    case 'trash': {
      ctx.lineWidth = s * 0.09;
      roundRect(ctx, -s * 0.3, -s * 0.2, s * 0.6, s * 0.62, s * 0.08);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, -s * 0.28);
      ctx.lineTo(s * 0.42, -s * 0.28);
      ctx.moveTo(-s * 0.12, -s * 0.42);
      ctx.lineTo(s * 0.12, -s * 0.42);
      ctx.stroke();
      break;
    }
    case 'world': {
      ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.18, s * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.42, 0);
      ctx.lineTo(s * 0.42, 0);
      ctx.stroke();
      break;
    }
    case 'undo': {
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.arc(0.05 * s, 0.05 * s, s * 0.32, -Math.PI * 0.9, Math.PI * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.3);
      ctx.lineTo(-s * 0.2, -s * 0.05);
      ctx.lineTo(-s * 0.5, s * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'trigger': {
      ctx.lineWidth = s * 0.09;
      roundRect(ctx, -s * 0.18, -s * 0.5, s * 0.36, s, s * 0.18);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.18, -s * 0.1);
      ctx.quadraticCurveTo(-s * 0.5, s * 0.05, -s * 0.4, s * 0.4);
      ctx.stroke();
      break;
    }
    case 'hand': {
      ctx.lineWidth = s * 0.09;
      roundRect(ctx, -s * 0.3, -s * 0.1, s * 0.6, s * 0.55, s * 0.2);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        roundRect(ctx, -s * 0.3 + i * s * 0.15, -s * 0.5 + (i === 0 || i === 3 ? s * 0.12 : 0), s * 0.12, s * 0.5, s * 0.06);
        ctx.stroke();
      }
      break;
    }
    case 'exit': {
      ctx.lineWidth = s * 0.1;
      ctx.beginPath();
      ctx.moveTo(s * 0.05, -s * 0.42);
      ctx.lineTo(-s * 0.4, -s * 0.42);
      ctx.lineTo(-s * 0.4, s * 0.42);
      ctx.lineTo(s * 0.05, s * 0.42);
      ctx.stroke();
      ctx.lineWidth = s * 0.14;
      ctx.beginPath();
      ctx.moveTo(-s * 0.15, 0);
      ctx.lineTo(s * 0.45, 0);
      ctx.moveTo(s * 0.2, -s * 0.24);
      ctx.lineTo(s * 0.45, 0);
      ctx.lineTo(s * 0.2, s * 0.24);
      ctx.stroke();
      break;
    }
    case 'check': {
      ctx.lineWidth = s * 0.16;
      ctx.beginPath();
      ctx.moveTo(-s * 0.4, 0);
      ctx.lineTo(-s * 0.1, s * 0.3);
      ctx.lineTo(s * 0.45, -s * 0.35);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}
