import * as THREE from 'three';

/**
 * One shader for the whole environment (terrain, trees, flowers, rocks,
 * clouds, props). Two looks blended by how much colour has reached a spot:
 *
 *  - SKETCH: warm paper, anti-aliased cross-hatching in the shade and soft
 *    baked shadows, like a pencil illustration waiting to be coloured in.
 *  - VIVID: the object's own colour tinted by the paint that landed there,
 *    with hemisphere + sun toon lighting.
 *
 * A glowing "magic edge" marks the boundary. OUTLINE builds an inverted-hull
 * graphite line around low-poly props (needs a smooth `snormal` attribute).
 *
 * Attributes: color, tint (0..1 how much paint hue overrides natural
 * colour), sway (wind). Instanced meshes may add popT (bloom time; <0 always
 * visible). forceColor (uniform) reveals everything — used by the title
 * screen and the opening "colours drain away" moment.
 */

const vertexShader = /* glsl */ `
attribute float tint;
attribute float sway;
#ifdef OUTLINE
attribute vec3 snormal;
#endif
#ifdef POP
attribute float popT;
#endif
#ifdef CLOUD
attribute vec4 cloudInfo; // center.x, center.z, speed, unused
#endif
uniform float time;
uniform float windStrength;
uniform float forceColor;
uniform float outlineWidth;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying float vTint;

float elasticOut(float t) {
  if (t <= 0.0) return 0.0;
  if (t >= 1.0) return 1.0;
  return pow(2.0, -10.0 * t) * sin((t * 10.0 - 0.75) * 2.0943951) + 1.0;
}

void main() {
  vec3 pos = position;
  mat4 model = modelMatrix;
  #ifdef USE_INSTANCING
    model = modelMatrix * instanceMatrix;
  #endif
  float popScale = 1.0;
  #ifdef POP
    popScale = popT < 0.0 ? 1.0 : elasticOut(clamp((time - popT) / 1.1, 0.0, 1.0));
    popScale = max(popScale, forceColor);
    pos *= popScale;
  #endif
  vec4 wp = model * vec4(pos, 1.0);
  #ifdef OUTLINE
    vec3 sn = normalize(mat3(model) * snormal);
    wp.xyz += sn * outlineWidth * popScale;
  #endif
  #ifdef CLOUD
    float W = 140.0;
    float cx = mod(cloudInfo.x + time * cloudInfo.z + W, 2.0 * W) - W;
    wp.x = cx + (wp.x - cloudInfo.x);
    wp.y += sin(time * 0.35 + cloudInfo.y * 0.1) * 0.6;
  #endif
  #ifdef WIND
    float w = sway * windStrength * max(pos.y, 0.0);
    float ph = wp.x * 0.35 + wp.z * 0.27;
    vec2 gust = vec2(sin(time * 1.6 + ph), cos(time * 1.25 + ph * 1.3));
    wp.xz += gust * w * 0.09;
  #endif
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(model) * normal);
  vColor = color;
  vTint = tint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D paintMap;
uniform vec4 mapRect;
uniform sampler2D shadowMap;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyLight;
uniform vec3 groundLight;
uniform vec3 fogColor;
uniform vec2 fogRange;
uniform float time;
uniform float worldColor;
uniform float forceColor;
uniform float tintScale;
uniform float emissive;
uniform vec3 paperColor;
uniform vec3 inkColor;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying float vTint;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// anti-aliased pencil lines: 1 on the line, 0 between
float hatchLines(float v) {
  float s = sin(v);
  float w = fwidth(v) * 1.3;
  return smoothstep(0.35 - w, 0.35 + w, s);
}
// cross-hatching that only appears in real shade and fades with distance
float hatch(vec3 p, float dark, float dist) {
  float fade = 1.0 - smoothstep(3.0, 18.0, dist);
  if (fade <= 0.001) return 0.0;
  float f = 48.0;
  float l1 = hatchLines((p.x + p.y * 0.8 + p.z * 0.4) * f);
  float l2 = hatchLines((p.z - p.y * 0.7 + p.x * 0.35) * f);
  float h = l1 * smoothstep(0.42, 0.7, dark) + l2 * smoothstep(0.72, 0.95, dark);
  return clamp(h, 0.0, 1.0) * fade;
}

void main() {
  #ifdef FLAT
    vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  #else
    vec3 N = normalize(vNormal);
  #endif

  vec2 uv = (vWorldPos.xz - mapRect.xy) / mapRect.zw;
  vec4 pm = texture2D(paintMap, uv);
  float mapCov = pm.a;
  vec3 pcol = pm.rgb / max(mapCov, 0.002);
  pcol = mix(vColor, pcol, smoothstep(0.0, 0.04, mapCov));
  float cov = mapCov;
  float shadow = texture2D(shadowMap, uv).a;
  #ifdef GLOBAL_COLOR
    cov = worldColor;
    pcol = vColor;
    shadow = 0.0;
  #endif
  cov = max(cov, forceColor);
  float reveal = smoothstep(0.05, 0.5, cov);

  float ndl = dot(N, sunDir);
  float lit = smoothstep(-0.4, 0.6, ndl) * (1.0 - shadow * 0.8);
  float dist = distance(vWorldPos, cameraPosition);
  vec3 base = vColor;
  float l = luma(base);

  // ---- pencil sketch ----
  float tone = clamp(0.12 + 0.72 * lit + 0.16 * l, 0.0, 1.0);
  vec3 sketch = paperColor * (0.68 + 0.32 * tone);
  float h = hatch(vWorldPos, (1.0 - tone) + shadow * 0.4, dist);
  #ifdef GROUND_NOISE
    h *= 0.6;
  #endif
  sketch = mix(sketch, inkColor, h * 0.6);
  sketch = mix(sketch, inkColor, shadow * 0.18);
  #ifdef OUTLINE
    sketch = inkColor;
  #endif

  // ---- vivid colour ----
  vec3 paintTint = pcol * (l * 1.25 + 0.3);
  // pale paints (white, cream) lighten rather than bleach
  float sat = max(pcol.r, max(pcol.g, pcol.b)) - min(pcol.r, min(pcol.g, pcol.b));
  float tintAmt = clamp(vTint * tintScale, 0.0, 1.0) * mix(0.4, 1.0, smoothstep(0.0, 0.35, sat));
  vec3 vivid = mix(base, paintTint, tintAmt);
  #ifdef GROUND_NOISE
    float gn = vnoise(vWorldPos.xz * 1.3);
    vivid *= 0.9 + 0.2 * gn;
  #endif
  vec3 hemi = mix(groundLight, skyLight, N.y * 0.5 + 0.5);
  vec3 light = hemi + sunColor * lit;
  vec3 colV = vivid * light + vivid * emissive;
  #ifdef OUTLINE
    colV = vivid * 0.28;
  #endif

  vec3 col = mix(sketch, colV, reveal);

  #ifndef OUTLINE
    float edge = smoothstep(0.0, 0.16, cov) * (1.0 - smoothstep(0.16, 0.5, cov));
    float shimmer = 0.7 + 0.3 * sin(time * 5.0 + vWorldPos.x * 4.0 + vWorldPos.z * 3.0);
    col += (pcol * 0.9 + 0.2) * edge * shimmer;
  #endif

  float f = smoothstep(fogRange.x, fogRange.y, dist);
  col = mix(col, fogColor, f);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class WorldMaterial extends THREE.ShaderMaterial {
  /**
   * @param {object} shared shared uniform objects owned by World
   * @param {object} opts { flat, wind, pop, cloud, double, tint, globalColor, emissive, outline, outlineWidth, groundNoise, name }
   */
  constructor(shared, opts = {}) {
    const defines = {};
    if (opts.flat) defines.FLAT = 1;
    if (opts.wind) defines.WIND = 1;
    if (opts.pop) defines.POP = 1;
    if (opts.cloud) defines.CLOUD = 1;
    if (opts.globalColor) defines.GLOBAL_COLOR = 1;
    if (opts.outline) defines.OUTLINE = 1;
    if (opts.groundNoise) defines.GROUND_NOISE = 1;
    super({
      uniforms: {
        ...shared,
        tintScale: { value: opts.tint ?? 1 },
        emissive: { value: opts.emissive ?? 0 },
        outlineWidth: { value: opts.outlineWidth ?? 0.02 },
      },
      vertexShader,
      fragmentShader,
      defines,
      vertexColors: true,
      side: opts.outline ? THREE.BackSide : opts.double ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.name = opts.name || 'WorldMaterial';
  }
}

/**
 * Average normals across vertices that share a position, stored as
 * `snormal`, so an inverted-hull outline stays watertight on flat-shaded,
 * non-indexed geometry.
 */
export function addSmoothNormals(geo) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const n = pos.count;
  const map = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let acc = map.get(k);
    if (!acc) {
      acc = [0, 0, 0];
      map.set(k, acc);
    }
    acc[0] += nrm.getX(i);
    acc[1] += nrm.getY(i);
    acc[2] += nrm.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = map.get(key(i));
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    out[i * 3] = a[0] / len;
    out[i * 3 + 1] = a[1] / len;
    out[i * 3 + 2] = a[2] / len;
  }
  geo.setAttribute('snormal', new THREE.BufferAttribute(out, 3));
  return geo;
}
