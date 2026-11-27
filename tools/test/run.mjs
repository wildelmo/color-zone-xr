/**
 * End-to-end test: boots the gallery in headless Chromium, first on desktop
 * and then in an emulated Quest (two Touch controllers), and exercises the
 * real interactions: assembly, winding, the music box, grabbing, two-handed
 * scaling, life size, unloading and reloading. Captures the README shots.
 *
 *   node tools/test/run.mjs            # full run + write docs/screenshots
 *   node tools/test/run.mjs --quick    # skip screenshots of detail views
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, launchArgs } from './pw.mjs';
import { serve } from './server.mjs';
import { openQuest } from '../xr/quest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const QUICK = process.argv.includes('--quick');
// --only=desktop|quest|globe-desktop|globe|exit|iwer runs just that section
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const want = (name) => !ONLY || ONLY === name;
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
function check(cond, msg) {
  console.log(cond ? '  ✓' : '  ✗', msg);
  if (!cond) failures.push(msg);
}

const { chromium } = await loadPlaywright();
const { server, url } = await serve(ROOT);
const browser = await chromium.launch({ args: launchArgs });
const errors = [];

async function newPage(viewport, { xr = false, query = '' } = {}) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GPU stall|ReadPixels/i.test(m.text())) errors.push(m.text());
  });
  if (xr) await page.addInitScript({ path: path.join(ROOT, 'tools', 'test', 'xr-emulator.js') });
  await page.goto(url + 'index.html' + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cc && window.__cc.frame > 3, null, { timeout: 60000 });
  return page;
}

/**
 * Screenshot with the render loop paused: on a software-GL CI runner a frame
 * can take over a second, and a capture competing with the loop can stall.
 */
async function snap(page, file, clip) {
  // let the latest camera/pose render first, then hold that frame
  const f = await page.evaluate(() => window.__cc.frame);
  await page.waitForFunction((f) => window.__cc.frame >= f + 2, f, { timeout: 120000 });
  await page.evaluate(() => (window.__cc.paused = true));
  try {
    await page.screenshot({ path: path.join(OUT, file), clip, timeout: 120000 });
  } finally {
    await page.evaluate(() => (window.__cc.paused = false));
  }
}

const state = (page) =>
  page.evaluate(() => {
    const a = window.__cc;
    const s = a.stage;
    const st = s.asset ? s.asset.state : null;
    return {
      mode: a.mode,
      presenting: a.renderer.xr.isPresenting,
      loaded: !!s.asset,
      assembled: st ? st.assembled : false,
      wind: st ? st.wind : 0,
      speed: st ? st.speed : 0,
      angle: st ? st.angle : 0,
      beat: st ? st.musicBeat : 0,
      stageMode: s.mode,
      scale: s.holder.scale.x,
      holder: s.holder.position.toArray().map((v) => +v.toFixed(3)),
      grabbed: s.grabbed,
      drawCalls: a.stats.drawCalls,
      triangles: a.stats.triangles,
      geometries: a.renderer.info.memory.geometries,
      textures: a.renderer.info.memory.textures,
    };
  });

/** move the desktop camera for a detail shot (orbit target + position) */
const look = (page, target, pos) =>
  page.evaluate(
    ([t, p]) => {
      const a = window.__cc;
      a.desktop.anim = null;
      a.desktop.orbit.target.set(...t);
      a.camera.position.set(...p);
      a.desktop.orbit.update();
    },
    [target, pos],
  );

