/**
 * End-to-end test: boots the app in headless Chromium with an emulated Quest
 * (two Touch controllers), plays through the experience and asserts on
 * gameplay state. Also captures the screenshots used in the README.
 *
 *   node tools/test/run.mjs            # run + write docs/screenshots
 *   node tools/test/run.mjs --quick    # skip the long scenarios
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright, launchArgs } from './pw.mjs';
import { serve } from './server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const QUICK = process.argv.includes('--quick');
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
function check(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else {
    console.log('  ✗', msg);
    failures.push(msg);
  }
}

console.log('\n▶ Static checks');
{
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const assets = Array.from(sw.matchAll(/'(\.\/[^']+)'/g), (m) => m[1]).filter((a) => a !== './');
  const missing = assets.filter((a) => !fs.existsSync(path.join(ROOT, a)));
  check(missing.length === 0, missing.length ? 'service worker lists missing files: ' + missing.join(', ') : `service worker caches ${assets.length} existing files`);
  const srcFiles = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const fp = path.join(d, f);
      if (fs.statSync(fp).isDirectory()) walk(fp);
      else if (f.endsWith('.js')) srcFiles.push('./' + path.relative(ROOT, fp).split(path.sep).join('/'));
    }
  };
  walk(path.join(ROOT, 'src'));
  const uncached = srcFiles.filter((f) => !assets.includes(f));
  check(uncached.length === 0, uncached.length ? 'source files not in the service worker: ' + uncached.join(', ') : 'every source module is cached offline');
}

const { chromium } = await loadPlaywright();
const { server, url } = await serve(ROOT);
const browser = await chromium.launch({ args: launchArgs });
const errors = [];
const consoleErrors = [];

async function newPage(viewport, xr) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/service worker|sw\.js|bad HTTP response/i.test(m.text())) consoleErrors.push(m.text());
  });
  if (xr) await page.addInitScript({ path: path.join(ROOT, 'tools', 'test', 'xr-emulator.js') });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__czx && window.__czx.frame > 5, null, { timeout: 60000 });
  return page;
}

/** VR screenshots: keep just the left eye so README images stay small and readable */
const EYE = { clip: { x: 0, y: 0, width: 800, height: 800 } };

async function state(page) {
  return page.evaluate(() => {
    const a = window.__czx;
    return {
      mode: a.mode,
      presenting: a.renderer.xr.isPresenting,
      strokes: a.paint.history.length,
      stickers: a.paint.stamps.total,
      batches: a.paint.batches.length,
      live: a.paint.live.length,
      progress: a.world.progress,
      worldColor: a.world.worldColor,
      bubbles: a.bubbles.aliveCount,
      pops: a.bubbles.popCount,
      splats: a.splats.splatCount,
      butterflies: a.butterflies.items.length,
      milestones: Array.from(a.milestones.reached),
      teleports: a.locomotion.teleports,
      turns: a.locomotion.turns,
      menuOpen: a.menu.open,
      colorIndex: a.paint.colorIndex,
      brush: a.paint.brush.id,
      rig: a.rig.position.toArray().map((v) => +v.toFixed(2)),
      pulses: window.__xrEmu ? window.__xrEmu.pulses.length : 0,
      drawCalls: a.stats.drawCalls,
      triangles: a.stats.triangles,
      audio: a.audio.ready,
      frameErrors: a._errors || 0,
    };
  });
}

console.log('\n▶ Title screen (desktop)');
{
  const page = await newPage({ width: 1280, height: 720 }, false);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '01-title.png') });
  const s = await state(page);
  check(s.mode === 'attract', 'attract mode running');
  check(s.drawCalls > 5 && s.triangles > 50000, `scene rendered (${s.drawCalls} draw calls, ${s.triangles} tris)`);
  await page.click('#btn-desktop');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__czx.desktop.setLook(0.35, -0.12));
  // paint with the mouse: drag across the canvas
  await page.mouse.move(640, 360);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) {
    await page.mouse.move(640 + Math.sin(i / 6) * 3, 360, { steps: 1 });
    await page.evaluate((i) => window.__czx.desktop.setLook(0.35 - i * 0.02, -0.12 + Math.sin(i / 4) * 0.08), i);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  const s2 = await state(page);
  check(s2.mode === 'desktop', 'desktop mode');
  check(s2.strokes >= 1, `desktop painting created ${s2.strokes} stroke(s)`);
  await page.evaluate(() => window.__czx.desktop.setLook(0.2, -0.25));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '02-desktop-paint.png') });
  await page.close();
}

