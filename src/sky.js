/**
 * Module 2a: the painted sky dome.
 * A huge inside-out sphere colored by elevation angle from the palette ramp,
 * with faint horizontal brush streaks so it reads as paint, not a CG gradient.
 */
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { COMMON_GLSL, rampGLSL } from './shaderlib.js';

export const SKY_RADIUS = 4500;

export function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      ${COMMON_GLSL}
      ${rampGLSL('skyRamp', PALETTE.sky)}
      void main() {
        vec3 d = normalize(vDir);
        float elev = degrees(asin(clamp(d.y, -1.0, 1.0)));
        float az = atan(d.x, d.z);

        // Long, soft horizontal strokes: nudge the ramp position a little.
        float streak = fbm(vec2(az * 3.0, elev * 0.35)) - 0.5;
        float wash = fbm(vec2(az * 0.8 + 7.0, elev * 0.08)) - 0.5;
        float x = max(elev, 0.0) * (1.0 + streak * 0.10) + wash * 1.2;

        vec3 c = skyRamp(max(x, 0.0));
        gl_FragColor = vec4(srgbToLinear(dither(c, gl_FragCoord.xy)), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 64, 32), material);
  mesh.name = 'sky';
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}
