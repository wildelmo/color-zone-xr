import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBag, lathe, mat, ringMat, tube, spurGear, normalizeGeometry, filigreeCrest, roundRectShape, ellipsePoints, beadRing } from '../core/geometry.js';
import { PALETTE } from '../core/materials.js';
import { sceneAtlas, roofTexture, ceilingTexture, deckTexture } from './paintings.js';
import { D } from './dimensions.js';

/**
 * Everything that turns: the plank deck, the sweeps and crankshafts under
 * the canopy, the rounding boards (mirrors + painted vignettes), the
 * scalloped valance, gilded cresting, the striped tent roof, the cupola and
 * its pennant.
 */
export function buildRotor(ctx, kit, shared, bulbs, { lod }) {
  const hero = lod === 'hero';
  const seg = hero ? 144 : 48;
  const beadSeg = hero ? 96 : 40;
  const mats = {
    ...shared,
    deck: kit.standard({ map: kit.trackTexture(deckTexture()), roughness: 0.55 }),
    scenes: kit.standard({ map: kit.trackTexture(sceneAtlas()), roughness: 0.4 }),
    roof: kit.standard({ map: kit.trackTexture(roofTexture()), roughness: 0.55 }),
    // the painted ceiling glows a little, as if lit by the bulbs below it
    ceiling: (() => {
      const t = kit.trackTexture(ceilingTexture());
      return kit.standard({ map: t, emissiveMap: t, emissive: 0x6a5040, roughness: 0.6 });
    })(),
  };
  const bag = new GeoBag(); // deck
  const mech = new GeoBag(); // sweeps, bearings, ceiling
  const canopy = new GeoBag(); // rounding boards, valance, cresting, roof
  const top = new GeoBag(); // cupola, dome, finial

  // ------------------------------------------------------------- platform
  bag.add(lathe([[1.4, D.deckBottom], [4.9, D.deckBottom], [4.98, D.deckBottom + 0.03], [5.04, 1.31], [5.04, 1.45], [5.0, 1.49], [4.95, D.deckTop - 0.005], [1.4, D.deckTop - 0.005]], seg), null, 'paint', PALETTE.red);
  const deckGeo = new THREE.RingGeometry(1.4, 4.95, hero ? 96 : 36, 3);
  {
    const uv = deckGeo.attributes.uv;
    const ts = hero ? 96 : 36;
    for (let j = 0; j <= 3; j++) for (let i = 0; i <= ts; i++) uv.setXY(j * (ts + 1) + i, i / ts, j / 3);
    deckGeo.rotateX(-Math.PI / 2);
    deckGeo.translate(0, D.deckTop, 0);
  }
  bag.add(deckGeo, null, 'deck');
  bag.add(beadRing(4.97, D.deckTop - 0.005, 0.025, beadSeg, 5), null, 'gold');
  bag.add(beadRing(5.045, 1.3, 0.02, beadSeg, 5), null, 'gold');
  bag.add(beadRing(5.045, 1.46, 0.02, beadSeg, 5), null, 'gold');
  // little mirrors and rosettes round the deck skirt
  for (let i = 0; i < 24; i++) {
    const a = ((i + 0.5) / 24) * Math.PI * 2;
    bag.add(new THREE.ShapeGeometry(ellipseShape(0.2, 0.065), 6), ringMat(a, 5.05, 1.38), 'mirror');
    bag.add(tube(ellipsePoints(0.215, 0.08, 20), 0.014, { closed: true, segments: 32, radial: 4 }), ringMat(a, 5.05, 1.38), 'gold');
    const ra = (i / 24) * Math.PI * 2;
    bag.add(new THREE.SphereGeometry(0.04, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), ringMat(ra, 5.04, 1.38), 'gold');
  }

  // ---------------------------------------------------- sweeps and bearings
  const sweepH = 0.22, sweepW = 0.14;
  for (let k = 0; k < D.sweeps; k++) {
    const a = (k / D.sweeps) * Math.PI * 2;
    const rot = mat(0, 0, 0, 0, -a);
    const len = D.boardR - 0.45;
    const beam = new THREE.BoxGeometry(len, sweepH, sweepW);
    beam.translate(0.45 + len / 2, D.sweepY, 0);
    mech.add(beam, rot, 'paint', '#5c2617');
    const stripe = new THREE.BoxGeometry(len * 0.9, 0.025, sweepW + 0.01);
    stripe.translate(0.45 + len * 0.52, D.sweepY - 0.06, 0);
    mech.add(stripe, rot, 'gold');
    for (const x of [1.85, (D.innerR + D.outerR) / 2, 4.78]) {
      const hang = D.sweepY - sweepH / 2 - D.shaftY;
      const strap = new THREE.BoxGeometry(0.05, hang, 0.1);
      strap.translate(x, D.shaftY + hang / 2, 0);
      mech.add(strap, rot, 'steel');
      const ring = new THREE.TorusGeometry(0.075, 0.03, 6, hero ? 14 : 8);
      ring.rotateY(Math.PI / 2);
      ring.translate(x, D.shaftY, 0);
      mech.add(ring, rot, 'brass');
    }
    // the rounding board hangs from the sweep end on an iron bracket
    const br = new THREE.BoxGeometry(0.08, 0.5, 0.08);
    br.translate(D.boardR - 0.1, D.sweepY - 0.1, 0);
    mech.add(br, rot, 'steel');
  }
  // hub on the centre pole
  mech.add(lathe([[0.33, 5.38], [0.58, 5.38], [0.6, 5.42], [0.6, 5.7], [0.58, 5.74], [0.33, 5.74]], 32), null, 'steel');
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    mech.add(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 6).rotateZ(Math.PI / 2), ringMat(a, 0.62, 5.62, 0, 0), 'brass');
  }
  // painted sunburst ceiling above the machinery
  const ceil = new THREE.RingGeometry(0.34, D.boardR - 0.02, hero ? 96 : 32, 1);
  ceil.rotateX(Math.PI / 2);
  ceil.translate(0, D.ceilingY, 0);
  mech.add(ceil, null, 'ceiling');

  // ------------------------------------------------------- rounding boards
  const yb0 = D.boardBottom, yb1 = D.boardTop, ybm = (yb0 + yb1) / 2;
  const band = new THREE.CylinderGeometry(D.boardR, D.boardR, yb1 - yb0, seg, 1, true);
  band.translate(0, ybm, 0);
  canopy.add(band, null, 'paint', PALETTE.cream);
  const bandIn = new THREE.CylinderGeometry(D.boardR - 0.04, D.boardR - 0.04, yb1 - yb0, seg, 1, true);
  bandIn.scale(-1, 1, 1);
  bandIn.translate(0, ybm, 0);
  canopy.add(bandIn, null, 'paint', PALETTE.oxblood);
  // mouldings
  canopy.add(lathe([[D.boardR - 0.04, yb0 - 0.05], [D.boardR + 0.07, yb0 - 0.05], [D.boardR + 0.1, yb0 - 0.01], [D.boardR + 0.07, yb0 + 0.04], [D.boardR, yb0 + 0.06]], seg), null, 'paint', PALETTE.red);
  canopy.add(beadRing(D.boardR + 0.1, yb0 - 0.01, 0.025, beadSeg, 5), null, 'gold');
  canopy.add(lathe([[D.boardR, yb1 - 0.06], [D.boardR + 0.06, yb1 - 0.04], [D.boardR + 0.08, yb1], [D.boardR + 0.16, yb1 + 0.06], [D.roofBaseR + 0.05, yb1 + 0.1], [D.roofBaseR + 0.05, D.roofBaseY], [D.boardR - 0.04, D.roofBaseY]], seg), null, 'paint', PALETTE.red);
  canopy.add(beadRing(D.boardR + 0.085, yb1, 0.025, beadSeg, 5), null, 'gold');
  canopy.add(beadRing(D.roofBaseR + 0.06, D.roofBaseY - 0.03, 0.03, beadSeg, 5), null, 'gold');

  const slots = 24;
  for (let i = 0; i < slots; i++) {
    const a = ((i + 0.5) / slots) * Math.PI * 2;
    if (i % 2 === 0) {
      // bevelled oval mirror with jewels
      canopy.add(new THREE.ShapeGeometry(ellipseShape(0.36, 0.3), 16), ringMat(a, D.boardR + 0.035, ybm), 'mirror');
      canopy.add(tube(ellipsePoints(0.38, 0.32, 28), 0.03, { closed: true, segments: 36, radial: hero ? 4 : 3 }), ringMat(a, D.boardR + 0.04, ybm), 'gold');
      canopy.add(tube(ellipsePoints(0.44, 0.38, 28), 0.012, { closed: true, segments: 40, radial: 3 }), ringMat(a, D.boardR + 0.03, ybm), 'gold');
      for (const [x, y] of [[0, 0.33], [0, -0.33], [0.39, 0], [-0.39, 0]]) {
        canopy.add(new THREE.IcosahedronGeometry(0.035, 0).scale(1, 1, 0.6), ringMat(a, D.boardR + 0.08, ybm, 0, 0).multiply(mat(x, y, 0)), 'jewel', x ? '#1d4fb5' : '#b3122e');
      }
    } else {
      // painted vignette in a gilded frame
      const pw = 1.0, ph = 0.6;
      const pg = new THREE.ShapeGeometry(roundRectShape(pw, ph, 0.08), 4);
      const cell = (i >> 1) % 4;
      const uv = pg.attributes.uv, p = pg.attributes.position;
      for (let k = 0; k < p.count; k++) uv.setXY(k, (cell % 2) * 0.5 + ((p.getX(k) + pw / 2) / pw) * 0.5, (cell < 2 ? 0.5 : 0) + ((p.getY(k) + ph / 2) / ph) * 0.5);
      canopy.add(pg, ringMat(a, D.boardR + 0.045, ybm), 'scenes');
      const frame = roundRectShape(pw + 0.06, ph + 0.06, 0.1).getPoints(8).map((v) => [v.x, v.y, 0]);
      canopy.add(tube(frame, 0.026, { closed: true, segments: 40, radial: hero ? 4 : 3, tension: 0.2 }), ringMat(a, D.boardR + 0.05, ybm), 'gold');
    }
    // pilaster + bulbs between slots
    const pa = (i / slots) * Math.PI * 2;
    canopy.add(new THREE.CylinderGeometry(0.035, 0.035, yb1 - yb0 - 0.1, hero ? 8 : 5), mat(Math.cos(pa) * (D.boardR + 0.04), ybm, Math.sin(pa) * (D.boardR + 0.04)), 'gold');
    bulbs.add(new THREE.Vector3(Math.cos(pa) * (D.boardR + 0.1), yb0 + 0.16, Math.sin(pa) * (D.boardR + 0.1)), 1, i, slots);
    bulbs.add(new THREE.Vector3(Math.cos(pa) * (D.boardR + 0.1), yb1 - 0.16, Math.sin(pa) * (D.boardR + 0.1)), 2, i, slots);
  }
  // bulbs along the cornice
  const nc = 48;
  for (let i = 0; i < nc; i++) {
    const a = ((i + 0.25) / nc) * Math.PI * 2;
    bulbs.add(new THREE.Vector3(Math.cos(a) * (D.roofBaseR + 0.1), D.roofBaseY - 0.12, Math.sin(a) * (D.roofBaseR + 0.1)), 3, i, nc);
  }

  // ------------------------------------------------------------ valance
  const nScallop = 48;
  const vTop = yb0 - 0.05, vDepth = 0.2, vSag = 0.1;
  {
    const cols = nScallop * (hero ? 8 : 4);
    const rows = 3;
    const pos = [], uv = [], idx = [], col = [];
    const red = new THREE.Color(PALETTE.crimson);
    const edge = [];
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const a = u * Math.PI * 2;
      const frac = (u * nScallop) % 1;
      const yb = vTop - vDepth - vSag * Math.sin(Math.PI * frac);
      for (let j = 0; j <= rows; j++) {
        const t = j / rows;
        const y = vTop + (yb - vTop) * t;
        const r = D.boardR + 0.06 + 0.06 * t;
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        uv.push(u, 1 - t);
        const shade = 1 - 0.18 * Math.sin(Math.PI * frac) * t;
        col.push(red.r * shade, red.g * shade, red.b * shade);
      }
      edge.push([Math.cos(a) * (D.boardR + 0.125), yb, Math.sin(a) * (D.boardR + 0.125)]);
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const a = i * (rows + 1) + j, b = a + 1, c = a + rows + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    canopy.add(g, null, 'paintDouble');
    canopy.add(tube(edge, 0.018, { closed: true, segments: Math.round(cols * 0.6), radial: hero ? 4 : 3 }), null, 'gold');
    // gold drops (tassels) where scallops meet
    const drop = lathe([[0, 0], [0.03, -0.01], [0.05, -0.05], [0.045, -0.1], [0.025, -0.14], [0, -0.16]], hero ? 6 : 4);
    for (let i = 0; i < nScallop; i++) {
      const a = (i / nScallop) * Math.PI * 2;
      canopy.add(drop.clone(), mat(Math.cos(a) * (D.boardR + 0.125), vTop - vDepth, Math.sin(a) * (D.boardR + 0.125)), 'gold');
    }
    drop.dispose();
  }

  // ------------------------------------------------------------- cresting
  const crestGeo = filigreeCrest(1.1, { radial: hero ? 4 : 3, segments: hero ? 12 : 5, medallion: true });
  for (let i = 0; i < 12; i++) {
    const a = ((i * 2 + 0.5) / slots) * Math.PI * 2;
    const m = ringMat(a, D.roofBaseR + 0.02, D.roofBaseY - 0.02, -0.12);
    canopy.add(crestGeo.clone(), m, 'gold');
    const medal = new THREE.ShapeGeometry(ellipseShape(0.18, 0.225), 12);
    canopy.add(medal, m.clone().multiply(mat(0, 0.396, -0.005)), i % 2 ? 'mirror' : 'jewel', PALETTE.crimson);
    const top = new THREE.Vector3(0, 0.98, 0.0).applyMatrix4(m);
    bulbs.add(top, 4, i, 12);
    // finial between crests
    const fa = ((i * 2 + 1.5) / slots) * Math.PI * 2;
    canopy.add(lathe([[0, 0], [0.06, 0], [0.04, 0.08], [0.03, 0.2], [0.07, 0.28], [0.03, 0.36], [0, 0.38]], hero ? 10 : 6), mat(Math.cos(fa) * (D.roofBaseR + 0.04), D.roofBaseY - 0.02, Math.sin(fa) * (D.roofBaseR + 0.04)), 'gold');
  }
  crestGeo.dispose();

  // ---------------------------------------------------------------- roof
  const roofPts = [];
  const steps = hero ? 18 : 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    roofPts.push([D.roofBaseR + (D.roofTopR - D.roofBaseR) * t, D.roofBaseY + (D.roofTopY - D.roofBaseY) * Math.pow(t, 1.5)]);
  }
  const roof = lathe(roofPts, hero ? 192 : 72);
  {
    // canvas sags a little between the gilded ribs
    const p = roof.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), z = p.getZ(k), y = p.getY(k);
      const phi = Math.atan2(x, z);
      const t = (y - D.roofBaseY) / (D.roofTopY - D.roofBaseY);
      const s = 1 - 0.022 * Math.abs(Math.sin(12 * phi)) * Math.sin(Math.PI * Math.min(1, t * 1.1));
      p.setX(k, x * s);
      p.setZ(k, z * s);
      p.setY(k, y - 0.04 * Math.abs(Math.sin(12 * phi)) * (1 - t));
    }
    roof.computeVertexNormals();
  }
  canopy.add(roof, null, 'roof');
  for (let r = 0; r < 24; r++) {
    const phi = (r / 24) * Math.PI * 2;
    const pts = roofPts.map(([rr, y]) => [Math.sin(phi) * (rr + 0.03), y + 0.025, Math.cos(phi) * (rr + 0.03)]);
    canopy.add(tube(pts, 0.03, { segments: Math.round(steps * 1.2), radial: hero ? 4 : 3 }), null, 'gold');
    for (const t of [0.22, 0.5, 0.78]) {
      const i = Math.round(t * steps);
      const [rr, y] = roofPts[i];
      bulbs.add(new THREE.Vector3(Math.sin(phi) * (rr + 0.07), y + 0.06, Math.cos(phi) * (rr + 0.07)), 5 + Math.round(t * 4), r, 24);
    }
  }
  canopy.add(lathe([[D.roofTopR - 0.05, D.roofTopY - 0.04], [D.roofTopR + 0.1, D.roofTopY - 0.02], [D.roofTopR + 0.12, D.roofTopY + 0.05], [D.roofTopR - 0.05, D.roofTopY + 0.08]], 48), null, 'gold');

  // --------------------------------------------------------------- cupola
  const cr = 1.1;
  top.add(new THREE.CylinderGeometry(cr, cr, D.cupolaTop - D.roofTopY, hero ? 64 : 24, 1, true), mat(0, (D.cupolaTop + D.roofTopY) / 2, 0), 'paint', PALETTE.cream);
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const win = new THREE.ShapeGeometry(archShape(0.32, 0.36), 6);
    top.add(win, ringMat(a, cr + 0.012, (D.cupolaTop + D.roofTopY) / 2 - 0.02), 'mirror');
    const pa = (i / 8) * Math.PI * 2;
    top.add(new THREE.CylinderGeometry(0.03, 0.03, D.cupolaTop - D.roofTopY, 6), mat(Math.cos(pa) * (cr + 0.03), (D.cupolaTop + D.roofTopY) / 2, Math.sin(pa) * (cr + 0.03)), 'gold');
    bulbs.add(new THREE.Vector3(Math.cos(pa) * (cr + 0.09), D.cupolaTop - 0.08, Math.sin(pa) * (cr + 0.09)), 9, i, 8);
  }
  top.add(lathe([[cr - 0.02, D.cupolaTop - 0.05], [cr + 0.12, D.cupolaTop - 0.03], [cr + 0.16, D.cupolaTop + 0.03], [1.25, D.cupolaTop + 0.05]], 48), null, 'paint', PALETTE.red);
  const domePts = [[1.25, D.cupolaTop + 0.05], [1.27, D.cupolaTop + 0.1], [1.2, D.cupolaTop + 0.22], [1.02, D.cupolaTop + 0.36], [0.74, D.cupolaTop + 0.48], [0.4, D.cupolaTop + 0.56], [0.14, D.cupolaTop + 0.6], [0.0, D.domeTop]];
  top.add(lathe(domePts, hero ? 64 : 24), null, 'paint', PALETTE.crimson);
  for (let r = 0; r < 8; r++) {
    const phi = (r / 8) * Math.PI * 2;
    top.add(tube(domePts.slice(0, -1).map(([rr, y]) => [Math.sin(phi) * (rr + 0.02), y + 0.01, Math.cos(phi) * (rr + 0.02)]), 0.025, { segments: 16, radial: 4 }), null, 'gold');
  }
  top.add(beadRing(1.26, D.cupolaTop + 0.07, 0.03, 48, 6), null, 'gold');
  // finial and flagpole
  top.add(lathe([[0, D.domeTop - 0.02], [0.12, D.domeTop], [0.08, D.domeTop + 0.08], [0.2, D.domeTop + 0.22], [0.08, D.domeTop + 0.36], [0.04, D.domeTop + 0.45], [0.05, D.domeTop + 0.5], [0.02, D.finialTop], [0, D.finialTop]], hero ? 20 : 10), null, 'gold');
  top.add(new THREE.CylinderGeometry(0.02, 0.025, 0.9, 6), mat(0, D.finialTop + 0.4, 0), 'gold');
  top.add(new THREE.SphereGeometry(0.05, 10, 8), mat(0, D.finialTop + 0.86, 0), 'gold');

  // ------------------------------------------------------- crankshafts
  const shafts = buildCrankshafts(kit, shared, hero);

  const group = new THREE.Group();
  group.name = 'rotor';
  const parts = {
    deck: bag.build(mats, { name: 'deck' }),
    mech: mech.build(mats, { name: 'mechanism' }),
    canopy: canopy.build(mats, { name: 'canopy' }),
    top: top.build(mats, { name: 'cupola' }),
  };
  parts.mech.add(shafts.group);
  // pennant: animated cloth
  const flag = buildFlag(kit, hero);
  flag.mesh.position.set(0, D.finialTop + 0.62, 0);
  parts.top.add(flag.mesh);
  for (const g of Object.values(parts)) group.add(g);

  return {
    group,
    parts,
    shafts,
    update(state) {
      shafts.update(state.crank);
      flag.update(state.time, state.speed);
    },
  };
}

