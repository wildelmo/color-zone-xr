import * as THREE from 'three';
import { WORLD } from '../config.js';

/**
 * A little pond that turns from pencil-grey to sparkling blue when colour
 * reaches it. Cheap animated ripples + a sun glint + fresnel sky reflection.
 */
const vert = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const frag = /* glsl */ `
uniform sampler2D paintMap;
uniform vec4 mapRect;
uniform vec3 sunDir;
uniform vec3 skyLight;
uniform vec3 fogColor;
uniform vec2 fogRange;
uniform float time;
uniform float worldColor;
uniform vec2 center;
uniform float radius;
varying vec3 vWorldPos;
void main() {
  vec2 uv = (vWorldPos.xz - mapRect.xy) / mapRect.zw;
  vec4 pm = texture2D(paintMap, uv);
  float cov = pm.a;
  vec3 pcol = pm.rgb / max(cov, 0.002);
  float reveal = smoothstep(0.05, 0.5, cov);
  float d = distance(vWorldPos.xz, center) / radius;
  vec3 deepG = vec3(0.70, 0.68, 0.71);
  vec3 shallowG = vec3(0.86, 0.84, 0.82);
  vec3 deepC = vec3(0.08, 0.42, 0.85);
  vec3 shallowC = vec3(0.25, 0.75, 0.95);
  vec3 grey = mix(deepG, shallowG, d);
  vec3 blue = mix(deepC, shallowC, d);
  blue = mix(blue, pcol * 0.6 + blue * 0.5, 0.35);
  vec3 col = mix(grey, blue, reveal);

  // ripples
  float t = time * 1.4;
  vec3 n = normalize(vec3(
    sin(vWorldPos.x * 2.7 + t) * 0.06 + sin(vWorldPos.z * 3.9 - t * 1.3) * 0.04,
    1.0,
    cos(vWorldPos.z * 2.3 + t * 0.8) * 0.06 + cos(vWorldPos.x * 4.1 - t) * 0.04));
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 R = reflect(-sunDir, n);
  float spec = pow(max(dot(R, V), 0.0), 90.0) * (0.6 + 1.2 * reveal);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col = mix(col, skyLight * 1.4, fres * 0.6);
  col += spec;
  // sparkle ring where colour meets grey
  float edge = smoothstep(0.0, 0.16, cov) * (1.0 - smoothstep(0.16, 0.5, cov));
  col += (pcol * 0.8 + 0.2) * edge * (0.7 + 0.3 * sin(time * 5.0 + vWorldPos.x * 4.0));
  float dist = distance(vWorldPos, cameraPosition);
  col = mix(col, fogColor, smoothstep(fogRange.x, fogRange.y, dist));
  gl_FragColor = vec4(col, 0.92);
  #include <colorspace_fragment>
}
`;

export class Pond {
  constructor(world) {
    const p = WORLD.pond;
    const geo = new THREE.CircleGeometry(p.radius * 0.96, 40);
    geo.rotateX(-Math.PI / 2);
    const u = world.uniforms;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        paintMap: u.paintMap,
        mapRect: u.mapRect,
        sunDir: u.sunDir,
        skyLight: u.skyLight,
        fogColor: u.fogColor,
        fogRange: u.fogRange,
        time: u.time,
        worldColor: u.worldColor,
        center: { value: new THREE.Vector2(p.x, p.z) },
        radius: { value: p.radius },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(p.x, world.terrain.waterLevel, p.z);
    this.mesh.renderOrder = 5;
    this.mesh.name = 'pond';
  }
}
