import * as THREE from 'three';

/**
 * Neon-light tube shader for strokes: bright core, white fresnel rim and a
 * slow travelling pulse so paintings feel alive. COTTON variant is a soft,
 * lit, wobbling puff; SPARKLE adds twinkles.
 */
const vert = /* glsl */ `
attribute float aux;
uniform float time;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying float vDist;
void main() {
  vec3 pos = position;
  #ifdef COTTON
    float wob = sin(uv.x * 9.0 + time * 2.0 + uv.y * 6.2831) * 0.16 + sin(uv.x * 23.0 - time * 1.3 + uv.y * 12.566) * 0.12;
    pos += normal * aux * wob;
  #endif
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vDist = length(vV);
  vColor = color;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const frag = /* glsl */ `
uniform float time;
uniform vec3 fogColor;
uniform vec2 fogRange;
uniform vec3 sunDir;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying float vDist;
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vV);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 2.2);
  #ifdef COTTON
    float lit = 0.55 + 0.45 * max(dot(N, sunDir), 0.0);
    vec3 col = vColor * (0.55 + 0.6 * lit) + vec3(1.0) * fres * 0.3 + vec3(0.12);
  #else
    vec3 core = vColor * 1.05 + vec3(0.3) * pow(ndv, 3.0);
    vec3 col = core + vec3(1.0) * fres * 0.5 + vColor * fres * 0.3;
    float flow = pow(0.5 + 0.5 * sin(vUv.x * 14.0 - time * 5.0), 14.0);
    col += (vColor * 0.5 + 0.5) * flow * 0.4;
    #ifdef SPARKLE
      vec2 cell = floor(vec2(vUv.x * 70.0, vUv.y * 8.0));
      float tw = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      float on = step(0.72, tw) * (0.5 + 0.5 * sin(time * 9.0 + tw * 40.0));
      col += vec3(1.0) * on * 0.7;
    #endif
  #endif
  col = mix(col, fogColor, smoothstep(fogRange.x, fogRange.y, vDist) * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class StrokeMaterial extends THREE.ShaderMaterial {
  constructor(shared, { cotton = false, sparkle = false } = {}) {
    const defines = {};
    if (cotton) defines.COTTON = 1;
    if (sparkle) defines.SPARKLE = 1;
    super({
      uniforms: { time: shared.time, fogColor: shared.fogColor, fogRange: shared.fogRange, sunDir: shared.sunDir },
      vertexShader: vert,
      fragmentShader: frag,
      defines,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.name = cotton ? 'stroke-cotton' : sparkle ? 'stroke-sparkle' : 'stroke-glow';
  }
}