console.log('\n▶ Emulated Quest session');
const page = await newPage({ width: 1600, height: 800 }, true);
await page.waitForFunction(() => !document.getElementById('btn-vr').disabled, null, { timeout: 10000 });
await page.click('#btn-vr');
await page.waitForFunction(() => window.__czx.renderer.xr.isPresenting && window.__xrEmu.frames > 10, null, { timeout: 20000 });
await page.evaluate(() => window.__xrEmu.setHead([0, 1.6, 0], window.__xrEmu.quatYawPitch(0, -0.18)));
await page.evaluate(() => window.__xrEmu.waitFrames(5));
let s = await state(page);
check(s.presenting && s.mode === 'xr', 'XR session presenting');
check(await page.evaluate(() => window.__czx.hands.left.connected && window.__czx.hands.right.connected), 'both controllers connected');
check(s.audio, 'audio engine started');
await page.screenshot({ path: path.join(OUT, '03-vr-start.png'), ...EYE });
const intro = await page.evaluate(() => ({ started: window.__czx.intro.started, phase: window.__czx.intro.phase, force: window.__czx.world.uniforms.forceColor.value }));
check(intro.started && intro.phase === 'story', 'opening story started');
check(intro.force > 0.5, 'world shown in full colour before the drain');
// the emulator runs slower than real time; jump to the ready-to-paint state
await page.evaluate(async () => {
  window.__czx.intro.skip();
  await window.__xrEmu.waitFrames(8);
});
check((await page.evaluate(() => window.__czx.world.uniforms.forceColor.value)) === 0, 'colours drained to the sketch world');

console.log('\n▶ Painting with every brush');
const brushes = ['glow', 'rainbow', 'sparkle', 'cotton', 'stamp', 'bubble'];
for (let bi = 0; bi < brushes.length; bi++) {
  await page.evaluate(async ({ bi }) => {
    const E = window.__xrEmu;
    const app = window.__czx;
    app.paint.setBrushIndex(bi);
    app.paint.setColorIndex((bi * 2 + 1) % 12);
    const cx = -0.62 + bi * 0.25;
    const cy = 1.45 + (bi % 2) * 0.12;
    const cz = -0.85;
    E.setButton('right', 0, true, 1);
    await E.animate('right', 1300, (t) => {
      const a = t * Math.PI * 2;
      return { pos: [cx + Math.cos(a) * 0.14, cy + Math.sin(a) * 0.17, cz + Math.sin(a * 2) * 0.03], quat: [0, 0, 0, 1] };
    });
    E.setButton('right', 0, false, 0);
    await E.waitFrames(3);
  }, { bi });
}
s = await state(page);
check(s.strokes >= 5, `${s.strokes} strokes recorded`);
check(s.stickers > 0, `${s.stickers} stickers placed`);
check(s.bubbles > 0, `${s.bubbles} bubbles blown`);
check(s.pulses >= 10, `haptics fired (${s.pulses} pulses)`);
await page.screenshot({ path: path.join(OUT, '04-vr-brushes.png'), ...EYE });

