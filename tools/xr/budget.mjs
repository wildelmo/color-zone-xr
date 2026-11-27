#!/usr/bin/env node
/**
 * The frame budget on the emulated Quest 3: how many triangles and draw calls
 * a frame costs in each view, how much of that is the shadow pass, and where
 * the triangles live (the room, each shelf preview, the hero).
 *
 *   node tools/xr/budget.mjs [--out budget] [--only carousel,globe] [--shots] [--compare old/budget.json]
 *
 * Views, per curio: on the table, held close at 3x (as when you pick it up
 * and stretch it with both hands), and its big view (life size / up close).
 *
 * The emulator draws both eyes, so "frame" numbers are whole frames: two eye
 * passes plus one shadow pass. They are counts, not timings (headless
 * Chromium renders in software); only a headset can tell you frame time.
 *
 * --shots also saves a picture of each view and a close-up of every shelf
 * preview, from the same viewpoints every run, to compare by eye.
 * --compare prints the change against an earlier run's budget.json.
 */
import path from 'node:path';
import fs from 'node:fs';
import { launchQuest } from './quest.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const out = path.resolve(opt('out', 'budget'));
const only = opt('only', '') ? opt('only').split(',') : ['carousel', 'globe'];
const shots = args.includes('--shots');
const compare = opt('compare', '');
fs.mkdirSync(out, { recursive: true });

/** in the page: count what one frame draws, right now */
function measure(page, label) {
  return page.evaluate(async (label) => {
    const app = window.__cc;
    const wait = async (n) => {
      const f = app.frame;
      const t0 = performance.now();
      while (app.frame < f + n && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 20));
    };
    await wait(4);
    const frame = { ...app.stats };
    // hold the last shadow map for a few frames: the difference is the shadow pass
    app.renderer.shadowMap.autoUpdate = false;
    await wait(4);
    const noShadow = { ...app.stats };
    app.renderer.shadowMap.autoUpdate = true;
    await wait(2);

    const tris = (o) => {
      const g = o.geometry;
      let n = g.index ? g.index.count : g.attributes.position?.count || 0;
      if (Number.isFinite(g.drawRange.count)) n = Math.min(n, g.drawRange.count);
      let inst = 1;
      if (o.isInstancedMesh) inst = o.count;
      else if (g.isInstancedBufferGeometry) {
        inst = Number.isFinite(g.instanceCount) ? g.instanceCount : 0;
        if (!inst) for (const a of Object.values(g.attributes)) if (a.isInstancedBufferAttribute) inst = Math.max(inst, a.count);
      }
      return Math.round((n / 3) * inst);
    };
    const under = (o, root) => {
      for (let x = o; x; x = x.parent) if (x === root) return true;
      return false;
    };
    const buckets = {};
    const meshes = [];
    app.scene.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry) return;
      const t = tris(o);
      let bucket = 'other';
      if (under(o, app.stage.holder)) bucket = 'hero';
      else if (under(o, app.hall.group)) bucket = 'room';
      else if (under(o, app.shelf.group)) {
        const it = app.shelf.items.find((i) => under(o, i.group));
        bucket = it ? `shelf:${it.entry.id}` : 'shelf';
      } else if (app.stage.walkway && under(o, app.stage.walkway)) bucket = 'walkway';
      const b = (buckets[bucket] ||= { triangles: 0, meshes: 0, casters: 0 });
      b.triangles += t;
      b.meshes++;
      if (o.castShadow) b.casters += t;
      let name = o.name;
      for (let p = o.parent; !name && p; p = p.parent) name = p.name ? `${p.name}/…` : '';
      meshes.push({ bucket, name: name || '(unnamed)', triangles: t, instances: o.isInstancedMesh ? o.count : 1, castsShadow: !!o.castShadow });
    });
    meshes.sort((a, b) => b.triangles - a.triangles);
    const lights = [];
    app.scene.traverseVisible((o) => o.isLight && lights.push(o.type + (o.castShadow ? ' (shadow)' : '')));
    const mem = app.renderer.info.memory;
    return {
      label,
      frame: { triangles: frame.triangles, drawCalls: frame.drawCalls },
      shadowPass: { triangles: frame.triangles - noShadow.triangles, drawCalls: frame.drawCalls - noShadow.drawCalls },
      visible: { triangles: meshes.reduce((s, m) => s + m.triangles, 0), meshes: meshes.length },
      buckets,
      top: meshes.slice(0, 12),
      lights,
      memory: { geometries: mem.geometries, textures: mem.textures, programs: app.renderer.info.programs?.length ?? 0 },
      scale: +app.stage.holder.scale.x.toFixed(5),
    };
  }, label);
}

