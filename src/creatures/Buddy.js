import * as THREE from 'three';
import { PropMaterial, glowTexture } from '../util/PropMaterial.js';
import { makeLabel } from '../ui/Text.js';
import { damp } from '../util/math.js';
import { BlobShadow } from '../util/BlobShadow.js';

/**
 * Dot — a little floating paint-drop friend who hovers at your side,
 * cheers when you paint, spins when bubbles pop and takes on the colour
 * you're using. Squash-and-stretch and blinking keep it feeling alive.
 */
const _head = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();

export function dropGeometry() {
  const pts = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // bottom round, pinching to a tip at the top
    const y = -0.12 + t * 0.3;
    const r = t < 0.55 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.33) / 0.42, 2))) * 0.12 : 0.12 * Math.pow(1 - (t - 0.55) / 0.45, 1.35) * 0.95;
    pts.push(new THREE.Vector2(Math.max(0.004, r), y));
  }
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.computeVertexNormals();
  return geo;
}

export class Buddy {
  constructor(app) {
    this.app = app;
    const shared = app.world.uniforms;
    this.group = new THREE.Group();
    this.group.name = 'buddy';
    this.body = new THREE.Group();
    this.group.add(this.body);

    this.color = new THREE.Color('#7cc7ff');
    this.bodyMat = new PropMaterial(shared, { color: '#7cc7ff', rim: 0.45, gloss: 1.3 });
    const body = new THREE.Mesh(dropGeometry(), this.bodyMat);
    this.body.add(body);

    const white = new PropMaterial(shared, { color: '#ffffff', rim: 0.1, gloss: 0.6 });
    const black = new PropMaterial(shared, { color: '#241b33', rim: 0.0, gloss: 2.0 });
    const pink = new PropMaterial(shared, { color: '#ff9ac4', rim: 0.0, gloss: 0.2 });
    this.eyes = [];
    for (const sx of [-1, 1]) {
      const eye = new THREE.Group();
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), white);
      w.scale.set(1, 1.15, 0.6);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.017, 12, 10), black);
      p.position.set(0, 0.004, 0.02);
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), white);
      hl.position.set(0.006, 0.012, 0.035);
      eye.add(w, p, hl);
      eye.position.set(sx * 0.045, 0.01, 0.095);
      this.body.add(eye);
      this.eyes.push(eye);
      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.014, 12), pink);
      cheek.position.set(sx * 0.085, -0.03, 0.084);
      cheek.lookAt(cheek.position.clone().multiplyScalar(2));
      this.body.add(cheek);
    }
    this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 16, Math.PI), black);
    this.mouth.position.set(0, -0.035, 0.11);
    this.mouth.rotation.z = Math.PI;
    this.body.add(this.mouth);

    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x7cc7ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35 }));
    this.glow.scale.setScalar(0.5);
    this.body.add(this.glow);

    this.bubble = makeLabel({ text: '', size: 60, tail: true });
    this.bubble.position.set(0, 0.36, 0);
    this.bubble.visible = false;
    this.bubble.renderOrder = 31;
    this.group.add(this.bubble);
    this.bubbleT = 0;

    this.pos = new THREE.Vector3(-0.7, 1.35, -1.1);
    this.group.position.copy(this.pos);
    this.vel = new THREE.Vector3();
    this.bob = 0;
    this.blinkT = 2;
    this.blink = 0;
    this.excite = 0; // 0..1 energy
    this.spin = 0;
    this.spinVel = 0;
    this.squash = 0;
    this.idleT = 0;
    this.hintT = 12;
    this.autoHints = true; // generic idle hints; a guide system sets this false and hints situationally instead
    this.sayQueue = [];
    this.yaw = 0;
    this.lookAtTip = 0;
    this.wave = 0;
    this.mood = 'idle';
    this.moodT = 0;
    this.goal = null; // { pos, until } — a place Dot flies to for a while (visit)
    this.shadow = new BlobShadow(app, 0.16);
    this.group.add(this.shadow.mesh);

    const ev = app.events;
    ev.on('paintstart', () => this.react(0.5));
    ev.on('bubblepop', (e) => {
      if (!e || !e.byHand) return; // bubbles dying of old age far away are not news
      this.react(0.9);
      this.setMood('happy', 1.2);
      this.spinVel += 14;
      if (e.byHand) this.say(this.app.rng.pick(['Pop!', 'Nice one!', 'Wheee!', 'Got it!']), 1.4);
    });
    ev.on('splat', () => {
      this.react(1);
      this.spinVel += 10;
      this.say(this.app.rng.pick(['Splat!', 'Whoa!', 'So messy!', 'Love it!']), 1.6);
    });
    ev.on('milestone', (m) => {
      this.react(1);
      this.setMood('happy', 3);
      this.spinVel += 20;
      this.say(m.buddy || 'Amazing!', 3);
    });
    ev.on('color', () => this.react(0.2));
    ev.on('bloom', (n) => {
      if (n > 4) this.react(0.35);
    });
  }

  react(energy) {
    this.excite = Math.min(1, this.excite + energy);
    this.squash = Math.min(1.2, this.squash + energy * 0.8);
    this.idleT = 0;
    this.hintT = 18 + this.app.rng.float() * 10;
  }

  say(text, duration = 2) {
    this.sayQueue.push({ text, duration });
  }

  /** 'surprised' (wide eyes, round mouth) or 'happy' (squinty smile) for a while */
  setMood(mood, duration = 1.5) {
    this.mood = mood;
    this.moodT = duration;
  }

  /** fly to a spot in the world for a few seconds (leading the player, showing something) */
  visit(pos, seconds = 8) {
    if (!this.goal) this.goal = { pos: new THREE.Vector3(), until: 0 };
    this.goal.pos.copy(pos);
    this.goal.until = this.app.time + seconds;
  }

  stopVisit() {
    this.goal = null;
  }

  get visiting() {
    return !!this.goal && this.app.time < this.goal.until;
  }

  /** pop into view right in front of the player (intro) with a little wave */
  summon() {
    const app = this.app;
    app.headPosition(_head);
    app.headQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(_fwd.z, 0, -_fwd.x);
    this.pos.copy(_head).addScaledVector(_fwd, 1.15).addScaledVector(_right, -0.3);
    this.pos.y = _head.y - 0.12;
    this.group.position.copy(this.pos);
    this.wave = 1.6;
    this.react(1);
    this.spinVel += 6;
    if (app.fx) app.fx.burst(this.pos, this.color, 30, 1.2, 0.04);
  }

  update(dt, time) {
    const app = this.app;
    const rng = app.rng;
    app.headPosition(_head);
    app.headQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.set(_fwd.z, 0, -_fwd.x);

    // where it likes to hang out: front-left of the player, a little low
    _target.copy(_head).addScaledVector(_fwd, 1.15).addScaledVector(_right, -0.65);
    _target.y = _head.y - 0.2 + Math.sin(time * 1.3) * 0.05;
    if (this.goal && time < this.goal.until) _target.copy(this.goal.pos);
    else if (this.goal) this.goal = null;
    // stay above ground
    const gy = app.world.heightAt(_target.x, _target.z);
    if (_target.y < gy + 0.5) _target.y = gy + 0.5;
    // only chase when far away so it doesn't jitter with head motion
    const dist = this.pos.distanceTo(_target);
    const lam = this.goal ? 2.2 : dist > 1.6 ? 3.2 : dist > 0.6 ? 1.6 : 0.6;
    this.pos.x = damp(this.pos.x, _target.x, lam, dt);
    this.pos.y = damp(this.pos.y, _target.y, lam, dt);
    this.pos.z = damp(this.pos.z, _target.z, lam, dt);
    this.bob += dt * (2 + this.excite * 6);
    this.group.position.copy(this.pos);
    this.group.position.y += Math.sin(this.bob) * (0.025 + this.excite * 0.06);

    // face the player (yaw), glance at the brush while painting
    const painting = app.brushes.some((b) => b.painting);
    this.lookAtTip = damp(this.lookAtTip, painting ? 1 : 0, 4, dt);
    _look.copy(_head);
    if (painting) {
      const b = app.brushes.find((x) => x.painting);
      _look.lerp(b.hand.tip, this.lookAtTip * 0.7);
    }
    const dx = _look.x - this.group.position.x;
    const dz = _look.z - this.group.position.z;
    const targetYaw = Math.atan2(dx, dz);
    let dy = targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-dt * 6));
    this.spinVel *= Math.exp(-dt * 3.5);
    this.spin += this.spinVel * dt;
    if (Math.abs(this.spinVel) < 0.6) {
      // settle back to facing forward (nearest full turn)
      const rest = Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2;
      this.spin = damp(this.spin, rest, 6, dt);
    }
    this.body.rotation.set(0, this.yaw + this.spin, 0);
    const pitch = Math.atan2(_look.y - this.group.position.y, Math.hypot(dx, dz));
    this.body.rotation.x = -pitch * 0.5;
    this.body.rotation.z = Math.sin(time * 1.7) * 0.06 * (1 + this.excite);
    if (this.wave > 0) {
      this.wave -= dt;
      this.body.rotation.z += Math.sin(time * 14) * 0.35 * Math.min(1, this.wave);
    }

    // squash & stretch
    this.squash = damp(this.squash, 0, 5, dt);
    const s = 1 + Math.sin(this.bob * 2) * 0.05 * this.excite;
    const sy = s * (1 + this.squash * 0.35 * Math.sin(time * 18));
    this.body.scale.set(1 / Math.sqrt(sy) * s, sy, 1 / Math.sqrt(sy) * s);
    this.excite = damp(this.excite, 0, 1.2, dt);

    // colour follows the paint
    this.color.lerp(app.paint.color, 1 - Math.exp(-dt * 0.8));
    this.bodyMat.color.copy(this.color);
    this.bodyMat.emissive.copy(this.color).multiplyScalar(0.12 + this.excite * 0.3);
    this.glow.material.color.copy(this.color);
    this.glow.material.opacity = 0.25 + this.excite * 0.4;

    // grounded by a soft shadow
    this.shadow.mesh.position.set(0, 0, 0);
    this.shadow.update(this.group.position, 0.18, 5);
    this.shadow.mesh.position.sub(this.group.position);

    // blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 1;
      this.blinkT = 1.8 + rng.float() * 3.5;
    }
    this.blink = Math.max(0, this.blink - dt * 9);
    if (this.moodT > 0) {
      this.moodT -= dt;
      if (this.moodT <= 0) this.mood = 'idle';
    }
    let eyeY = 1;
    let eyeXZ = 1;
    let mouthScale = 1;
    let mouthRot = Math.PI; // smile
    if (this.mood === 'surprised') {
      eyeY = 1.3;
      eyeXZ = 1.25;
      mouthScale = 0.7;
      mouthRot = 0; // little "o"-ish frown flips the arc
    } else if (this.mood === 'happy') {
      eyeY = 0.45;
      mouthScale = 1.35;
    }
    const eyeScale = this.blink > 0.5 ? 0.08 : eyeY;
    for (const e of this.eyes) {
      e.scale.y = damp(e.scale.y, eyeScale, 40, dt);
      e.scale.x = damp(e.scale.x, eyeXZ, 12, dt);
      e.scale.z = damp(e.scale.z, eyeXZ, 12, dt);
    }
    this.mouth.scale.x = damp(this.mouth.scale.x, mouthScale, 12, dt);
    this.mouth.scale.y = damp(this.mouth.scale.y, mouthScale, 12, dt);
    this.mouth.rotation.z = damp(this.mouth.rotation.z, mouthRot, 10, dt);

    // speech
    if (this.bubbleT > 0) {
      this.bubbleT -= dt;
      const a = Math.min(1, this.bubbleT / 0.3);
      this.bubble.material.opacity = a;
      this.bubble.position.y = 0.34 + Math.sin(this.bob) * 0.01;
      if (this.bubbleT <= 0) this.bubble.visible = false;
    } else if (this.sayQueue.length) {
      const s = this.sayQueue.shift();
      if (app.audio) app.audio.chatter(s.text, this.group.position, this.mood);
      this.bubble.setText(s.text);
      const h = 0.14;
      this.bubble.scale.set(this.bubble.userData.aspect * h, h, 1);
      this.bubble.visible = true;
      this.bubbleT = s.duration;
    }

    // gentle nudges if the player is idle
    this.idleT += dt;
    this.hintT -= dt;
    if (this.autoHints && this.hintT <= 0 && !painting) {
      this.hintT = 22 + rng.float() * 10;
      this.react(0.6);
      const p = app.world.progress;
      const hints = p < 0.05 ? ['Pull the trigger to paint!', 'Paint the grey world!', 'Try touching a colour orb!'] : p < 0.5 ? ['Pop a bubble!', 'Squeeze to throw paint!', 'Paint near the trees!', 'Press B for a new brush!'] : ['Keep going, almost there!', 'The rainbow is watching!', 'Paint the far hills!'];
      this.say(rng.pick(hints), 2.6);
    }
  }
}
