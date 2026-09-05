/**
 * F1 — Sleepyheads. A wand poke only teases a sleeper; painting through it
 * wakes it in the paint colour (event + celebration); awake critters can be
 * booped; bunnies hop after the player. Controller poses are in rig space,
 * so world points go through rig.worldToLocal (the run teleported earlier).
 */
export const title = 'Sleepyheads (critters)';

export async function run({ page, check, state }) {
  const info = await page.evaluate(() => {
    const a = window.__czx;
    const c = a.critters;
    if (!c) return null;
    const head = a.headPosition();
    const n = c.nearestSleeping(head);
    const bySpecies = {};
    for (const it of c.items) bySpecies[it.species] = (bySpecies[it.species] || 0) + 1;
    return {
      total: c.items.length,
      sleeping: c.sleepingCount,
      awake: c.awakeCount,
      bySpecies,
      nearest: n ? { index: n.index, species: n.species, d: +n.pos.distanceTo(head).toFixed(2) } : null,
    };
  });
  check(!!info, 'critters system present');
  if (!info) return;
  check(info.total >= 12 && info.total <= 14, `${info.total} sleepers placed (${Object.entries(info.bySpecies).map(([k, v]) => `${v} ${k}`).join(', ')})`);
  check(info.sleeping === info.total, 'everyone starts asleep');
  check(!!info.nearest, `nearest sleeper: ${info.nearest && info.nearest.species} ${info.nearest && info.nearest.d} m away`);
  if (!info.nearest) return;
  const idx = info.nearest.index;

  // a wand poke (trigger released) only makes a sleeper twitch
  const tease = await page.evaluate(async (idx) => {
    const a = window.__czx;
    const E = window.__xrEmu;
    const c = a.critters;
    const it = c.items[idx];
    const before = c.teaseCount;
    a.rig.updateWorldMatrix(true, false);
    const l = a.rig.worldToLocal(new a.THREE.Vector3(it.pos.x, it.pos.y + 0.12, it.pos.z));
    E.setController('right', [l.x, l.y, l.z + 0.115], [0, 0, 0, 1]); // the brush tip sits 0.115 m down the controller's -z
    await E.waitFrames(5);
    E.setController('right', [0.25, 1.15, -0.35], [0, 0, 0, 1]);
    await E.waitFrames(2);
    return { teased: c.teaseCount - before, asleep: !it.awake };
  }, idx);
  check(tease.teased >= 1 && tease.asleep, `a wand poke only teases it (${tease.teased} twitch, still asleep)`);

  // paint through it: the brush wakes it in the paint colour
  await page.evaluate(() => {
    window.__critterWakes = [];
    window.__czx.events.on('critterwake', (e) => window.__critterWakes.push({ index: e.index, species: e.species, by: e.by }));
  });
  const woke = await page.evaluate(async (idx) => {
    const a = window.__czx;
    const E = window.__xrEmu;
    const c = a.critters;
    const it = c.items[idx];
    a.paint.setBrushIndex(0);
    a.paint.setColorIndex(1);
    const centre = it.pos.clone();
    const toRig = (x, y, z) => {
      a.rig.updateWorldMatrix(true, false);
      const l = a.rig.worldToLocal(new a.THREE.Vector3(x, y, z));
      return [l.x, l.y, l.z + 0.115];
    };
    E.setController('right', toRig(centre.x - 0.5, centre.y + 0.25, centre.z), [0, 0, 0, 1]);
    await E.waitFrames(2);
    E.setButton('right', 0, true, 1);
    await E.waitFrames(2);
    await E.animate('right', 700, (t) => ({ pos: toRig(centre.x - 0.5 + t, centre.y + 0.25, centre.z), quat: [0, 0, 0, 1] }));
    await E.waitFrames(3);
    E.setButton('right', 0, false, 0);
    await E.waitFrames(3);
    return { awake: it.awake, awakeCount: c.awakeCount, color: '#' + it.color.getHexString(), paint: '#' + a.paint.color.getHexString(), events: window.__critterWakes.slice() };
  }, idx);
  check(woke.awake && woke.awakeCount === info.awake + 1, `painting through the ${info.nearest.species} woke it (awake: ${woke.awakeCount})`);
  check(woke.events.some((e) => e.index === idx && e.by === 'paint'), `critterwake fired (${JSON.stringify(woke.events)})`);
  check(woke.color === woke.paint, `it took the paint colour (${woke.color})`);

  // boop it: the tip tracks the critter for a moment
  const boop = await page.evaluate(async (idx) => {
    const a = window.__czx;
    const E = window.__xrEmu;
    const c = a.critters;
    const it = c.items[idx];
    const before = c.boopCount;
    await E.animate('right', 600, () => {
      a.rig.updateWorldMatrix(true, false);
      const p = new a.THREE.Vector3(it.pos.x + it.vel.x * 0.05, it.pos.y + 0.12 + it.vel.y * 0.05, it.pos.z + it.vel.z * 0.05);
      const l = a.rig.worldToLocal(p);
      return { pos: [l.x, l.y, l.z + 0.115], quat: [0, 0, 0, 1] };
    });
    await E.waitFrames(2);
    E.setController('right', [0.25, 1.15, -0.35], [0, 0, 0, 1]);
    return { boops: c.boopCount - before, squash: +it.squash.toFixed(3), hopping: it.hopping, wiggle: +it.wiggleT.toFixed(2) };
  }, idx);
  check(boop.boops >= 1, `booped it (${boop.boops} boop(s))`);
  check(boop.squash !== 0 || boop.hopping || boop.wiggle > 0, `it reacted (squash ${boop.squash}, hopping ${boop.hopping}, wiggle ${boop.wiggle})`);

  // a bunny hops after you
  const follow = await page.evaluate(async () => {
    const a = window.__czx;
    const E = window.__xrEmu;
    const c = a.critters;
    let b = c.items.find((i) => i.awake && i.species === 'bunny');
    let woken = false;
    if (!b) {
      const head = a.headPosition();
      let bd = Infinity;
      for (const i of c.items) {
        if (i.awake || i.species !== 'bunny') continue;
        const d = i.pos.distanceTo(head);
        if (d < bd) {
          bd = d;
          b = i;
        }
      }
      if (!b) return null;
      c.wake(b.index, a.paint.color, 'paint');
      woken = true;
    }
    const head = a.headPosition();
    const d0 = Math.hypot(b.pos.x - head.x, b.pos.z - head.z);
    await E.waitFrames(90);
    a.headPosition(head);
    const d1 = Math.hypot(b.pos.x - head.x, b.pos.z - head.z);
    return { index: b.index, woken, d0: +d0.toFixed(2), d1: +d1.toFixed(2), hops: b.hops };
  });
  check(!!follow, 'a bunny is awake');
  if (follow) check(follow.d1 < follow.d0 - 0.2 || follow.d1 <= 2.0, `the bunny came to sit by you (${follow.d0} → ${follow.d1} m, ${follow.hops} hops${follow.woken ? ', woken via API' : ''})`);

  const s = await state(page);
  check(s.drawCalls < 190, `draw calls stay low with critters (${s.drawCalls} for both eyes)`);
  check(s.frameErrors === 0, 'no frame errors from critters');
}
