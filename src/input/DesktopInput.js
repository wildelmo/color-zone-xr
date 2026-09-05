import * as THREE from 'three';
import { WORLD } from '../config.js';
import { clamp } from '../util/math.js';

/**
 * Mouse + keyboard stand-in for a headset so the experience can be explored
 * (and automatically tested) on a normal computer. Produces the same
 * HandState data the XR path does: a virtual wand floats in front of you.
 */
export class DesktopInput {
  constructor(app) {
    this.app = app;
    this.camera = app.camera;
    this.rig = app.rig;
    this.canvas = app.renderer.domElement;
    this.hands = app.hands;
    this.enabled = false;
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0 };
    this.pos = new THREE.Vector3(0, 0, 0);
    this.locked = false;

    this.rightRay = new THREE.Object3D();
    this.rightRay.name = 'desktop-right';
    this.rightRay.position.set(0.3, -0.24, -0.5);
    this.rightRay.rotation.set(0.35, -0.15, 0);
    this.leftRay = new THREE.Object3D();
    this.leftRay.name = 'desktop-left';
    this.leftRay.position.set(-0.32, -0.28, -0.45);
    this.leftRay.rotation.set(0.6, 0.35, 0);
    this.camera.add(this.rightRay, this.leftRay);
    this.rightSway = 0;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      this.app.onDesktopKey && this.app.onDesktopKey(e.code, e);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.enabled) return;
      if (this.locked || e.buttons & 4) {
        this.mouse.dx += e.movementX;
        this.mouse.dy += e.movementY;
      }
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      this.mouse.buttons |= 1 << e.button;
      if (!this.locked && this.canvas.requestPointerLock) {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      }
      e.preventDefault();
    };
    this._onMouseUp = (e) => {
      this.mouse.buttons &= ~(1 << e.button);
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      this.mouse.wheel += e.deltaY;
      e.preventDefault();
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  enable() {
    this.enabled = true;
    const L = this.hands.left;
    const R = this.hands.right;
    L.connected = R.connected = true;
    L.ray = L.grip = this.leftRay;
    R.ray = R.grip = this.rightRay;
    this.app.onHandConnected && this.app.onHandConnected(L);
    this.app.onHandConnected && this.app.onHandConnected(R);
  }

  disable() {
    this.enabled = false;
    this.hands.left.connected = this.hands.right.connected = false;
    if (document.exitPointerLock && this.locked) document.exitPointerLock();
  }

  /** scripted look for tests */
  setLook(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    this.yaw -= this.mouse.dx * 0.0022;
    this.pitch = clamp(this.pitch - this.mouse.dy * 0.0022, -1.4, 1.4);
    this.mouse.dx = this.mouse.dy = 0;
    if (k.has('ArrowLeft')) this.yaw += 1.6 * dt;
    if (k.has('ArrowRight')) this.yaw -= 1.6 * dt;
    if (k.has('ArrowUp')) this.pitch = clamp(this.pitch + 1.2 * dt, -1.4, 1.4);
    if (k.has('ArrowDown')) this.pitch = clamp(this.pitch - 1.2 * dt, -1.4, 1.4);

    const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? 6 : 3) * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();
    if (k.has('KeyW')) move.add(fwd);
    if (k.has('KeyS')) move.sub(fwd);
    if (k.has('KeyD')) move.add(right);
    if (k.has('KeyA')) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      const nx = this.pos.x + move.x;
      const nz = this.pos.z + move.z;
      const terrain = this.app.world.terrain;
      if (terrain.isOnIsland(nx, nz, 1.5) && !terrain.isWater(nx, nz)) {
        this.pos.x = nx;
        this.pos.z = nz;
        // footprints of colour
        this.stepAcc = (this.stepAcc || 0) + speed;
        if (this.stepAcc > 1.5) {
          this.stepAcc = 0;
          this.app.world.paintMap.stamp(nx, nz, 0.45, this.app.paint.color, 0.5, 0.85);
        }
      }
    }
    this.pos.y = this.app.world.heightAt(this.pos.x, this.pos.z);
    this.rig.position.copy(this.pos);
    this.rig.rotation.set(0, 0, 0);
    this.camera.position.set(0, WORLD.eyeHeight, 0);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // gentle wand sway so desktop strokes look hand-drawn
    this.rightSway += dt;
    this.rightRay.position.set(0.3 + Math.sin(this.rightSway * 1.7) * 0.004, -0.24 + Math.cos(this.rightSway * 2.1) * 0.004, -0.5);

    const R = this.hands.right;
    const L = this.hands.left;
    R.trigger = this.mouse.buttons & 1 ? 1 : 0;
    R.squeeze = this.mouse.buttons & 2 ? 1 : 0;
    R.setButtons({ primary: k.has('KeyZ'), secondary: k.has('Tab'), stickDown: false });
    R.stick.set(0, 0);
    if (this.mouse.wheel !== 0) {
      R.stick.y = this.mouse.wheel > 0 ? 1 : -1;
      this.mouse.wheel = 0;
    }
    if (k.has('KeyE')) R.stick.y = -1; // bigger
    if (k.has('KeyQ')) R.stick.y = 1; // smaller
    L.trigger = 0;
    L.squeeze = 0;
    L.setButtons({ primary: k.has('KeyM'), secondary: k.has('KeyZ'), stickDown: false });
    L.stick.set(0, 0);
    R.updateTipFromRay();
    L.updateTipFromRay();
    R.commit(dt);
    L.commit(dt);
  }
}