function ellipseShape(rx, ry) {
  const s = new THREE.Shape();
  s.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false);
  return s;
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

/** 12 crankshafts: pinion rolling on the crown gear + two crank throws */
function buildCrankshafts(kit, shared, hero) {
  const steelParts = [];
  const brassParts = [];
  const x0 = D.pinionX + 0.08, x1 = 4.85;
  steelParts.push(new THREE.CylinderGeometry(0.042, 0.042, x1 - x0, hero ? 12 : 6).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, 0, 0));
  for (const [x, sgn] of [[D.outerR, 1], [D.innerR, -1]]) {
    for (const dx of [-0.08, 0.08]) {
      const cheek = new THREE.BoxGeometry(0.04, D.crank + 0.12, 0.13);
      cheek.translate(x + dx, (sgn * D.crank) / 2, 0);
      steelParts.push(cheek);
    }
    steelParts.push(new THREE.CylinderGeometry(0.035, 0.035, 0.2, hero ? 10 : 6).rotateZ(Math.PI / 2).translate(x, sgn * D.crank, 0));
  }
  brassParts.push(spurGear(D.pinionTeeth, D.pinionR, 0.1, { hole: 0, curveSegments: 1 }).rotateY(Math.PI / 2).translate(D.pinionX, 0, 0));
  brassParts.push(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12).rotateZ(Math.PI / 2).translate(D.pinionX + 0.1, 0, 0));
  for (const x of [x1 - 0.02]) brassParts.push(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateZ(Math.PI / 2).translate(x, 0, 0));
  const steelGeo = mergeGeometries(steelParts.map((g) => normalizeGeometry(g)), false);
  const brassGeo = mergeGeometries(brassParts.map((g) => normalizeGeometry(g)), false);
  steelParts.concat(brassParts).forEach((g) => g.dispose());
  const n = D.sweeps;
  const steel = new THREE.InstancedMesh(steelGeo, shared.steel, n);
  const brass = new THREE.InstancedMesh(brassGeo, shared.brass, n);
  for (const m of [steel, brass]) {
    m.castShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  steel.name = 'crankshafts:steel';
  brass.name = 'crankshafts:brass';
  const group = new THREE.Group();
  group.name = 'crankshafts';
  group.add(steel, brass);
  const m = new THREE.Matrix4();
  const rx = new THREE.Matrix4();
  return {
    group,
    update(crankBase) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        m.makeRotationY(-a);
        m.setPosition(0, D.shaftY, 0);
        rx.makeRotationX(crankBase + k * (Math.PI / 2));
        m.multiply(rx);
        steel.setMatrixAt(k, m);
        brass.setMatrixAt(k, m);
      }
      steel.instanceMatrix.needsUpdate = true;
      brass.instanceMatrix.needsUpdate = true;
    },
  };
}