console.log('\n▶ Palette, undo, brush cycling');
{
  const orb = await page.evaluate(() => {
    const a = window.__czx;
    a.palette.group.updateWorldMatrix(true, false);
    const w = a.palette.positions[3].clone().applyMatrix4(a.palette.group.matrixWorld);
    return [w.x, w.y, w.z];
  });
  await page.evaluate(async (orb) => {
    const E = window.__xrEmu;
    await E.animate('right', 400, (t) => ({ pos: [orb[0] + (1 - t) * 0.15, orb[1] + (1 - t) * 0.1, orb[2] + 0.115], quat: [0, 0, 0, 1] }));
    await E.waitFrames(4);
  }, orb);
  s = await state(page);
  check(s.colorIndex === 3, `palette pick selected colour 3 (got ${s.colorIndex})`);
  await page.screenshot({ path: path.join(OUT, '05-vr-palette.png'), ...EYE });
  const before = s.strokes;
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setController('right', [0.3, 1.3, -0.5], [0, 0, 0, 1]);
    await E.press('right', 4, 4); // A = undo
    await E.press('right', 5, 4); // B = next brush
  });
  s = await state(page);
  check(s.strokes === before - 1, `undo removed a stroke (${before} → ${s.strokes})`);
  check(s.brush === 'glow', `B cycled the brush (now ${s.brush})`);
}

console.log('\n▶ Many strokes stay cheap (batching)');
{
  await page.evaluate(async () => {
    const app = window.__czx;
    const c = new app.THREE.Color('#ffd93d');
    const p = new app.THREE.Vector3();
    for (let k = 0; k < 60; k++) {
      const e = app.paint.beginStroke('glow');
      for (let i = 0; i < 30; i++) {
        p.set(-1 + k * 0.04, 1.0 + i * 0.01, -1.2 + Math.sin(i * 0.4 + k) * 0.08);
        e.stroke.addPoint(p, 0.01, c);
      }
      app.paint.endStroke(e);
    }
    await window.__xrEmu.waitFrames(3);
  });
  s = await state(page);
  check(s.batches >= 1 && s.live <= 24, `60 extra strokes → ${s.batches} batch(es), ${s.live} live meshes`);
  check(s.drawCalls < 190, `draw calls stay low (${s.drawCalls} for both eyes)`);
  const undone = await page.evaluate(() => {
    const a = window.__czx;
    let n = 0;
    for (let i = 0; i < 60; i++) if (a.paint.undo()) n++;
    const batched = a.paint.batches.reduce((sum, b) => sum + b.entries.length, 0);
    const tubes = a.paint.history.filter((e) => e.kind === 'tube').length;
    const mid = { n, batches: a.paint.batches.length, live: a.paint.live.length, history: a.paint.history.length, consistent: batched + a.paint.live.length === tubes };
    while (a.paint.undo());
    return { ...mid, finalBatches: a.paint.batches.length, finalHistory: a.paint.history.length, meshes: a.paint.group.children.filter((c) => c.name === 'stroke' || c.name === 'stroke-batch').length };
  });
  check(undone.n === 60 && undone.consistent, `undo walked back through batches (${undone.n} undos, ${undone.batches} batch(es) + ${undone.live} live = ${undone.history} entries)`);
  check(undone.finalHistory === 0 && undone.finalBatches === 0 && undone.meshes === 0, 'undoing everything leaves no stroke meshes behind');
  // put the brush strokes back for the later scenarios
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    app.paint.setBrushIndex(0);
    app.paint.setColorIndex(6);
    E.setButton('right', 0, true, 1);
    await E.animate('right', 900, (t) => ({ pos: [-0.3 + t * 0.6, 1.3 + Math.sin(t * 9) * 0.08, -0.7], quat: [0, 0, 0, 1] }));
    E.setButton('right', 0, false, 0);
    await E.waitFrames(3);
  });
}

console.log('\n▶ Throw a paint ball');
{
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    const app = window.__czx;
    app.paint.setColorIndex(9);
    E.setController('right', [0.25, 1.1, -0.3], [0, 0, 0, 1]);
    E.setButton('right', 1, true, 1);
    await E.waitFrames(8);
    await E.animate('right', 200, (t) => ({ pos: [0.25, 1.1 + t * 0.45, -0.3 - t * 1.0], quat: E.quatYawPitch(0, 0.35) }));
    E.setButton('right', 1, false, 0);
    await E.waitFrames(70);
  });
  s = await state(page);
  check(s.splats >= 1, `paint ball splatted (${s.splats})`);
}

