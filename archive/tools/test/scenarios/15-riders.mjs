/**
 * F6 — Riders: a long stroke becomes a rail, a little paint drop rides it,
 * giggles when poked, flies off the end and splats; undo takes the rail
 * (and its rider) away without leaving anything behind.
 */
export const title = 'Riders: paint drops ride your strokes';

/**
 * Paint a long descending S-curve with the right controller (poses are in
 * rig space). The stroke starts a frame after the trigger press and the
 * last sample is dropped at release, so hold for a frame on both ends —
 * the emulator can run at a few fps under load and the tube must still
 * clear the 1.5 m rail threshold.
 */
async function paintRail(page, from, to, ms) {
  await page.evaluate(
    async ({ from, to, ms }) => {
      const E = window.__xrEmu;
      const app = window.__czx;
      app.paint.setBrushIndex(0);
      E.setController('right', from, [0, 0, 0, 1]);
      await E.waitFrames(2);
      E.setButton('right', 0, true, 1);
      await E.waitFrames(2);
      await E.animate('right', ms, (t) => ({
        pos: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t + Math.sin(t * Math.PI * 2) * 0.15],
        quat: [0, 0, 0, 1],
      }));
      await E.waitFrames(2);
      E.setButton('right', 0, false, 0);
      await E.waitFrames(2);
      E.setController('right', [0.35, 1.25, -0.4], [0, 0, 0, 1]);
      await E.waitFrames(25);
    },
    { from, to, ms }
  );
}

export async function run({ page, check, state }) {
  const before = await page.evaluate(() => {
    const a = window.__czx;
    if (!window.__riderEv) {
      window.__riderEv = { ride: 0, launch: 0, poke: 0 };
      a.events.on('ride', () => window.__riderEv.ride++);
      a.events.on('ridelaunch', () => window.__riderEv.launch++);
      a.events.on('ridepoke', () => window.__riderEv.poke++);
    }
    a.paint.setColorIndex(1);
    return { rails: a.riders.rails.length, splats: a.splats.splatCount, launches: a.riders.launches, pokes: a.riders.pokes };
  });

  // a ~2 m swoop from above the shoulder down to the hip
  await paintRail(page, [0.6, 1.9, -0.4], [-0.9, 0.8, -1.4], 1600);
  const s1 = await page.evaluate(() => {
    const a = window.__czx;
    const rail = a.riders.rails[a.riders.rails.length - 1];
    const r = a.riders.riders[0];
    return {
      rails: a.riders.rails.length,
      riders: a.riders.riders.length,
      rideEv: window.__riderEv.ride,
      len: rail ? rail.len : 0,
      onRail: !!r && r.s >= 0 && r.s <= r.rail.len && r.rail === rail,
      drawn: a.riders.body.count,
    };
  });
  check(s1.rails === before.rails + 1, `a long stroke became a rail (${s1.rails} rail(s), ${s1.len.toFixed(2)} m)`);
  check(s1.riders >= 1 && s1.rideEv >= 1 && s1.drawn === s1.riders, `a rider popped onto it (${s1.riders} riding, ${s1.rideEv} ride event(s), ${s1.drawn} drawn)`);
  check(s1.onRail, 'the rider sits on its rail');

  // poke it: put the wand tip just ahead of the rider (it keeps rolling, so try a few times)
  let poked = false;
  for (let attempt = 0; attempt < 8 && !poked; attempt++) {
    poked = await page.evaluate(async () => {
      const a = window.__czx;
      const E = window.__xrEmu;
      const r = a.riders.riders[0];
      if (!r) return false;
      const n0 = a.riders.pokes;
      const p = r.pos.clone().addScaledVector(r.up, 0.04).addScaledVector(r.tan, r.v * 0.08);
      a.rig.updateWorldMatrix(true, false);
      const l = a.rig.worldToLocal(p);
      E.setController('right', [l.x, l.y, l.z + 0.115], [0, 0, 0, 1]);
      await E.waitFrames(3);
      return a.riders.pokes > n0;
    });
  }
  const pulses = await page.evaluate(() => window.__xrEmu.pulses.length);
  check(poked, `poking the rider made it giggle and hop (${await page.evaluate(() => window.__riderEv.poke)} poke event(s), ${pulses} haptic pulses so far)`);
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setController('right', [0.35, 1.25, -0.4], [0, 0, 0, 1]);
    await E.waitFrames(2);
  });

  // it rolls down and flies off the end...
  const launched = await page.evaluate(async () => {
    const a = window.__czx;
    const E = window.__xrEmu;
    const n0 = a.riders.launches;
    let ok = a.riders.launches > n0;
    for (let i = 0; i < 25 && !ok; i++) {
      await E.waitFrames(10);
      ok = a.riders.launches > n0;
    }
    return { ok, launches: a.riders.launches, ev: window.__riderEv.launch };
  });
  check(launched.ok && launched.ev >= 1, `the rider flew off the end (${launched.launches} launch(es), ${launched.ev} ridelaunch event(s))`);
  // ...and splats colour where it lands
  const splatted = await page.evaluate(async (before) => {
    const a = window.__czx;
    const E = window.__xrEmu;
    let ok = a.splats.splatCount > before;
    for (let i = 0; i < 15 && !ok; i++) {
      await E.waitFrames(10);
      ok = a.splats.splatCount > before;
    }
    return { ok, splats: a.splats.splatCount };
  }, before.splats);
  check(splatted.ok, `the flying rider splatted colour (${before.splats} → ${splatted.splats} splats)`);
  const said = await page.evaluate(() => window.__czx.riders.commented);
  check(said, 'Dot commented on the first ride');

  // a second rail, then undo it: the rail and its rider must vanish, nothing orphaned
  await paintRail(page, [1.2, 1.9, -0.4], [-0.2, 0.8, -1.7], 1500);
  const undo = await page.evaluate(async () => {
    const a = window.__czx;
    const E = window.__xrEmu;
    const railsBefore = a.riders.rails.length;
    const last = a.paint.history[a.paint.history.length - 1];
    const rail = a.riders.rails.find((r) => r.entry === last);
    const hadRider = !!rail && a.riders.riders.some((r) => r.rail === rail);
    a.paint.undo();
    await E.waitFrames(3);
    const rails = a.riders.rails;
    const orphans = a.riders.riders.filter((r) => !rails.includes(r.rail)).length;
    return { wasRail: !!rail, hadRider, railsBefore, railsAfter: rails.length, orphans, riders: a.riders.riders.length, drawn: a.riders.body.count, faces: a.riders.face.count };
  });
  check(undo.wasRail && undo.railsAfter === undo.railsBefore - 1, `undo removed the rail (${undo.railsBefore} → ${undo.railsAfter}${undo.hadRider ? ', rider aboard' : ''})`);
  check(undo.orphans === 0 && undo.drawn === undo.riders && undo.faces === undo.riders, `no orphan riders (${undo.riders} riding, ${undo.drawn} drawn)`);

  const s = await state(page);
  check(s.drawCalls < 190, `draw calls stay low with riders (${s.drawCalls} for both eyes)`);
  check(s.frameErrors === 0, 'no frame errors while riding');
}
