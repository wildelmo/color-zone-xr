/**
 * GLSL helpers shared by the painted shaders.
 *
 * Palette ramps are interpolated in sRGB, the way a painter mixes colors, and
 * converted to linear afterwards so three.js's output pass (colorspace_fragment)
 * gives back the exact hex values from palette.js.
 */
import { srgb } from './palette.js';

const f = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const vec3 = (hex) => `vec3(${srgb(hex).map((v) => v.toFixed(4)).join(', ')})`;

/** GLSL function `vec3 name(float x)` -> piecewise-linear sRGB ramp through [x, '#hex'] stops. */
export function rampGLSL(name, stops) {
  const lines = [`vec3 ${name}(float x) {`, `  vec3 c = ${vec3(stops[0][1])};`];
  for (let i = 1; i < stops.length; i++) {
    const [x0] = stops[i - 1];
    const [x1, hex] = stops[i];
    lines.push(`  c = mix(c, ${vec3(hex)}, clamp((x - ${f(x0)}) / ${f(x1 - x0)}, 0.0, 1.0));`);
  }
  lines.push('  return c;', '}');
  return lines.join('\n');
}

export const COMMON_GLSL = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
// Breaks up 8-bit banding in the long smooth gradients (very visible on Quest).
vec3 dither(vec3 c, vec2 fragCoord) {
  return c + (hash12(fragCoord) - 0.5) / 255.0;
}
`;