// ------------------------------------------------------------------ desktop
console.log('\n▶ Desktop: boot, assemble, wind, play');
if (want('desktop')) {
  const page = await newPage({ width: 1280, height: 800 });
  await page.waitForTimeout(800);
  await page.waitForFunction(() => window.__cc.stage.asset, null, { timeout: 120000 });
  await snap(page, '01-title.png');
  let s = await state(page);
  check(s.loaded && !s.assembled, 'hero carousel built off-screen, waiting to assemble');
  await page.click('#btn-desktop');
  await page.waitForFunction(() => window.__cc.stage.asset.timeline.t > 3.2, null, { timeout: 60000 });
  if (!QUICK) await snap(page, '02-assembling.png');
  await page.waitForFunction(() => window.__cc.stage.asset.state.assembled, null, { timeout: 120000 });
  s = await state(page);
  check(s.assembled, 'assembly animation completed');
  const notes0 = await page.evaluate(() => {
    window.__notes = 0;
    window.__cc.stage.asset.events.on('note', () => window.__notes++);
    return window.__cc.stage.asset.state.wind;
  });
  // wind with the keyboard
  // hold W until the spring has wound (wall-clock time means little on slow software GL)
  await page.keyboard.down('w');
  await page.waitForFunction((w0) => window.__cc.stage.asset.state.wind > w0 + 0.06, notes0, { timeout: 90000 }).catch(() => {});
  await page.keyboard.up('w');
  s = await state(page);
  check(s.wind > notes0 + 0.05, `holding W winds the spring (${notes0.toFixed(2)} → ${s.wind.toFixed(2)})`);
  await page.waitForFunction(() => window.__notes > 8, null, { timeout: 90000 }).catch(() => {});
  s = await state(page);
  const notes = await page.evaluate(() => window.__notes);
  check(s.speed > 0.3 && s.angle > 0.3, `carousel turning (speed ${s.speed.toFixed(2)}, angle ${s.angle.toFixed(2)} rad)`);
  check(notes > 5, `music box played ${notes} notes`);
  check(s.drawCalls > 30 && s.drawCalls < 260, `draw calls in budget (${s.drawCalls})`);
  console.log(`    triangles this frame (incl. shadow pass): ${s.triangles}`);
  await snap(page, '03-desktop.png');
  if (!QUICK) {
    const T = [0, 0.84, -0.62];
    const at = (dx, dy, dz) => [T[0] + dx, T[1] + dy, T[2] + dz];
    await look(page, at(0.06, 0.12, 0.08), at(0.2, 0.17, 0.28));
    await page.waitForTimeout(600);
    await snap(page, '04-horses-close.png');
    await look(page, at(0, 0.03, 0.22), at(0.0, 0.05, 0.36));
    await page.waitForTimeout(600);
    await snap(page, '05-music-movement.png');
    await look(page, at(0, 0.24, 0), at(0.15, 0.13, 0.12));
    await page.waitForTimeout(600);
    await snap(page, '06-under-canopy.png');
    await look(page, at(0, 0.12, 0.06), at(0.03, 0.14, 0.16));
    await page.waitForTimeout(600);
    await snap(page, '07-band-organ.png');
  }
  // life size from the HUD
  await page.click('#hud-life');
  // (life size fills the screen: on a software-GL runner each frame can take seconds)
  await page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'life', null, { timeout: 240000 }).catch(() => {});
  s = await state(page);
  check(s.stageMode === 'life' && Math.abs(s.scale - 1) < 0.01, `life size (scale ${s.scale.toFixed(2)})`);
  if (!QUICK) {
    await look(page, [0, 2.6, 0], [2.2, 1.6, 5.6]);
    await page.waitForTimeout(800);
    await snap(page, '08-life-size.png');
  }
  await page.click('#hud-life');
  await page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'toy', null, { timeout: 240000 }).catch(() => {});
  s = await state(page);
  check(s.stageMode === 'toy' && Math.abs(s.scale - 1 / 22) < 0.002, 'back to toy size on the table');
  await page.close();
}

