import * as THREE from 'three';

export const TIP_OFFSET = 0.115; // metres from controller ray origin to brush tip

/**
 * Controller-agnostic view of one hand. Filled in each frame by XRInput
 * (real controllers / tracked hands) or DesktopInput (mouse + keyboard), so
 * painting, palette and UI code never care where the input came from.
 */
export class HandState {
  constructor(handedness) {
    this.handedness = handedness;
    this.connected = false;
    this.isTrackedHand = false;
    this.ray = null; // Object3D whose -Z is the pointing direction
    this.grip = null; // Object3D for holding things
    this.gamepad = null;
    this.source = null;

    this.trigger = 0;
    this.triggerDown = false;
    this.triggerPressed = false;
    this.triggerReleased = false;
    this.squeeze = 0;
    this.squeezeDown = false;
    this.squeezePressed = false;
    this.squeezeReleased = false;
    this.primary = false;
    this.primaryPressed = false;
    this.secondary = false;
    this.secondaryPressed = false;
    this.stick = new THREE.Vector2();
    this.stickDown = false;
    this.stickPressed = false;

    this.tip = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.tipVel = new THREE.Vector3();
    this.tipQuat = new THREE.Quaternion();
    this.rayOrigin = new THREE.Vector3();
    this.rayDir = new THREE.Vector3(0, 0, -1);
    this.hasTip = false;
    this.uiBlocked = false;
    this.grabBlocked = false; // a system already used this frame's squeeze (catch/grab) — don't conjure a ball
    this.locoBusy = false;
    this.fist = false; // tracked hands: middle/ring/pinky curled (acts as the squeeze)
    this._pulseT = 0;
  }

  /** derive edge flags from raw values; call once per frame after raw fields are set */
  commit(dt) {
    const td = this.trigger > 0.5;
    this.triggerPressed = td && !this.triggerDown;
    this.triggerReleased = !td && this.triggerDown;
    this.triggerDown = td;
    const sd = this.squeeze > 0.5;
    this.squeezePressed = sd && !this.squeezeDown;
    this.squeezeReleased = !sd && this.squeezeDown;
    this.squeezeDown = sd;
    if (dt > 0 && this.hasTip) {
      this.tipVel.subVectors(this.tip, this.prevTip).divideScalar(dt);
    }
    this.prevTip.copy(this.tip);
    if (this._pulseT > 0) this._pulseT -= dt;
  }

  setButtons({ primary = false, secondary = false, stickDown = false }) {
    this.primaryPressed = primary && !this.primary;
    this.primary = primary;
    this.secondaryPressed = secondary && !this.secondary;
    this.secondary = secondary;
    this.stickPressed = stickDown && !this.stickDown;
    this.stickDown = stickDown;
  }

  /** update tip/ray from the ray object's world matrix */
  updateTipFromRay(tipOffset = TIP_OFFSET) {
    if (!this.ray) return;
    this.ray.updateWorldMatrix(true, false);
    const m = this.ray.matrixWorld;
    this.tip.set(0, 0, -tipOffset).applyMatrix4(m);
    this.rayOrigin.setFromMatrixPosition(m);
    this.rayDir.set(0, 0, -1).transformDirection(m);
    this.tipQuat.setFromRotationMatrix(m);
    this.hasTip = true;
  }

  /** haptic pulse (no-op on desktop / tracked hands) */
  pulse(intensity = 0.5, ms = 30) {
    const act = this.gamepad && this.gamepad.hapticActuators && this.gamepad.hapticActuators[0];
    if (!act || typeof act.pulse !== 'function') return;
    try {
      const p = act.pulse(intensity, ms);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      /* ignore */
    }
  }

  /** rate-limited light buzz used while painting */
  tick(intensity = 0.15, ms = 40) {
    if (this._pulseT > 0) return;
    this._pulseT = ms / 1000;
    this.pulse(intensity, ms);
  }
}
