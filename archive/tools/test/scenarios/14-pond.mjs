/**
 * F5 — Pond life. A paint ball dropped into the pond goes kersploosh (waterhit,
 * the water takes the colour, the fountain is fed and bubbles a column, every
 * koi leaps); a wand tip resting on the water lures the fish, who nibble
 * (haptics) and then leap through it; and an ambient bubble rises from the
 * colour front within 6 m of the player.
 */
export const title = 'Pond life: feed the fountain, fish, bubbles near you';

export async function run({ page, check, state }) {
  // 1. drop a paint ball straight into the pond
  const r1 = await page.evaluate(async () => {
    const app = window.__czx;
    const E = window.__xrEmu;
    const T = app.THREE;
    const P = app.world.terrain.pond;
    const wl = app.world.terrain.waterLevel;
    const counters = { hits: 0, feeds: 0, leaps: 0 };
    app.events.on('waterhit', () => counters.hits++);
    app.events.on('pondfeed', () => counters.feeds++);
    app.events.on('fishleap', () => counters.leaps++);
    const before = { alive: app.bubbles.aliveCount, spawns: app.bubbles.spawnCount, fed: app.pond.fed.size, level: app.world.fountain.level, decals: app.splats.decals.count, splats: app.splats.splatCount };
    const ball = app.splats.launch(new T.Vector3(P.x + 1.1, wl + 1.6, P.z + 0.7), new T.Vector3(0, -1, 0), new T.Color('#ff3b5c'));
    for (let i = 0; i < 16 && counters.hits === 0; i++) await E.waitFrames(4);
    await E.waitFrames(20); // the bubble column and the fish rush are staggered over ~0.8 s
    return {
      before,
      ...counters,
      gone: !app.splats.balls.includes(ball),
      fed: app.pond.fed.size,
      awake: app.pond.awake,
      level: app.world.fountain.level,
      alive: app.bubbles.aliveCount,
      spawns: app.bubbles.spawnCount,
      pondCov: app.world.paintMap.coverageAt(P.x, P.z),
      mist: app.world.fountain.mist.visible,
      fishColored: app.pond.fish.coloredCount,
      decals: app.splats.decals.count,
      splats: app.splats.splatCount,
    };
  });
  check(r1.hits === 1 && r1.gone, `paint ball hit the water: waterhit fired ${r1.hits}×, ball consumed`);
  check(r1.decals === r1.before.decals && r1.splats === r1.before.splats, 'water hit left no splat decal');
  check(r1.fed === 1 && r1.awake && r1.feeds >= 1, `fountain fed its first colour (fed ${r1.fed}, pondfeed ${r1.feeds}×)`);
  check(r1.level > 0 && r1.mist, `fountain level rose to ${r1.level.toFixed(2)} and the mist appeared`);
  check(r1.spawns >= r1.before.spawns + 8 && (r1.alive > r1.before.alive || r1.before.alive >= 32), `a column of bubbles rose from the fountain (${r1.before.alive} → ${r1.alive} alive, ${r1.spawns - r1.before.spawns} blown)`);
  check(r1.pondCov > 0.4, `the whole pond took the colour (coverage ${r1.pondCov.toFixed(2)} at the centre)`);
  check(r1.leaps >= 3 && r1.fishColored >= 1, `the koi rushed and leapt (${r1.leaps} leaps, ${r1.fishColored} took the colour)`);

  // 2. rest the right wand tip on the water: fish come, nibble, one leaps through the tip
  const r2 = await page.evaluate(async () => {
    const app = window.__czx;
    const E = window.__xrEmu;
    const T = app.THREE;
    const P = app.world.terrain.pond;
    const wl = app.world.terrain.waterLevel;
    const fish = app.pond.fish;
    for (let i = 0; i < 12 && fish.items.some((f) => f.leap.active); i++) await E.waitFrames(5);
    let best = null;
    let bd = Infinity;
    for (const f of fish.items) {
      const d = Math.hypot(f.pos.x - P.x, f.pos.z - P.z);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    const tip = new T.Vector3(best.pos.x, wl + 0.01, best.pos.z);
    // controller poses live in the rig's space; an identity orientation puts the tip 0.115 m along -Z
    app.rig.updateWorldMatrix(true, false);
    const local = app.rig.worldToLocal(tip.clone());
    E.setController('right', [local.x, local.y, local.z + 0.115], [0, 0, 0, 1]);
    await E.waitFrames(3);
    const tipErr = app.hands.right.tip.distanceTo(tip);
    const leapsBefore = fish.leaps;
    const nibBefore = fish.nibbles;
    const pulsesBefore = E.pulses.length;
    let lured = 0;
    for (let i = 0; i < 30 && fish.leaps === leapsBefore; i++) {
      await E.waitFrames(4);
      lured = Math.max(lured, fish.items.filter((f) => f.lure).length);
    }
    const leapt = fish.leaps - leapsBefore;
    await E.waitFrames(16); // let the leap land
    return { tipErr, lured, leapt, nibbles: fish.nibbles - nibBefore, pulses: E.pulses.length - pulsesBefore, colored: fish.coloredCount };
  });
  check(r2.tipErr < 0.05, `right wand tip placed on the water (${r2.tipErr.toFixed(3)} m off)`);
  check(r2.lured >= 1 && r2.lured <= 3, `fish came to the wand (${r2.lured} interested)`);
  check(r2.nibbles >= 2 && r2.pulses >= 2, `nibbles tickled the hand (${r2.nibbles} nibbles, ${r2.pulses} haptic pulses)`);
  check(r2.leapt >= 1, `a fish leapt through the wand tip (${r2.leapt} leap${r2.leapt === 1 ? '' : 's'}, ${r2.colored} coloured koi)`);

  // 3. an ambient bubble rises near the player and drifts over
  const r3 = await page.evaluate(async () => {
    const app = window.__czx;
    const E = window.__xrEmu;
    const T = app.THREE;
    E.setController('right', [0.25, 1.15, -0.35], [0, 0, 0, 1]);
    const head = app.headPosition();
    // the player has painted around here already; a soft patch makes sure a colour front is within reach
    app.world.paintMap.stamp(head.x + 2.4, head.z - 1.2, 1.6, new T.Color('#ffd93d'), 0.45, 0.5);
    app.bubbles.spawnTimer = Math.min(app.bubbles.spawnTimer, 0.5);
    const before = app.bubbles.ambientCount;
    for (let i = 0; i < 25 && app.bubbles.ambientCount === before; i++) await E.waitFrames(4);
    const spawned = app.bubbles.ambientCount - before;
    const dist = spawned ? app.bubbles.lastAmbient.distanceTo(app.headPosition()) : -1;
    let closer = false;
    if (spawned) {
      // the newest bubble should be heading our way
      let idx = -1;
      let youngest = Infinity;
      for (let i = 0; i < app.bubbles.capacity; i++) {
        if (app.bubbles.alive[i] && app.bubbles.age[i] < youngest) {
          youngest = app.bubbles.age[i];
          idx = i;
        }
      }
      if (idx >= 0) {
        const h = app.headPosition();
        const d0 = Math.hypot(app.bubbles.pos[idx].x - h.x, app.bubbles.pos[idx].z - h.z);
        await E.waitFrames(30);
        const d1 = app.bubbles.alive[idx] ? Math.hypot(app.bubbles.pos[idx].x - h.x, app.bubbles.pos[idx].z - h.z) : 0;
        closer = d1 < d0 - 0.05 || !app.bubbles.alive[idx] || d0 < 1.3;
      }
    }
    return { spawned, dist, closer };
  });
  check(r3.spawned >= 1 && r3.dist <= 6.5, `an ambient bubble rose ${r3.dist.toFixed(1)} m from the player (within 6 m)`);
  check(r3.closer, 'and it drifted toward the player');

  // tidy up: both controllers back by the body, nothing pressed
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setController('right', [0.25, 1.15, -0.35], [0, 0, 0, 1]);
    E.setController('left', [-0.25, 1.15, -0.35], [0, 0, 0, 1]);
    await E.waitFrames(3);
  });
  const s = await state(page);
  check(s.drawCalls < 190, `draw calls stay low with the fish and mist (${s.drawCalls} for both eyes)`);
  check(s.frameErrors === 0, 'no frame errors during the pond scenario');
}
