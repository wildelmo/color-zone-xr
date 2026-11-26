import * as THREE from 'three';
import { GeoBag, lathe, mat, tube, crownGear, filigreeCrest } from '../core/geometry.js';
import { PALETTE } from '../core/materials.js';
import { floralAtlas, nameBoard, organFacadeTexture } from './paintings.js';
import { D } from './dimensions.js';

/**
 * The stationary centre: a twelve-sided column of mirrors and painted
 * panels, the crown gear the pinions roll around, the centre pole, and the
 * band-organ facade with its pipes, drums and three little automata.
 */
export function buildColumn(ctx, kit, shared, bulbs, { lod }) {
  const hero = lod === 'hero';
  const sides = 12;
  const ap = D.columnR; // apothem
  const vr = ap / Math.cos(Math.PI / sides); // vertex radius
  const faceW = 2 * ap * Math.tan(Math.PI / sides);
  const y0 = D.deckTop, y1 = D.columnTop;
  const floral = kit.trackTexture(floralAtlas());
  const mats = {
    ...shared,
    floral: kit.standard({ map: floral, roughness: 0.4 }),
  };
  const bag = new GeoBag();
  const phi0 = -Math.PI / sides; // so a face centre points at +z

  // stationary collar on the deck + base skirt + cornice
  bag.add(lathe([[1.0, D.deckBottom], [1.38, D.deckBottom], [1.38, y0 + 0.01], [1.0, y0 + 0.01]], 48), null, 'paint', PALETTE.oxblood);
  bag.add(lathe([[vr + 0.08, y0], [vr + 0.1, y0 + 0.08], [vr + 0.03, y0 + 0.14], [vr + 0.03, y0 + 0.36], [vr + 0.08, y0 + 0.4], [vr, y0 + 0.44], [vr - 0.01, y0 + 0.44]], sides, phi0), null, 'paint', PALETTE.red);
  bag.add(lathe([[vr - 0.01, y1 - 0.42], [vr, y1 - 0.42], [vr + 0.06, y1 - 0.38], [vr + 0.06, y1 - 0.3], [vr + 0.14, y1 - 0.22], [vr + 0.26, y1 - 0.08], [vr + 0.28, y1], [0.3, y1]], sides, phi0), null, 'paint', PALETTE.red);
  bag.add(lathe([[vr + 0.105, y0 + 0.38], [vr + 0.11, y0 + 0.4], [vr + 0.105, y0 + 0.42]], sides, phi0), null, 'gold');
  bag.add(lathe([[vr + 0.07, y1 - 0.31], [vr + 0.08, y1 - 0.29], [vr + 0.07, y1 - 0.27]], sides, phi0), null, 'gold');
  bag.add(lathe([[vr + 0.29, y1 - 0.02], [vr + 0.3, y1], [vr + 0.29, y1 + 0.02]], sides, phi0), null, 'gold');

  const panelY0 = y0 + 0.44, panelY1 = y1 - 0.42;
  const panelH = panelY1 - panelY0;
  for (let i = 0; i < sides; i++) {
    const a = Math.PI / 2 + (i / sides) * Math.PI * 2;
    const face = (x, y, z, m = 1) => mat(Math.cos(a) * (ap + z) + Math.cos(a + Math.PI / 2) * x * m, y, Math.sin(a) * (ap + z) + Math.sin(a + Math.PI / 2) * x * m, 0, Math.PI / 2 - a);
    // ground
    bag.add(new THREE.PlaneGeometry(faceW, panelH), face(0, (panelY0 + panelY1) / 2, 0), 'paint', i % 2 ? PALETTE.cream : '#e7d3a6');
    if (i === 0) continue; // the organ stands in front of this face
    const innerW = faceW * 0.66, innerH = panelH * 0.78;
    const cy = (panelY0 + panelY1) / 2;
    if (i % 2 === 0) {
      // bevelled mirror with arched top
      const s = archShape(innerW, innerH);
      const mirror = new THREE.ShapeGeometry(s, 8);
      bag.add(mirror, face(0, cy, 0.012), 'mirror');
      bag.add(tube(archPoints(innerW + 0.04, innerH + 0.04), 0.028, { closed: true, radial: hero ? 6 : 4, segments: 64 }), face(0, cy, 0.02), 'gold');
    } else {
      // painted floral panel (atlas cell by side)
      const pg = new THREE.ShapeGeometry(archShape(innerW, innerH), 8);
      remapUV(pg, innerW, innerH, (i % 4 === 1 ? 0 : 0.5), 0.5);
      bag.add(pg, face(0, cy, 0.012), 'floral');
      bag.add(tube(archPoints(innerW + 0.04, innerH + 0.04), 0.028, { closed: true, radial: hero ? 6 : 4, segments: 64 }), face(0, cy, 0.02), 'gold');
    }
    // pilaster at the face's left corner with capital and bulbs
    const ca = a - Math.PI / sides;
    const px = Math.cos(ca) * (vr + 0.02), pz = Math.sin(ca) * (vr + 0.02);
    bag.add(new THREE.CylinderGeometry(0.05, 0.05, panelH, hero ? 10 : 6), mat(px, cy, pz), 'gold');
    bag.add(lathe([[0.0, 0], [0.09, 0], [0.09, 0.03], [0.06, 0.06], [0.08, 0.1], [0.0, 0.1]], 10), mat(px, panelY1 - 0.1, pz), 'gold');
    bag.add(lathe([[0.0, 0], [0.08, 0], [0.06, 0.04], [0.09, 0.07], [0.09, 0.1], [0.0, 0.1]], 10), mat(px, panelY0, pz), 'gold');
    for (let k = 0; k < 3; k++) bulbs.add(new THREE.Vector3(Math.cos(ca) * (vr + 0.1), panelY0 + panelH * (0.2 + k * 0.3), Math.sin(ca) * (vr + 0.1)), 20, i * 3 + k, sides * 3);
  }

  // crown gear (stationary) the pinions roll around, on top of the column
  const crown = crownGear(D.crownTeeth, D.crownR0, D.crownR1, 0.12, 0.08);
  bag.add(crown, mat(0, D.crownTop, 0), 'brass');
  bag.add(lathe([[0.3, y1], [D.crownR0 + 0.02, y1], [D.crownR0 + 0.02, D.crownTop - 0.2], [0.3, D.crownTop - 0.2]], 48), null, 'steel');
  // centre pole up through the canopy
  bag.add(new THREE.CylinderGeometry(0.28, 0.3, D.roofTopY - y1 + 0.3, 24), mat(0, (y1 + D.roofTopY + 0.3) / 2, 0), 'steel');
  for (const y of [5.2, 5.95, 6.7, 7.45]) bag.add(new THREE.TorusGeometry(0.31, 0.04, 6, 24).rotateX(Math.PI / 2), mat(0, y, 0), 'brass');

  const organ = buildOrgan(kit, mats, bag, bulbs, hero);
  const group = bag.build({ ...mats, ...organ.mats }, { name: 'column' });
  group.add(organ.group);

  return {
    group,
    update(state) {
      organ.update(state);
    },
  };
}

