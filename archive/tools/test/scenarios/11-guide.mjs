/**
 * F2 — Guide: Dot leads you to the next thing to do.
 * Hands still → Dot picks a target (sleeping critter / unpainted tree / grey pond), flies over
 * and hovers there while a beacon pulses; finishing the target (paint through a critter, or
 * colour the ground at the tree / the pond) fires guideresolved and Dot celebrates there.
 */
export const title = 'Guide: Dot leads you to the next thing';

export async function run({ page, check }) {
  // rest pose: every button released, hands away from the palette and the menu, listeners installed
  const before = await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    for (const h of ['left', 'right']) {
      E.setButton(h, 0, false, 0);
      E.setButton(h, 1, false, 0);
      E.setAxes(h, 0, 0);
    }
    E.setController('right', [0.3, 1.2, -0.4], [0, 0, 0, 1]);
    E.setController('left', [-0.3, 1.1, -0.4], [0, 0, 0, 1]);
    window.__guideLog = { targets: [], resolved: [] };
    app.events.on('guidetarget', (e) => window.__guideLog.targets.push(e.kind));
    app.events.on('guideresolved', (e) => window.__guideLog.resolved.push(e.kind));
    await E.waitFrames(2);
    const g = app.guide;
    // (a target may already be set if the earlier steps left the player idle for a while: start that lead afresh)
    const preset = !!(g && g.target);
    if (preset) {
      g.reset();
      g.idleT = 6;
    }
    return { exists: !!g, state: g && g.state, autoHints: app.buddy.autoHints, preset };
  });
  check(before.exists, 'guide system is running');
  check(before.autoHints === false, "Dot's generic idle hints are switched off by the guide");

  // wait, hands still, until Dot picks something (the idle timer runs on game time, ~0.05 s per emulated frame)
  const lead = await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    const g = app.guide;
    let waited = 0;
    while (!g.target && waited < 300) {
      await E.waitFrames(5);
      waited += 5;
    }
    if (!g.target) return { picked: false, state: g.state, idleT: g.idleT, ready: g.ready, waited };
    const t = g.target;
    const pos = t.pos.toArray();
    const head = app.headPosition();
    const dxz = (a) => Math.hypot(a.x - t.pos.x, a.z - t.pos.z);
    const d0 = dxz(app.buddy.pos);
    let dMin = d0;
    let sawVisiting = false;
    let sawBeacon = false;
    let sawAbove = false;
    for (let i = 0; i < 30; i++) {
      await E.waitFrames(3);
      if (app.buddy.visiting) sawVisiting = true;
      if (g.beacon.visible && g.beacon.material.opacity > 0.1) sawBeacon = true;
      const d = dxz(app.buddy.pos);
      if (d < dMin) dMin = d;
      if (d < 1 && app.buddy.pos.y > t.pos.y + 0.5) sawAbove = true;
    }
    return { picked: true, kind: t.kind, index: t.index, pos, dist: Math.hypot(pos[0] - head.x, pos[2] - head.z), state: g.state, waited, d0, dMin, sawVisiting, sawBeacon, sawAbove, events: window.__guideLog.targets.length };
  });
  check(lead.picked, lead.picked ? `Dot picked a ${lead.kind} ${lead.dist.toFixed(1)} m away after ${lead.waited} idle frames` : `no target picked (state ${lead.state}, idle ${lead.idleT}, ready ${lead.ready})`);
  if (!lead.picked) return;
  check(lead.state === 'lead' && lead.events >= 1, `guide is leading (state ${lead.state}, ${lead.events} guidetarget event(s))`);
  check(lead.sawVisiting, 'Dot flew off to visit the target');
  check(lead.dMin < 1 && lead.dMin <= lead.d0, `Dot moved over the target (${lead.d0.toFixed(1)} → ${lead.dMin.toFixed(1)} m across the ground)`);
  check(lead.sawAbove, 'Dot hovers above the target');
  check(lead.sawBeacon, 'the beacon is pulsing over the target');

  // resolve it
  if (lead.kind === 'critter') {
    // paint a stroke through the sleeper (controller poses are in the rig's space; the tip is 0.115 m ahead of the controller)
    await page.evaluate(async ({ pos }) => {
      const E = window.__xrEmu;
      const app = window.__czx;
      app.rig.updateWorldMatrix(true, false);
      const local = (x, y, z) => {
        const l = app.rig.worldToLocal(new app.THREE.Vector3(x, y, z)).toArray();
        l[2] += 0.115;
        return l;
      };
      const a = local(pos[0] - 0.35, pos[1] + 0.35, pos[2]);
      const b = local(pos[0] + 0.35, pos[1] - 0.05, pos[2]);
      E.setController('right', a, [0, 0, 0, 1]);
      await E.waitFrames(2);
      E.setButton('right', 0, true, 1);
      await E.animate('right', 900, (t) => ({ pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], quat: [0, 0, 0, 1] }));
      E.setButton('right', 0, false, 0);
      await E.waitFrames(3);
    }, lead);
  } else {
    // colour the ground at the tree / the pond
    await page.evaluate(async ({ kind, pos }) => {
      const app = window.__czx;
      const c = new app.THREE.Color('#ff8c2a');
      app.world.paintMap.stamp(pos[0], pos[2], kind === 'pond' ? 3.2 : 2.2, c, 1, 0.5);
      await window.__xrEmu.waitFrames(2);
    }, lead);
  }
  const done = await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    const g = app.guide;
    let waited = 0;
    while (g.resolvedCount < 1 && waited < 80) {
      await E.waitFrames(4);
      waited += 4;
    }
    // back to the rest pose, everything released
    E.setButton('right', 0, false, 0);
    E.setController('right', [0.3, 1.2, -0.4], [0, 0, 0, 1]);
    E.setController('left', [-0.3, 1.1, -0.4], [0, 0, 0, 1]);
    await E.waitFrames(2);
    return { resolved: g.resolvedCount, state: g.state, target: g.target, events: window.__guideLog.resolved, waited, errors: app._errors || 0, hint: g.everTeleported, buddyBack: app.buddy.visiting };
  });
  check(done.resolved === 1, `target resolved (resolvedCount ${done.resolved} after ${done.waited} frames)`);
  check(done.events.length === 1 && done.events[0] === lead.kind, `guideresolved fired for the ${lead.kind}`);
  check(done.target === null && done.state === 'cooldown' && !done.buddyBack, `Dot celebrated and takes a breather (state ${done.state})`);
  check(done.errors === 0, 'no frame errors while guiding');
}
