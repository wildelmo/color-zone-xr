/**
 * Checks that the snow-globe town's small things are attached to something:
 * every light hangs from a lamp, a post or a wire, the guards walk on top of
 * the wall (not on air, not through towers), and every flag flies from a
 * pole. Runs in the page, against a built town (island-local coordinates).
 *
 *   const { findFloaters } = await import('/tools/test/floaters.js');
 *   const r = findFloaters(THREE, town);   // { lights, guards, flags }
 */
export function findFloaters(THREE, town, { seconds = 600, step = 2 } = {}) {
  const skip = /walkers|flags|folk|sails/;
  const targets = [];
  town.group.updateMatrixWorld(true);
  town.group.traverse((o) => o.isMesh && !skip.test(o.name) && targets.push(o));
  const rc = new THREE.Raycaster();
  const toWorld = (p) => p.clone().applyMatrix4(town.group.matrixWorld);
  const scale = new THREE.Vector3().setFromMatrixScale(town.group.matrixWorld).x;
  // 14 directions (cube faces and corners)
  const dirs = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (Math.abs(x) + Math.abs(y) + Math.abs(z) === 1 || (x && y && z)) dirs.push(new THREE.Vector3(x, y, z).normalize());
  /** is there a surface within d (island units) of p (island-local)? rays inward from a shell round it */
  const near = (p, d) => {
    const P = toWorld(p);
    for (const dir of dirs) {
      rc.set(P.clone().addScaledVector(dir, d * scale), dir.clone().negate());
      rc.far = d * scale * 1.02;
      if (rc.intersectObjects(targets, false).length) return true;
    }
    return false;
  };

  // lights: street lanterns, door and gate lamps, the well, the bridge, string lights
  const lights = [];
  town.lanterns.forEach((p, i) => near(p, 0.35) || lights.push({ kind: 'lantern', i, at: p.toArray().map((v) => +v.toFixed(2)) }));
  (town.fairy || []).forEach((b, i) => near(b.p, 0.2) || lights.push({ kind: 'string light', i, at: b.p.toArray().map((v) => +v.toFixed(2)) }));

  // guards on the wall-walk: something under their feet, and not inside a tower
  const guards = { samples: 0, floating: 0, sunk: 0, inTower: 0, worst: null };
  const w = town.walkers;
  if (w) {
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const towers = (town.blockers || []).filter((b) => b.r !== undefined && b.r > 1.5 && b.r < 3);
    for (let t = 0; t < seconds; t += step) {
      w.update(t);
      for (let i = 0; i < w.mesh.count; i++) {
        w.mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        guards.samples++;
        rc.set(toWorld(p.clone().add(new THREE.Vector3(0, 0.6, 0))), new THREE.Vector3(0, -1, 0));
        rc.far = 1.6 * scale;
        const hit = rc.intersectObjects(targets, false)[0];
        const drop = hit ? hit.distance / scale - 0.6 : Infinity; // feet above the surface
        if (drop > 0.12) {
          guards.floating++;
          if (!guards.worst || drop > guards.worst.drop) guards.worst = { t, i, drop: +drop.toFixed(2), at: p.toArray().map((v) => +v.toFixed(1)) };
        } else if (drop < -0.12) guards.sunk++;
        if (towers.some((b) => Math.hypot(p.x - b.x, p.z - b.z) < b.r - 0.35)) guards.inTower++;
      }
    }
  }

  // flags: the top of each one's hoist edge is at its pole
  const flags = [];
  (town.flagSpecs || []).forEach((s, i) => near(s.p, 0.15) || flags.push({ i, pattern: s.pattern, at: s.p.toArray().map((v) => +v.toFixed(2)) }));

  return { lights, guards, flags, counts: { lanterns: town.lanterns.length, stringLights: (town.fairy || []).length, flags: (town.flagSpecs || []).length } };
}