const results = [];
for (const asset of only) {
  const q = await launchQuest({ query: `?instant&asset=${asset}`, size: [1024, 1024], out });
  const p = q.page;
  const shot = async (file) => shots && (await q.run({ cmd: 'shot', file }));
  await p.waitForFunction((id) => window.__cc.stage.asset?.info.id === id && !window.__cc.stage.loading, asset, { timeout: 300000 });
  await q.run({ cmd: 'enter' });
  // hands down and out of the pictures
  for (const hand of ['right', 'left']) await q.run({ cmd: 'aim', hand, at: [hand === 'left' ? -0.3 : 0.3, -3, 2] });

  // 1. on the table, from where you stand when you enter
  await q.run({ cmd: 'head', look: 'proxy:hero' });
  results.push(await measure(p, `${asset}: on the table`));
  await shot(`${asset}-table.png`);

  // close-ups of the shelf previews (the one on the table is off its pedestal)
  if (shots) {
    const peds = await p.evaluate(() =>
      window.__cc.shelf.items
        .filter((i) => i.asset && !i.onStage)
        .map((i) => ({ id: i.entry.id, p: i.group.getWorldPosition(new window.__qd.THREE.Vector3()).toArray() })),
    );
    for (const { id, p: pos } of peds) {
      const r = Math.hypot(pos[0], pos[2]);
      const k = (r - 0.62) / r;
      await q.run({ cmd: 'head', at: [pos[0] * k, 1.36, pos[2] * k], look: [pos[0], 1.16, pos[2]] });
      await shot(`shelf-${id}.png`);
    }
    await q.run({ cmd: 'head', at: [0, 1.6, 0], look: 'proxy:hero' });
  }

  // 2. held close and stretched to 3x, as with two hands
  await p.evaluate((k) => {
    const app = window.__cc, s = app.stage, THREE = window.__qd.THREE;
    s.grabbed = true;
    s.tween = null;
    const cam = app.renderer.xr.getCamera();
    const head = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    dir.y = 0;
    dir.normalize();
    const scale = s.scale * k;
    const b = s.asset.info.bounds;
    const c = head.clone().addScaledVector(dir, 0.3 + b.radius * scale);
    c.y -= 0.25;
    s.holder.quaternion.identity();
    s.holder.scale.setScalar(scale);
    s.holder.position.set(c.x - b.center[0] * scale, c.y - b.center[1] * scale, c.z - b.center[2] * scale);
  }, 3);
  await q.run({ cmd: 'head', look: 'proxy:hero' });
  results.push(await measure(p, `${asset}: held close, 3x`));
  await shot(`${asset}-held.png`);
  await p.evaluate(() => {
    const s = window.__cc.stage;
    s.grabbed = false;
    s.reset();
  });
  await p.waitForFunction(() => !window.__cc.stage.tween, null, { timeout: 90000 });

  // 3. the big view (life size / up close)
  await p.evaluate(() => {
    window.__cc.hidePanel = true;
    window.__cc.stage.setLife(true, true);
  });
  await p.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'life', null, { timeout: 90000 });
  await q.run({ cmd: 'wait', frames: 4 });
  await q.run({ cmd: 'head', look: 'proxy:hero' });
  results.push(await measure(p, `${asset}: big view`));
  await shot(`${asset}-big.png`);

  if (q.errors.length) console.log(`page errors (${asset}):`, q.errors);
  await q.close();
}

// ------------------------------------------------------------------ report
const n = (x) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);
const before = compare ? JSON.parse(fs.readFileSync(compare, 'utf8')) : null;
const delta = (now, was) => (was ? ` (${now >= was ? '+' : ''}${Math.round(((now - was) / was) * 100)}%)` : '');

console.log('\nFrame budget (both eyes + the shadow pass)\n');
console.log(pad('view', 30) + padL('triangles', 22) + padL('draw calls', 18) + padL('shadow pass', 14));
for (const r of results) {
  const old = before?.find((b) => b.label === r.label);
  console.log(
    pad(r.label, 30) +
      padL(n(r.frame.triangles) + delta(r.frame.triangles, old?.frame.triangles), 22) +
      padL(r.frame.drawCalls + delta(r.frame.drawCalls, old?.frame.drawCalls), 18) +
      padL(`${Math.round((r.shadowPass.triangles / r.frame.triangles) * 100)}%`, 14),
  );
}
console.log('\nWhere the visible triangles are (one eye)\n');
for (const r of results) {
  const old = before?.find((b) => b.label === r.label);
  console.log(r.label);
  for (const [k, b] of Object.entries(r.buckets).sort((a, c) => c[1].triangles - a[1].triangles)) {
    if (b.triangles < 100) continue;
    console.log('  ' + pad(k, 18) + padL(n(b.triangles) + delta(b.triangles, old?.buckets[k]?.triangles), 18) + padL(`${b.meshes} meshes`, 14));
  }
  console.log('  heaviest: ' + r.top.slice(0, 5).map((m) => `${m.name} ${n(m.triangles)}`).join(', '));
}
fs.writeFileSync(path.join(out, 'budget.json'), JSON.stringify(results, null, 1));
console.log(`\nwrote ${path.join(out, 'budget.json')}${shots ? ' and the pictures beside it' : ''}`);
