#!/usr/bin/env node
/**
 * Inspection tour of the snow globe's "Up close" view on the emulated
 * Quest 3: the same viewpoints every time (round the walkway, leaning over
 * the rail, in front of particular houses, down a street, under the
 * island), screenshotted, plus the numbers that matter on a headset.
 *
 *   node tools/xr/tour.mjs --out shots/before [--only gate,house-0]
 *
 * Compare two runs side by side to check a change really landed.
 */
import path from 'node:path';
import fs from 'node:fs';
import { launchQuest } from './quest.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const out = path.resolve(opt('out', 'tour'));
const only = opt('only', '') ? opt('only').split(',') : null;
fs.mkdirSync(out, { recursive: true });

const q = await launchQuest({ query: '?instant&asset=globe', size: [1024, 1024], out });
const run = (c) => q.run(c);
const p = q.page;
await p.waitForFunction(() => window.__cc.stage.asset?.info.id === 'globe' && !window.__cc.stage.loading, null, { timeout: 300000 });
await run({ cmd: 'enter' });
await run({ cmd: 'aim', hand: 'right', at: 'button:life' });
await run({ cmd: 'press', hand: 'right', button: 'trigger' });
await p.waitForFunction(() => !window.__cc.stage.tween && window.__cc.stage.mode === 'life', null, { timeout: 90000 });
// hands down out of the way
await run({ cmd: 'aim', hand: 'right', at: [0, -5, 9] });
await run({ cmd: 'aim', hand: 'left', at: [0, -5, 9] });

// viewpoints, worked out in the page from the town's real layout
const views = await p.evaluate(async () => {
  const { T, topHeight } = await import('/library/globe/terrain.js');
  const a = window.__cc.stage.asset;
  const THREE = window.__qd.THREE;
  const island = a.debug.island;
  island.updateWorldMatrix(true, false);
  const w = (x, y, z) => island.localToWorld(new THREE.Vector3(x, y, z)).toArray();
  const gate = T.gateA;
  const ring = (ang, r, y) => [Math.cos(ang) * r, y, Math.sin(ang) * r];
  const c = w(0, 0, 0);
  const v = [
    { name: 'gate', at: ring(gate, 4, 1.6), look: [0, c[1] + 0.25, 0] },
    { name: 'side', at: ring(gate + 1.3, 3.6, 1.6), look: [0, c[1] + 0.15, 0] },
    { name: 'back', at: ring(gate + Math.PI, 3.6, 1.6), look: [0, c[1] + 0.15, 0] },
    { name: 'lean-a', at: ring(gate - 1.0, 2.75, 1.3), look: ring(gate - 1.0, 1.5, c[1] + 0.05) },
    { name: 'lean-b', at: ring(gate + 2.2, 2.75, 1.3), look: ring(gate + 2.2, 1.5, c[1] + 0.05) },
    { name: 'over', at: ring(gate + 0.5, 3.3, 2.1), look: [0, c[1], 0] },
    // crouching at the rail, looking up under the island
    { name: 'under', at: ring(gate - 0.4, 3.2, 0.45), look: [0, c[1] - 0.9, 0] },
  ];
  // in front of a few houses of different styles (their fronts face the
  // street), only where nothing stands in the way of the camera
  const houses = a.debug.houses;
  const town = island.getObjectByName('town');
  const rc = new THREE.Raycaster();
  const scale = window.__cc.stage.holder.scale.x;
  // the camera hangs over the street in front, looking down at the front
  // (like leaning over the town); nothing may be in between
  const frontView = (h, out = 5, up = 4) => {
    const nx = Math.sin(h.yaw), nz = Math.cos(h.yaw);
    const fx = h.x + nx * (h.d / 2), fz = h.z + nz * (h.d / 2);
    return { at: w(fx + nx * out, h.y + h.wallsH * 0.5 + up, fz + nz * out), look: w(fx, h.y + h.wallsH * 0.5, fz) };
  };
  const clear = (h) => {
    const { at, look } = frontView(h);
    const a0 = new THREE.Vector3(...look), a1 = new THREE.Vector3(...at);
    const dir = a1.clone().sub(a0);
    const dist = dir.length();
    rc.set(a0.addScaledVector(dir.normalize(), 0.3 * scale), dir);
    rc.far = dist - 0.3 * scale;
    return rc.intersectObject(town, true).length === 0;
  };
  const picks = [];
  for (const style of [0, 1, 2, 3]) {
    const h = houses.find((x) => x.style === style && x.floors >= 2 && !picks.includes(x) && clear(x)) || houses.find((x) => x.style === style && !picks.includes(x) && clear(x));
    if (h) picks.push(h);
  }
  picks.forEach((h, i) => v.push({ name: `house-${i}`, style: h.style, ...frontView(h) }));
  // closer: one house's door and its eaves
  if (picks[0]) {
    const h = picks[0];
    const nx = Math.sin(h.yaw), nz = Math.cos(h.yaw);
    const fx = h.x + nx * (h.d / 2), fz = h.z + nz * (h.d / 2);
    v.push({ name: 'door', at: w(fx + nx * 2.0, h.y + 2.7, fz + nz * 2.0), look: w(fx, h.y + 1.2, fz) });
    v.push({ name: 'eaves', at: w(fx + nx * 2.6, h.y + h.wallsH + 1.6, fz + nz * 2.6), look: w(fx, h.y + h.wallsH, fz) });
  }
  // a balcony, a shop sign, string lights and a snowman, up close
  const find = (k) => houses.find((h) => h[k] && clear(h));
  for (const k of ['balcony', 'sign', 'lights']) {
    const h = find(k);
    if (h) v.push({ name: k, ...frontView(h, k === 'lights' ? 6 : 3.5, k === 'lights' ? 5 : 3) });
  }
  const sm = a.debug.snowmen[0];
  if (sm) {
    // from outside, over the wall, as you'd lean in from the walkway
    const l = Math.hypot(sm[0], sm[2]);
    const ox = sm[0] / l, oz = sm[2] / l;
    v.push({ name: 'snowman', at: w(sm[0] + ox * 6, sm[1] + 7, sm[2] + oz * 6), look: w(sm[0], sm[1] + 0.9, sm[2]) });
    v.push({ name: 'snowman-close', at: w(sm[0] + ox * 1.6 + oz * 1.2, sm[1] + 1.9, sm[2] + oz * 1.6 - ox * 1.2), look: w(sm[0], sm[1] + 0.9, sm[2]) });
    v.push({ name: 'snowman-2', at: w(a.debug.snowmen[1][0] * 1.2, a.debug.snowmen[1][1] + 7, a.debug.snowmen[1][2] * 1.2), look: w(a.debug.snowmen[1][0], a.debug.snowmen[1][1] + 0.9, a.debug.snowmen[1][2]) });
  }
  // down the lower ring street
  const hill = T.hill;
  const sa = gate - 0.6;
  const sx = hill[0] + Math.cos(sa) * 20.1, sz = hill[1] + Math.sin(sa) * 20.1;
  const ta = sa + 0.35;
  const tx = hill[0] + Math.cos(ta) * 20.1, tz = hill[1] + Math.sin(ta) * 20.1;
  v.push({ name: 'street', at: w(sx, topHeight(sx, sz) + 2.2, sz), look: w(tx, topHeight(tx, tz) + 1.0, tz) });
  return v;
});

