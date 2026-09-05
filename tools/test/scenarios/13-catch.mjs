/**
 * 13 — Catch: play catch with Dot.
 *   (1) a ball thrown at Dot is caught (consumed) and lobbed back toward the player's hand
 *   (2) hand catch: squeeze as the lob reaches the right tip → held; let go → it flies again
 *   (3) hand tracking: a closed fist reads as the squeeze
 */
export const title = 'Catch with Dot';

export async function run({ page, check, state }) {
  // park both controllers away from the palette/menu with every button released, hook the events
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    for (const i of [0, 1, 4, 5]) {
      E.setButton('right', i, false, 0);
      E.setButton('left', i, false, 0);
    }
    E.setAxes('left', 0, 0);
    E.setAxes('right', 0, 0);
    E.setController('right', [0.3, 1.2, -0.4], [0, 0, 0, 1]);
    E.setController('left', [-0.3, 1.1, -0.3], [0, 0, 0, 1]);
    window.__catchLog = [];
    window.__said = [];
    app.events.on('catch', (e) => window.__catchLog.push({ by: e.by, hand: e.hand, rally: e.rally }));
    const say = app.buddy.say.bind(app.buddy);
    window.__restoreSay = () => (app.buddy.say = say);
    app.buddy.say = (text, dur) => {
      window.__said.push(text);
      return say(text, dur);
    };
    await E.waitFrames(30); // let Dot settle at the player's side after the earlier teleport + turn
  });

  // (1) throw a ball at Dot: she catches it and lobs it back
  const r1 = await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    const T = app.THREE;
    const dot = app.buddy.group.position.clone();
    const head = app.headPosition();
    const dir = new T.Vector3().subVectors(head, dot);
    dir.y = 0;
    dir.normalize();
    const from = dot.clone().addScaledVector(dir, 1.5);
    from.y = dot.y + 0.1;
    const flight = 0.5;
    const vel = new T.Vector3().subVectors(dot, from).divideScalar(flight);
    vel.y += 0.5 * 6.5 * flight;
    const ball = app.splats.launch(from, vel, new T.Color('#ff8c2a'));
    const ballsAtLaunch = app.splats.balls.length;
    let consumed = false;
    let moved = 0;
    for (let f = 0; f < 40 && !consumed; f += 2) {
      await E.waitFrames(2);
      moved = Math.max(moved, app.buddy.group.position.distanceTo(dot));
      if (app.splats.balls.indexOf(ball) < 0) consumed = !!ball.consumed;
    }
    const ballsAfterCatch = app.splats.balls.length;
    const dotCatches = window.__catchLog.filter((e) => e.by === 'dot').length;
    let lobbed = null;
    for (let f = 0; f < 60 && !lobbed; f += 2) {
      await E.waitFrames(2);
      lobbed = app.splats.balls.find((b) => b.fromDot) || null;
    }
    const lob = app.catch.lastLob;
    return {
      consumed,
      dropped: ballsAfterCatch < ballsAtLaunch,
      dotCatches,
      moved: +moved.toFixed(2),
      said: window.__said.slice(),
      lobbed: !!lobbed,
      lobCatches: lobbed ? lobbed.catches : -1,
      lobScale: lobbed ? +lobbed.mesh.scale.x.toFixed(2) : 0,
      aimErr: lob ? +lob.target.distanceTo(app.hands.right.tip).toFixed(2) : -1,
      rally: app.catch.rally,
      catches: app.catch.catches,
    };
  });
  check(r1.consumed && r1.dropped && r1.dotCatches >= 1, `Dot caught the ball thrown at her (catch event by 'dot' ×${r1.dotCatches}, ball consumed, Dot moved ${r1.moved} m)`);
  check(r1.said.some((t) => /Got it|Gotcha|Mine/.test(t)), `Dot said "${r1.said.join('" / "')}"`);
  check(r1.lobbed, 'Dot lobbed a ball back');
  check(r1.lobCatches === 1 && r1.lobScale > 1.05, `the rally ball carries its catches (${r1.lobCatches}) and grew (scale ${r1.lobScale})`);
  check(r1.aimErr >= 0 && r1.aimErr < 0.3, `the lob is aimed at the right hand (${r1.aimErr} m from the tip)`);
  check(r1.rally === 1 && r1.catches >= 1, `rally ${r1.rally}, catches ${r1.catches}`);

  // (2) hand catch: hold the tip where the lob is going, squeeze as it arrives
  const r2 = await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    const lob = app.catch.lastLob;
    const ball = app.splats.balls.find((b) => b.fromDot);
    if (!lob || !ball) return { ok: false };
    // controller poses live in the rig's space; the tip sits 0.115 m down the controller's -Z
    app.rig.updateWorldMatrix(true, false);
    const local = app.rig.worldToLocal(lob.target.clone());
    E.setController('right', [local.x, local.y, local.z + 0.115], [0, 0, 0, 1]);
    const pulsesBefore = E.pulses.length;
    let pressed = false;
    let closest = Infinity;
    for (let f = 0; f < 60 && !app.splats.held.right; f++) {
      await E.waitFrames(1);
      if (app.splats.balls.indexOf(ball) < 0) break; // landed
      const d = ball.mesh.position.distanceTo(app.hands.right.tip);
      closest = Math.min(closest, d);
      // squeeze when it is coming down at the hand (the lob goes up first)
      if (!pressed && d < 0.5 && ball.vel.y < 0) {
        E.setButton('right', 1, true, 1);
        pressed = true;
      }
    }
    const held = app.splats.held.right;
    const caught = held === ball;
    const conjured = !!held && held !== ball; // the squeeze made a fresh ball instead of catching
    const handCatches = window.__catchLog.filter((e) => e.by === 'hand').length;
    const heldCatches = held ? held.catches : -1;
    const pulses = E.pulses.slice(pulsesBefore).filter((p) => p.hand === 'right' && p.value >= 0.75).length;
    const rally = app.catch.rally;
    // let go: it flies again (a gentle drop from a still hand)
    E.setButton('right', 1, false, 0);
    await E.waitFrames(3);
    const released = app.splats.held.right === null;
    const flying = caught && app.splats.balls.indexOf(ball) >= 0 && ball.flying;
    await E.waitFrames(45); // and lands
    const gone = app.splats.balls.indexOf(ball) < 0;
    return { ok: true, pressed, closest: +closest.toFixed(2), caught, conjured, handCatches, heldCatches, pulses, rally, released, flying, gone, rallyAfter: app.catch.rally, said: window.__said.slice() };
  });
  check(r2.ok && r2.pressed, `the lob came within ${r2.closest} m of the tip`);
  check(r2.caught && r2.handCatches >= 1 && !r2.conjured, `squeezing as it arrived caught it (held.right set, catch event by 'hand' ×${r2.handCatches})`);
  check(r2.heldCatches === 2 && r2.rally === 2, `the rally continued (ball catches ${r2.heldCatches}, rally ${r2.rally})`);
  check(r2.pulses >= 1, 'the catch buzzed the hand');
  check(r2.released && r2.flying, 'letting go threw it again');
  check(r2.gone && r2.rallyAfter === 0, 'it landed and the rally ended');

  // (3) hand tracking: a closed fist is the squeeze
  const r3 = await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    E.setController('right', [0.3, 1.2, -0.4], [0, 0, 0, 1]);
    E.setHandTracking('right', true, false);
    await E.waitFrames(6);
    const tracked = app.hands.right.connected && app.hands.right.isTrackedHand;
    E.setFist('right', true);
    await E.waitFrames(4);
    const fist = app.hands.right.fist;
    const squeeze = app.hands.right.squeeze;
    const holding = !!app.splats.held.right; // a fist conjures a ball exactly like the grip does
    E.setFist('right', false);
    await E.waitFrames(4);
    const opened = app.hands.right.squeeze;
    E.setHandTracking('right', false);
    await E.waitFrames(6);
    const back = app.hands.right.connected && !app.hands.right.isTrackedHand;
    await E.waitFrames(40); // the dropped ball lands
    // tidy up: controllers parked, nothing pressed, Dot's voice restored
    E.setController('right', [0.25, 1.15, -0.35], [0, 0, 0, 1]);
    E.setController('left', [-0.25, 1.15, -0.35], [0, 0, 0, 1]);
    for (const i of [0, 1, 4, 5]) {
      E.setButton('right', i, false, 0);
      E.setButton('left', i, false, 0);
    }
    window.__restoreSay();
    await E.waitFrames(3);
    return { tracked, fist, squeeze, holding, opened, back, held: !!app.splats.held.right || !!app.splats.held.left };
  });
  check(r3.tracked, 'right hand switched to hand tracking');
  check(r3.fist && r3.squeeze === 1, `a closed fist reads as the squeeze (fist ${r3.fist}, squeeze ${r3.squeeze}, holding a ball: ${r3.holding})`);
  check(r3.opened === 0 && r3.back && !r3.held, 'fist opened, controller restored, hands empty');

  const s = await state(page);
  check(s.frameErrors === 0, 'no frame errors during catch');
  check(s.drawCalls < 190, `draw calls stay low (${s.drawCalls})`);
}
