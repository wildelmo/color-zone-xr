/**
 * F3 — Boops: everything reacts to the wand tip and to paint balls.
 * Sweeps the right tip through a bloomed plant, pokes Dot, ricochets a ball
 * off a rock, bounces one on a mushroom cap, pokes a tree and the sign
 * through the public API, and checks the splat wave ran. Leaves the
 * controllers released, away from the palette and the menu.
 */
export const title = 'Boops: poke the world, balls hit things';

export async function run({ page, check, state }) {
  await page.evaluate(() => {
    const app = window.__czx;
    window.__boops = [];
    app.events.on('boop', (e) => window.__boops.push(e.kind));
  });
  const kinds = () => page.evaluate(() => window.__boops.slice());

  // ---- 1. sweep the wand through a bloomed plant near the player ----
  const plant = await page.evaluate(() => {
    const app = window.__czx;
    const head = app.headPosition();
    let best = null;
    app.world.flora.bloomers.forEach((b, bi) => {
      if (b.mesh.name === 'mushrooms') return;
      for (let i = 0; i < b.count; i++) {
        if (b.popT.array[i] >= 1e8) continue; // not bloomed
        const d = Math.hypot(b.xs[i] - head.x, b.zs[i] - head.z);
        const near = d < 4;
        if (!best || (near && !best.near) || (near === best.near && d < best.d)) best = { bi, i, d, near, x: b.xs[i], z: b.zs[i], name: b.mesh.name, popT: b.popT.array[i] };
      }
    });
    return best;
  });
  check(!!plant, plant ? `a bloomed ${plant.name} instance ${plant.d.toFixed(1)} m from the head` : 'no bloomed plant found');
  const countBefore = await page.evaluate(() => window.__czx.boops.count);
  if (plant) {
    await page.evaluate(async (f) => {
      const app = window.__czx;
      const E = window.__xrEmu;
      const gy = app.world.heightAt(f.x, f.z);
      app.rig.updateWorldMatrix(true, false);
      // controller pose (rig space, identity rotation) whose tip lands on a world point
      const ctrl = (wx, wy, wz) => {
        const p = app.rig.worldToLocal(new app.THREE.Vector3(wx, wy, wz));
        return [p.x, p.y, p.z + 0.115];
      };
      const b = app.world.flora.bloomers[f.bi];
      // sweep through the plant; under heavy load frames are sparse, so sweep back once more if it was missed
      for (let pass = 0; pass < 2 && b.popT.array[f.i] === f.popT; pass++) {
        const dir = pass ? -1 : 1;
        await E.animate('right', 1400, (t) => ({ pos: ctrl(f.x + dir * (t * 0.7 - 0.35), gy + 0.14, f.z), quat: [0, 0, 0, 1] }));
        await E.waitFrames(3);
      }
    }, plant);
    const after = await page.evaluate((f) => {
      const b = window.__czx.world.flora.bloomers[f.bi];
      return { popT: b.popT.array[f.i], count: window.__czx.boops.count, kinds: window.__boops.slice() };
    }, plant);
    check(after.count > countBefore, `wand sweep booped ${after.count - countBefore} thing(s): ${after.kinds.join(', ') || '-'}`);
    check(after.popT !== plant.popT && after.popT < 1e8, `the plant's popT was rewritten for a boing (${plant.popT.toFixed(2)} → ${after.popT.toFixed(2)})`);
  }

  // ---- 2. poke Dot ----
  const dotBefore = await page.evaluate(() => window.__czx.buddy.boops || 0);
  const dot = await page.evaluate(async () => {
    const app = window.__czx;
    const E = window.__xrEmu;
    app.rig.updateWorldMatrix(true, false);
    const w = app.buddy.group.position.clone();
    const p = app.rig.worldToLocal(w.clone());
    E.setController('right', [p.x, p.y, p.z + 0.115], [0, 0, 0, 1]);
    await E.waitFrames(2);
    const b = app.buddy;
    return { boops: b.boops || 0, mood: b.mood, spin: b.spinVel, scoot: b.pos.distanceTo(w), talking: b.bubble.visible || b.sayQueue.length > 0 };
  });
  check(dot.boops > dotBefore, `Dot got booped (mood '${dot.mood}', spinVel ${dot.spin.toFixed(1)}, scooted ${dot.scoot.toFixed(2)} m, talking: ${dot.talking})`);
  check(dot.mood === 'surprised' || dot.mood === 'happy', `Dot's mood changed to '${dot.mood}'`);
  await page.evaluate(async () => {
    window.__xrEmu.setController('right', [0.25, 1.15, -0.35], [0, 0, 0, 1]);
    await window.__xrEmu.waitFrames(2);
  });

  // ---- 3. a paint ball ricochets off a rock ----
  const rock = await page.evaluate(() => {
    const app = window.__czx;
    let best = null;
    app.world.flora.rocks.forEach((r, i) => {
      if (app.world.terrain.slopeAt(r.x, r.z) > 0.25) return;
      if (!best || r.s > best.s) best = { i, x: r.x, y: r.y, z: r.z, s: r.s, r: r.r };
    });
    return best;
  });
  check(!!rock, rock ? `target rock #${rock.i} (size ${rock.s.toFixed(2)})` : 'no rock on flat ground');
  if (rock) {
    const rico = await page.evaluate(async (rk) => {
      const app = window.__czx;
      const E = window.__xrEmu;
      const T = app.THREE;
      const c = new T.Vector3(rk.x, rk.y + 0.5 * rk.s, rk.z);
      const target = c.clone();
      target.y += 0.1;
      // approach from whichever side has the lowest ground, from 0.8 m outside the rock
      let start = null;
      for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const s = new T.Vector3(c.x + dx * (rk.r + 0.8), 0, c.z + dz * (rk.r + 0.8));
        s.y = Math.max(target.y, app.world.heightAt(s.x, s.z) + 0.15);
        if (!start || s.y < start.y) start = s;
      }
      const flight = start.distanceTo(target) / 5;
      const vel = target.clone().sub(start).divideScalar(flight);
      vel.y += 0.5 * 6.5 * flight;
      const before = window.__boops.filter((k) => k === 'rock').length;
      const b = app.splats.launch(start, vel, new T.Color('#3ec9ff'));
      const toward = c.clone().sub(b.mesh.position).normalize().dot(b.vel.clone().normalize());
      let hit = null;
      for (let f = 0; f < 45 && !hit; f++) {
        await E.waitFrames(1);
        if (window.__boops.filter((k) => k === 'rock').length > before) {
          const away = b.mesh.position.clone().sub(c).normalize().dot(b.vel.clone().normalize());
          hit = { frame: f, toward, away, speed: b.vel.length(), ricochets: app.boops.stats.ricochet };
        }
      }
      return hit;
    }, rock);
    check(!!rico && rico.toward > 0.5, rico ? `ball launched at the rock (heading ${rico.toward.toFixed(2)})` : 'ball never reached the rock');
    check(!!rico && rico.away > 0, rico ? `ball ricocheted off the rock and is moving away (${rico.away.toFixed(2)}, ${rico.speed.toFixed(1)} m/s, ${rico.ricochets} ricochet(s))` : 'no ricochet');
  }

  // ---- 4. a mushroom cap is a trampoline ----
  const shroom = await page.evaluate(() => {
    const app = window.__czx;
    const b = app.world.flora.bloomers.find((x) => x.mesh.name === 'mushrooms');
    if (!b || !b.count) return null;
    let i = -1;
    for (let k = 0; k < b.count; k++) {
      if (b.popT.array[k] < 1e8) {
        i = k;
        break;
      }
    }
    let forced = false;
    if (i < 0) {
      // none has bloomed yet: pop the one nearest the start (test scaffolding for the bounce itself)
      let bd = 1e9;
      for (let k = 0; k < b.count; k++) {
        const d = Math.hypot(b.xs[k], b.zs[k]);
        if (d < bd) {
          bd = d;
          i = k;
        }
      }
      b.popT.array[i] = app.time - 5;
      b.popT.needsUpdate = true;
      forced = true;
    }
    return { i, x: b.xs[i], z: b.zs[i], forced };
  });
  check(!!shroom, shroom ? `mushroom #${shroom.i}${shroom.forced ? ' (bloomed for the test)' : ''}` : 'no mushrooms on this island');
  if (shroom) {
    const tramp = await page.evaluate(async (m) => {
      const app = window.__czx;
      const E = window.__xrEmu;
      const T = app.THREE;
      const gy = app.world.heightAt(m.x, m.z);
      const before = app.boops.stats.bounce;
      const b = app.splats.launch(new T.Vector3(m.x, gy + 1.2, m.z), new T.Vector3(0, 0, 0), new T.Color('#ff6ad5'));
      let res = null;
      for (let f = 0; f < 60 && !res; f++) {
        await E.waitFrames(1);
        if (app.boops.stats.bounce > before) res = { frame: f, vy: b.vel.y, y: b.mesh.position.y - gy };
      }
      return res;
    }, shroom);
    check(!!tramp && tramp.vy > 0, tramp ? `ball bounced off the mushroom cap (vy ${tramp.vy.toFixed(1)} m/s, ${tramp.y.toFixed(2)} m up)` : 'the ball fell straight through the mushroom');
  }

  // ---- 5. public pokes: a tree shivers, the sign wobbles ----
  const api = await page.evaluate(async () => {
    const app = window.__czx;
    const E = window.__xrEmu;
    const t = app.world.flora.trees[0];
    const pokeBefore = t.pokeT ? t.pokeT.array[t.i] : null;
    app.boops.pokeTree(0);
    const treePoke = t.pokeT ? t.pokeT.array[t.i] : null;
    const base = app.boops.signBase ? app.boops.signBase.clone() : null;
    app.boops.pokeSign();
    await E.waitFrames(3);
    const wobbling = base ? app.helpSign.group.quaternion.angleTo(base) : 0;
    return { pokeBefore, treePoke, time: app.time, wobbling, kinds: window.__boops.slice() };
  });
  check(api.treePoke !== null && api.treePoke !== api.pokeBefore && Math.abs(api.treePoke - api.time) < 1, `pokeTree(0) stamped the tree's pokeT (${api.pokeBefore} → ${api.treePoke.toFixed(2)})`);
  check(api.wobbling > 0.005, `pokeSign() set the signpost wobbling (${(api.wobbling * 57.3).toFixed(1)}°)`);
  check(api.kinds.includes('tree') && api.kinds.includes('sign'), `boop events: ${Array.from(new Set(api.kinds)).join(', ')}`);

  // ---- 6. a splat next to the booped plant sends a wave through the bloomed meadow ----
  const wave = await page.evaluate(async (f) => {
    const app = window.__czx;
    const E = window.__xrEmu;
    const T = app.THREE;
    for (let i = 0; i < 90 && app.splats.balls.length > 0; i++) await E.waitFrames(1); // let the earlier balls land
    const b = app.world.flora.bloomers[f.bi];
    const popBefore = b.popT.array[f.i];
    const hopsBefore = app.boops.stats.hops;
    const splatsBefore = app.splats.splatCount;
    const x = f.x + 0.3;
    const z = f.z;
    app.splats.launch(new T.Vector3(x, app.world.heightAt(x, z) + 0.6, z), new T.Vector3(0, -1, 0), new T.Color('#ffd93d'));
    for (let i = 0; i < 60 && (app.splats.splatCount === splatsBefore || app.boops.qN > 0); i++) await E.waitFrames(1);
    return { splatted: app.splats.splatCount > splatsBefore, hops: app.boops.stats.hops - hopsBefore, pending: app.boops.qN, popBefore, popAfter: b.popT.array[f.i], count: app.boops.count, stats: app.boops.stats };
  }, plant);
  check(wave.splatted, 'a paint ball splatted beside the booped plant');
  check(wave.hops > 0 && wave.pending === 0, `the splat wave hopped ${wave.hops} plant(s) in turn (${wave.pending} still pending)`);
  check(wave.popAfter !== wave.popBefore, `the booped plant hopped with the wave (popT ${wave.popBefore.toFixed(2)} → ${wave.popAfter.toFixed(2)})`);
  console.log(`  · boops ${wave.count}: ${JSON.stringify(wave.stats)}`);

  // tidy: controller back at rest, nothing pressed
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setController('right', [0.25, 1.15, -0.35], [0, 0, 0, 1]);
    await E.waitFrames(3);
  });
  const s = await state(page);
  check(s.frameErrors === 0, 'no frame errors during the boops scenario');
  check(s.drawCalls < 190, `draw calls stay low with boops (${s.drawCalls} for both eyes)`);
  const all = await kinds();
  check(all.length >= 4, `${all.length} boop events in total`);
}
