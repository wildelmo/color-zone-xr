import * as THREE from 'three';
import { Stroke } from '../paint/Stroke.js';
import { StrokeMaterial } from '../paint/StrokeMaterial.js';
import { PropMaterial } from '../util/PropMaterial.js';

/**
 * Comfort-first movement for kids: push the left stick forward to show a
 * glowing arc, let go to teleport (with a soft blink). Flick the right
 * stick to snap-turn 30°. No smooth locomotion, no motion sickness.
 */
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _head = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const GOOD = new THREE.Color('#5cf2c2');
const BAD = new THREE.Color('#ff5c7a');

export class Locomotion {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'locomotion';
    this.aiming = false;
    this.valid = false;
    this.target = new THREE.Vector3();
    this.arcMat = new StrokeMaterial(app.world.uniforms);
    this.arc = null;
    this.arcMesh = null;
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.025, 8, 40), new PropMaterial(app.world.uniforms, { color: '#ffffff', emissive: '#5cf2c2', rim: 0 }));
    ring.rotation.x = Math.PI / 2;
    this.ringMat = ring.material;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), new PropMaterial(app.world.uniforms, { color: '#5cf2c2', emissive: '#5cf2c2', opacity: 0.35, transparent: true, rim: 0, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    this.discMat = disc.material;
    this.marker.add(ring, disc);
    this.marker.visible = false;
    this.group.add(this.marker);
    this.turnFlick = 0;
    this.fadeT = 0;
    // blink sphere around the camera
    this.fade = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false }));
    this.fade.renderOrder = 100;
    this.fade.visible = false;
    app.camera.add(this.fade);
    this.teleports = 0;
    this.turns = 0;
  }

  _rebuildArc(points, color) {
    if (this.arcMesh) {
      this.group.remove(this.arcMesh);
      this.arc.dispose();
    }
    this.arc = new Stroke({ maxPoints: points.length + 4, sides: 8 });
    for (const p of points) this.arc.addPoint(p, 0.012, color);
    this.arc.end();
    this.arcMesh = new THREE.Mesh(this.arc.geometry, this.arcMat);
    this.arcMesh.frustumCulled = false;
    this.group.add(this.arcMesh);
  }

  _hideArc() {
    if (this.arcMesh) {
      this.group.remove(this.arcMesh);
      this.arc.dispose();
      this.arcMesh = null;
      this.arc = null;
    }
    this.marker.visible = false;
  }

  /** fade in from black (session start) */
  fadeIn(duration = 1) {
    this.fadeT = duration;
    this.fadeDur = duration;
    this.fade.visible = true;
    this.fade.material.opacity = 1;
  }

  teleportTo(x, z) {
    const app = this.app;
    app.headPosition(_head);
    const rig = app.rig;
    // keep the head's offset inside the rig; move so the head lands on target
    rig.position.x += x - _head.x;
    rig.position.z += z - _head.z;
    rig.position.y = app.world.heightAt(x, z);
    if (app.mode === 'desktop') app.desktop.pos.set(x, rig.position.y, z);
    this.fadeT = 0.35;
    this.fadeDur = 0;
    this.fade.visible = true;
    this.teleports++;
    if (app.audio) app.audio.teleport();
    app.events.emit('teleport', { x, z });
  }

  snapTurn(dir) {
    const app = this.app;
    app.headPosition(_head);
    const rig = app.rig;
    const angle = dir * THREE.MathUtils.degToRad(30);
    // rotate the rig around the head's vertical axis so the player stays put
    _q.setFromAxisAngle(_up, angle);
    _v.subVectors(rig.position, _head);
    _v.applyQuaternion(_q);
    rig.position.copy(_head).add(_v);
    rig.quaternion.premultiply(_q);
    this.turns++;
    if (app.mode === 'desktop') app.desktop.yaw += angle;
    if (app.audio) app.audio.snapTurn();
  }

  update(dt) {
    const app = this.app;
    const L = app.hands.left;
    const R = app.hands.right;
    // blink fade
    if (this.fadeT > 0) {
      this.fadeT -= dt;
      const dur = this.fadeDur || 0.2;
      const a = Math.min(1, this.fadeT / dur);
      this.fade.material.opacity = a * (this.fadeDur ? 1 : 0.9);
      if (this.fadeT <= 0) {
        this.fade.visible = false;
        this.fadeDur = 0;
      }
    }
    // snap turn on right stick flick
    if (R.connected && app.renderer.xr.isPresenting) {
      const x = R.stick.x;
      if (this.turnFlick === 0 && Math.abs(x) > 0.65 && Math.abs(R.stick.y) < 0.5) {
        this.turnFlick = Math.sign(x);
        this.snapTurn(-this.turnFlick);
      } else if (Math.abs(x) < 0.3) this.turnFlick = 0;
    }
    // teleport aim on left stick forward
    const want = L.connected && L.stick.y < -0.6 && !L.uiBlocked;
    if (want) {
      this.aiming = true;
      L.locoBusy = true;
      _o.copy(L.rayOrigin);
      _d.copy(L.rayDir);
      // launch along the pointing direction, lofted a little so it lands nicely
      _v.copy(_d).multiplyScalar(6.5);
      _v.y += 2.0;
      const pts = [];
      let landed = false;
      let x = 0;
      let z = 0;
      _p.copy(_o);
      const step = 0.045;
      for (let i = 0; i < 80; i++) {
        pts.push(_p.clone());
        _v.y -= 9.8 * step;
        _p.addScaledVector(_v, step);
        const gy = app.world.heightAt(_p.x, _p.z);
        if (_p.y <= gy) {
          x = _p.x;
          z = _p.z;
          _p.y = gy;
          pts.push(_p.clone());
          landed = true;
          break;
        }
      }
      const terrain = app.world.terrain;
      this.valid = landed && terrain.isOnIsland(x, z, 2.2) && !terrain.isWater(x, z) && terrain.slopeAt(x, z) < 0.55;
      _c.copy(this.valid ? GOOD : BAD);
      this._rebuildArc(pts, _c);
      if (landed) {
        this.target.set(x, app.world.heightAt(x, z) + 0.02, z);
        this.marker.visible = true;
        this.marker.position.copy(this.target);
        terrain.normalAt(x, z, _n);
        this.marker.quaternion.setFromUnitVectors(_up, _n);
        const pulse = 1 + Math.sin(app.time * 8) * 0.08;
        this.marker.scale.setScalar(pulse);
        this.ringMat.emissive.copy(_c);
        this.discMat.color.copy(_c);
        this.discMat.emissive.copy(_c).multiplyScalar(0.5);
      } else this.marker.visible = false;
    } else if (this.aiming) {
      this.aiming = false;
      L.locoBusy = false;
      if (this.valid) this.teleportTo(this.target.x, this.target.z);
      else if (app.audio) app.audio.select(0.05);
      this._hideArc();
      this.valid = false;
    }
  }
}
