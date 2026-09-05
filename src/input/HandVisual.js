import * as THREE from 'three';
import { PropMaterial } from '../util/PropMaterial.js';

/**
 * Shows tracked hands as a constellation of glowing beads at each joint,
 * tinted with the current paint colour. No downloaded models needed.
 */
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class HandVisual {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'handVisual';
    this.meshes = {};
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (const key of ['left', 'right']) {
      const mat = new PropMaterial(app.world.uniforms, { color: '#ffffff', emissive: '#3ec9ff', rim: 0.4, gloss: 1.0, opacity: 0.9, transparent: true });
      const mesh = new THREE.InstancedMesh(geo, mat, 25);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = 'hand-' + key;
      this.group.add(mesh);
      this.meshes[key] = mesh;
    }
  }

  update() {
    const app = this.app;
    for (const key of ['left', 'right']) {
      const hand = app.hands[key];
      const mesh = this.meshes[key];
      if (!hand.connected || !hand.isTrackedHand || !hand.handObject) {
        mesh.count = 0;
        continue;
      }
      const joints = hand.handObject.joints || {};
      let n = 0;
      for (const name in joints) {
        const j = joints[name];
        if (!j.visible && j.visible !== undefined && j.jointRadius === undefined) continue;
        j.updateWorldMatrix(true, false);
        _p.setFromMatrixPosition(j.matrixWorld);
        const r = Math.max(0.005, (j.jointRadius || 0.008) * (name.endsWith('tip') ? 1.15 : 0.9));
        _s.setScalar(r);
        _q.identity();
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(n++, _m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.material.emissive.copy(app.paint.color).multiplyScalar(0.5);
    }
  }
}
