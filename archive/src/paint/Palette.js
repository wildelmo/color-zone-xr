import * as THREE from 'three';
import { PALETTE } from '../config.js';
import { PropMaterial } from '../util/PropMaterial.js';
import { makeLabel } from '../ui/Text.js';

/**
 * A crown of glossy colour orbs around the left controller. Dip the other
 * wand's tip into an orb to pick that colour — no buttons, no menus.
 */
export class Palette {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'palette';
    this.group.visible = false;
    const n = PALETTE.length;
    this.n = n;
    this.radius = 0.072;
    this.positions = [];
    const geo = new THREE.SphereGeometry(0.0125, 18, 12);
    this.material = new PropMaterial(app.world.uniforms, { color: '#ffffff', rim: 0.5, gloss: 1.2, instanceColor: true });
    this.mesh = new THREE.InstancedMesh(geo, this.material, n);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.name = 'palette-orbs';
    this.mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    // arc from 25° to 335°, leaving the front open where the wand is
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const a = THREE.MathUtils.degToRad(25 + t * 310) + Math.PI / 2;
      const p = new THREE.Vector3(Math.cos(a) * this.radius, 0.028, Math.sin(a) * this.radius + 0.02);
      this.positions.push(p);
      m.makeTranslation(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, new THREE.Color(PALETTE[i].hex));
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.group.add(this.mesh);

    // selection ring + hub
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0022, 8, 28), new PropMaterial(app.world.uniforms, { color: '#ffffff', emissive: '#ffffff', rim: 0 }));
    this.ring.name = 'palette-ring';
    this.group.add(this.ring);
    this.hub = new THREE.Mesh(new THREE.TorusGeometry(this.radius, 0.0018, 6, 48, THREE.MathUtils.degToRad(310)), new PropMaterial(app.world.uniforms, { color: '#ffffff', rim: 0.2, gloss: 0.3, opacity: 0.55, transparent: true }));
    this.hub.rotation.x = Math.PI / 2;
    this.hub.rotation.z = THREE.MathUtils.degToRad(25) + Math.PI / 2;
    this.hub.position.set(0, 0.028, 0.02);
    this.group.add(this.hub);

    this.label = makeLabel({ text: '', size: 52, padding: 22, width: 640 });
    this.label.visible = false;
    this.label.renderOrder = 28;
    this.group.add(this.label);
    this.labelT = 0;
    this.scales = new Float32Array(n).fill(1);
    this.hover = -1;
    this._m = new THREE.Matrix4();
    this._w = new THREE.Vector3();
    this._parent = null;
    this.hidden = false;
  }

  attachTo(hand) {
    let parent = hand.ray;
    let offset = null;
    if (hand.isTrackedHand) {
      // tracked hands: the crown sits on the back of the hand
      const wrist = hand.handObject && hand.handObject.joints && hand.handObject.joints['wrist'];
      if (!wrist) {
        this.group.visible = false;
        return;
      }
      parent = wrist;
      offset = [0, 0.05, -0.07];
    }
    if (this._parent !== parent) {
      parent.add(this.group);
      this._parent = parent;
    }
    this.group.visible = !this.hidden;
    if (offset) this.group.position.set(offset[0], offset[1], offset[2]);
    else this.group.position.set(0, 0, 0);
  }

  update(dt) {
    const app = this.app;
    const L = app.hands.left;
    const R = app.hands.right;
    if (!L.connected || !L.ray) {
      this.group.visible = false;
      return;
    }
    this.attachTo(L);
    if (!this.group.visible) return;
    this.group.updateWorldMatrix(true, false);
    const sel = app.paint.colorIndex;
    let hover = -1;
    let hoverD = 0.03;
    if (R.connected && R.hasTip) {
      for (let i = 0; i < this.n; i++) {
        this._w.copy(this.positions[i]).applyMatrix4(this.group.matrixWorld);
        const d = this._w.distanceTo(R.tip);
        if (d < hoverD) {
          hoverD = d;
          hover = i;
        }
      }
    }
    if (hover >= 0) {
      R.uiBlocked = true;
      if (hover !== this.hover) {
        app.paint.setColorIndex(hover);
        this.label.setText(PALETTE[hover].name);
        this.label.scale.set(this.label.userData.aspect * 0.045, 0.045, 1);
        const lp = this.positions[hover];
        this.label.position.set(lp.x, lp.y + 0.045, lp.z);
        this.label.visible = true;
        this.labelT = 1.4;
        R.pulse(0.6, 40);
        L.pulse(0.3, 30);
        if (app.audio) app.audio.select(hover / this.n);
        if (app.fx) {
          this._w.copy(this.positions[hover]).applyMatrix4(this.group.matrixWorld);
          app.fx.burst(this._w, app.paint.color, 10, 0.35);
        }
      }
    }
    this.hover = hover;
    if (this.labelT > 0) {
      this.labelT -= dt;
      this.label.material.opacity = Math.min(1, this.labelT / 0.3);
      if (this.labelT <= 0) this.label.visible = false;
    }
    // animate orb scales
    for (let i = 0; i < this.n; i++) {
      const target = i === hover ? 1.55 : i === sel ? 1.25 : 1;
      this.scales[i] += (target - this.scales[i]) * (1 - Math.exp(-dt * 18));
      const p = this.positions[i];
      this._m.makeScale(this.scales[i], this.scales[i], this.scales[i]).setPosition(p.x, p.y + (i === sel ? 0.006 : 0), p.z);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    const sp = this.positions[sel];
    this.ring.position.set(sp.x, sp.y + 0.006, sp.z);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.material.emissive.copy(app.paint.color).multiplyScalar(0.6);
    this.ring.material.color.copy(app.paint.color).lerp(new THREE.Color(1, 1, 1), 0.5);
  }
}