function archShape(w, h) {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(-r, -h / 2);
  s.lineTo(r, -h / 2);
  s.lineTo(r, h / 2 - r);
  s.absarc(0, h / 2 - r, r, 0, Math.PI, false);
  s.lineTo(-r, -h / 2);
  return s;
}

function archPoints(w, h) {
  const r = w / 2;
  const pts = [];
  pts.push([-r, -h / 2, 0], [r, -h / 2, 0], [r, h / 2 - r, 0]);
  for (let i = 1; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    pts.push([Math.cos(a) * r, h / 2 - r + Math.sin(a) * r, 0]);
  }
  pts.push([-r, h / 2 - r, 0]);
  return pts;
}

/** map a ShapeGeometry's planar uvs into an atlas cell */
function remapUV(g, w, h, u0, uw) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, u0 + ((p.getX(i) + w / 2) / w) * uw, (p.getY(i) + h / 2) / h);
  }
  uv.needsUpdate = true;
}

/* ------------------------------------------------------------- band organ */

function buildOrgan(kit, mats, bag, bulbs, hero) {
  const group = new THREE.Group();
  group.name = 'organ';
  const Z = D.columnR; // facade back sits on the column face
  const yb = D.deckTop + 0.02;
  const W = 1.7, DEPTH = 0.42;
  const facade = kit.trackTexture(organFacadeTexture());
  const board = kit.trackTexture(nameBoard('LE GRAND CARROUSEL'));
  const om = {
    organFacade: kit.standard({ map: facade, roughness: 0.4 }),
    organBoard: kit.standard({ map: board, roughness: 0.35 }),
  };
  const F = (x, y, z) => mat(x, yb + y, Z + z);

  // cabinet
  bag.add(new THREE.BoxGeometry(W, 1.0, DEPTH), F(0, 0.5, DEPTH / 2), 'paint', PALETTE.cream);
  bag.add(new THREE.BoxGeometry(W + 0.08, 0.08, DEPTH + 0.08), F(0, 1.02, DEPTH / 2), 'paint', PALETTE.red);
  bag.add(new THREE.BoxGeometry(W + 0.06, 0.1, DEPTH + 0.06), F(0, 0.05, DEPTH / 2), 'paint', PALETTE.red);
  const fp = new THREE.PlaneGeometry(W - 0.12, 0.82);
  bag.add(fp, F(0, 0.52, DEPTH + 0.003), 'organFacade');
  // upper case with the pipe recess
  bag.add(new THREE.BoxGeometry(W, 1.15, 0.12), F(0, 1.64, 0.06), 'paint', '#5a1314');
  for (const s of [1, -1]) {
    bag.add(new THREE.BoxGeometry(0.16, 1.15, DEPTH), F(s * (W / 2 - 0.08), 1.64, DEPTH / 2), 'paint', PALETTE.cream);
    bag.add(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8), F(s * (W / 2 - 0.02), 1.64, DEPTH + 0.01), 'gold');
  }
  // pediment: scroll crest + name board
  const crest = filigreeCrest(0.62, { radial: hero ? 5 : 3, segments: hero ? 14 : 6, medallion: false });
  crest.scale(1.9, 1, 1);
  bag.add(crest, F(0, 2.25, DEPTH * 0.5), 'gold');
  const nb = new THREE.PlaneGeometry(W * 0.56, 0.12);
  bag.add(nb, F(0, 2.33, DEPTH * 0.5 + 0.04), 'organBoard');
  bag.add(new THREE.BoxGeometry(W + 0.12, 0.06, DEPTH + 0.1), F(0, 2.22, DEPTH / 2), 'gold');

  // pipe rank (brass) with mouths
  const pipes = 13;
  for (let i = 0; i < pipes; i++) {
    const u = i / (pipes - 1) - 0.5;
    const len = 0.45 + 0.45 * Math.cos(u * Math.PI);
    const x = u * (W - 0.6);
    const r = 0.032 + 0.012 * Math.cos(u * Math.PI);
    const pz = DEPTH * 0.45;
    bag.add(new THREE.CylinderGeometry(r, r, len, hero ? 12 : 6), F(x, 1.22 + 0.12 + len / 2, pz), 'brass');
    bag.add(new THREE.CylinderGeometry(r, r * 0.35, 0.14, hero ? 12 : 6), F(x, 1.22 + 0.05, pz), 'brass');
    bag.add(new THREE.BoxGeometry(r * 1.1, 0.05, 0.01), F(x, 1.22 + 0.18, pz + r * 0.95), 'paint', '#140a08');
    bag.add(new THREE.TorusGeometry(r * 1.02, 0.008, 4, hero ? 12 : 6).rotateX(Math.PI / 2), F(x, 1.22 + 0.12 + len, pz), 'gold');
  }
  // bass drums on the cabinet front
  for (const s of [1, -1]) {
    const dx = s * 0.52, dy = 0.56, dz = DEPTH + 0.09;
    bag.add(new THREE.CylinderGeometry(0.17, 0.17, 0.16, hero ? 24 : 10).rotateX(Math.PI / 2), F(dx, dy, dz), 'paint', PALETTE.red);
    bag.add(new THREE.CylinderGeometry(0.175, 0.175, 0.02, hero ? 24 : 10).rotateX(Math.PI / 2), F(dx, dy, dz + 0.08), 'gold');
    bag.add(new THREE.CylinderGeometry(0.175, 0.175, 0.02, hero ? 24 : 10).rotateX(Math.PI / 2), F(dx, dy, dz - 0.08), 'gold');
    bag.add(new THREE.CircleGeometry(0.165, hero ? 24 : 10), F(dx, dy, dz + 0.091), 'paint', PALETTE.parchment);
    const zig = [];
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      zig.push([Math.cos(a) * 0.178, Math.sin(a) * 0.178, k % 2 ? 0.07 : -0.07]);
    }
    bag.add(tube(zig, 0.008, { closed: true, segments: 64, radial: 4, tension: 0 }), F(dx, dy, dz), 'gold');
    // drummer's bracket and snare drum on the cabinet top
    const fx = s * 0.6;
    bag.add(new THREE.BoxGeometry(0.3, 0.035, 0.26), F(fx, 1.075, DEPTH + 0.08), 'gold');
    bag.add(new THREE.CylinderGeometry(0.085, 0.085, 0.07, hero ? 20 : 8), F(fx, 1.39, DEPTH + 0.33), 'paint', PALETTE.royal);
    bag.add(new THREE.CylinderGeometry(0.088, 0.088, 0.012, hero ? 20 : 8), F(fx, 1.43, DEPTH + 0.33), 'gold');
    bag.add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), F(fx, 1.24, DEPTH + 0.33), 'gold');
    // bells on the side boards
    bag.add(lathe([[0, 0.1], [0.025, 0.1], [0.04, 0.085], [0.055, 0.035], [0.08, 0.0], [0.08, -0.01], [0, -0.01]], hero ? 16 : 8), F(s * 0.77, 1.95, DEPTH + 0.05), 'brass');
  }
  bag.add(lathe([[0, 0], [0.14, 0], [0.15, 0.03], [0.12, 0.06], [0, 0.06]], hero ? 20 : 8), F(0, 1.06, DEPTH + 0.1), 'gold');
  // lights round the arch
  for (let k = 0; k < 9; k++) {
    const a = Math.PI * (k / 8);
    bulbs.add(new THREE.Vector3(Math.cos(a) * (W / 2 - 0.08), yb + 1.64 + Math.sin(a) * 0.55, Z + DEPTH + 0.02), 21, k, 9);
  }

  // automata: two drummers and a bandmaster with a baton
  const figures = [
    makeFigure(kit, mats, hero, { jacket: PALETTE.crimson, hat: '#1a1411' }),
    makeFigure(kit, mats, hero, { jacket: PALETTE.royal, hat: '#1a1411' }),
    makeFigure(kit, mats, hero, { jacket: '#efe1c0', hat: PALETTE.red, bandmaster: true }),
  ];
  figures[0].root.position.set(-0.6, yb + 1.09, Z + DEPTH + 0.1);
  figures[1].root.position.set(0.6, yb + 1.09, Z + DEPTH + 0.1);
  figures[2].root.position.set(0, yb + 1.12, Z + DEPTH + 0.1);
  figures[2].root.scale.setScalar(1.12);
  for (const f of figures) group.add(f.root);

  return {
    group,
    mats: om,
    update(state) {
      const beat = state.musicBeat;
      const run = Math.min(1, state.speed * 3);
      // drummers strike on the beat, alternating hands
      const ph = (beat % 1) * Math.PI * 2;
      for (const [i, f] of [figures[0], figures[1]].entries()) {
        const lift = Math.max(0, Math.sin(ph + i * Math.PI)) * 0.9 * run;
        f.armR.rotation.x = -0.6 - lift;
        f.armL.rotation.x = -0.6 - Math.max(0, Math.sin(ph + Math.PI + i * Math.PI)) * 0.9 * run;
        f.head.rotation.y = Math.sin(beat * Math.PI * 0.333) * 0.3 * run;
      }
      // bandmaster beats a waltz pattern: down, out, up
      const b = figures[2];
      const t = (beat % 3) / 3;
      b.armR.rotation.x = -1.2 - Math.sin(t * Math.PI * 2) * 0.6 * run;
      b.armR.rotation.z = -0.4 - Math.cos(t * Math.PI * 2) * 0.35 * run;
      b.armL.rotation.x = -0.4 - Math.sin(beat * 0.5) * 0.15 * run;
      b.head.rotation.z = Math.sin(t * Math.PI * 2) * 0.12 * run;
      b.root.rotation.y = Math.sin(beat * Math.PI / 6) * 0.25 * run;
    },
  };
}