console.log('\n▶ Pop a bubble');
{
  const b = await page.evaluate(() => {
    const a = window.__czx;
    for (let i = 0; i < a.bubbles.capacity; i++) if (a.bubbles.alive[i]) return a.bubbles.pos[i].toArray();
    return null;
  });
  check(b !== null, 'a bubble is floating');
  if (b) {
    const popsBefore = s.pops;
    await page.evaluate(async (b) => {
      const E = window.__xrEmu;
      const a = window.__czx;
      // find it again right before touching (bubbles drift)
      let p = b;
      for (let i = 0; i < a.bubbles.capacity; i++) if (a.bubbles.alive[i]) { p = a.bubbles.pos[i].toArray(); break; }
      E.setController('right', [p[0], p[1], p[2] + 0.115], [0, 0, 0, 1]);
      await E.waitFrames(4);
    }, b);
    s = await state(page);
    check(s.pops > popsBefore, `bubble popped (${s.pops} total)`);
  }
}

console.log('\n▶ Teleport + snap turn');
{
  const rigBefore = s.rig;
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setController('left', [-0.25, 1.2, -0.3], E.quatYawPitch(0, 0.45));
    E.setAxes('left', 0, -1);
    await E.waitFrames(12);
  });
  await page.screenshot({ path: path.join(OUT, '06-vr-teleport.png'), ...EYE });
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setAxes('left', 0, 0);
    await E.waitFrames(6);
    E.setAxes('right', 1, 0);
    await E.waitFrames(4);
    E.setAxes('right', 0, 0);
    await E.waitFrames(4);
  });
  s = await state(page);
  check(s.teleports === 1, `teleported (rig ${rigBefore} → ${s.rig})`);
  check(s.turns === 1, 'snap turned');
}

