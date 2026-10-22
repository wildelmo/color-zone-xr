/**
 * Module 3 (placeholder): a calm sea out to the horizon.
 * Colored by how far below the horizon you look, from the palette ramp.
 * Glitter, ripples and reflections come in the full water module.
 */
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { COMMON_GLSL, rampGLSL } from './shaderlib.js';

export const WATER_Y = -1.2;

export function createWater() {
  const material = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      ${COMMON_GLSL}
      ${rampGLSL('waterRamp', PALETTE.water)}
      void main() {
        vec2 rel = vWorld.xz - cameraPosition.xz;
        float dist = length(rel);
        float dep = degrees(atan(cameraPosition.y - vWorld.y, dist));
        // Flat, horizontal paint bands that stretch with distance.
        float band = fbm(vec2(vWorld.x * 0.004, vWorld.z * 0.05)) - 0.5;
        vec3 c = waterRamp(max(dep * (1.0 + band * 0.25), 0.0));
        gl_FragColor = vec4(srgbToLinear(dither(c, gl_FragCoord.xy)), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(4000, 96), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WATER_Y;
  mesh.name = 'water';
  return mesh;
}