/** a little painted peg-doll automaton with jointed arms */
function makeFigure(kit, mats, hero, { jacket, hat, bandmaster = false }) {
  const seg = hero ? 16 : 8;
  const root = new THREE.Group();
  const paint = mats.paint;
  const body = new GeoBag();
  // trousers / skirt of the jacket, torso, plinth
  body.add(lathe([[0, 0], [0.1, 0], [0.11, 0.02], [0.1, 0.04], [0, 0.04]], seg), null, 'gold');
  body.add(lathe([[0, 0.04], [0.07, 0.04], [0.065, 0.2], [0.075, 0.24], [0, 0.24]], seg), null, 'paint', '#f2ece0');
  body.add(lathe([[0, 0.22], [0.095, 0.22], [0.085, 0.32], [0.07, 0.42], [0.05, 0.45], [0, 0.45]], seg), null, 'paint', jacket);
  body.add(new THREE.TorusGeometry(0.083, 0.008, 4, seg).rotateX(Math.PI / 2), mat(0, 0.3, 0), 'gold');
  for (let k = 0; k < 3; k++) body.add(new THREE.SphereGeometry(0.009, 6, 4), mat(0, 0.27 + k * 0.05, 0.085 - k * 0.006), 'gold');
  const bodyMesh = body.build({ paint, gold: mats.gold }, { name: 'figure' });
  root.add(bodyMesh);
  const head = new THREE.Group();
  head.position.y = 0.45;
  const hb = new GeoBag();
  hb.add(new THREE.SphereGeometry(0.07, seg, seg * 0.75), mat(0, 0.06, 0), 'paint', '#f0c9a8');
  hb.add(new THREE.SphereGeometry(0.008, 6, 4), mat(0.025, 0.075, 0.064), 'paint', '#1a1411');
  hb.add(new THREE.SphereGeometry(0.008, 6, 4), mat(-0.025, 0.075, 0.064), 'paint', '#1a1411');
  hb.add(new THREE.SphereGeometry(0.014, 6, 4), mat(0.035, 0.045, 0.058), 'paint', '#e48a86');
  hb.add(new THREE.SphereGeometry(0.014, 6, 4), mat(-0.035, 0.045, 0.058), 'paint', '#e48a86');
  if (bandmaster) {
    hb.add(lathe([[0, 0.1], [0.12, 0.1], [0.12, 0.115], [0.06, 0.12], [0.065, 0.24], [0, 0.24]], seg), null, 'paint', hat);
    hb.add(new THREE.TorusGeometry(0.063, 0.01, 4, seg).rotateX(Math.PI / 2), mat(0, 0.14, 0), 'gold');
  } else {
    hb.add(lathe([[0, 0.09], [0.07, 0.09], [0.075, 0.22], [0, 0.23]], seg), null, 'paint', hat);
    hb.add(new THREE.SphereGeometry(0.02, 6, 4), mat(0, 0.24, 0), 'paint', PALETTE.crimson);
    hb.add(new THREE.CylinderGeometry(0.076, 0.076, 0.012, seg), mat(0, 0.1, 0), 'gold');
  }
  head.add(hb.build({ paint, gold: mats.gold }, { name: 'figure:head' }));
  root.add(head);
  const arm = (side) => {
    const g = new THREE.Group();
    g.position.set(side * 0.085, 0.4, 0);
    const ab = new GeoBag();
    ab.add(new THREE.CapsuleGeometry(0.022, 0.12, 3, 8), mat(0, -0.08, 0), 'paint', jacket);
    ab.add(new THREE.SphereGeometry(0.024, 8, 6), mat(0, -0.17, 0), 'paint', '#f0c9a8');
    // drumstick / baton
    ab.add(new THREE.CylinderGeometry(0.006, 0.006, bandmaster ? 0.24 : 0.16, 6), mat(0, -0.19, 0.08, Math.PI / 2), 'paint', bandmaster ? '#f4ecdc' : '#7a4a2a');
    if (!bandmaster) ab.add(new THREE.SphereGeometry(0.014, 6, 4), mat(0, -0.19, 0.16), 'paint', '#f4ecdc');
    g.add(ab.build({ paint }, { name: 'figure:arm' }));
    root.add(g);
    return g;
  };
  const armR = arm(1);
  const armL = arm(-1);
  return { root, head, armR, armL };
}

