import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Desktop exploration: orbit/zoom right down to the gears with the mouse,
 * click pedestals and in-world buttons, press-and-hold the winding key.
 * Keyboard: W hold to wind, R reset, L life size, M mute.
 */
export class DesktopControls {
  constructor(app, camera, dom) {
    this.app = app;
    this.camera = camera;
    this.dom = dom;
    this.enabled = false;
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 0.04;
    this.orbit.maxDistance = 7;
    this.orbit.zoomSpeed = 0.9;
    this.orbit.zoomToCursor = true;
    this.orbit.enabled = false;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.hover = null;
    this.holding = null;
    this.keyWind = false;
    this.shelfHover = null;
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerdown', (e) => this.onDown(e), true);
    window.addEventListener('pointerup', () => this.onUp());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  enable(on) {
    this.enabled = on;
    this.orbit.enabled = on;
  }

  focus(center, distance = null, instant = false) {
    const target = center.clone();
    const dir = this.camera.position.clone().sub(this.orbit.target);
    if (distance) dir.setLength(distance);
    this.anim = { t: instant ? 1 : 0, fromT: this.orbit.target.clone(), toT: target, fromP: this.camera.position.clone(), toP: target.clone().add(dir) };
  }

  pick(e) {
    const r = this.dom.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const ix = this.app.interaction;
    const hits = this.raycaster.intersectObjects(ix.targets(), false);
    return hits.length ? ix.resolve(hits[0].object) : null;
  }

  onMove(e) {
    if (!this.enabled) return;
    const t = this.pick(e);
    if (this.hover?.button && this.hover.button !== t?.button) this.hover.button.setHover(false);
    if (t?.button) t.button.setHover(true);
    this.hover = t;
    this.shelfHover = t?.kind === 'shelf' ? t.item : null;
    this.dom.style.cursor = t ? 'pointer' : 'grab';
  }

  onDown(e) {
    if (!this.enabled || e.button !== 0) return;
    const t = this.pick(e);
    if (!t) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const app = this.app;
    if (t.kind === 'button') {
      t.button.press();
      app.audio.ui('click');
    } else if (t.kind === 'shelf') {
      if (t.item.entry.comingSoon) app.onStatus?.(`${t.item.entry.name} is still under its dust cloth. Coming soon!`);
      else {
        app.audio.ui('select');
        app.stage.load(t.item);
      }
    } else if (t.kind === 'interaction') {
      this.holding = t.interaction;
      t.interaction.onStart?.();
    }
  }

  onUp() {
    if (this.holding) {
      this.holding.onEnd?.();
      this.holding = null;
    }
  }

  onKey(e, down) {
    if (!this.enabled) return;
    const app = this.app;
    const k = e.key.toLowerCase();
    if (k === 'w') this.setWinding(down);
    if (!down) return;
    if (k === 'r') app.stage.reset();
    if (k === 'l') app.toggleLife();
    if (k === 'm') app.audio.setMuted(!app.audio.muted);
  }

  setWinding(on) {
    const wind = this.app.stage.asset?.interactions.find((i) => i.id === 'wind');
    if (!wind) return;
    if (on && !this.keyWind) wind.onStart?.();
    if (!on && this.keyWind) wind.onEnd?.();
    this.keyWind = on;
  }

  update(dt) {
    if (!this.enabled) return;
    if (this.anim && this.anim.t < 1) {
      const a = this.anim;
      a.t = Math.min(1, a.t + dt / 1.2);
      const e = a.t < 0.5 ? 4 * a.t * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 3) / 2;
      this.orbit.target.lerpVectors(a.fromT, a.toT, e);
      this.camera.position.lerpVectors(a.fromP, a.toP, e);
    }
    if (this.holding) this.holding.onHold?.(dt);
    if (this.keyWind) this.app.stage.asset?.interactions.find((i) => i.id === 'wind')?.onHold?.(dt);
    this.orbit.update();
  }
}