console.log('\n▶ Menu');
{
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setController('right', [0.25, 1.15, -0.35], [0, 0, 0, 1]);
    await E.press('left', 4, 4); // X = menu
  });
  s = await state(page);
  check(s.menuOpen, 'menu opened with X');
  // point the right controller at the "Bigger" button and pull the trigger
  const target = await page.evaluate(() => {
    const a = window.__czx;
    const m = a.menu;
    const b = m.buttons.find((x) => x.id === 'bigger');
    const [x, y, w, h] = b.rect;
    const u = (x + w / 2) / 1320 - 0.5;
    const v = 0.5 - (y + h / 2) / 920;
    const p = new window.__czx.THREE.Vector3(u * 0.66, v * 0.46, 0).applyMatrix4(m.panel.matrixWorld);
    // controller poses are expressed in the rig's (XR reference) space
    a.rig.updateWorldMatrix(true, false);
    return a.rig.worldToLocal(p).toArray();
  });
  const sizeBefore = await page.evaluate(() => window.__czx.paint.size);
  await page.evaluate(async (target) => {
    const E = window.__xrEmu;
    const from = [0.25, 1.15, 0.0];
    const d = [target[0] - from[0], target[1] - from[1], target[2] - from[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const yaw = Math.atan2(-d[0], -d[2]);
    const pitch = Math.asin(d[1] / len);
    E.setController('right', from, E.quatYawPitch(yaw, pitch));
    await E.waitFrames(4);
    await E.press('right', 0, 4, 1);
  }, target);
  const sizeAfter = await page.evaluate(() => window.__czx.paint.size);
  check(sizeAfter > sizeBefore, `laser + trigger pressed "Bigger" (${sizeBefore.toFixed(3)} → ${sizeAfter.toFixed(3)})`);
  await page.screenshot({ path: path.join(OUT, '07-vr-menu.png'), ...EYE });
  await page.evaluate(async () => {
    window.__czx.menu.close();
    await window.__xrEmu.waitFrames(2);
  });
}

// feature scenarios: tools/test/scenarios/*.mjs export `run({ page, check, state, EYE, OUT, QUICK })`
{
  const dir = path.join(ROOT, 'tools', 'test', 'scenarios');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort() : [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    if (typeof mod.run !== 'function') continue;
    console.log(`\n▶ ${mod.title || f}`);
    try {
      await mod.run({ page, check, state, EYE, OUT, QUICK, ROOT });
    } catch (err) {
      check(false, `scenario ${f} threw: ${err && err.message ? err.message : err}`);
    }
  }
}

if (!QUICK) {
  console.log('\n▶ Colouring the world (milestones)');
  // paint big splashes all over the island to drive progress
  await page.evaluate(async () => {
    const app = window.__czx;
    const E = window.__xrEmu;
    const pal = app.paint.palette;
    const R = 34;
    let k = 0;
    for (let x = -R; x <= R; x += 2.4) {
      for (let z = -R; z <= R; z += 2.4) {
        if (Math.hypot(x, z) < R) app.world.paintMap.stamp(x, z, 2.6, pal[k++ % 12], 0.9, 0.7);
      }
    }
    await E.waitFrames(10);
  });
  s = await state(page);
  check(s.progress > 0.85, `progress ${(s.progress * 100).toFixed(0)}%`);
  check(s.milestones.length >= 3, `milestones reached: ${s.milestones.join(', ')}`);
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setHead([0, 1.6, 0], E.quatYawPitch(0.6, 0.05));
    E.setController('right', [0.3, 1.2, -0.4], [0, 0, 0, 1]);
    E.setController('left', [-0.3, 1.1, -0.4], [0, 0, 0, 1]);
    await E.waitFrames(90);
  });
  s = await state(page);
  check(s.butterflies > 0, `${s.butterflies} butterflies arrived`);
  await page.screenshot({ path: path.join(OUT, '08-vr-world-alive.png'), ...EYE });
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setHead([0, 1.6, 0], E.quatYawPitch(-0.4, 0.35));
    await E.waitFrames(30);
  });
  await page.screenshot({ path: path.join(OUT, '09-vr-rainbow.png'), ...EYE });
  // fireworks finale
  await page.evaluate(async () => {
    const app = window.__czx;
    app.milestones.force('finale');
    const E = window.__xrEmu;
    E.setHead([0, 1.6, 0], E.quatYawPitch(0.2, 0.55));
    await E.waitFrames(75);
  });
  await page.screenshot({ path: path.join(OUT, '10-vr-fireworks.png'), ...EYE });
  s = await state(page);
  check(s.milestones.includes('finale'), 'finale celebration ran');

  console.log('\n▶ New world + hand tracking');
  await page.evaluate(async () => {
    window.__czx.newWorld('test-seed');
    await window.__xrEmu.waitFrames(6);
  });
  s = await state(page);
  check(s.strokes === 0 && s.progress < 0.05, `new world reset (progress ${(s.progress * 100).toFixed(1)}%)`);
  // colour spread: a lone splash should grow outward while the player is active
  const spread = await page.evaluate(async () => {
    const app = window.__czx;
    const pm = app.world.paintMap;
    const c = new app.THREE.Color('#ff3b5c');
    const before = pm.coverageAt(20.5, 20.5);
    pm.stamp(18.4, 20.5, 1.2, c, 1, 0.5);
    pm.flush(); // push the stamp to the GPU map before spreading
    for (let i = 0; i < 40; i++) pm._spreadCPU(1);
    for (let i = 0; i < 60; i++) pm._spreadGPU();
    const after = pm.coverageAt(20.5, 20.5);
    // GPU texels are ~10 cm: probe 15 cm past the stamp's edge (x = 19.6)
    const buf = new Uint8Array(4);
    const px = Math.floor(((19.75 + pm.half) / pm.size) * pm.res);
    const pz = Math.floor(((20.5 + pm.half) / pm.size) * pm.res);
    app.renderer.readRenderTargetPixels(pm.target, px, pz, 1, 1, buf);
    return { before, after, gpuAlpha: buf[3] / 255 };
  });
  check(spread.after > spread.before + 0.05, `CPU colour spread ${spread.before.toFixed(2)} → ${spread.after.toFixed(2)}`);
  check(spread.gpuAlpha > 0.05, `GPU colour spread reached the neighbour texel (alpha ${spread.gpuAlpha.toFixed(2)})`);
  await page.evaluate(async () => {
    const E = window.__xrEmu;
    E.setHandTracking('right', true, false);
    E.setHandTracking('left', true, false);
    await E.waitFrames(6);
    E.setController('right', [0.2, 1.3, -0.4], [0, 0, 0, 1]);
    E.setPinch('right', true);
    await E.waitFrames(3);
    await E.animate('right', 900, (t) => ({ pos: [0.2 - t * 0.5, 1.3 + Math.sin(t * 6) * 0.1, -0.4], quat: [0, 0, 0, 1] }));
    E.setPinch('right', false);
    await E.waitFrames(4);
  });
  s = await state(page);
  const tracked = await page.evaluate(() => window.__czx.hands.right.isTrackedHand);
  check(tracked, 'tracked hands detected');
  check(s.strokes >= 1, `pinch painting made ${s.strokes} stroke(s)`);
  await page.screenshot({ path: path.join(OUT, '11-vr-hands.png'), ...EYE });
}

