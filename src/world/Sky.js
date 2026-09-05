import * as THREE from 'three';

/**
 * Gradient sky dome with a warm sun. Blends from a pencil-grey overcast look
 * to a vivid pastel sky as the world gets painted (uniform worldColor).
 */
const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vDir = normalize(wp.xyz - cameraPosition);
  vec4 clip = projectionMatrix * viewMatrix * wp;
  gl_Position = clip.xyww; // always at far plane
}
`;

const frag = /* glsl */ `
uniform float worldColor;
uniform vec3 sunDir;
uniform float time;
uniform vec3 zenithG, horizonG, nadirG;
uniform vec3 zenithC, horizonC, nadirC;
uniform vec3 sunColor;
uniform float sunSmile;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 grey = h > 0.0 ? mix(horizonG, zenithG, pow(h, 0.55)) : mix(horizonG, nadirG, pow(-h, 0.6));
  vec3 vivid = h > 0.0 ? mix(horizonC, zenithC, pow(h, 0.7)) : mix(horizonC, nadirC, pow(-h, 0.5));
  vec3 col = mix(grey, vivid, worldColor);

  // sun disc + halo
  float sd = dot(d, sunDir);
  float disc = smoothstep(0.9975, 0.9988, sd);
  float halo = pow(max(sd, 0.0), 60.0) * 0.55 + pow(max(sd, 0.0), 6.0) * 0.12;
  vec3 sunCol = mix(vec3(0.95), sunColor, worldColor);
  col += sunCol * (halo * (0.5 + 0.6 * worldColor));

  col = mix(col, sunCol * 1.15, disc);

  // smiling sun (milestone reward)
  if (sunSmile > 0.0 && sd > 0.99) {
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(sunDir, up));
    vec3 upv = cross(right, sunDir);
    vec2 sc = vec2(dot(d, right), dot(d, upv)) / 0.05; // sun-local coords, disc radius ~1
    float eyes = smoothstep(0.16, 0.10, length(sc - vec2(-0.35, 0.28))) + smoothstep(0.16, 0.10, length(sc - vec2(0.35, 0.28)));
    float r = length(sc - vec2(0.0, 0.05));
    float ang = atan(sc.y - 0.05, sc.x);
    float mouth = smoothstep(0.08, 0.02, abs(r - 0.55)) * step(ang, -0.35) * step(-2.8, ang);
    float face = clamp(eyes + mouth, 0.0, 1.0) * sunSmile;
    col = mix(col, vec3(1.0, 0.55, 0.2), face * disc);
  }

  // twinkling colour sparkles high in the sky once the world is alive
  float sparkle = 0.0;
  if (worldColor > 0.35 && h > 0.2) {
    vec2 cell = floor(d.xz / max(d.y, 0.2) * 40.0);
    float hh = hash(cell);
    vec2 cp = fract(d.xz / max(d.y, 0.2) * 40.0) - 0.5;
    float star = smoothstep(0.08, 0.0, length(cp)) * step(0.985, hh);
    sparkle = star * (0.5 + 0.5 * sin(time * 3.0 + hh * 60.0)) * (worldColor - 0.35) / 0.65;
  }
  col += sparkle * vec3(1.0, 0.9, 1.0);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor(shared) {
    const c = (hex) => new THREE.Color(hex);
    this.uniforms = {
      worldColor: shared.worldColor,
      sunDir: shared.sunDir,
      time: shared.time,
      zenithG: { value: c('#cbc7cf') },
      horizonG: { value: c('#f1ebdf') },
      nadirG: { value: c('#dcd6cb') },
      zenithC: { value: c('#3a8dff') },
      horizonC: { value: c('#ffd0e8') },
      nadirC: { value: c('#9ed4ff') },
      sunColor: { value: c('#fff1b0') },
      sunSmile: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 40, 24), mat);
    this.mesh.renderOrder = -100;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }

  setSmile(v) {
    this.uniforms.sunSmile.value = v;
  }
}
