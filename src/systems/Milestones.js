import * as THREE from 'three';
import { MILESTONES } from '../config.js';
import { Rainbow } from '../world/Rainbow.js';

/**
 * The reward loop: 25% butterflies, 50% rainbow, 75% the sun smiles,
 * 100% fireworks + fanfare. Each step is a big visible/audible moment.
 */
const _head = new THREE.Vector3();

export class Milestones {
  constructor(app) {
    this.app = app;
    this.reached = new Set();
    this.rainbow = new Rainbow(app);
    app.scene.add(this.rainbow.mesh);
    this.smile = 0;
    this.smileTarget = 0;
    this.fireworksT = 0;
    this.fireworksLeft = 0;
    this.finaleDone = false;
    app.events.on('reset', () => this.reset());
  }

  reset() {
    this.reached.clear();
    this.rainbow.show(false);
    this.smileTarget = 0;
    this.fireworksLeft = 0;
    this.finaleDone = false;
    this.app.butterflies.reset();
  }

  trigger(m) {
    const app = this.app;
    this.reached.add(m.id);
    app.headPosition(_head);
    const level = MILESTONES.indexOf(m);
    app.events.emit('milestone', { ...m, level, buddy: ['Butterflies!', 'A rainbow!', 'The sun is happy!', 'WE DID IT!'][level] });
    app.events.emit('toast', { text: m.title, duration: 3, big: true });
    if (app.audio) {
      if (m.id === 'finale') app.audio.fanfare();
      else app.audio.milestone(level);
    }
    if (app.fx) {
      const p = _head.clone();
      p.y += 0.3;
      app.fx.confetti(p, 60 + level * 30, null, 2.2);
      app.fx.burst(p, new THREE.Color('#ffffff'), 30, 1.5, 0.05);
    }
    if (m.id === 'butterflies') app.butterflies.enable();
    if (m.id === 'rainbow') this.rainbow.show(true);
    if (m.id === 'sunshine') this.smileTarget = 1;
    if (m.id === 'finale') {
      this.fireworksLeft = 14;
      this.fireworksT = 0.5;
      this.finaleDone = true;
    }
  }

  /** re-apply persistent effects from a saved game without re-celebrating */
  restore(ids) {
    for (const id of ids) {
      this.reached.add(id);
      if (id === 'butterflies') this.app.butterflies.enable();
      if (id === 'rainbow') this.rainbow.show(true);
      if (id === 'sunshine') this.smileTarget = 1;
    }
  }

  /** debug/test hook: jump straight to a milestone's celebration */
  force(id) {
    const m = MILESTONES.find((x) => x.id === id);
    if (m && !this.reached.has(m.id)) this.trigger(m);
  }

  update(dt) {
    const app = this.app;
    const p = app.world.progress;
    for (const m of MILESTONES) {
      if (!this.reached.has(m.id) && p >= m.at) {
        this.trigger(m);
        break; // one per frame so celebrations don't pile up
      }
    }
    this.rainbow.update(dt);
    this.smile += (this.smileTarget - this.smile) * (1 - Math.exp(-dt * 0.8));
    app.world.sky.setSmile(this.smile);
    if (this.fireworksLeft > 0) {
      this.fireworksT -= dt;
      if (this.fireworksT <= 0) {
        this.fireworksLeft--;
        this.fireworksT = 0.5 + app.rng.float() * 0.6;
        app.headPosition(_head);
        const a = app.rng.float() * Math.PI * 2;
        const d = 6 + app.rng.float() * 10;
        const base = new THREE.Vector3(_head.x + Math.cos(a) * d, 0, _head.z + Math.sin(a) * d);
        base.y = app.world.heightAt(base.x, base.z) + 1;
        const col = app.paint.palette[app.rng.int(0, 11)];
        app.fx.firework(base, col);
        if (app.audio) app.audio.fireworkLaunch();
      }
    }
  }
}