for (const vw of views) {
  if (only && !only.includes(vw.name)) continue;
  await run({ cmd: 'head', at: vw.at, look: vw.look });
  // tuck the controllers behind the camera so they never block the view
  const d = [vw.look[0] - vw.at[0], vw.look[1] - vw.at[1], vw.look[2] - vw.at[2]];
  const l = Math.hypot(...d);
  const behind = (side) => [vw.at[0] - (d[0] / l) * 0.6 + side * 0.2, vw.at[1] - 0.3, vw.at[2] - (d[2] / l) * 0.6];
  await run({ cmd: 'place', hand: 'right', at: behind(1), look: [vw.at[0] - d[0], vw.at[1] - 1, vw.at[2] - d[2]] });
  await run({ cmd: 'place', hand: 'left', at: behind(-1), look: [vw.at[0] - d[0], vw.at[1] - 1, vw.at[2] - d[2]] });
  await run({ cmd: 'wait', frames: 3 });
  await run({ cmd: 'shot', file: `${vw.name}.png` });
  console.log('shot', vw.name, vw.style ?? '');
}

const stats = await p.evaluate(() => {
  const a = window.__cc.stage.asset;
  const count = (root) => {
    let t = 0;
    root.traverse((o) => {
      if (o.isMesh && o.visible && o.geometry) {
        const g = o.geometry;
        const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        t += n * (o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? 0 : 1);
      }
    });
    return Math.round(t);
  };
  const town = a.root.getObjectByName('town');
  const per = {};
  town.traverse((o) => {
    if (o.isMesh && o.geometry) per[o.name] = Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3);
  });
  return { townTris: count(town), assetTris: count(a.root), drawCalls: window.__cc.stats.drawCalls, sceneTris: window.__cc.stats.triangles, per };
});
const build = await p.evaluate(async () => {
  const { buildTown, townUniforms } = await import('/library/globe/town.js');
  const { MaterialKit } = await import('/library/core/materials.js');
  const k = new MaterialKit();
  const t0 = performance.now();
  const t = await buildTown(k, townUniforms(), { lod: 'hero' });
  const ms = performance.now() - t0;
  t.group.traverse((o) => o.geometry?.dispose());
  k.dispose?.();
  return Math.round(ms);
});
stats.townBuildMs = build;
console.log(JSON.stringify(stats, null, 1));
fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(stats, null, 1));
if (q.errors.length) console.log('page errors:', q.errors);
await q.close();