function buildFlag(kit, hero) {
  const W = 1.0, H = 0.46;
  const sx = hero ? 14 : 6, sy = hero ? 5 : 2;
  const g = new THREE.PlaneGeometry(W, H, sx, sy);
  g.translate(W / 2, 0, 0);
  const p = g.attributes.position;
  const base = new Float32Array(p.array);
  // taper into a pennant
  for (let i = 0; i < p.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1];
    base[i * 3 + 1] = y * (1 - 0.75 * (x / W));
  }
  const colors = new Float32Array(p.count * 3);
  const red = new THREE.Color(PALETTE.crimson), gold = new THREE.Color(PALETTE.gold);
  for (let i = 0; i < p.count; i++) {
    const y = base[i * 3 + 1] / (H * 0.5 * (1 - 0.75 * (base[i * 3] / W)) || 1);
    const c = Math.abs(y) > 0.7 ? gold : red;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = kit.standard({ color: 0xffffff, vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'flag';
  mesh.castShadow = true;
  return {
    mesh,
    update(t, speed) {
      const amp = 0.05 + speed * 0.06;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        const k = x / W;
        p.setXYZ(i, x * (1 - 0.04 * k), y - k * k * 0.06, Math.sin(x * 6 - t * (3 + speed * 5)) * amp * k + Math.sin(x * 11 - t * 7 + y * 4) * amp * 0.25 * k);
      }
      p.needsUpdate = true;
      g.computeVertexNormals();
    },
  };
}
