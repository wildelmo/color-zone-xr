import * as THREE from 'three';
import { makeCanvas, canvasTexture, roundRect, drawIcon, FONT } from './Text.js';
import { PropMaterial } from '../util/PropMaterial.js';

/**
 * A friendly wooden signpost next to where you start, with big pictures of
 * what to do and a live "world painted" meter.
 */
export class HelpSign {
  constructor(app) {
    this.app = app;
    const shared = app.world.uniforms;
    this.group = new THREE.Group();
    this.group.name = 'helpSign';
    const wood = new PropMaterial(shared, { color: '#b07a4a', rim: 0.15, gloss: 0.2 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.5, 10), wood);
    post.position.y = 0.75;
    this.group.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.78, 0.05), wood);
    board.position.y = 1.55;
    this.group.add(board);
    this.canvas = makeCanvas(1120, 780);
    this.texture = canvasTexture(this.canvas);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.72), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }));
    face.position.set(0, 1.55, 0.027);
    this.group.add(face);
    // a little flower pot of colour at the base
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.1, 10), new PropMaterial(shared, { color: '#ff8c2a', rim: 0.2 }));
    pot.position.set(0.28, 0.05, 0.1);
    this.group.add(pot);
    this._progress = -1;
    this.redraw(0);
    const x = -1.25;
    const z = -2.6;
    this.group.position.set(x, app.world.heightAt(x, z) - 0.02, z);
    this.group.lookAt(0, this.group.position.y, 0);
  }

  redraw(progress) {
    const ctx = this.canvas.getContext('2d');
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff8ea';
    roundRect(ctx, 0, 0, W, H, 40);
    ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `900 74px ${FONT}`;
    const grad = ctx.createLinearGradient(200, 0, 920, 0);
    ['#ff3b5c', '#ff8c2a', '#ffd93d', '#33d872', '#3ec9ff', '#a05cff'].forEach((c, i, arr) => grad.addColorStop(i / (arr.length - 1), c));
    ctx.fillStyle = grad;
    ctx.fillText('Paint the world!', W / 2, 78);
    const rows = [
      ['trigger', 'Pull the trigger to paint in the air'],
      ['hand', 'Dip your wand in an orb to pick a colour'],
      ['bubble', 'Pop bubbles · Squeeze to throw paint'],
      ['sparkle', 'Colour makes flowers, butterflies & rainbows'],
    ];
    rows.forEach(([icon, text], i) => {
      const y = 190 + i * 118;
      ctx.fillStyle = ['#ff6ad5', '#3ec9ff', '#ffd93d', '#33d872'][i];
      roundRect(ctx, 70, y - 44, 88, 88, 24);
      ctx.fill();
      drawIcon(ctx, icon, 114, y, 54, '#ffffff');
      ctx.fillStyle = '#4a3d6b';
      ctx.font = `800 42px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(text, 190, y);
    });
    // progress meter
    const y = 690;
    ctx.fillStyle = '#4a3d6b';
    ctx.font = `800 40px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('World painted', 70, y);
    const px = 400;
    const pw = 560;
    ctx.fillStyle = '#e6e0f5';
    roundRect(ctx, px, y - 20, pw, 40, 20);
    ctx.fill();
    const pg = ctx.createLinearGradient(px, 0, px + pw, 0);
    ['#ff3b5c', '#ffd93d', '#33d872', '#3ec9ff', '#a05cff'].forEach((c, i, arr) => pg.addColorStop(i / (arr.length - 1), c));
    ctx.fillStyle = pg;
    roundRect(ctx, px, y - 20, Math.max(40, pw * progress), 40, 20);
    ctx.fill();
    ctx.fillStyle = '#4a3d6b';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(progress * 100)}%`, px + pw + 16, y);
    this.texture.needsUpdate = true;
  }

  update(dt) {
    // texture uploads aren't free on a headset: refresh the meter at most every 2 s
    this._cooldown = (this._cooldown || 0) - dt;
    if (this._cooldown > 0) return;
    const p = Math.round(this.app.world.progress * 100) / 100;
    if (p !== this._progress) {
      this._progress = p;
      this._cooldown = 2;
      this.redraw(p);
    }
  }
}
