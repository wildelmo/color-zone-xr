/**
 * Carousel dimensions, in metres at life size (the toy is shown at 1:25).
 * Everything that has to line up mechanically (pinions on the crown gear,
 * crank throws, pole lengths) is derived from here.
 */
export const D = {
  // stationary base
  plinthR: 5.6,
  plinthTop: 1.2,
  windowHalfAngle: 0.27,
  windowY0: 0.5,
  windowY1: 0.98,
  // rotating platform
  deckR: 5.0,
  deckBottom: 1.24,
  deckTop: 1.52,
  // stationary centre
  columnR: 1.25,
  columnTop: 4.72,
  crownTop: 4.85,
  crownR0: 1.33,
  crownR1: 1.8,
  crownTeeth: 62,
  // crank drive
  pinionR: 0.3,
  pinionX: 1.55,
  pinionTeeth: 12,
  shaftY: 5.15,
  crank: 0.26,
  rod: 0.55,
  sweepY: 5.56,
  sweeps: 12,
  // horses
  outerR: 4.3,
  innerR: 3.15,
  innerScale: 0.75,
  horseMid: 2.6,
  // canopy
  boardR: 5.15,
  boardBottom: 5.3,
  boardTop: 6.2,
  roofBaseR: 5.32,
  roofBaseY: 6.34,
  roofTopR: 1.22,
  roofTopY: 7.7,
  ceilingY: 5.78,
  cupolaTop: 8.25,
  domeTop: 8.85,
  finialTop: 9.45,
};

/** crankshaft turns per platform turn (pinion rolling round the crown gear; it turns the opposite way, see index.js) */
D.ratio = D.pinionX / D.pinionR;
/** pole top sits this far below the shaft when the crank is level */
D.poleTopToHorse = D.shaftY - D.rod - D.horseMid;

/**
 * grid spacing (horse units) the horses are meshed at: the hero carousel's
 * near and far levels of detail, and the shelf miniature. The test suite
 * checks the mane at these same resolutions. (The shelf horse is the fused
 * `mini` layer meshed at `shelf` and then simplified to MINI_HORSE_TRIS, see
 * miniature.js; the separate body and mane layers are not drawn there.)
 */
export const HORSE_CELLS = { hi: 0.034, lo: 0.062, shelf: 0.08 };
/** triangles in one shelf-preview horse, after simplification */
export const MINI_HORSE_TRIS = 420;
/**
 * the hero's horse shadow caster (the `shadow` layer, drawn only into the
 * shadow map): meshed at the far level's spacing, then simplified. A shadow
 * map texel is about 2 cm of carousel at any scale, so a few hundred
 * triangles keep the outline of a 2 m horse. Not a drawn level, so it is not
 * in HORSE_CELLS.
 */
export const HORSE_SHADOW = { cell: HORSE_CELLS.lo, tris: 900 };
/** radius of the gilt piping round a horse's saddle blanket (a tube near, painted far) */
export const BLANKET_PIPING = 0.0095;
