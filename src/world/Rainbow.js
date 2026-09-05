import * as THREE from 'three';

/** A soft rainbow arc over the far hills; fades in at the 50% milestone. */
const vert = /* glsl */ `
varying vec2 vUv;
varying float vDist;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDist = distance(wp.xyz, cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const frag = /* glsl */ `
uniform float opacity;
uniform float time;
varying vec2 vUv;
varying float vDist;
vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  // radial position across the tube cross-section: 0 outer edge .. 1 inner edge
  float band = 0.5 - 0.5 * cos(vUv.y * 6.2831);
  vec3 col = hue(band * 0.78);
  col = mix(col, vec3(1.0), 0.18);
  float edge = smoothstep(0.0, 0.12, band) * smoothstep(0.0, 0.12, 1.0 - band);
  float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(0.0, 0.12, 1.0 - vUv.x);
  float shimmer = 0.9 + 0.1 * sin(vUv.x * 40.0 + time * 2.0);
  gl_FragColor = vec4(col * shimmer, opacity * edge * ends * 0.55);
  #include <colorspace_fragment>
}
`;

export class Rainbow {
  constructor(app) {
    this.app = app;
    const geo = new THREE.TorusGeometry(30, 3.2, 12, 72, Math.PI);
    this.material = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 }, time: app.world.uniforms.time },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(6, -6, -38);
    this.mesh.rotation.y = 0.35;
    this.mesh.renderOrder = -5;
    this.mesh.visible = false;
    this.mesh.name = 'rainbow';
    this.target = 0;
  }

  show(on = true) {
    this.target = on ? 1 : 0;
  }

  update(dt) {
    const v = this.material.uniforms.opacity.value;
    const nv = v + (this.target - v) * (1 - Math.exp(-dt * 0.6));
    this.material.uniforms.opacity.value = nv;
    this.mesh.visible = nv > 0.01;
  }
}
