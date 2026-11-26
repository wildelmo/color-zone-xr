import * as THREE from 'three';

/**
 * In-world UI drawn on canvases: a small brass control panel of round
 * buttons (pointable and pokeable) and a printed information card.
 */
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Segoe UI", "Avenir Next", system-ui, -apple-system, Arial, sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function wrap(ctx, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = w;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lh;
}

/** a round brass button with an icon glyph and a caption */
export class Button3D {
  constructor({ id, label, glyph, size = 0.055, onPress }) {
    this.id = id;
    this.onPress = onPress;
    this.label = label;
    this.glyph = glyph;
    this.size = size;
    this.c = canvas(256, 320);
    this.tex = texture(this.c);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 1.25), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    this.mesh.name = `button:${id}`;
    this.mesh.userData.button = this;
    this.hover = false;
    this.active = false;
    this.pressT = 0;
    this.draw();
  }

  draw() {
    const ctx = this.c.getContext('2d');
    ctx.clearRect(0, 0, 256, 320);
    const lit = this.hover || this.active;
    const g = ctx.createRadialGradient(110, 100, 10, 128, 128, 120);
    g.addColorStop(0, lit ? '#fff1c4' : '#f2d48a');
    g.addColorStop(0.6, lit ? '#e8b85a' : '#c9973f');
    g.addColorStop(1, '#6e4a18');
    ctx.fillStyle = '#2a1a0c';
    ctx.beginPath();
    ctx.arc(128, 128, 122, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(128, 128, this.active ? 104 : 112, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a1a0c';
    ctx.font = `700 112px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.glyph, 128, 136);
    ctx.fillStyle = lit ? '#ffe7b0' : '#e9d3a8';
    ctx.font = `700 40px ${SANS}`;
    ctx.fillText(this.label, 128, 290);
    this.tex.needsUpdate = true;
  }

  setLabel(label) {
    if (label !== this.label) {
      this.label = label;
      this.draw();
    }
  }

  setHover(h) {
    if (h !== this.hover) {
      this.hover = h;
      this.draw();
    }
  }

  setActive(a) {
    if (a !== this.active) {
      this.active = a;
      this.draw();
    }
  }

  press() {
    this.pressT = 0.18;
    if (this.onPress) this.onPress(this);
  }

  update(dt) {
    if (this.pressT > 0) {
      this.pressT -= dt;
      this.mesh.scale.setScalar(0.9 + 0.1 * (1 - Math.max(0, this.pressT) / 0.18));
    } else this.mesh.scale.setScalar(this.hover ? 1.06 : 1);
  }
}

export class ControlPanel {
  constructor(buttons) {
    this.group = new THREE.Group();
    this.group.name = 'control-panel';
    this.buttons = buttons;
    const w = buttons.length * 0.075 + 0.03;
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.1, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x3a1a0c, roughness: 0.4, metalness: 0.1 }),
    );
    board.position.z = -0.008;
    this.group.add(board);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.11, 0.006), new THREE.MeshStandardMaterial({ color: 0xc9973f, metalness: 1, roughness: 0.3 }));
    rim.position.z = -0.012;
    this.group.add(rim);
    this.board = board;
    this.rim = rim;
    buttons.forEach((b) => this.group.add(b.mesh));
    this.layout();
  }

  /** lay out the visible buttons and size the board to fit */
  layout() {
    const vis = this.buttons.filter((b) => b.mesh.visible);
    vis.forEach((b, i) => b.mesh.position.set((i - (vis.length - 1) / 2) * 0.075, -0.004, 0.001));
    const w = vis.length * 0.075 + 0.03;
    this.board.scale.x = w / this.board.geometry.parameters.width;
    this.rim.scale.x = (w + 0.01) / this.rim.geometry.parameters.width;
  }

  setVisible(id, v) {
    const b = this.buttons.find((x) => x.id === id);
    if (b && b.mesh.visible !== v) {
      b.mesh.visible = v;
      this.layout();
    }
  }

  get targets() {
    return this.buttons.filter((b) => b.mesh.visible).map((b) => b.mesh);
  }

  update(dt) {
    for (const b of this.buttons) b.update(dt);
  }
}

/** a printed museum card with the asset's story and the controls */
export class InfoCard {
  constructor() {
    this.c = canvas(1024, 1280);
    this.tex = texture(this.c);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.4), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.8 }));
    this.mesh.name = 'info-card';
    this.set(null);
  }

  set(info, status = '') {
    const ctx = this.c.getContext('2d');
    const W = 1024, H = 1280;
    ctx.fillStyle = '#efe4cc';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#8a6a3a';
    ctx.lineWidth = 10;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    ctx.lineWidth = 3;
    ctx.strokeRect(44, 44, W - 88, H - 88);
    ctx.fillStyle = '#2a1a10';
    ctx.textAlign = 'center';
    ctx.font = `700 34px ${SANS}`;
    ctx.fillStyle = '#8a3a2a';
    ctx.fillText('THE CURIO CABINET', W / 2, 120);
    ctx.fillStyle = '#2a1a10';
    ctx.font = `700 76px ${SERIF}`;
    ctx.fillText(info ? info.name : 'Choose a curio', W / 2, 220);
    ctx.font = `italic 34px ${SERIF}`;
    ctx.fillStyle = '#5a4030';
    ctx.fillText(info ? info.maker : 'from the pedestals behind the table', W / 2, 280);
    ctx.fillStyle = '#8a6a3a';
    ctx.fillRect(W / 2 - 160, 316, 320, 4);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2a1a10';
    ctx.font = `38px ${SERIF}`;
    let y = 390;
    if (info) y = wrap(ctx, info.blurb, 90, y, W - 180, 52) + 20;
    ctx.font = `700 34px ${SANS}`;
    ctx.fillStyle = '#8a3a2a';
    ctx.fillText('HOW TO PLAY', 90, y + 10);
    y += 70;
    ctx.font = `32px ${SANS}`;
    ctx.fillStyle = '#2a1a10';
    const lines = [
      ['Trigger', 'point at a pedestal to bring a curio to the table; press buttons; hold on the key to wind it'],
      ['Grip', 'pick it up. Grab with both hands and pull apart to make it bigger'],
      ['A / X', 'hold to wind it up (the key)'],
      ['Shake', 'shake the snow globe for real, or press Shake'],
      ['B / Y', 'tap to put it back on the table; hold to exit'],
      ['Sticks', 'left to walk, right to turn; in the big views push right up or down to rise and sink'],
    ];
    for (const [k, v] of lines) {
      ctx.font = `700 32px ${SANS}`;
      ctx.fillText(k, 90, y);
      ctx.font = `32px ${SANS}`;
      y = wrap(ctx, v, 250, y, W - 340, 42) + 8;
    }
    if (status) {
      ctx.textAlign = 'center';
      ctx.font = `italic 36px ${SERIF}`;
      ctx.fillStyle = '#8a3a2a';
      ctx.fillText(status, W / 2, H - 90);
    }
    this.tex.needsUpdate = true;
  }
}

/** floating text label (billboard) */
export class Label {
  constructor({ width = 0.3, scale = 1 } = {}) {
    this.c = canvas(768, 160);
    this.tex = texture(this.c);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width * scale, ((width * 160) / 768) * scale), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false }));
    this.mesh.renderOrder = 20;
    this.text = null;
  }

  set(title, sub = '') {
    const key = title + '|' + sub;
    if (key === this.text) return;
    this.text = key;
    const ctx = this.c.getContext('2d');
    ctx.clearRect(0, 0, 768, 160);
    if (!title) {
      this.tex.needsUpdate = true;
      return;
    }
    ctx.fillStyle = 'rgba(26,16,10,0.88)';
    const r = 40;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(8, 8, 752, 144, r) : ctx.rect(8, 8, 752, 144);
    ctx.fill();
    ctx.strokeStyle = '#c9973f';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2d48a';
    ctx.font = `700 52px ${SERIF}`;
    ctx.fillText(title, 384, sub ? 74 : 98);
    if (sub) {
      ctx.fillStyle = '#e9d9bf';
      ctx.font = `30px ${SANS}`;
      ctx.fillText(sub, 384, 122);
    }
    this.tex.needsUpdate = true;
  }
}
