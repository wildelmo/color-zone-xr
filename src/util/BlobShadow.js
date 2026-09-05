import * as THREE from 'three';

/**
 * A soft dark disc on the ground under a floating thing (Dot, paint balls).
 * Fades and grows as the object rises — the classic cheap grounding trick.
 */
const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const frag = /* glsl */ `
uniform float opacity;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float a = (1.0 - smoothstep(0.45, 1.0, r)) * opacity;
  gl_FragColor = vec4(0.16, 0.12, 0.22, a);
}
`;
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class BlobShadow {
  constructor(app, radius = 0.2) {
    this.app = app;
    this.radius = radius;
    this.material = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0.4 } },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const geo = new THREE.CircleGeometry(1, 24);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 3;
    this.mesh.name = 'blobShadow';
  }

  update(pos, radius = this.radius, maxHeight = 3.5) {
    const world = this.app.world;
    const gy = world.heightAt(pos.x, pos.z);
    const h = Math.max(0, pos.y - gy);
    const k = Math.max(0, 1 - h / maxHeight);
    this.mesh.visible = k > 0.02 && world.terrain.isOnIsland(pos.x, pos.z, 0.5);
    if (!this.mesh.visible) return;
    this.mesh.position.set(pos.x, gy + 0.012, pos.z);
    world.terrain.normalAt(pos.x, pos.z, _n);
    this.mesh.quaternion.setFromUnitVectors(_up, _n);
    const s = radius * (1 + h * 0.25);
    this.mesh.scale.set(s, 1, s);
    this.material.uniforms.opacity.value = 0.5 * k;
  }
}
