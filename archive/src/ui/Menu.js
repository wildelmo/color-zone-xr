import * as THREE from 'three';
import { BRUSHES } from '../config.js';
import { makeCanvas, canvasTexture, roundRect, drawIcon, FONT } from './Text.js';
import { PropMaterial } from '../util/PropMaterial.js';

/**
 * A floating, world-locked panel with big friendly buttons. Point a wand's
 * laser at a button and pull the trigger, or just poke it with the tip.
 */
const W = 0.66;
const H = 0.46;
const PW = 1320;
const PH = 920;
const _head = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _plane = new THREE.Plane();
const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _local = new THREE.Vector3();
const _inv = new THREE.Matrix4();

export class Menu {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'menu';
    this.group.visible = false;
    this.open = false;
    this.canvas = makeCanvas(PW, PH);
    this.texture = canvasTexture(this.canvas);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
    this.panel.renderOrder = 25;
    this.group.add(this.panel);
    // soft backing so the panel reads against bright skies
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.02, H + 0.02), new PropMaterial(app.world.uniforms, { color: '#ffffff', opacity: 0.0, transparent: true, rim: 0 }));
    back.position.z = -0.002;
    back.visible = false;
    this.group.add(back);

    this.buttons = [];
    this.hover = null;
    this.armed = null;
    this.armedT = 0;
    this.pokeCooldown = 0;
    this.lasers = {};
    for (const key of ['left', 'right']) {
      // a slim glowing rod from the controller to the panel (1 unit long, scaled to fit)
      const geo = new THREE.CylinderGeometry(0.0022, 0.0035, 1, 6, 1, true);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0, -0.5);
      const line = new THREE.Mesh(geo, new PropMaterial(app.world.uniforms, { color: '#ffffff', emissive: '#ffffff', rim: 0, opacity: 0.75, transparent: true }));
      line.renderOrder = 26;
      line.visible = false;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new PropMaterial(app.world.uniforms, { color: '#ffffff', emissive: '#ffffff', rim: 0 }));
      dot.visible = false;
      dot.renderOrder = 27;
      this.lasers[key] = { line, dot };
      this.group.add(dot);
    }
    this._layout();
    this.redraw();
    app.events.on('menu', () => this.toggle());
    app.events.on('brush', () => this.open && this.redraw());
    app.events.on('size', () => this.open && this.redraw());
    app.events.on('clearrequest', () => this.activate(this.buttons.find((b) => b.id === 'clear')));
    this._lastProgress = -1;
  }

  _layout() {
    const bw = 190;
    const bh = 210;
    const gap = 22;
    const x0 = (PW - (bw * 6 + gap * 5)) / 2;
    BRUSHES.forEach((b, i) => {
      this.buttons.push({ id: 'brush:' + b.id, brush: b, icon: b.id, label: b.name, rect: [x0 + i * (bw + gap), 150, bw, bh] });
    });
    const row2 = [
      { id: 'smaller', icon: 'minus', label: 'Smaller' },
      { id: 'bigger', icon: 'plus', label: 'Bigger' },
      { id: 'undo', icon: 'undo', label: 'Undo' },
      { id: 'sound', icon: 'sound', label: 'Sound' },
      { id: 'clear', icon: 'trash', label: 'Clear', confirm: 'Sure?' },
      { id: 'newworld', icon: 'world', label: 'New world', confirm: 'Sure?' },
    ];
    row2.forEach((b, i) => {
      this.buttons.push({ ...b, rect: [x0 + i * (bw + gap), 410, bw, 175] });
    });
    this.buttons.push({ id: 'close', icon: 'check', label: 'Done', rect: [PW - 250, 36, 200, 84], small: true });
  }

  redraw() {
    const ctx = this.canvas.getContext('2d');
    const app = this.app;
    ctx.clearRect(0, 0, PW, PH);
    // card
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.shadowColor = 'rgba(40,20,80,0.25)';
    ctx.shadowBlur = 40;
    roundRect(ctx, 10, 10, PW - 20, PH - 20, 60);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // title
    ctx.font = `900 64px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const grad = ctx.createLinearGradient(60, 0, 700, 0);
    ['#ff3b5c', '#ff8c2a', '#ffd93d', '#33d872', '#3ec9ff', '#a05cff'].forEach((c, i, arr) => grad.addColorStop(i / (arr.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillText('Color Zone', 60, 78);
    ctx.font = `700 34px ${FONT}`;
    ctx.fillStyle = '#6b5f8a';
    ctx.fillText('Brushes', 60, 130);
    ctx.fillText('Tools', 60, 392);

    for (const b of this.buttons) {
      const [x, y, w, h] = b.rect;
      const selected = b.brush && app.paint.brush.id === b.brush.id;
      const hovered = this.hover === b;
      const armed = this.armed === b;
      ctx.fillStyle = selected ? '#a05cff' : hovered ? '#ffe9f8' : b.small ? '#33d872' : '#f1eefb';
      if (armed) ctx.fillStyle = '#ff6a6a';
      roundRect(ctx, x, y, w, h, 34);
      ctx.fill();
      if (hovered && !selected) {
        ctx.strokeStyle = '#ff6ad5';
        ctx.lineWidth = 8;
        ctx.stroke();
      }
      const iconColor = selected || armed || b.small ? '#ffffff' : '#5b4a8a';
      let icon = b.icon;
      if (b.id === 'sound' && app.audio && app.audio.muted) icon = 'mute';
      drawIcon(ctx, icon, x + w / 2, y + (b.small ? h / 2 : h / 2 - 22), b.small ? 40 : 90, iconColor);
      ctx.font = `800 ${b.small ? 36 : 34}px ${FONT}`;
      ctx.fillStyle = iconColor;
      ctx.textAlign = 'center';
      const label = armed ? b.confirm : b.small ? '' : b.label;
      if (label) ctx.fillText(label, x + w / 2, y + h - 34);
      if (b.small) ctx.fillText(b.label, x + w / 2 + 30, y + h / 2);
    }
    // size + progress
    const p = Math.round(app.world.progress * 100);
    ctx.textAlign = 'left';
    ctx.font = `700 34px ${FONT}`;
    ctx.fillStyle = '#6b5f8a';
    ctx.fillText(`Brush size`, 60, 650);
    const sx = 260;
    const sw = 380;
    ctx.fillStyle = '#e6e0f5';
    roundRect(ctx, sx, 636, sw, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#ff6ad5';
    roundRect(ctx, sx, 636, Math.max(28, sw * app.paint.sizeT), 28, 14);
    ctx.fill();
    ctx.fillStyle = '#6b5f8a';
    ctx.fillText(`World painted`, 700, 650);
    const px = 940;
    const pw = 320;
    ctx.fillStyle = '#e6e0f5';
    roundRect(ctx, px, 636, pw, 28, 14);
    ctx.fill();
    const pg = ctx.createLinearGradient(px, 0, px + pw, 0);
    ['#ff3b5c', '#ffd93d', '#33d872', '#3ec9ff', '#a05cff'].forEach((c, i, arr) => pg.addColorStop(i / (arr.length - 1), c));
    ctx.fillStyle = pg;
    roundRect(ctx, px, 636, Math.max(28, pw * app.world.progress), 28, 14);
    ctx.fill();
    ctx.fillStyle = '#4a3d6b';
    ctx.font = `900 34px ${FONT}`;
    ctx.fillText(`${p}%`, px + pw + 16, 650);
    // hints
    ctx.font = `600 30px ${FONT}`;
    ctx.fillStyle = '#9088a8';
    ctx.textAlign = 'center';
    ctx.fillText('Trigger: paint  ·  Grip: throw paint  ·  Touch the orbs: pick a colour  ·  Left stick: teleport  ·  A/Y: undo', PW / 2, 760);
    ctx.fillText('Paint the whole island to see the fireworks!', PW / 2, 830);
    this.texture.needsUpdate = true;
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    const app = this.app;
    this.open = true;
    this.group.visible = true;
    app.headPosition(_head);
    app.headQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    this.group.position.copy(_head).addScaledVector(_fwd, 0.8);
    this.group.position.y = _head.y - 0.12;
    this.group.lookAt(_head.x, this.group.position.y, _head.z);
    this.armed = null;
    this.redraw();
    if (app.audio) app.audio.select(0.3);
  }

  close() {
    this.open = false;
    this.group.visible = false;
    this.hover = null;
    this.armed = null;
    for (const l of Object.values(this.lasers)) {
      l.line.visible = false;
      l.dot.visible = false;
    }
  }

  /** returns the button under a world-space ray, and the hit point */
  _hitTest(origin, dir) {
    this.panel.updateWorldMatrix(true, false);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.panel.matrixWorld);
    const center = new THREE.Vector3().setFromMatrixPosition(this.panel.matrixWorld);
    _plane.setFromNormalAndCoplanarPoint(normal, center);
    _ray.set(origin, dir);
    if (!_ray.intersectPlane(_plane, _hit)) return null;
    _inv.copy(this.panel.matrixWorld).invert();
    _local.copy(_hit).applyMatrix4(_inv);
    const u = _local.x / W + 0.5;
    const v = 0.5 - _local.y / H;
    if (u < 0 || u > 1 || v < 0 || v > 1) return { button: null, point: _hit.clone(), inside: false };
    const px = u * PW;
    const py = v * PH;
    for (const b of this.buttons) {
      const [x, y, w, h] = b.rect;
      if (px >= x && px <= x + w && py >= y && py <= y + h) return { button: b, point: _hit.clone(), inside: true };
    }
    return { button: null, point: _hit.clone(), inside: true };
  }

  activate(b) {
    if (!b) return;
    const app = this.app;
    const paint = app.paint;
    if (b.confirm && this.armed !== b) {
      this.armed = b;
      this.armedT = 3;
      if (app.audio) app.audio.select(0.1);
      this.redraw();
      return;
    }
    this.armed = null;
    if (b.brush) {
      paint.setBrush(b.brush.id);
      app.events.emit('toast', { text: b.brush.name + ' brush' });
    } else if (b.id === 'smaller') paint.setSize(paint.size * 0.78);
    else if (b.id === 'bigger') paint.setSize(paint.size * 1.28);
    else if (b.id === 'undo') app.controls.undo(app.hands.right);
    else if (b.id === 'sound') app.audio.setMuted(!app.audio.muted);
    else if (b.id === 'clear') app.clearPainting();
    else if (b.id === 'newworld') app.newWorld();
    else if (b.id === 'close') {
      this.close();
      return;
    }
    if (app.audio) app.audio.select(0.6);
    this.redraw();
  }

  update(dt) {
    if (!this.open) return;
    const app = this.app;
    this.pokeCooldown = Math.max(0, this.pokeCooldown - dt);
    if (this.armed) {
      this.armedT -= dt;
      if (this.armedT <= 0) {
        this.armed = null;
        this.redraw();
      }
    }
    let hover = null;
    for (const hand of [app.hands.left, app.hands.right]) {
      const laser = this.lasers[hand.handedness];
      if (!hand.connected || !hand.ray) {
        laser.line.visible = laser.dot.visible = false;
        continue;
      }
      const res = this._hitTest(hand.rayOrigin, hand.rayDir);
      // laser from the controller to the panel (attached to the ray so it tracks perfectly)
      if (laser.line.parent !== hand.ray) hand.ray.add(laser.line);
      const len = res ? res.point.distanceTo(hand.rayOrigin) : 1;
      laser.line.scale.set(1, 1, Math.min(2, len));
      laser.line.visible = res !== null && res.inside;
      laser.line.material.color.copy(app.paint.color);
      laser.line.material.emissive.copy(app.paint.color).multiplyScalar(0.6);
      laser.dot.visible = laser.line.visible;
      if (res) laser.dot.position.copy(res.point);
      if (res && res.inside) {
        hand.uiBlocked = true;
        if (res.button) hover = res.button;
        if (hand.triggerPressed && res.button) {
          hand.pulse(0.5, 40);
          this.activate(res.button);
        }
      }
      // poke with the tip
      if (hand.hasTip && this.pokeCooldown === 0) {
        _inv.copy(this.panel.matrixWorld).invert();
        _local.copy(hand.tip).applyMatrix4(_inv);
        if (Math.abs(_local.z) < 0.02 && Math.abs(_local.x) < W / 2 && Math.abs(_local.y) < H / 2) {
          hand.uiBlocked = true;
          const px = (_local.x / W + 0.5) * PW;
          const py = (0.5 - _local.y / H) * PH;
          const b = this.buttons.find((bb) => px >= bb.rect[0] && px <= bb.rect[0] + bb.rect[2] && py >= bb.rect[1] && py <= bb.rect[1] + bb.rect[3]);
          if (b) {
            this.pokeCooldown = 0.5;
            hand.pulse(0.6, 40);
            this.activate(b);
          }
        }
      }
    }
    if (hover !== this.hover) {
      this.hover = hover;
      this.redraw();
    }
    const p = Math.round(app.world.progress * 100);
    if (p !== this._lastProgress) {
      this._lastProgress = p;
      this.redraw();
    }
  }
}