if (!QUICK) {
  console.log('\n▶ Auto-save and restore');
  const saved = await page.evaluate(() => {
    const a = window.__czx;
    a.paint.setColorIndex(4);
    const ok = a.saveGame.save();
    return { ok, strokes: a.paint.history.length, seed: a.seedName, progress: a.world.progress };
  });
  check(saved.ok, `saved ${saved.strokes} stroke(s) for island "${saved.seed}"`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__czx && window.__czx.frame > 5, null, { timeout: 60000 });
  const restored = await page.evaluate(() => {
    const a = window.__czx;
    return { restored: a.restored, strokes: a.paint.history.length, seed: a.seedName, color: a.paint.colorIndex, progress: a.world.progress };
  });
  check(restored.restored && restored.strokes === saved.strokes, `restored ${restored.strokes} stroke(s) on reload`);
  check(restored.seed === saved.seed, `same island restored (${restored.seed})`);
  check(restored.color === 4, 'colour choice restored');
  await page.goto(url + '?fresh', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__czx && window.__czx.frame > 5, null, { timeout: 60000 });
  const fresh = await page.evaluate(() => ({ strokes: window.__czx.paint.history.length, progress: window.__czx.world.progress }));
  check(fresh.strokes === 0, '?fresh starts clean');
  check(restored.progress > fresh.progress + 0.0002, `ground colour rebuilt from the save (${(restored.progress * 100).toFixed(2)}% vs ${(fresh.progress * 100).toFixed(2)}% fresh)`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__czx && window.__czx.frame > 5, null, { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('btn-vr').disabled, null, { timeout: 10000 });
  await page.click('#btn-vr');
  await page.waitForFunction(() => window.__czx.renderer.xr.isPresenting && window.__xrEmu.frames > 5, null, { timeout: 20000 });
}

console.log('\n▶ Stability');
s = await state(page);
check(s.frameErrors === 0, 'no frame errors');
check(errors.length === 0, errors.length ? 'page errors: ' + errors.join(' | ') : 'no page errors');
check(consoleErrors.length === 0, consoleErrors.length ? 'console errors: ' + consoleErrors.slice(0, 3).join(' | ') : 'no console errors');
console.log(`  · draw calls ${s.drawCalls}, triangles ${s.triangles}`);

await page.evaluate(() => window.__xrEmu.endSession());
await page.waitForTimeout(400);
s = await state(page);
check(!s.presenting && s.mode === 'attract', 'session ended cleanly');

await browser.close();
server.close();
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll checks passed. Screenshots in docs/screenshots/');
