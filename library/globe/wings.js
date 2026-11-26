import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeGeometry, taperedTube } from '../core/geometry.js';

/**
 * Dragon wings in two hinged panels so a flap ripples outward:
 *   inner: shoulder -> wrist, membrane down to the flank (hinge at the root)
 *   outer: wrist -> three finger bones with scalloped membrane between them
 * Built for the left wing (+z); the right wing is mirrored by the instance
 * matrix. Each panel returns { membrane, bones } geometries.
 *
 * Wing-local frame: origin at the wing root, +x forward, +z outward.
 */
export const WRIST = new THREE.Vector3(-0.1, 0.22, 1.0);
const FINGERS = [
  new THREE.Vector3(0.18, 0.12, 0.92), // leading finger (relative to the wrist)
  new THREE.Vector3(-0.32, 0.02, 1.02),
  new THREE.Vector3(-0.78, -0.06, 0.62),
];
const INNER_TRAIL = [new THREE.Vector3(-0.72, -0.02, 0.18), new THREE.Vector3(-0.66, 0.02, 0.6)];

/** a scalloped edge between two points, bowing toward `bow` */
function scallop(a, b, bow, depth, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.addScaledVector(bow, Math.sin(Math.PI * t) * depth);
    pts.push(p);
  }
  return pts;
}

/** triangulate a fan of strips from `hub` points to an edge polyline (both same length) */
function stripMesh(edgeA, edgeB) {
  const pos = [];
  const idx = [];
  const n = edgeA.length;
  for (let i = 0; i < n; i++) {
    pos.push(edgeA[i].x, edgeA[i].y, edgeA[i].z, edgeB[i].x, edgeB[i].y, edgeB[i].z);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a membrane panel between two bones (root->tipA, root->tipB) with a scalloped free edge */
function membrane(root, tipA, tipB, seg, depth) {
  const edge = scallop(tipA, tipB, root.clone().sub(tipA.clone().lerp(tipB, 0.5)).normalize(), depth, seg);
  const rootSide = edge.map(() => root.clone());
  // slight billow: push the membrane a touch downward between the bones
  const strips = [];
  const rows = 4;
  const geos = [];
  for (let r = 0; r < rows; r++) {
    const t0 = r / rows, t1 = (r + 1) / rows;
    const a = edge.map((p, i) => rootSide[i].clone().lerp(p, t0).add(new THREE.Vector3(0, -0.035 * Math.sin(Math.PI * t0) * Math.sin((Math.PI * i) / seg), 0)));
    const b = edge.map((p, i) => rootSide[i].clone().lerp(p, t1).add(new THREE.Vector3(0, -0.035 * Math.sin(Math.PI * t1) * Math.sin((Math.PI * i) / seg), 0)));
    geos.push(stripMesh(a, b));
    strips.push(a);
  }
  const g = mergeGeometries(geos.map((x) => normalizeGeometry(x)), false);
  geos.forEach((x) => x.dispose());
  return g;
}

export function buildWing(detail = 1) {
  const seg = detail > 0 ? 8 : 4;
  const radial = detail > 0 ? 5 : 3;
  const tubeSeg = detail > 0 ? 10 : 4;
  const O = new THREE.Vector3(0, 0, 0);
  // inner panel (wing-local, hinge at the root)
  const innerMem = [
    membrane(O, WRIST, INNER_TRAIL[1], seg, 0.08),
    membrane(O, INNER_TRAIL[1], INNER_TRAIL[0], seg, 0.05),
  ];
  const innerBones = [taperedTube([O, new THREE.Vector3(0.0, 0.14, 0.5), WRIST], 0.06, 0.045, { segments: tubeSeg, radial })];
  // outer panel (local to the wrist)
  const W = new THREE.Vector3(0, 0, 0);
  const trailFromWrist = INNER_TRAIL[1].clone().sub(WRIST);
  const outerMem = [
    membrane(W, FINGERS[0], FINGERS[1], seg, 0.14),
    membrane(W, FINGERS[1], FINGERS[2], seg, 0.16),
    membrane(W, FINGERS[2], trailFromWrist, seg, 0.08),
  ];
  const outerBones = FINGERS.map((f, i) => taperedTube([W, W.clone().lerp(f, 0.5).add(new THREE.Vector3(0, 0.03, 0)), f], 0.04 - i * 0.006, 0.008, { segments: tubeSeg, radial }));
  // little claw at the wrist
  const claw = taperedTube([W, new THREE.Vector3(0.1, 0.1, 0.02), new THREE.Vector3(0.16, 0.08, -0.02)], 0.03, 0.005, { segments: 6, radial });
  outerBones.push(claw);
  const merge = (list) => {
    const g = mergeGeometries(list.map((x) => normalizeGeometry(x)), false);
    list.forEach((x) => x.dispose());
    return g;
  };
  return {
    inner: { membrane: merge(innerMem), bones: merge(innerBones) },
    outer: { membrane: merge(outerMem), bones: merge(outerBones) },
  };
}

const _m = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _axis = new THREE.Vector3();
/**
 * Wing panel matrices for one wing.
 * @param {THREE.Matrix4} body   dragon matrix
 * @param {THREE.Vector3} root   wing root in dragon space
 * @param {number} side          +1 left, -1 right
 * @param {number} flap          inner hinge angle (radians, + = up)
 * @param {number} fold          outer hinge angle relative to the inner panel
 * @param {THREE.Matrix4} outInner, outOuter
 */
export function wingMatrices(body, root, side, flap, fold, sweep, outInner, outOuter) {
  // inner: body * T(root) * mirror * R_y(sweep) * R_x(-flap)   (+z outward after mirror)
  outInner.copy(body).multiply(_m.makeTranslation(root.x, root.y, root.z));
  if (side < 0) outInner.multiply(_m.makeScale(1, 1, -1));
  outInner.multiply(_r.makeRotationY(sweep));
  outInner.multiply(_r.makeRotationX(-flap));
  // outer: inner * T(wrist) * R_about(arm axis)(-fold)
  outOuter.copy(outInner).multiply(_m.makeTranslation(WRIST.x, WRIST.y, WRIST.z));
  _axis.set(1, 0, 0);
  outOuter.multiply(_r.makeRotationAxis(_axis, -fold));
}
