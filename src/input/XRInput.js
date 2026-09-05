import { TIP_OFFSET } from './HandState.js';

/**
 * Reads Meta Quest Touch controllers (xr-standard gamepad mapping) and
 * tracked hands, publishing into the shared HandState objects.
 *
 * Touch mapping: buttons[0] trigger, [1] squeeze, [3] thumbstick press,
 * [4] A/X, [5] B/Y; axes[2], axes[3] thumbstick.
 */
export class XRInput {
  constructor(renderer, rig, hands) {
    this.renderer = renderer;
    this.rig = rig;
    this.hands = hands;
    this.slots = [];
    for (let i = 0; i < 2; i++) {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      ray.name = `xr-ray-${i}`;
      grip.name = `xr-grip-${i}`;
      hand.name = `xr-hand-${i}`;
      rig.add(ray, grip, hand);
      const slot = { ray, grip, hand, source: null, state: null, pinching: false };
      ray.addEventListener('connected', (e) => this.onConnected(slot, e.data));
      ray.addEventListener('disconnected', () => this.onDisconnected(slot));
      hand.addEventListener('pinchstart', () => (slot.pinching = true));
      hand.addEventListener('pinchend', () => (slot.pinching = false));
      this.slots.push(slot);
    }
    this.onConnect = null; // callback(handState)
  }

  onConnected(slot, source) {
    let handedness = source.handedness;
    if (handedness !== 'left' && handedness !== 'right') {
      handedness = this.hands.right.connected ? 'left' : 'right';
    }
    const hs = this.hands[handedness];
    slot.source = source;
    slot.state = hs;
    hs.connected = true;
    hs.source = source;
    hs.gamepad = source.gamepad || null;
    hs.isTrackedHand = !!source.hand;
    hs.ray = slot.ray;
    hs.grip = slot.grip;
    hs.handObject = slot.hand;
    if (this.onConnect) this.onConnect(hs, slot);
  }

  onDisconnected(slot) {
    const hs = slot.state;
    if (hs) {
      hs.connected = false;
      hs.gamepad = null;
      hs.trigger = 0;
      hs.squeeze = 0;
      hs.stick.set(0, 0);
      hs.setButtons({});
    }
    slot.source = null;
    slot.state = null;
    slot.pinching = false;
  }

  update(dt) {
    for (const slot of this.slots) {
      const hs = slot.state;
      if (!hs) continue;
      const src = slot.source;
      if (hs.isTrackedHand) {
        // tracked hands: index tip paints, pinch = trigger
        const joints = slot.hand.joints || {};
        const tipJoint = joints['index-finger-tip'];
        if (tipJoint) {
          tipJoint.updateWorldMatrix(true, false);
          hs.tip.setFromMatrixPosition(tipJoint.matrixWorld);
          hs.tipQuat.setFromRotationMatrix(tipJoint.matrixWorld);
          hs.hasTip = true;
        }
        const wrist = joints['wrist'];
        if (wrist) {
          wrist.updateWorldMatrix(true, false);
          hs.rayOrigin.setFromMatrixPosition(wrist.matrixWorld);
          hs.rayDir.set(0, 0, -1).transformDirection(slot.ray.matrixWorld);
        }
        hs.trigger = slot.pinching ? 1 : 0;
        hs.squeeze = 0;
        hs.stick.set(0, 0);
        hs.setButtons({});
      } else {
        hs.updateTipFromRay(TIP_OFFSET);
        const gp = src.gamepad;
        if (gp) {
          const b = gp.buttons;
          const a = gp.axes;
          hs.trigger = b[0] ? b[0].value || (b[0].pressed ? 1 : 0) : 0;
          hs.squeeze = b[1] ? b[1].value || (b[1].pressed ? 1 : 0) : 0;
          const sx = a.length >= 4 ? a[2] : a[0] || 0;
          const sy = a.length >= 4 ? a[3] : a[1] || 0;
          hs.stick.set(Math.abs(sx) < 0.12 ? 0 : sx, Math.abs(sy) < 0.12 ? 0 : sy);
          hs.setButtons({
            primary: !!(b[4] && b[4].pressed),
            secondary: !!(b[5] && b[5].pressed),
            stickDown: !!(b[3] && b[3].pressed),
          });
        }
      }
      hs.commit(dt);
    }
  }
}
