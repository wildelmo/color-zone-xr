import * as THREE from 'three';

/**
 * Cheap stylised material for props (wand, buddy, UI frames): hemisphere +
 * sun toon lighting, rim light, optional emissive glow. No scene lights needed.
 */
const vert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vWorldPos;
#ifdef INSTANCE_COLOR
varying vec3 vIColor;
#endif
void main() {
  mat4 model = modelMatrix;
  #ifdef USE_INSTANCING
    model = modelMatrix * instanceMatrix;
  #endif
  vec4 wp = model * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vN = normalize(mat3(model) * normal);
  vV = cameraPosition - wp.xyz;
  #ifdef INSTANCE_COLOR
    #ifdef USE_INSTANCING_COLOR
      vIColor = instanceColor;
    #else
      vIColor = vec3(1.0);
    #endif
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const frag = /* glsl */ `
uniform vec3 color;
uniform vec3 emissive;
uniform float rim;
uniform float gloss;
uniform vec3 sunDir;
uniform vec3 fogColor;
uniform vec2 fogRange;
uniform float opacity;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWorldPos;
#ifdef INSTANCE_COLOR
varying vec3 vIColor;
#endif
void main() {
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vV);
  vec3 base = color;
  #ifdef INSTANCE_COLOR
    base *= vIColor;
  #endif
  float ndl = dot(N, sunDir);
  float lit = smoothstep(-0.35, 0.65, ndl);
  vec3 hemi = mix(vec3(0.55, 0.5, 0.6), vec3(0.95, 0.95, 1.0), N.y * 0.5 + 0.5);
  vec3 col = base * (hemi * 0.55 + vec3(1.0, 0.96, 0.9) * lit * 0.7);
  float spec = pow(max(dot(reflect(-sunDir, N), V), 0.0), 48.0) * gloss;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0) * rim;
  col += vec3(1.0) * (spec + fres);
  col += emissive;
  float dist = length(vV);
  col = mix(col, fogColor, smoothstep(fogRange.x, fogRange.y, dist) * 0.85);
  gl_FragColor = vec4(col, opacity);
  #include <colorspace_fragment>
}
`;

export class PropMaterial extends THREE.ShaderMaterial {
  constructor(shared = null, { color = '#ffffff', emissive = '#000000', rim = 0.35, gloss = 0.6, opacity = 1, transparent = false, side = THREE.FrontSide, instanceColor = false } = {}) {
    // Material.clone() constructs with no arguments; provide safe fallbacks
    shared = shared || {
      sunDir: { value: new THREE.Vector3(0.42, 0.68, -0.6).normalize() },
      fogColor: { value: new THREE.Color('#d3d7df') },
      fogRange: { value: new THREE.Vector2(40, 150) },
    };
    super({
      defines: instanceColor ? { INSTANCE_COLOR: 1 } : {},
      uniforms: {
        color: { value: new THREE.Color(color) },
        emissive: { value: new THREE.Color(emissive) },
        rim: { value: rim },
        gloss: { value: gloss },
        opacity: { value: opacity },
        sunDir: shared.sunDir,
        fogColor: shared.fogColor,
        fogRange: shared.fogRange,
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent,
      side,
    });
  }
  get color() {
    return this.uniforms.color.value;
  }
  get emissive() {
    return this.uniforms.emissive.value;
  }
}

/** additive soft glow disc texture (shared) */
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
