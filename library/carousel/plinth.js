import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBag, lathe, mat, tube, spurGear, normalizeGeometry, bendAroundY, beadRing } from '../core/geometry.js';
import { PALETTE } from '../core/materials.js';
import { lettering, canvasTexture } from '../core/textures.js';
import { plinthWoodTexture } from './paintings.js';
import { D } from './dimensions.js';
import { SCORE, COMB } from './score.js';

/**
 * The stationary turned-mahogany base: bun feet, bead mouldings, a curved
 * glass window onto the music-box movement (pinned cylinder, steel comb,
 * spring barrel, spinning governor) and the brass winding key.
 */
export function buildPlinth(ctx, kit, shared, { lod }) {
  const hero = lod === 'hero';
  const seg = hero ? 128 : 48;
  const R = 5.45;
  const w = D.windowHalfAngle;
  const y0 = D.windowY0, y1 = D.windowY1;

  const wood = kit.standard({ map: kit.trackTexture(plinthWoodTexture()), roughness: 0.32, metalness: 0 });
  // velvet-lined window cavity with a hint of a hidden lamp, so the brass shows
  const velvet = kit.standard({ color: 0xffffff, vertexColors: true, roughness: 0.9, emissive: 0x2a0d08 });
  const mats = { ...shared, wood, velvet };
  const bag = new GeoBag();

  // --- turned body (split round the window)
  bag.add(lathe([[0.01, 0.2], [5.1, 0.2], [5.5, 0.22], [5.62, 0.27], [5.65, 0.33], [5.57, 0.38], [5.47, 0.42], [R, 0.46], [R, y0]], seg), null, 'wood');
  bag.add(lathe([[R, y0], [R, y1]], seg, w, Math.PI * 2 - 2 * w), null, 'wood');
  bag.add(lathe([[R, y1], [R, 1.02], [5.53, 1.05], [5.61, 1.1], [5.65, 1.15], [5.6, 1.19], [5.25, 1.205], [0.01, 1.205]], seg), null, 'wood');
  bag.add(beadRing(5.475, 0.44, 0.03, seg, 6), null, 'gold');
  bag.add(beadRing(5.5, 1.035, 0.03, seg, 6), null, 'gold');
  bag.add(beadRing(5.6, 0.25, 0.022, seg, 6), null, 'gold');

  // --- bun feet
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const f = lathe([[0, 0], [0.22, 0.005], [0.32, 0.06], [0.33, 0.11], [0.26, 0.17], [0.18, 0.2], [0, 0.2]], hero ? 20 : 10);
    bag.add(f, mat(Math.cos(a) * 5.05, 0, Math.sin(a) * 5.05), 'gold');
  }

  // --- window cavity (velvet lined), frame and glass
  const cx = R * Math.sin(w), cz = R * Math.cos(w);
  const back = 4.05;
  const arcShape = (flipZ) => {
    const s = new THREE.Shape();
    const n = 16;
    for (let i = 0; i <= n; i++) {
      const a = -w + (2 * w * i) / n;
      const x = R * Math.sin(a), z = R * Math.cos(a);
      if (i === 0) s.moveTo(x, flipZ ? z : -z);
      else s.lineTo(x, flipZ ? z : -z);
    }
    s.lineTo(cx, flipZ ? back : -back);
    s.lineTo(-cx, flipZ ? back : -back);
    s.closePath();
    return s;
  };
  const floor = new THREE.ShapeGeometry(arcShape(false));
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, y0, 0);
  bag.add(floor, null, 'velvet', PALETTE.oxblood);
  const ceil = new THREE.ShapeGeometry(arcShape(true));
  ceil.rotateX(Math.PI / 2);
  ceil.translate(0, y1, 0);
  bag.add(ceil, null, 'velvet', PALETTE.oxblood);
  for (const s of [1, -1]) {
    const side = new THREE.PlaneGeometry(cz - back, y1 - y0);
    side.rotateY(-s * Math.PI / 2);
    side.translate(s * cx, (y0 + y1) / 2, (cz + back) / 2);
    bag.add(side, null, 'velvet', PALETTE.oxblood);
  }
  const backWall = new THREE.PlaneGeometry(cx * 2, y1 - y0);
  backWall.translate(0, (y0 + y1) / 2, back);
  bag.add(backWall, null, 'velvet', '#7a2a22');
  const frame = [];
  const fr = R + 0.025;
  for (let i = 0; i <= 14; i++) {
    const a = -w + (2 * w * i) / 14;
    frame.push([fr * Math.sin(a), y0, fr * Math.cos(a)]);
  }
  for (let i = 0; i <= 14; i++) {
    const a = w - (2 * w * i) / 14;
    frame.push([fr * Math.sin(a), y1, fr * Math.cos(a)]);
  }
  bag.add(tube(frame, 0.032, { closed: true, segments: 90, radial: hero ? 8 : 5, tension: 0.0 }), null, 'gold');
  for (const s of [1, -1]) for (const y of [y0, y1]) bag.add(new THREE.SphereGeometry(0.055, 10, 8), mat(s * fr * Math.sin(w), y, fr * Math.cos(w)), 'gold');
  const glassGeo = new THREE.CylinderGeometry(R + 0.012, R + 0.012, y1 - y0, 24, 1, true, -w, 2 * w);
  glassGeo.translate(0, (y0 + y1) / 2, 0);
  const glass = new THREE.Mesh(glassGeo, shared.glass);
  glass.name = 'plinth:glass';
  glass.renderOrder = 5;

  // --- maker's plaque on the left side
  const plaqueTex = kit.trackTexture(canvasTexture(lettering(['ATELIER MERVEILLE', 'LE GRAND CARROUSEL · PARIS'], { w: 1024, h: 200, bg: '#1b1411', fg: '#e3b660', sizes: [62, 40], letterSpacing: 5 })));
  const plaqueMat = kit.standard({ map: plaqueTex, roughness: 0.35 });
  const plaqueGeo = bendAroundY(new THREE.PlaneGeometry(2.2, 0.38, 24, 1), R + 0.015);
  plaqueGeo.applyMatrix4(mat(0, 0.74, 0, 0, -Math.PI / 2));
  const plaque = new THREE.Mesh(plaqueGeo, plaqueMat);
  plaque.name = 'plinth:plaque';
  const pf = [];
  for (const [u, v] of [[-1.15, -0.22], [1.15, -0.22], [1.15, 0.22], [-1.15, 0.22]]) {
    const a = u / (R + 0.03);
    pf.push([Math.sin(a) * (R + 0.03), 0.74 + v, Math.cos(a) * (R + 0.03)]);
  }
  const pfGeo = tube(pf, 0.022, { closed: true, segments: 40, radial: 6, tension: 0 });
  pfGeo.applyMatrix4(mat(0, 0, 0, 0, -Math.PI / 2));
  bag.add(pfGeo, null, 'gold');

  // --- winding-key escutcheon (+x side)
  const esc = lathe([[0, 0.0], [0.2, 0.0], [0.24, 0.03], [0.17, 0.07], [0.09, 0.09], [0.0, 0.09]], hero ? 24 : 12);
  esc.rotateZ(-Math.PI / 2);
  bag.add(esc, mat(5.44, 0.72, 0), 'gold');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    bag.add(new THREE.SphereGeometry(0.03, 6, 4), mat(5.5, 0.72 + Math.sin(a) * 0.27, Math.cos(a) * 0.27), 'gold');
  }

  const group = bag.build(mats, { name: 'plinth' });
  group.add(glass, plaque);

  // --- the key itself (turns while winding)
  const key = new THREE.Group();
  key.name = 'plinth:key';
  key.position.set(5.5, 0.72, 0);
  const keyParts = [];
  const shaft = new THREE.CylinderGeometry(0.05, 0.06, 0.4, 12);
  shaft.rotateZ(-Math.PI / 2);
  shaft.translate(0.2, 0, 0);
  keyParts.push(shaft);
  const collar = new THREE.TorusGeometry(0.07, 0.025, 8, 16);
  collar.rotateY(Math.PI / 2);
  collar.translate(0.36, 0, 0);
  keyParts.push(collar);
  const head = new THREE.Shape();
  head.moveTo(0, -0.05);
  head.bezierCurveTo(0.12, -0.07, 0.34, -0.32, 0.18, -0.4);
  head.bezierCurveTo(0.06, -0.46, -0.06, -0.46, -0.18, -0.4);
  head.bezierCurveTo(-0.34, -0.32, -0.12, -0.07, 0, -0.05);
  const hole = new THREE.Path();
  hole.absarc(0, -0.29, 0.065, 0, Math.PI * 2, true);
  head.holes.push(hole);
  for (const s of [1, -1]) {
    const h = new THREE.ExtrudeGeometry(head, { depth: 0.045, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 10 });
    h.translate(0, 0, -0.0225);
    if (s < 0) h.rotateZ(Math.PI);
    h.rotateY(Math.PI / 2);
    h.translate(0.43, 0, 0);
    keyParts.push(h);
  }
  const keyGeo = mergeGeometries(keyParts.map((g) => normalizeGeometry(g)), false);
  keyParts.forEach((g) => g.dispose());
  const keyMesh = new THREE.Mesh(keyGeo, shared.brass);
  keyMesh.castShadow = true;
  key.add(keyMesh);
  group.add(key);
  // invisible grab target around the key head
  const keyProxy = new THREE.Mesh(new THREE.SphereGeometry(0.75, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
  keyProxy.position.set(0.45, 0, 0);
  keyProxy.name = 'proxy:key';
  key.add(keyProxy);

  const movement = hero ? buildMovement(kit, shared) : null;
  if (movement) group.add(movement.group);

  return {
    group,
    key,
    keyProxy,
    movement,
    keyAngle: 0,
    update(state, dt) {
      if (movement) movement.update(state, dt);
    },
  };
}

/** the music-box movement visible through the window */
function buildMovement(kit, shared) {
  const group = new THREE.Group();
  group.name = 'movement';
  const bag = new GeoBag();
  const CY = 0.71, CZ = 4.66, CR = 0.13;
  const X0 = -0.95, X1 = 0.65;
  // bedplate, pillars and screws
  bag.add(new THREE.BoxGeometry(2.6, 0.04, 0.95), mat(0, 0.52, 4.6), 'brass');
  for (const x of [X0 - 0.05, X1 + 0.05]) {
    bag.add(new THREE.BoxGeometry(0.05, 0.25, 0.14), mat(x, 0.64, CZ), 'brass');
    bag.add(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 10).rotateZ(Math.PI / 2), mat(x, CY, CZ), 'steel');
  }
  for (const [x, z] of [[-1.25, 4.2], [1.25, 4.2], [-1.25, 5.02], [1.25, 5.02], [0, 4.2]]) {
    bag.add(new THREE.SphereGeometry(0.03, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(x, 0.54, z), 'steel');
  }
  // comb base
  const K = COMB.length;
  const pitch = (X1 - X0) / K;
  bag.add(new THREE.BoxGeometry(X1 - X0 + 0.06, 0.07, 0.11), mat((X0 + X1) / 2, 0.69, 5.0), 'steel');
  bag.add(new THREE.BoxGeometry(X1 - X0 + 0.1, 0.12, 0.12), mat((X0 + X1) / 2, 0.6, 5.0), 'brass');
  for (const x of [X0 + 0.1, (X0 + X1) / 2, X1 - 0.1]) bag.add(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 8), mat(x, 0.73, 5.0), 'brass');
  // lead resonator weights under the bass teeth
  for (let k = 0; k < 6; k++) bag.add(new THREE.BoxGeometry(pitch * 0.7, 0.04, 0.06), mat(X0 + (k + 0.5) * pitch, 0.68, 4.84), 'steel');
  // spring barrel behind the cylinder, with its ratchet
  const BZ = CZ - 0.4;
  const barrel = new THREE.CylinderGeometry(0.18, 0.18, 0.3, 24).rotateZ(Math.PI / 2);
  bag.add(barrel, mat(0.9, CY, BZ), 'brass');
  bag.add(new THREE.BoxGeometry(0.05, 0.25, 0.14), mat(1.12, 0.64, BZ), 'brass');
  const staticGroup = bag.build({ brass: shared.brass, steel: shared.steel }, { name: 'movement:static' });
  group.add(staticGroup);

  // rotating cylinder with its pins (placed from the score) and end gear
  const parts = [];
  parts.push(new THREE.CylinderGeometry(CR, CR, X1 - X0, 32).rotateZ(Math.PI / 2).translate((X0 + X1) / 2, 0, 0));
  parts.push(spurGear(40, 0.16, 0.03, { hole: 0.02, spokes: 5 }).rotateY(Math.PI / 2).translate(X1 + 0.08, 0, 0));
  const pin = new THREE.CylinderGeometry(0.0045, 0.0045, 0.024, 5);
  for (const n of SCORE.notes) {
    const k = COMB.indexOf(n[1]);
    const x = X0 + (k + 0.5) * pitch;
    const th = (n[0] / SCORE.length) * Math.PI * 2;
    const p = pin.clone();
    p.translate(0, CR + 0.01, 0);
    p.rotateX(Math.PI / 2 - th); // pin at angle th, measured from +z toward +y
    p.translate(x, 0, 0);
    parts.push(p);
  }
  pin.dispose();
  const cylGeo = mergeGeometries(parts.map((g) => normalizeGeometry(g)), false);
  parts.forEach((g) => g.dispose());
  const cylinder = new THREE.Mesh(cylGeo, shared.brass);
  cylinder.position.set(0, CY, CZ);
  cylinder.name = 'movement:cylinder';
  group.add(cylinder);

  // barrel gear (meshes with the cylinder gear) + ratchet wheel
  const bg = mergeGeometries([
    normalizeGeometry(spurGear(60, 0.24, 0.03, { hole: 0.03, spokes: 6 }).rotateY(Math.PI / 2).translate(X1 + 0.08 - 0.9, 0, 0)),
    normalizeGeometry(spurGear(20, 0.15, 0.04, {}).rotateY(Math.PI / 2).translate(1.1 - 0.9 + 0.08, 0, 0)),
  ], false);
  const barrelGear = new THREE.Mesh(bg, shared.brass);
  barrelGear.position.set(0.9, CY, BZ);
  group.add(barrelGear);

  // governor ("fly"): worm shaft + fan, spins fast
  const fly = new THREE.Group();
  fly.position.set(-1.15, 0.54, 4.45);
  const flyParts = [new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8).translate(0, 0.21, 0)];
  const worm = [];
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 2 * 6;
    worm.push([Math.cos(a) * 0.035, 0.08 + (i / 60) * 0.12, Math.sin(a) * 0.035]);
  }
  flyParts.push(tube(worm, 0.01, { segments: 120, radial: 4 }));
  for (const s of [1, -1]) flyParts.push(new THREE.BoxGeometry(0.16, 0.09, 0.006).translate(s * 0.09, 0.34, 0));
  const flyGeo = mergeGeometries(flyParts.map((g) => normalizeGeometry(g)), false);
  flyParts.forEach((g) => g.dispose());
  const flyMesh = new THREE.Mesh(flyGeo, shared.steel);
  fly.add(flyMesh);
  group.add(fly);
  const gearL = new THREE.Mesh(spurGear(30, 0.12, 0.025, { hole: 0.015, spokes: 4 }).rotateY(Math.PI / 2), shared.brass);
  gearL.position.set(X0 - 0.09, CY, CZ);
  group.add(gearL);

  // comb teeth: instanced so plucked teeth can quiver
  const toothLen = 4.97 - (CZ + CR + 0.004);
  const toothGeo = new THREE.BoxGeometry(pitch * 0.78, 0.012, toothLen);
  toothGeo.translate(0, 0, -toothLen / 2); // pivot at the comb base
  const teeth = new THREE.InstancedMesh(toothGeo, shared.steel, K);
  teeth.name = 'movement:comb';
  teeth.frustumCulled = false;
  const tm = new THREE.Matrix4();
  const plucked = new Float32Array(K).fill(-10);
  const setTooth = (k, ang) => {
    tm.makeRotationX(ang).setPosition(X0 + (k + 0.5) * pitch, CY + 0.004, 4.97);
    teeth.setMatrixAt(k, tm);
  };
  for (let k = 0; k < K; k++) setTooth(k, 0);
  group.add(teeth);

  let flyAngle = 0;
  return {
    group,
    pluck(pitchMidi, time) {
      const k = COMB.indexOf(pitchMidi);
      if (k >= 0) plucked[k] = time;
    },
    update(state) {
      const ang = (state.musicBeat / SCORE.length) * Math.PI * 2;
      cylinder.rotation.x = ang;
      gearL.rotation.x = -ang * (0.16 / 0.12);
      barrelGear.rotation.x = -ang * (0.16 / 0.24) + state.windAngle * 0.15;
      flyAngle += state.speed * 0.9;
      fly.rotation.y = flyAngle;
      for (let k = 0; k < K; k++) {
        const dt = state.time - plucked[k];
        setTooth(k, dt >= 0 && dt < 0.6 ? Math.sin(dt * 90) * Math.exp(-dt * 9) * 0.06 : 0);
      }
      teeth.instanceMatrix.needsUpdate = true;
    },
  };
}