// --------------------------------------------------------------------- XR
console.log('\n▶ Emulated Quest');
if (want('quest')) {
  const page = await newPage({ width: 1600, height: 800 }, { xr: true, query: '?instant' });
  await page.waitForFunction(() => !document.getElementById('btn-vr').disabled && window.__cc.stage.asset, null, { timeout: 120000 });
  // start "standing" somewhere odd in the room, facing sideways
  await page.evaluate(() => window.__xrEmu.setHead([1.4, 1.6, 2.1], window.__xrEmu.quatYawPitch(1.1, 0)));
  await page.click('#btn-vr');
  await page.waitForFunction(() => window.__cc.renderer.xr.isPresenting && window.__xrEmu.frames > 10, null, { timeout: 30000 });
  const placed = await page.evaluate(() => {
    const a = window.__cc;
    const p = a.camera.getWorldPosition(a.camera.position.clone());
    const f = a.camera.getWorldDirection(a.camera.position.clone());
    return { x: p.x, z: p.z, fx: f.x, fz: f.z };
  });
  check(Math.hypot(placed.x, placed.z) < 0.05 && placed.fz < -0.95, `entering VR puts you at the table, facing it (head at ${placed.x.toFixed(2)}, ${placed.z.toFixed(2)})`);
  // back to a head at the origin so the scripted poses below are world poses
  await page.evaluate(async () => {
    window.__xrEmu.setHead([0, 1.6, 0], window.__xrEmu.quatYawPitch(0, 0));
    await window.__xrEmu.waitFrames(3); // the head pose reaches the camera on the next frames
    window.__cc.recenter(new window.__cc.rig.position.constructor(0, 0, 0), 0);
  });
  const rig0 = await page.evaluate(() => [...window.__cc.rig.position.toArray(), window.__cc.rig.rotation.y].map((v) => Math.abs(v)));
  check(Math.max(...rig0) < 1e-3, 'recentring with the head at the origin leaves the room where it is');
  // helpers inside the page
  await page.evaluate(() => {
    const E = window.__xrEmu;
    window.__aim = (from, to) => {
      const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const l = Math.hypot(...d);
      const f = d.map((v) => v / l);
      // quaternion rotating (0,0,-1) onto f: [a x b, 1 + a.b]
      const w = 1 - f[2];
      if (w < 1e-6) return [0, 1, 0, 0];
      const q = [f[1], -f[0], 0, w];
      const n = Math.hypot(...q);
      return q.map((v) => v / n);
    };
    E.setHead([0, 1.6, 0], E.quatYawPitch(0, -0.55));
  });
  await page.evaluate(() => window.__xrEmu.waitFrames(5));
  let s = await state(page);
  check(s.presenting && s.mode === 'xr', 'XR session presenting');
  check(s.loaded && s.assembled, 'carousel on the table in VR');
  await page.waitForTimeout(1500);
  await snap(page, '10-vr-table.png', { x: 0, y: 0, width: 800, height: 800 });

  // point at the key and hold the trigger to wind
  const key = await page.evaluate(() => {
    const k = window.__cc.stage.asset.interactions[0].proxy;
    const v = k.getWorldPosition(new k.position.constructor());
    return v.toArray();
  });
  const w0 = (await state(page)).wind;
  await page.evaluate((key) => {
    const E = window.__xrEmu;
    const from = [0.25, 1.15, -0.25];
    E.setController('right', from, window.__aim(from, key));
  }, key);
  await page.evaluate(() => window.__xrEmu.waitFrames(3));
  await page.evaluate(() => window.__xrEmu.setButton('right', 0, true));
  await page.evaluate(() => window.__xrEmu.waitFrames(40));
  await page.evaluate(() => window.__xrEmu.setButton('right', 0, false));
  s = await state(page);
  check(s.wind > w0 + 0.02, `trigger on the brass key winds it (${w0.toFixed(2)} → ${s.wind.toFixed(2)})`);
  const pulses = await page.evaluate(() => window.__xrEmu.pulses.length);
  check(pulses > 3, `ratchet clicks buzz the controller (${pulses} pulses)`);

  // grab it near the hand and lift it up to the face
  const center = await page.evaluate(() => window.__cc.stage.worldBounds().center.toArray());
  await page.evaluate((c) => window.__xrEmu.setController('right', [c[0] + 0.05, c[1], c[2] + 0.1], [0, 0, 0, 1]), center);
  await page.evaluate(() => window.__xrEmu.waitFrames(3));
  await page.evaluate(() => window.__xrEmu.setButton('right', 1, true));
  await page.evaluate(() => window.__xrEmu.waitFrames(3));
  check((await state(page)).grabbed, 'grip near the carousel picks it up');
  await page.evaluate((c) => window.__xrEmu.animate('right', 700, (t) => ({ pos: [c[0] + 0.05, c[1] + 0.5 * t, c[2] + 0.1 + 0.25 * t] })), center);
  await page.evaluate(() => window.__xrEmu.setHead([0, 1.6, 0], window.__xrEmu.quatYawPitch(0, -0.3)));
  await page.evaluate(() => window.__xrEmu.waitFrames(5));
  s = await state(page);
  check(s.holder[1] > 1.2, `carousel lifted to eye level (y ${s.holder[1]})`);
  await snap(page, '11-vr-holding.png', { x: 0, y: 0, width: 800, height: 800 });

  // second hand: pull apart to scale it up
  const scale0 = s.scale;
  const lc = await page.evaluate(() => window.__cc.stage.worldBounds().center.toArray());
  await page.evaluate((c) => window.__xrEmu.setController('left', [c[0] - 0.08, c[1], c[2] + 0.1], [0, 0, 0, 1]), lc);
  await page.evaluate(() => window.__xrEmu.waitFrames(2));
  await page.evaluate(() => window.__xrEmu.setButton('left', 1, true));
  await page.evaluate(() => window.__xrEmu.waitFrames(3));
  const rp = await page.evaluate(() => window.__xrEmu.state.controllers.right.pos.slice());
  const lp = await page.evaluate(() => window.__xrEmu.state.controllers.left.pos.slice());
  await page.evaluate(([rp, lp]) => Promise.all([
    window.__xrEmu.animate('right', 600, (t) => ({ pos: [rp[0] + 0.25 * t, rp[1], rp[2]] })),
    window.__xrEmu.animate('left', 600, (t) => ({ pos: [lp[0] - 0.25 * t, lp[1], lp[2]] })),
  ]), [rp, lp]);
  await page.evaluate(() => window.__xrEmu.waitFrames(4));
  s = await state(page);
  check(s.scale > scale0 * 1.5, `two-handed stretch scales it up (${scale0.toFixed(3)} → ${s.scale.toFixed(3)})`);
  await page.evaluate(() => {
    window.__xrEmu.setButton('left', 1, false);
    window.__xrEmu.setButton('right', 1, false);
  });
  await page.evaluate(() => window.__xrEmu.waitFrames(3));
  s = await state(page);
  check(!s.grabbed, 'released');

  // B puts it back on the table
  await page.evaluate(() => window.__xrEmu.press('right', 5, 3));
  await page.waitForFunction(() => !window.__cc.stage.tween, null, { timeout: 60000 }).catch(() => {});
  s = await state(page);
  check(Math.abs(s.scale - 1 / 22) < 0.002 && Math.abs(s.holder[2] + 0.62) < 0.01, 'B returns it to the table');

  // press the in-world "Life size" button with the laser
  const btn = await page.evaluate(() => {
    const b = window.__cc.panel.buttons.find((x) => x.id === 'life').mesh;
    return b.getWorldPosition(new b.position.constructor()).toArray();
  });
  await page.evaluate((b) => {
    const from = [0.15, 1.1, -0.05];
    window.__xrEmu.setController('right', from, window.__aim(from, b));
  }, btn);
  await page.evaluate(() => window.__xrEmu.waitFrames(3));
  await page.evaluate(() => window.__xrEmu.press('right', 0, 3));
  await page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'life', null, { timeout: 60000 }).catch(() => {});
  s = await state(page);
  check(s.stageMode === 'life' && s.scale > 0.95, 'laser-pressing "Life size" scales it up around you');
  await page.evaluate(() => {
    const E = window.__xrEmu;
    E.setHead([0, 1.6, 0], E.quatYawPitch(0.15, 0.12));
    E.setController('right', [0.25, 1.0, -0.3], [0, 0, 0, 1]);
  });
  // walk in a little with the left stick
  await page.evaluate(() => window.__xrEmu.setAxes('left', 0, -1));
  await page.evaluate(() => window.__xrEmu.waitFrames(8));
  await page.evaluate(() => window.__xrEmu.setAxes('left', 0, 0));
  await page.waitForTimeout(600);
  await snap(page, '12-vr-life-size.png', { x: 0, y: 0, width: 800, height: 800 });
  const rig = await page.evaluate(() => window.__cc.rig.position.toArray());
  check(rig[2] < 7.3, `left stick walks (rig z ${rig[2].toFixed(2)})`);
  await page.evaluate(() => window.__xrEmu.setHead([0, 1.6, 0], window.__xrEmu.quatYawPitch(0, 0)));
  await page.evaluate(() => window.__xrEmu.press('right', 5, 3));
  await page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'toy', null, { timeout: 60000 }).catch(() => {});
  s = await state(page);
  check(s.stageMode === 'toy', 'B leaves life size');

  // put it away, then bring it back from the shelf
  const mem0 = s.geometries;
  await page.evaluate(() => window.__cc.stage.unload());
  await page.evaluate(() => window.__xrEmu.waitFrames(5));
  s = await state(page);
  check(!s.loaded && s.geometries < mem0 - 50, `putting it away frees GPU memory (${mem0} → ${s.geometries} geometries)`);
  const ped = await page.evaluate(() => {
    const it = window.__cc.shelf.items.find((i) => i.entry.id === 'carousel');
    return it.proxy.getWorldPosition(new it.proxy.position.constructor()).toArray();
  });
  await page.evaluate((p) => {
    const E = window.__xrEmu;
    E.setHead([0, 1.6, 0], E.quatYawPitch(0.6, -0.1));
    const from = [0.2, 1.2, -0.2];
    E.setController('right', from, window.__aim(from, p));
  }, ped);
  await page.evaluate(() => window.__xrEmu.waitFrames(4));
  if (!QUICK) await snap(page, '13-vr-shelf.png', { x: 0, y: 0, width: 800, height: 800 });
  await page.evaluate(() => window.__xrEmu.press('right', 0, 3));
  await page.waitForFunction(() => window.__cc.stage.asset, null, { timeout: 120000 });
  s = await state(page);
  check(s.loaded, 'trigger on the pedestal brings the carousel back to the table');

  // the in-world Exit button really leaves: VR ends, audio closes, rendering stops
  const exitBtn = await page.evaluate(() => {
    const b = window.__cc.panel.buttons.find((x) => x.id === 'exit').mesh;
    return b.getWorldPosition(new b.position.constructor()).toArray();
  });
  await page.evaluate((b) => {
    const E = window.__xrEmu;
    E.setHead([0, 1.6, 0], E.quatYawPitch(0, -0.6));
    const from = [0.15, 1.1, -0.05];
    E.setController('right', from, window.__aim(from, b));
  }, exitBtn);
  await page.evaluate(() => window.__xrEmu.waitFrames(3));
  // (no waitFrames after the press: once Exit works, VR frames stop for good)
  await page.evaluate(() => window.__xrEmu.setButton('right', 0, true));
  await page.waitForFunction(() => window.__cc.closed && !window.__cc.renderer.xr.isPresenting, null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => window.__xrEmu.setButton('right', 0, false));
  const f0 = await page.evaluate(() => window.__cc.frame);
  await page.waitForTimeout(1500);
  const closed = await page.evaluate((f0) => ({
    presenting: window.__cc.renderer.xr.isPresenting,
    stopped: window.__cc.frame === f0,
    screen: !document.getElementById('closed').classList.contains('hidden'),
  }), f0);
  check(!closed.presenting && closed.stopped && closed.screen, 'Exit ends VR and stops the app');
  await page.close();
}

