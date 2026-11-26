import * as THREE from 'three';
import { noiseTexture } from './textures.js';

/**
 * The library's antique-toy palette and material factory.
 *
 * A MaterialKit tracks everything it creates so an asset can free all of its
 * GPU memory in one call when it is put back on the shelf.
 */

export const PALETTE = {
  cream: '#efe1c0',
  ivory: '#f4ecdc',
  parchment: '#e6d3a8',
  red: '#8c1c1e',
  crimson: '#ad272b',
  oxblood: '#5a1314',
  rose: '#c9707a',
  teal: '#2b6763',
  navy: '#1f2f5c',
  royal: '#2c4a8f',
  forest: '#2d5838',
  plum: '#4e2350',
  gold: '#e0ae55',
  goldDeep: '#b98a3a',
  brass: '#cfa860',
  steel: '#a9b0b6',
  walnut: '#4a2a19',
  mahogany: '#5c2617',
  ebony: '#1a1411',
  black: '#15110f',
};

export class MaterialKit {
  constructor() {
    this.items = [];
    this.textures = [];
    this._gilt = null;
  }

  track(m) {
    this.items.push(m);
    return m;
  }

  trackTexture(t) {
    this.textures.push(t);
    return t;
  }

  /** shared grey wear map that breaks up metal highlights */
  get giltMap() {
    if (!this._gilt) {
      this._gilt = this.trackTexture(noiseTexture(256, { seed: 11, scale: 6, octaves: 5, contrast: 0.9, base: 0.5 }));
      this._gilt.repeat.set(3, 3);
    }
    return this._gilt;
  }

  standard(params) {
    return this.track(new THREE.MeshStandardMaterial(params));
  }

  physical(params) {
    return this.track(new THREE.MeshPhysicalMaterial(params));
  }

  gold(extra = {}) {
    return this.standard({ color: PALETTE.gold, metalness: 1, roughness: 0.32, roughnessMap: this.giltMap, ...extra });
  }

  brass(extra = {}) {
    return this.standard({ color: PALETTE.brass, metalness: 1, roughness: 0.22, ...extra });
  }

  steel(extra = {}) {
    return this.standard({ color: PALETTE.steel, metalness: 1, roughness: 0.3, ...extra });
  }

  /** glossy enamel paint; vertex colours pick the colour per part */
  paint(extra = {}) {
    return this.standard({ color: 0xffffff, roughness: 0.38, metalness: 0, vertexColors: true, ...extra });
  }

  mirror(extra = {}) {
    // aged silvering: a faint warm sheen so mirrors never read as holes in a dark room
    return this.standard({ color: 0xf2ece0, metalness: 1, roughness: 0.1, envMapIntensity: 2.2, emissive: 0x4a3a28, ...extra });
  }

  glass(extra = {}) {
    const m = this.physical({ color: 0xffffff, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.16, depthWrite: false, ...extra });
    m.userData.noShadow = true;
    return m;
  }

  dispose() {
    for (const m of this.items) m.dispose();
    for (const t of this.textures) t.dispose();
    this.items.length = 0;
    this.textures.length = 0;
    this._gilt = null;
  }
}

/**
 * Instanced painted-wood material with two per-instance colours and a crisp
 * painted region driven by a per-vertex signed distance (`paint` attribute):
 *
 *   instanceCoat  (vec3) colour outside the region (e.g. a horse's coat)
 *   instanceTrim  (vec3) colour inside the region (e.g. its saddle blanket)
 *
 * fwidth() turns the interpolated distance into an anti-aliased edge, so a
 * scalloped blanket stays sharp even on a coarse mesh. A thin gold pinstripe
 * is painted just inside the edge.
 */
export function paintMaskMaterial(kit, { roughness = 0.34, stripe = 0.03, stripeWidth = 0.006, stripeColor = '#d9a64c', scales = null } = {}) {
  const m = kit.standard({ color: 0xffffff, roughness, metalness: 0, vertexColors: true });
  const sc = new THREE.Color(stripeColor);
  const useScales = !!scales;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uStripe = { value: new THREE.Vector3(stripe, stripeWidth, 0) };
    shader.uniforms.uStripeColor = { value: sc };
    if (useScales) shader.uniforms.uScales = { value: new THREE.Vector3(1 / scales.size, scales.depth, scales.belly ?? 0.35) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float paint;
        attribute vec3 instanceCoat;
        attribute vec3 instanceTrim;
        varying float vPaint;
        varying vec3 vCoat;
        varying vec3 vTrim;
        ${useScales ? 'varying vec3 vObjPos; varying vec3 vObjNormal;' : ''}`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vPaint = paint;
        vCoat = instanceCoat;
        vTrim = instanceTrim;
        ${useScales ? 'vObjPos = position; vObjNormal = normal;' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uStripe;
        uniform vec3 uStripeColor;
        varying float vPaint;
        varying vec3 vCoat;
        varying vec3 vTrim;
        ${useScales ? SCALE_GLSL : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float aw = max(fwidth(vPaint), 1e-5);
        float inside = clamp(0.5 - vPaint / aw, 0.0, 1.0);
        float sd = abs(vPaint + uStripe.x) - uStripe.y;
        float stripe = clamp(0.5 - sd / aw, 0.0, 1.0) * inside;
        vec3 paintCol = mix(vCoat, vTrim, inside);
        paintCol = mix(paintCol, uStripeColor, stripe);
        diffuseColor.rgb *= paintCol;`,
      );
    if (useScales) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // carved scales: triplanar hex domes in object space, as a bump
          vec3 w = abs(normalize(vObjNormal));
          w = pow(w, vec3(4.0));
          w /= (w.x + w.y + w.z);
          vec3 sp = vObjPos * uScales.x;
          float h = hexDome(sp.yz) * w.x + hexDome(sp.xz) * w.y + hexDome(sp.xy) * w.z;
          h *= mix(1.0, uScales.z, inside);
          vec2 dHdxy = vec2(dFdx(h), dFdy(h)) * uScales.y;
          normal = scalePerturb(-vViewPosition, normal, dHdxy, faceDirection);
          // a hint of shadow in the gaps between scales
          diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 0.5, h));
        }`,
      );
    }
  };
  m.customProgramCacheKey = () => (useScales ? 'paintMaskScales1' : 'paintMask1');
  return m;
}

const SCALE_GLSL = /* glsl */ `
  varying vec3 vObjPos;
  varying vec3 vObjNormal;
  uniform vec3 uScales;
  // distance to the nearest hex-cell centre -> a rounded dome per cell
  float hexDome(vec2 p) {
    const vec2 s = vec2(1.0, 1.7320508);
    vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
    vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
    vec2 d = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
    // shingled: the dome peaks toward one edge like overlapping scales
    float r = length(d + vec2(0.0, 0.12));
    return 1.0 - smoothstep(0.12, 0.56, r);
  }
  vec3 scalePerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
    vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
    vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
    vec3 vN = surf_norm;
    vec3 R1 = cross(vSigmaY, vN);
    vec3 R2 = cross(vN, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDirection;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }
`;
