import * as THREE from 'three';
import { T, STREETS } from './terrain.js';
import { townMaterial } from './town.js';

/**
 * The island's rock and snow, with the fine detail drawn in the shader
 * (the mesh's vertices are far too sparse for it): cobbled streets with
 * snow packed into the joints and drifting in at the edges, soft drifts
 * and glints across the snow, and rough, layered rock on the cliffs with
 * snow only where it could settle. Everything is worked out from the
 * island-local position, so it costs no textures.
 */
export function groundMaterial(kit, uniforms) {
  // (snow is handled here, not by the town shader, so bare cobbles stay bare)
  const m = townMaterial(kit, { vertexColors: true, roughness: 0.85 }, uniforms, { build: false, snow: false });
  const lanes = STREETS.lanes.map((l) => l.a);
  const plaza = [Math.cos(T.gateA) * (T.edge - 5.5), Math.sin(T.gateA) * (T.edge - 5.5)];
  const G = {
    uHill: { value: new THREE.Vector2(T.hill[0], T.hill[1]) },
    uRings: { value: new THREE.Vector4(STREETS.rings[0].r, STREETS.rings[0].w, STREETS.rings[1].r, STREETS.rings[1].w) },
    uLanes: { value: new THREE.Vector4(...lanes) },
    uLane: { value: new THREE.Vector3(STREETS.lanes[0].r0, STREETS.lanes[0].w, T.edge) },
    uPlaza: { value: new THREE.Vector2(...plaza) },
  };
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    base(shader, r);
    Object.assign(shader.uniforms, G);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIsle;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIsle = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vIsle;
        uniform vec2 uHill;
        uniform vec4 uRings;
        uniform vec4 uLanes;
        uniform vec3 uLane;
        uniform vec2 uPlaza;
        float gHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
        }
        float gLane(float a, float rh, float r, float la) {
          if (rh < uLane.x || r > uLane.z || cos(a - la) < 0.0) return 0.0;
          return 1.0 - smoothstep(uLane.y * 0.4, uLane.y * 0.6, abs(sin(a - la)) * rh);
        }
        // the street plan, as in terrain.js streetMask
        float gStreet(vec2 p) {
          float rh = length(p - uHill), r = length(p);
          float m = 1.0 - smoothstep(uRings.y * 0.4, uRings.y * 0.6, abs(rh - uRings.x));
          m = max(m, 1.0 - smoothstep(uRings.w * 0.4, uRings.w * 0.6, abs(rh - uRings.z)));
          float a = atan(p.y - uHill.y, p.x - uHill.x);
          m = max(m, gLane(a, rh, r, uLanes.x));
          m = max(m, gLane(a, rh, r, uLanes.y));
          m = max(m, gLane(a, rh, r, uLanes.z));
          m = max(m, gLane(a, rh, r, uLanes.w));
          m = max(m, 1.0 - smoothstep(3.0, 3.6, length(p - uPlaza)));
          return m;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float gH = 0.0; // height for the bump
        float gSpark = 0.0;
        {
          vec2 p = vIsle.xz;
          float flat_ = smoothstep(0.55, 0.8, vUp);
          float snowy = smoothstep(0.72, 0.86, dot(vColor.rgb, vec3(0.333)));
          float st = gStreet(p) * flat_;
          // cobbles: rows of rounded setts, snow packed into the joints
          vec2 q = p / 0.2;
          q.x += 0.5 * mod(floor(q.y), 2.0) + 0.3 * floor(q.y * 0.5);
          vec2 id = floor(q);
          float rnd = gHash(id);
          // each sett a little different in size and set slightly off
          vec2 f = fract(q) - 0.5 - (vec2(gHash(id + 7.1), gHash(id + 3.7)) - 0.5) * 0.12;
          vec2 d = abs(f) - vec2(0.36 - rnd * 0.06, 0.31 + gHash(id + 1.3) * 0.05);
          float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.09;
          float sett = 1.0 - smoothstep(-0.04, 0.015, sd);
          // snow drifts in from the edges of the street, and dusts some setts
          float drift = smoothstep(0.55, 0.95, st) * (1.0 - 0.6 * smoothstep(0.45, 0.8, gNoise(p * 0.9)));
          // the streets are swept; settled snow (uSnow ~0.9) only dusts some setts
          float dust = 0.35 * smoothstep(0.6, 0.95, uSnow);
          float bare = sett * drift * step(0.18 + dust, rnd);
          vec3 stone = mix(vec3(0.26, 0.25, 0.25), vec3(0.44, 0.40, 0.36), rnd) * (0.82 + 0.3 * gNoise(p * 14.0));
          // the joints: packed, greyish snow
          vec3 joint = vec3(0.72, 0.74, 0.78);
          vec3 snowCol = vec3(0.92, 0.95, 1.0) * (0.92 + 0.08 * gNoise(p * 1.7));
          vec3 ground = mix(diffuseColor.rgb, snowCol, snowy * flat_);
          float inStreet = drift * step(0.18 + dust, rnd);
          diffuseColor.rgb = mix(ground, mix(joint, stone, sett), inStreet);
          gH += inStreet * sett * (0.5 + 0.5 * smoothstep(0.0, -0.1, sd));
          // soft drifts across open snow
          gH += (1.0 - bare) * snowy * flat_ * (gNoise(p * 1.3) * 0.6 + gNoise(p * 4.1) * 0.25);
          // cliffs: layered, rough rock; snow only clings to ledges
          float steep = 1.0 - smoothstep(0.5, 0.78, vUp);
          // horizontal beds of rock, gently warped, a darker seam between each
          float warp = gNoise(vec2(vIsle.x + vIsle.z, vIsle.x - vIsle.z) * 0.12) * 3.0;
          float bed = fract(vIsle.y * 0.9 + warp);
          float seam = smoothstep(0.0, 0.08, bed) * (1.0 - smoothstep(0.9, 1.0, bed));
          float tone = gHash(vec2(floor(vIsle.y * 0.9 + warp), 3.0));
          float grain = gNoise(vec2(vIsle.x + vIsle.z, vIsle.y) * 4.0);
          vec3 rock = mix(vec3(0.24, 0.26, 0.31), vec3(0.40, 0.42, 0.47), tone) * (0.55 + 0.45 * seam) * (0.88 + 0.2 * grain);
          // snow lies only on the upper faces of the beds, the ledges
          float cling = smoothstep(0.28, 0.45, vUp) * smoothstep(0.55, 0.85, bed);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(rock, snowCol, cling), steep * snowy);
          // and the rock under the island is bare and dark
          diffuseColor.rgb = mix(diffuseColor.rgb, rock * 0.8, (1.0 - smoothstep(-0.3, 0.1, vUp)));
          gH += steep * (seam * 0.8 + grain * 0.25);
          // glints in the snow that come and go as you move your head
          vec2 g = floor(p * 9.0 + floor(vViewPosition.xy * 6.0) * 0.37);
          gSpark = step(0.993, gHash(g)) * snowy * flat_ * (1.0 - bare);
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        {
          // bump from gH (screen-space derivatives; the mesh has no UVs)
          vec2 dHdxy = vec2(dFdx(gH), dFdy(gH)) * 0.045;
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
          normal = normalize(abs(det) * normal - grad);
        }`,
      )
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\ntotalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * gSpark * 0.9;');
  };
  m.customProgramCacheKey = () => 'town:ground';
  return m;
}