// --------------------------------------------------- the snow globe, desktop
if (!QUICK && want('globe-desktop')) {
  console.log('\n▶ Le Royaume de Givre (snow globe), desktop shots');
  const page = await newPage({ width: 1280, height: 800 }, { query: '?asset=globe&instant' });
  await page.waitForFunction(() => window.__cc.stage.asset, null, { timeout: 240000 });
  await page.click('#btn-desktop');
  await page.waitForTimeout(1500);
  await look(page, [0, 1.12, -0.62], [0.32, 1.32, -0.02]);
  await snap(page, '14-globe.png');
  await look(page, [0.0, 1.13, -0.62], [0.12, 1.2, -0.42]);
  await snap(page, '18-globe-town.png');
  // a dragon up close (wherever it is right now)
  const dp = await page.evaluate(() => {
    const a = window.__cc.stage.asset;
    const d = a.debug.dragons[0];
    const p = a.root.localToWorld(d.pos.clone());
    return p.toArray();
  });
  await look(page, dp, [dp[0] + 0.03, dp[1] + 0.012, dp[2] + 0.035]);
  await snap(page, '19-dragon.png');
  check(true, 'snow globe desktop screenshots');
  await page.close();
}

// --------------------------------------------------------- the snow globe
console.log('\n▶ Le Royaume de Givre (snow globe), emulated Quest');
if (want('globe')) {
  const page = await newPage({ width: 1600, height: 800 }, { xr: true, query: '?asset=globe&instant' });
  await page.waitForFunction(() => !document.getElementById('btn-vr').disabled && window.__cc.stage.asset, null, { timeout: 240000 });
  let s = await state(page);
  check(s.loaded && (await page.evaluate(() => window.__cc.stage.asset.info.id)) === 'globe', 'the snow globe loads onto the table');
  const info = await page.evaluate(() => ({ houses: window.__cc.stage.asset.stats.houses, perches: window.__cc.stage.asset.debug.perches.length }));
  check(info.houses > 35 && info.perches >= 3, `a town of ${info.houses} houses and ${info.perches} dragon perches`);
  await page.click('#btn-vr');
  await page.waitForFunction(() => window.__cc.renderer.xr.isPresenting && window.__xrEmu.frames > 10, null, { timeout: 30000 });
  await page.evaluate(() => {
    const E = window.__xrEmu;
    E.setHead([0, 1.6, 0], E.quatYawPitch(0, -0.45));
  });
  await page.evaluate(() => window.__xrEmu.waitFrames(5));
  await snap(page, '15-vr-globe.png', { x: 0, y: 0, width: 800, height: 800 });
  // the dragons fly and stay inside the glass
  const d0 = await page.evaluate(() => window.__cc.stage.asset.debug.dragons.map((d) => d.pos.toArray()));
  await page.evaluate(() => window.__xrEmu.waitFrames(30));
  const d1 = await page.evaluate(() => window.__cc.stage.asset.debug.dragons.map((d) => ({ p: d.pos.toArray(), state: d.state })));
  const moved = d1.every((d, i) => Math.hypot(d.p[0] - d0[i][0], d.p[1] - d0[i][1], d.p[2] - d0[i][2]) > 0.5 || d.state === 'perched');
  const inside = d1.every((d) => Math.hypot(d.p[0], d.p[1] - 69, d.p[2]) < 52);
  check(moved && inside, `both dragons on the wing inside the glass (${d1.map((d) => d.state).join(', ')})`);
  // pick it up and shake it
  const c = await page.evaluate(() => window.__cc.stage.worldBounds().center.toArray());
  await page.evaluate((c) => window.__xrEmu.setController('right', [c[0] + 0.05, c[1], c[2] + 0.1], [0, 0, 0, 1]), c);
  await page.evaluate(() => window.__xrEmu.waitFrames(2));
  await page.evaluate(() => window.__xrEmu.setButton('right', 1, true));
  await page.evaluate(() => window.__xrEmu.waitFrames(3));
  check((await state(page)).grabbed, 'grip picks the globe up');
  const a0 = await page.evaluate(() => window.__cc.stage.asset.state.agitation);
  await page.evaluate(async (c) => {
    const E = window.__xrEmu;
    for (let k = 0; k < 24; k++) {
      E.setController('right', [c[0] + 0.05 + (k % 2 ? 0.12 : -0.12), c[1] + 0.25, c[2] + 0.1], [0, 0, 0, 1]);
      await E.waitFrames(1);
    }
  }, c);
  const a1 = await page.evaluate(() => window.__cc.stage.asset.state.agitation);
  check(a1 > a0 + 0.2, `shaking it stirs up a blizzard (agitation ${a0.toFixed(2)} → ${a1.toFixed(2)})`);
  await page.evaluate(() => window.__xrEmu.waitFrames(6));
  await snap(page, '16-vr-globe-shaken.png', { x: 0, y: 0, width: 800, height: 800 });
  await page.evaluate(() => window.__xrEmu.setButton('right', 1, false));
  await page.evaluate(() => window.__xrEmu.press('right', 5, 3));
  await page.waitForFunction(() => !window.__cc.stage.tween, null, { timeout: 60000 }).catch(() => {});
  // up close: just what's inside, about 5 m across, floating with its streets at waist height
  await page.evaluate(() => window.__cc.stage.setLife(true));
  await page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'life', null, { timeout: 90000 }).catch(() => {});
  s = await state(page);
  const big = await page.evaluate(() => {
    const a = window.__cc;
    const island = a.stage.asset.root.getObjectByName('island');
    const p = island.getWorldPosition(island.position.clone());
    const glass = a.stage.asset.root.getObjectByName('glass:sphere');
    return { islandY: p.y, room: a.hall.group.children.find((o) => o.name === 'floor').visible, glass: glass.visible, walkway: !!a.scene.getObjectByName('walkway') };
  });
  check(s.stageMode === 'life' && Math.abs(s.scale - 1 / 12) < 0.002 && !big.room && !big.glass && big.walkway && big.islandY > 0.8 && big.islandY < 1.1, `up close: just the island and town, no glass, at waist height (${big.islandY.toFixed(2)} m), on a walkway`);
  await page.evaluate(() => window.__xrEmu.setHead([0, 1.6, 0], window.__xrEmu.quatYawPitch(0, -0.3)));
  await page.evaluate(() => window.__xrEmu.waitFrames(6));
  await snap(page, '17-vr-up-close.png', { x: 0, y: 0, width: 800, height: 800 });
  // the small things are attached: every light hangs from a lamp, post or wire, the guards walk on the wall, flags fly from poles
  const fl = await page.evaluate(async () => {
    const THREE = await import('three');
    const { findFloaters } = await import('/tools/test/floaters.js');
    return findFloaters(THREE, window.__cc.stage.asset.debug.town, { seconds: 300, step: 3 });
  });
  check(fl.lights.length === 0, `every light hangs from something (${fl.counts.lanterns} lanterns, ${fl.counts.stringLights} string lights${fl.lights.length ? `; loose: ${JSON.stringify(fl.lights.slice(0, 3))}` : ''})`);
  check(fl.guards.floating === 0 && fl.guards.sunk === 0 && fl.guards.inTower === 0, `the guards walk on the wall-walk (${fl.guards.samples} positions: ${fl.guards.floating} on air, ${fl.guards.sunk} sunk, ${fl.guards.inTower} inside towers)`);
  check(fl.flags.length === 0, `all ${fl.counts.flags} flags fly from their poles`);
  // five simulated minutes of dragon flight: never inside a building, never outside the glass
  const sim = await page.evaluate(() => window.__cc.stage.asset.debug.simulateDragons(300));
  check(sim.insideBuilding === 0 && sim.outsideGlass === 0, `5 minutes of flight: ${sim.insideBuilding} frames in a building, ${sim.outsideGlass} outside the glass (closest pass ${sim.minClearance.toFixed(1)} m)`);
  check(sim.perched.length >= 2, `the dragons landed and perched (${sim.perched.join(', ')})`);
  await page.close();
}

