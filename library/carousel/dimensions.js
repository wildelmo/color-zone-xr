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
