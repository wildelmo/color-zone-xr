import * as THREE from 'three';

/**
 * One shader for the whole environment (terrain, trees, flowers, rocks,
 * clouds). It samples the top-down PaintMap and reveals colour where the
 * player has painted, with a glowing magic edge where colour meets sketch.
 *
 * Vertex attributes: color (natural colour), tint (0..1 how much the paint
 * hue overrides natural colour), sway (wind amount). Instanced meshes may add
 * popT (time the instance popped into existence; <0 = always visible).
 */

const vertexShader = /* glsl */ `
attribute float tint;
attribute float sway;
#ifdef POP
attribute float popT;
#endif
#ifdef CLOUD
attribute vec4 cloudInfo; // center.x, center.z, speed, unused
#endif
uniform float time;
uniform float windStrength;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying float vTint;
varying float vAlt;

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
  #ifdef POP
    float s = popT < 0.0 ? 1.0 : elasticOut(clamp((time - popT) / 1.1, 0.0, 1.0));
    pos *= s;
  #endif
  vec4 wp = model * vec4(pos, 1.0);
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
  vAlt = pos.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D paintMap;
uniform vec4 mapRect;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 skyLight;
uniform vec3 groundLight;
uniform vec3 fogColor;
uniform vec2 fogRange;
uniform float time;
uniform float worldColor;
uniform float tintScale;
uniform float emissive;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vColor;
varying float vTint;
varying float vAlt;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void main() {
  #ifdef FLAT
    vec3 N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  #else
    vec3 N = normalize(vNormal);
  #endif

  vec2 uv = (vWorldPos.xz - mapRect.xy) / mapRect.zw;
  vec4 pm = texture2D(paintMap, uv);
  float cov = pm.a;
  vec3 pcol = pm.rgb / max(cov, 0.002);
  #ifdef GLOBAL_COLOR
    cov = worldColor;
    pcol = vColor;
  #endif

  vec3 base = vColor;
  float l = luma(base);
  vec3 sketch = vec3(l * 0.5 + 0.34) * vec3(0.90, 0.93, 1.0);
  vec3 paintTint = pcol * (l * 1.25 + 0.3);
  vec3 vivid = mix(base, paintTint, clamp(vTint * tintScale, 0.0, 1.0));
  float reveal = smoothstep(0.05, 0.5, cov);
  vec3 albedo = mix(sketch, vivid, reveal);

  float ndl = dot(N, sunDir);
  float lit = smoothstep(-0.4, 0.6, ndl);
  vec3 hemi = mix(groundLight, skyLight, N.y * 0.5 + 0.5);
  vec3 light = hemi + sunColor * lit;
  vec3 col = albedo * light;
  col += albedo * emissive;

  float edge = smoothstep(0.0, 0.16, cov) * (1.0 - smoothstep(0.16, 0.5, cov));
  float shimmer = 0.7 + 0.3 * sin(time * 5.0 + vWorldPos.x * 4.0 + vWorldPos.z * 3.0);
  col += (pcol * 0.9 + 0.2) * edge * shimmer;

  float dist = distance(vWorldPos, cameraPosition);
  float f = smoothstep(fogRange.x, fogRange.y, dist);
  col = mix(col, fogColor, f);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class WorldMaterial extends THREE.ShaderMaterial {
  /**
   * @param {object} shared shared uniform objects owned by World
   * @param {object} opts { flat, wind, pop, cloud, double, tint, globalColor, emissive }
   */
  constructor(shared, opts = {}) {
    const defines = {};
    if (opts.flat) defines.FLAT = 1;
    if (opts.wind) defines.WIND = 1;
    if (opts.pop) defines.POP = 1;
    if (opts.cloud) defines.CLOUD = 1;
    if (opts.double) defines.DOUBLE = 1;
    if (opts.globalColor) defines.GLOBAL_COLOR = 1;
    super({
      uniforms: {
        ...shared,
        tintScale: { value: opts.tint ?? 1 },
        emissive: { value: opts.emissive ?? 0 },
      },
      vertexShader,
      fragmentShader,
      defines,
      vertexColors: true,
      side: opts.double ? THREE.DoubleSide : THREE.FrontSide,
    });
    this.name = opts.name || 'WorldMaterial';
  }
}