// ------------------------------------------------------------ hold B to exit
console.log('\n▶ Hold B/Y to exit');
if (want('exit')) {
  const page = await newPage({ width: 800, height: 400 }, { xr: true, query: '?instant&empty' });
  await page.waitForFunction(() => !document.getElementById('btn-vr').disabled, null, { timeout: 60000 });
  await page.click('#btn-vr');
  await page.waitForFunction(() => window.__cc.renderer.xr.isPresenting && window.__xrEmu.frames > 5, null, { timeout: 30000 });
  await page.evaluate(() => window.__xrEmu.setButton('right', 5, true));
  await page.waitForFunction(() => window.__cc.closed, null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(() => window.__xrEmu.setButton('right', 5, false));
  check(await page.evaluate(() => window.__cc.closed && !window.__cc.renderer.xr.isPresenting), 'holding B exits');
  await page.close();
}

// ------------------------------------------- Meta Quest 3 on Meta's emulator
// The same visit again, on Meta's own WebXR emulator (IWER, from the
// Immersive Web SDK) as a Quest 3 with Touch Plus controllers, driven only
// the way a person would: aim, pull the trigger, squeeze, push the sticks.
console.log("\n▶ Meta Quest 3 (Meta's IWER emulator), hands on the controllers");
if (want('iwer')) {
  const q = await openQuest(browser, url, { query: '?instant&empty', size: [960, 720], errors, out: OUT });
  const run = (c) => q.run(c);
  const st = () => run({ cmd: 'state' });
  check((await run({ cmd: 'enter' })).presenting, 'enters VR as a Quest 3 with two Touch Plus controllers');
  await run({ cmd: 'head', yaw: 0, pitch: -0.4 });
  // point at the snow globe's pedestal column and pull the trigger
  const ped = await run({ cmd: 'find', name: 'pedestal:globe' });
  const aimed = await run({ cmd: 'aim', hand: 'right', at: [ped.center[0], 0.55, ped.center[2]] });
  await run({ cmd: 'press', hand: 'right', button: 'trigger' });
  await q.page.waitForFunction(() => window.__cc.stage.asset?.info.id === 'globe' && !window.__cc.stage.loading, null, { timeout: 300000 }).catch(() => {});
  let s = await st();
  check(s.asset === 'globe', `pointing at the globe's pedestal and pulling the trigger brings it to the table (ray hit ${aimed.ray[0]?.name})`);
  // the panel's Up close button
  await run({ cmd: 'aim', hand: 'right', at: 'button:life' });
  await run({ cmd: 'press', hand: 'right', button: 'trigger' });
  await q.page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'life', null, { timeout: 90000 }).catch(() => {});
  s = await st();
  check(s.stageMode === 'life' && Math.abs(s.scale - 1 / 12) < 0.002, 'the Up close button blows up the island and town');
  // walk round it on the walkway with the left stick, then look at the town
  const p0 = s.head.pos;
  const walked = await run({ cmd: 'stick', hand: 'left', x: 1, y: 0, ms: 1200 });
  const p1 = walked.head.pos;
  const r1 = Math.hypot(p1[0], p1[2]);
  check(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 0.3 && r1 > 3.1 && r1 < 5.4, `the left stick walks you round it on the walkway (${Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2)} m, ${r1.toFixed(1)} m out)`);
  await run({ cmd: 'head', look: [0, 1.2, 0] });
  await run({ cmd: 'shot', file: '20-quest3-up-close.png' });
  // tap B: back on the table
  await run({ cmd: 'press', hand: 'right', button: 'b' });
  await q.page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'toy', null, { timeout: 90000 }).catch(() => {});
  s = await st();
  check(s.stageMode === 'toy', 'a tap of B puts it back on the table');
  // reach out, squeeze, lift it up and shake it
  await run({ cmd: 'head', at: [0, 1.6, 0], look: 'proxy:hero' });
  await run({ cmd: 'place', hand: 'right', at: 'proxy:hero' });
  await run({ cmd: 'down', hand: 'right', button: 'grip' });
  await run({ cmd: 'move', hand: 'right', to: [0.1, 1.35, -0.35], ms: 600 });
  s = await st();
  const held = await run({ cmd: 'find', name: 'proxy:hero' });
  check(s.grabbed && Math.abs(held.center[1] - 1.35) < 0.05, `squeezing the grip picks it up and it follows your hand (${held.center.map((v) => v.toFixed(2)).join(', ')})`);
  // lifting it briskly already stirs the snow; let it settle before the real shake
  await q.page.waitForFunction(() => window.__cc.stage.asset.state.agitation < 0.25, null, { timeout: 120000 }).catch(() => {});
  const a0 = await q.page.evaluate(() => window.__cc.stage.asset.state.agitation);
  await run({ cmd: 'shake', hand: 'right', amplitude: 0.12, count: 16 });
  const a1 = await q.page.evaluate(() => window.__cc.stage.asset.state.agitation);
  check(a1 > a0 + 0.3, `shaking the controller shakes up the snow (${a0.toFixed(2)} → ${a1.toFixed(2)})`);
  await run({ cmd: 'head', look: 'proxy:hero' });
  await run({ cmd: 'shot', file: '21-quest3-shaken.png' });
  await run({ cmd: 'up', hand: 'right', button: 'grip' });
  // the panel's Exit button ends the session
  await run({ cmd: 'head', at: [0, 1.6, 0], yaw: 0, pitch: -0.5 });
  await run({ cmd: 'aim', hand: 'right', at: 'button:exit' });
  await run({ cmd: 'press', hand: 'right', button: 'trigger' });
  await q.page.waitForFunction(() => window.__cc.closed, null, { timeout: 60000 }).catch(() => {});
  check(await q.page.evaluate(() => window.__cc.closed && !window.__cc.renderer.xr.isPresenting), 'the Exit button leaves VR');
  await q.page.close();
}

console.log('\n▶ Errors');
check(errors.length === 0, errors.length ? `page errors:\n    ${[...new Set(errors)].slice(0, 8).join('\n    ')}` : 'no page errors');

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
