import * as THREE from 'three';
import { PropMaterial, glowTexture } from '../util/PropMaterial.js';
import { TIP_OFFSET } from '../input/HandState.js';

/**
 * The magic paintbrush shown in each hand: a slim handle, a glowing tip in
 * the current colour, a size ring, and a soft additive halo.
 * With hand tracking the handle hides and the glow rides the index fingertip.
 */
export class Wand {
  constructor(app, hand) {
    this.app = app;
    this.hand = hand;
    const shared = app.world.uniforms;
    this.group = new THREE.Group();
    this.group.name = 'wand-' + hand.handedness;

    const handleGeo = new THREE.CylinderGeometry(0.0065, 0.0085, 0.125, 12);
    handleGeo.rotateX(Math.PI / 2);
    handleGeo.translate(0, 0, -0.045);
    this.handleMat = new PropMaterial(shared, { color: '#f4f0ff', rim: 0.25, gloss: 0.9 });
    this.handle = new THREE.Mesh(handleGeo, this.handleMat);
    const bandGeo = new THREE.CylinderGeometry(0.0095, 0.0095, 0.014, 12);
    bandGeo.rotateX(Math.PI / 2);
    bandGeo.translate(0, 0, -0.098);
    this.bandMat = new PropMaterial(shared, { color: '#ffd93d', rim: 0.3, gloss: 1.4 });
    this.band = new THREE.Mesh(bandGeo, this.bandMat);
    const endGeo = new THREE.SphereGeometry(0.0095, 14, 10);
    endGeo.translate(0, 0, 0.018);
    this.endCap = new THREE.Mesh(endGeo, new PropMaterial(shared, { color: '#a05cff', rim: 0.3, gloss: 1.2 }));
    this.group.add(this.handle, this.band, this.endCap);

    this.tipGroup = new THREE.Group();
    this.tipGroup.position.set(0, 0, -TIP_OFFSET);
    this.tipMat = new PropMaterial(shared, { color: '#ffffff', emissive: '#3ec9ff', rim: 0.1, gloss: 1.5 });
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.011, 18, 14), this.tipMat);
    this.tipGroup.add(this.tip);
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x3ec9ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.setScalar(0.09);
    this.tipGroup.add(this.glow);
    this.ringMat = new PropMaterial(shared, { color: '#ffffff', emissive: '#ffffff', rim: 0, opacity: 0.7, transparent: true });
    this.sizeRing = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 32), this.ringMat);
    this.tipGroup.add(this.sizeRing);
    this.group.add(this.tipGroup);
    this.pulse = 0;
    this._parent = null;
  }

  update(dt, time) {
    const h = this.hand;
    const app = this.app;
    if (!h.connected || !h.ray) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (h.isTrackedHand) {
      // ride the fingertip in world space
      if (this._parent !== app.scene) {
        app.scene.add(this.group);
        this._parent = app.scene;
      }
      this.handle.visible = this.band.visible = this.endCap.visible = false;
      this.group.position.copy(h.tip);
      this.group.quaternion.copy(h.tipQuat);
      this.tipGroup.position.set(0, 0, 0);
    } else {
      if (this._parent !== h.ray) {
        h.ray.add(this.group);
        this._parent = h.ray;
        this.group.position.set(0, 0, 0);
        this.group.quaternion.identity();
      }
      this.handle.visible = this.band.visible = this.endCap.visible = true;
      this.tipGroup.position.set(0, 0, -TIP_OFFSET);
    }
    const c = app.paint.color;
    this.tipMat.emissive.copy(c).multiplyScalar(0.9);
    this.tipMat.color.copy(c).lerp(new THREE.Color(1, 1, 1), 0.55);
    this.glow.material.color.copy(c);
    const painting = app.brushes && app.brushes.some((b) => b.hand === h && b.painting);
    this.pulse += ((painting ? 1 : 0) - this.pulse) * (1 - Math.exp(-dt * 12));
    const hint = app.hintPulse ? 0.5 + 0.5 * Math.sin(time * 7) : 0;
    const breathe = 1 + Math.sin(time * 6) * 0.06 * this.pulse + Math.sin(time * 2.1) * 0.03;
    this.glow.scale.setScalar((0.07 + this.pulse * 0.05 + app.paint.size * 1.2 + hint * 0.09) * breathe);
    this.glow.material.opacity = 0.6 + 0.35 * this.pulse + hint * 0.3;
    const r = app.paint.size + 0.004;
    this.sizeRing.scale.setScalar(r);
    this.sizeRing.visible = h.handedness === 'right' || !app.hands.right.connected;
    this.ringMat.uniforms.opacity.value = 0.35 + 0.4 * this.pulse;
    this.ringMat.emissive.copy(c).multiplyScalar(0.7);
  }
}
