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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const QUICK = process.argv.includes('--quick');
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
{
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
  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
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
  await page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'life', null, { timeout: 60000 }).catch(() => {});
  s = await state(page);
  check(s.stageMode === 'life' && Math.abs(s.scale - 1) < 0.01, `life size (scale ${s.scale.toFixed(2)})`);
  if (!QUICK) {
    await look(page, [0, 2.6, 0], [2.2, 1.6, 5.6]);
    await page.waitForTimeout(800);
    await snap(page, '08-life-size.png');
  }
  await page.click('#hud-life');
  await page.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'toy', null, { timeout: 60000 }).catch(() => {});
  s = await state(page);
  check(s.stageMode === 'toy' && Math.abs(s.scale - 1 / 22) < 0.002, 'back to toy size on the table');
  await page.close();
}

// --------------------------------------------------------------------- XR
console.log('\n▶ Emulated Quest');
{
  const page = await newPage({ width: 1600, height: 800 }, { xr: true, query: '?instant' });
  await page.waitForFunction(() => !document.getElementById('btn-vr').disabled && window.__cc.stage.asset, null, { timeout: 120000 });
  await page.click('#btn-vr');
  await page.waitForFunction(() => window.__cc.renderer.xr.isPresenting && window.__xrEmu.frames > 10, null, { timeout: 30000 });
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
  await page.close();
}

console.log('\n▶ Errors');
check(errors.length === 0, errors.length ? `page errors:\n    ${[...new Set(errors)].slice(0, 8).join('\n    ')}` : 'no page errors');

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
