import * as THREE from 'three';
import { makeLabel } from './Text.js';

/**
 * Short floating messages ("Rainbow brush!", "Butterflies!") that appear
 * in front of you, drift up and fade. Queued so they never overlap.
 */
export class Toast {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'toasts';
    this.queue = [];
    this.active = null;
    this.sprite = makeLabel({ text: '', size: 72, accent: null });
    this.sprite.visible = false;
    this.sprite.renderOrder = 30;
    this.group.add(this.sprite);
    this._head = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._fwd = new THREE.Vector3();
    app.events.on('toast', (t) => this.show(t));
  }

  show({ text, icon = '', duration = 1.8, big = false }) {
    this.queue.push({ text: icon ? `${icon}  ${text}` : text, duration, big });
  }

  update(dt) {
    if (!this.active && this.queue.length) {
      const t = this.queue.shift();
      this.active = { ...t, t: 0 };
      this.sprite.setText(t.text);
      const h = t.big ? 0.36 : 0.26;
      this.sprite.scale.set(this.sprite.userData.aspect * h, h, 1);
      // place in front of the head, a bit below eye level
      this.app.headPosition(this._head);
      this.app.headQuaternion(this._q);
      this._fwd.set(0, 0, -1).applyQuaternion(this._q);
      this._fwd.y = 0;
      if (this._fwd.lengthSq() < 1e-4) this._fwd.set(0, 0, -1);
      this._fwd.normalize();
      this.sprite.position.copy(this._head).addScaledVector(this._fwd, t.big ? 1.8 : 1.3);
      this.sprite.position.y = this._head.y - (t.big ? 0.15 : 0.25);
      this.sprite.visible = true;
      this.base = this.sprite.position.clone();
    }
    const a = this.active;
    if (!a) return;
    a.t += dt;
    const total = a.duration;
    const fadeIn = Math.min(1, a.t / 0.25);
    const fadeOut = Math.min(1, Math.max(0, (total - a.t) / 0.4));
    const alpha = Math.min(fadeIn, fadeOut);
    this.sprite.material.opacity = alpha;
    const pop = 1 + 0.15 * Math.sin(Math.min(1, a.t / 0.25) * Math.PI);
    const h = (a.big ? 0.36 : 0.26) * pop;
    this.sprite.scale.set(this.sprite.userData.aspect * h, h, 1);
    this.sprite.position.copy(this.base);
    this.sprite.position.y += a.t * 0.06;
    if (a.t >= total) {
      this.active = null;
      this.sprite.visible = false;
    }
  }
}
