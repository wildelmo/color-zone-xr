/**
 * Le Royaume de Givre: dimensions in metres at "life size" (the globe is
 * shown at 1:240 on the table, about 43 cm across).
 */
export const G = {
  // the wild base of dark rock and crystal
  baseR: 44,
  rimY: 31, // where the rock cups the glass
  // the glass sphere
  globeR: 52,
  globeY: 69, // centre
  // inside floor (rock + snow drifts) where the sphere meets the rim
  floorY: 31.5,
  // the floating island: y of its lowest town terrace
  islandY: 64,
  edgeR: 27, // average cliff radius
  terrace: [0, 3.6, 7.4], // heights of the three terraces above islandY
  terraceR: [17, 10], // radii of the steps up to terraces 2 and 3
  hill: [-2.5, -1.5], // x, z offset of the castle hill
};

G.floorR = Math.sqrt(G.globeR * G.globeR - (G.globeY - G.floorY) ** 2);
G.top = G.globeY + G.globeR;
