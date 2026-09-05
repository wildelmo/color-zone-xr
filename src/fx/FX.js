import * as THREE from 'three';
import { ParticlePool } from './Particles.js';

/**
 * Facade for all the sparkle. Sparkles/rockets are additive; confetti,
 * droplets and puffs use normal blending. Drips are droplets whose landing
 * is pre-computed so the ground can splash with colour exactly when they hit.
 */
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _size = new THREE.Vector2();

export class FX {
  constructor(app) {
    this.app = app;
    this.glow = new ParticlePool(app, { capacity: 6000, additive: true });
    this.bits = new ParticlePool(app, { capacity: 4000, additive: false });
    this.group = new THREE.Group();
    this.group.name = 'fx';
    this.group.add(this.glow.points, this.bits.points);
    this.landings = [];
    this.scheduled = [];
    this.rng = app.rng;
  }

  get time() {
    return this.app.time;
  }

  sparkle(p, v, color, life, size, seed = this.rng.float()) {
    this.glow.emit(p.x, p.y, p.z, v.x, v.y, v.z, color.r, color.g, color.b, this.time, life, size, 0, seed);
  }

  /** sparkles along a brush stroke */
  trail(p, color, brushId, radius, vel) {
    const rng = this.rng;
    if (brushId === 'sparkle') {
      for (let k = 0; k < 3; k++) {
        _v.set(rng.gauss() * 0.25, 0.15 + rng.float() * 0.3, rng.gauss() * 0.25).addScaledVector(vel, 0.08);
        _c.copy(color).lerp(new THREE.Color(1, 1, 1), rng.float() * 0.6);
        this.sparkle(_v.clone().multiplyScalar(0).add(p).addScaledVector(_v, 0.01), _v, _c, 0.8 + rng.float() * 1.2, 0.02 + rng.float() * 0.03);
      }
    } else if (brushId === 'cotton') {
      if (rng.chance(0.5)) {
        _v.set(rng.gauss() * 0.08, 0.05 + rng.float() * 0.1, rng.gauss() * 0.08);
        this.bits.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, color.r, color.g, color.b, this.time, 1.2 + rng.float(), 0.03 + radius * 0.6, 3, rng.float());
      }
    } else if (rng.chance(0.55)) {
      _v.set(rng.gauss() * 0.12, 0.08 + rng.float() * 0.15, rng.gauss() * 0.12).addScaledVector(vel, 0.05);
      _c.copy(color).lerp(new THREE.Color(1, 1, 1), 0.3);
      this.sparkle(p, _v, _c, 0.5 + rng.float() * 0.6, 0.012 + rng.float() * 0.018 + radius * 0.2);
    }
  }

  /** radial sparkle burst */
  burst(p, color, n = 20, speed = 1, size = 0.03) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      _v.set(rng.gauss(), rng.gauss(), rng.gauss()).normalize().multiplyScalar(speed * (0.4 + rng.float() * 0.8));
      _c.copy(color).lerp(new THREE.Color(1, 1, 1), rng.float() * 0.5);
      this.sparkle(p, _v, _c, 0.5 + rng.float() * 0.8, size * (0.6 + rng.float() * 0.8));
    }
  }

  confetti(p, n = 20, colors = null, speed = 1.6) {
    const rng = this.rng;
    const pal = colors || this.app.paint.palette;
    for (let i = 0; i < n; i++) {
      _v.set(rng.gauss(), 0.6 + rng.float() * 0.9, rng.gauss()).multiplyScalar(speed * (0.5 + rng.float() * 0.7));
      const c = pal[rng.int(0, pal.length - 1)];
      this.bits.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, c.r, c.g, c.b, this.time, 1.6 + rng.float() * 1.4, 0.025 + rng.float() * 0.02, 1, rng.float());
    }
  }

  confettiSized(p, n, speed, size) {
    const rng = this.rng;
    const pal = this.app.paint.palette;
    for (let i = 0; i < n; i++) {
      _v.set(rng.gauss(), 0.6 + rng.float() * 0.9, rng.gauss()).multiplyScalar(speed * (0.5 + rng.float() * 0.7));
      const c = pal[rng.int(0, pal.length - 1)];
      this.bits.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, c.r, c.g, c.b, this.time, 2.2 + rng.float() * 1.5, size * (0.7 + rng.float() * 0.6), 1, rng.float());
    }
  }

  /** wet paint droplets flying out and falling */
  splash(p, color, n = 24, speed = 2.2) {
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      _v.set(rng.gauss(), 0.5 + rng.float() * 1.2, rng.gauss()).multiplyScalar(speed * (0.4 + rng.float() * 0.8));
      _c.copy(color).multiplyScalar(0.8 + rng.float() * 0.4);
      this.bits.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, _c.r, _c.g, _c.b, this.time, 0.7 + rng.float() * 0.6, 0.02 + rng.float() * 0.03, 2, rng.float());
    }
  }

  /** a drop of colour that falls from p and colours the ground where it lands */
  drip(p, color, radius = 0.9) {
    const world = this.app.world;
    const gy = world.heightAt(p.x, p.z);
    const h = p.y - gy;
    if (h <= 0.05) return;
    const g = 4.0;
    const tl = Math.sqrt((2 * h) / g);
    const rng = this.rng;
    const vx = rng.gauss() * 0.05;
    const vz = rng.gauss() * 0.05;
    this.bits.emit(p.x, p.y, p.z, vx, 0, vz, color.r, color.g, color.b, this.time, tl, 0.035, 2, rng.float());
    this.landings.push({ t: this.time + tl, x: p.x + vx * tl * 0.8, z: p.z + vz * tl * 0.8, color: color.clone(), r: radius });
  }

  /** delayed callback (used for fireworks choreography) */
  schedule(delay, fn) {
    this.scheduled.push({ t: this.time + delay, fn });
  }

  firework(p, color) {
    const rng = this.rng;
    const top = p.clone();
    top.y += 5 + rng.float() * 4;
    top.x += rng.gauss() * 1.5;
    const rise = 1.1;
    _v.set((top.x - p.x) / rise, (top.y - p.y) / rise + 0.5, (top.z - p.z) / rise);
    // rocket trail
    for (let i = 0; i < 18; i++) {
      const t0 = (i / 18) * rise;
      const px = p.x + _v.x * t0;
      const py = p.y + (_v.y - 0.5) * t0;
      const pz = p.z + _v.z * t0;
      this.glow.emit(px, py, pz, 0, -0.3, 0, color.r, color.g, color.b, this.time + t0, 0.6, 0.16, 4, rng.float());
    }
    this.schedule(rise, () => {
      this.burst(top, color, 160, 6.0, 0.3);
      this.confettiSized(top, 60, 3.0, 0.08);
      if (this.app.audio) this.app.audio.fireworkBoom();
      const c2 = new THREE.Color().setHSL(rng.float(), 0.9, 0.65);
      this.schedule(0.3, () => this.burst(top, c2, 80, 4.0, 0.22));
    });
  }

  update(dt, time) {
    const world = this.app.world;
    // drips landing → colour the ground
    if (this.landings.length) {
      const keep = [];
      for (const l of this.landings) {
        if (time >= l.t) {
          world.paintMap.stamp(l.x, l.z, l.r, l.color, 0.6, 0.85);
          _v.set(l.x, world.heightAt(l.x, l.z) + 0.02, l.z);
          this.splash(_v, l.color, 5, 0.7);
          if (this.app.audio) this.app.audio.dripLand();
        } else keep.push(l);
      }
      this.landings = keep;
    }
    if (this.scheduled.length) {
      const keep = [];
      for (const s of this.scheduled) {
        if (time >= s.t) s.fn();
        else keep.push(s);
      }
      this.scheduled = keep;
    }
    this.app.renderer.getDrawingBufferSize(_size);
    this.glow.flush(_size.y);
    this.bits.flush(_size.y);
  }
}
