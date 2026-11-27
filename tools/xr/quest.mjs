#!/usr/bin/env node
/**
 * Quest driver: runs the gallery in headless Chromium on Meta's Immersive Web
 * Emulation Runtime (IWER, the emulator behind Meta's Immersive Web SDK) as a
 * Quest 3 with two Touch Plus controllers, and lets a person or an agent
 * drive it step by step: put the headset somewhere, point a controller at a
 * thing and pull the trigger, grab, push the sticks, and screenshot exactly
 * what the headset sees.
 *
 *   node tools/xr/quest.mjs serve [--port 9555] [--query "?instant&asset=globe"] [--size 1280x720]
 *       then POST one JSON command at a time:
 *       curl -s localhost:9555 -d '{"cmd":"enter"}'
 *       curl -s localhost:9555 -d '{"cmd":"aim","hand":"right","at":"pedestal:globe"}'
 *       curl -s localhost:9555 -d '{"cmd":"press","hand":"right","button":"trigger"}'
 *       curl -s localhost:9555 -d '{"cmd":"shot","file":"look.png"}'
 *   node tools/xr/quest.mjs run steps.json [--out dir]   # a JSON array of commands
 *
 * Positions are in gallery (world) metres; "at"/"look" targets are either
 * [x, y, z] or the name of an object in the scene ("pedestal:globe",
 * "button:shake", "proxy:hero", "info-card", "table"), aimed at its centre.
 *
 * Commands
 *   enter                       press Enter VR and wait for the headset view
 *   exit                        end the session (as the Quest menu button would)
 *   head  {at?, look?, yaw?, pitch?}     put the headset (eye) at a spot / aim it
 *   aim   {hand, at, from?}     point a controller's ray at a target
 *   place {hand, at, look?}     put a controller (its ray origin) at a spot
 *   move  {hand|"head", to, ms} glide there over ms (grabs follow)
 *   press {hand, button, ms?}   press and release trigger|grip|a|b|x|y|stick
 *   down / up {hand, button}    hold / let go of a button
 *   stick {hand, x, y, ms?}     push a thumbstick (y -1 = forward) then release
 *   shake {hand, amplitude?, count?}    shake a controller up and down
 *   wait  {ms?, frames?}
 *   shot  {file?}               screenshot of the headset view (png)
 *   find  {name}                world centre and radius of a scene object
 *   ray   {hand}                what that controller's ray is pointing at
 *   state                       a summary of the app
 *   eval  {js}                  evaluate an expression in the page
 *   quit
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, launchArgs } from '../test/pw.mjs';
import { serve } from '../test/server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const IWER = path.join(ROOT, 'node_modules', 'iwer', 'build', 'iwer.min.js');

// IWER's remote API numbers only the controls a controller has (its own
// compact order, not the WebXR gamepad's), so controls are looked up by name
const BUTTONS = { trigger: ['trigger'], grip: ['squeeze'], squeeze: ['squeeze'], stick: ['thumbstick'], a: ['a', 'x'], x: ['x', 'a'], b: ['b', 'y'], y: ['y', 'b'] };
const DEVICE = { left: 'controller-left', right: 'controller-right', head: 'headset' };

/** in-page bootstrap: install the emulated Quest 3 before the app runs */
const BOOT = `
(() => {
  const d = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: false });
  d.installRuntime({ forceInstall: true });
  d.frameClearEnabled = false; // the app clears; lets a held frame be screenshotted
  d.position.set(0, 1.6, 0);
  window.__quest = d;
})();
`;

/** in-page helpers (three is loaded through the page's import map) */
async function helpers(page) {
  await page.evaluate(async () => {
    if (window.__qd) return;
    const THREE = await import('three');
    const app = window.__cc;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const qd = {
      THREE,
      /** world -> the headset's reference space (the rig carries the camera) */
      toXR(p) {
        app.rig.updateMatrixWorld(true);
        return app.rig.worldToLocal(new THREE.Vector3(p[0], p[1], p[2]));
      },
      fromXR(p) {
        app.rig.updateMatrixWorld(true);
        return app.rig.localToWorld(new THREE.Vector3(p.x, p.y, p.z));
      },
      rigQuat() {
        return app.rig.getWorldQuaternion(new THREE.Quaternion());
      },
      find(name) {
        const o = app.scene.getObjectByName(name);
        if (!o) return null;
        o.updateWorldMatrix(true, true);
        box.makeEmpty();
        box.expandByObject(o, true);
        if (box.isEmpty()) {
          o.getWorldPosition(v);
          return { center: v.toArray(), radius: 0 };
        }
        const c = box.getCenter(new THREE.Vector3());
        return { center: c.toArray(), radius: box.getSize(v).length() / 2 };
      },
      target(t) {
        if (Array.isArray(t)) return t;
        const f = qd.find(t);
        if (!f) throw new Error(`no object named "${t}"`);
        return f.center;
      },
      /** XR-space orientation that points -Z from a (world) toward b (world) */
      lookQuat(a, b) {
        const xa = qd.toXR(a), xb = qd.toXR(b);
        const m = new THREE.Matrix4().lookAt(xa, xb, new THREE.Vector3(0, 1, 0));
        return new THREE.Quaternion().setFromRotationMatrix(m);
      },
      yawPitchQuat(yaw, pitch) {
        const world = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
        return qd.rigQuat().invert().multiply(world);
      },
      headWorld() {
        const cam = app.renderer.xr.isPresenting ? app.renderer.xr.getCamera() : app.camera;
        const p = cam.getWorldPosition(new THREE.Vector3());
        const d = cam.getWorldDirection(new THREE.Vector3());
        return { pos: p.toArray().map((x) => +x.toFixed(3)), dir: d.toArray().map((x) => +x.toFixed(3)) };
      },
      controllerWorld(hand) {
        const c = window.__quest.controllers[hand];
        return qd.fromXR({ x: c.position.x, y: c.position.y, z: c.position.z }).toArray();
      },
      /** first named thing along a controller's ray */
      ray(hand) {
        const c = window.__quest.controllers[hand];
        const o = qd.fromXR(c.position);
        const q = qd.rigQuat().multiply(new THREE.Quaternion(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w));
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const rc = new THREE.Raycaster(o, dir, 0.01, 50);
        const named = (obj) => {
          for (let x = obj; x; x = x.parent) if (x.name && !/^(scene|rig)$/.test(x.name)) return x.name;
          return '(unnamed)';
        };
        const seen = (obj) => {
          for (let x = obj; x; x = x.parent) if (x.visible === false) return false;
          return true;
        };
        return rc
          .intersectObject(app.scene, true)
          .map((h) => ({ name: named(h.object), seen: seen(h.object) || /^proxy:/.test(h.object.name), distance: +h.distance.toFixed(3), point: h.point.toArray().map((x) => +x.toFixed(3)) }))
          .filter((h) => h.seen && !/^(xr-|pointer)/.test(h.name))
          .slice(0, 4)
          .map(({ seen, ...h }) => h);
      },
    };
    window.__qd = qd;
  });
}

/** open the gallery in a new page of `browser` with an emulated Quest 3 */
export async function openQuest(browser, url, { query = '?instant', size = [1280, 720], errors = [], out = process.cwd() } = {}) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GPU stall|ReadPixels/i.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript({ content: fs.readFileSync(IWER, 'utf8') + BOOT });
  // say so if the page ever goes somewhere or dies under us (helps diagnose CI)
  let loaded = false;
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame() && loaded) console.log(`  [quest] the page navigated to ${f.url()}`);
  });
  page.on('crash', () => console.log('  [quest] the page crashed'));
  await page.goto(url + 'index.html' + query, { waitUntil: 'load' });
  loaded = true;
  await page.waitForFunction(() => window.__cc && window.__cc.frame > 3, null, { timeout: 60000 });
  await helpers(page);
  const q = new Quest(page, { out });
  q.errors = errors;
  return q;
}

/** a browser and a static server of its own, with the gallery on a Quest 3 */
export async function launchQuest({ query = '?instant', size = [1280, 720], headless = true, out } = {}) {
  const { chromium } = await loadPlaywright();
  const { server, url } = await serve(ROOT);
  const browser = await chromium.launch({ args: launchArgs, headless });
  const q = await openQuest(browser, url, { query, size, out });
  q.close = async () => {
    await browser.close();
    server.close();
  };
  return q;
}

export class Quest {
  constructor(page, { out = process.cwd() } = {}) {
    this.page = page;
    this.out = out;
  }

  dispatch(method, params) {
    return this.page.evaluate(([m, p]) => window.__quest.remote.dispatch(m, p), [method, params]);
  }

  /** the remote-API index of a named control on a controller */
  async control(dev, kind, names) {
    this.layout ||= {};
    this.layout[dev] ||= await this.dispatch('get_gamepad_state', { device: dev });
    const list = this.layout[dev][kind];
    for (const n of names) {
      const c = list.find((x) => x.name === n);
      if (c) return c.index;
    }
    throw new Error(`${dev} has no ${names.join('/')} (${list.map((x) => x.name).join(', ')})`);
  }

  frames(n = 2) {
    return this.page.evaluate(async (n) => {
      const a = window.__cc;
      const f = a.frame;
      const t0 = performance.now();
      const stopped = () => document.getElementById('closed') && !document.getElementById('closed').classList.contains('hidden');
      while (a.frame < f + n && !stopped() && performance.now() - t0 < 120000) await new Promise((r) => setTimeout(r, 10));
    }, n);
  }

  /**
   * Run one command. On CI the page's script context has been seen to be
   * replaced (no navigation, no crash) while a command waited on IWER's frame
   * queue; if the app is still there, say so, re-attach and try once more,
   * and if it isn't, fail as before.
   */
  async run(c) {
    try {
      return await this.run1(c);
    } catch (e) {
      if (!/Execution context was destroyed/.test(String(e.message))) throw e;
      const info = await this.page
        .evaluate(() => ({ url: location.href, app: !!window.__cc, presenting: !!window.__cc?.renderer.xr.isPresenting, helpers: !!window.__qd, quest: !!window.__quest, frame: window.__cc?.frame }))
        .catch((err) => ({ error: String(err.message || err).split('\n')[0] }));
      console.log(`  [quest] the page's script context was replaced during "${c.cmd}": ${JSON.stringify(info)}`);
      if (!info.app) throw e;
      if (!info.helpers) await helpers(this.page);
      return await this.run1(c);
    }
  }

  async run1(c) {
    const p = this.page;
    const hand = c.hand || 'right';
    switch (c.cmd) {
      case 'enter': {
        await p.waitForFunction(() => !document.getElementById('btn-vr').disabled, null, { timeout: 60000 });
        await p.click('#btn-vr');
        await p.waitForFunction(() => window.__cc.renderer.xr.isPresenting, null, { timeout: 30000 });
        await this.frames(8);
        return { presenting: true, head: await p.evaluate(() => window.__qd.headWorld()) };
      }
      case 'exit':
        await this.dispatch('end_session', {});
        await p.waitForFunction(() => !window.__cc.renderer.xr.isPresenting, null, { timeout: 30000 });
        return { presenting: false };
      case 'head': {
        const r = await p.evaluate(({ at, look, yaw, pitch }) => {
          const qd = window.__qd;
          const params = { device: 'headset' };
          const cur = qd.headWorld().pos;
          const pos = at || cur;
          if (at) params.position = (({ x, y, z }) => ({ x, y, z }))(qd.toXR(at));
          let q = null;
          if (look) q = qd.lookQuat(pos, qd.target(look));
          else if (yaw !== undefined || pitch !== undefined) q = qd.yawPitchQuat(yaw || 0, pitch || 0);
          if (q) params.orientation = { x: q.x, y: q.y, z: q.z, w: q.w };
          return window.__quest.remote.dispatch('set_transform', params);
        }, c);
        await this.frames(3);
        return { ok: !!r, head: await p.evaluate(() => window.__qd.headWorld()) };
      }
      case 'aim':
      case 'place': {
        await p.evaluate(({ hand, at, from, look, cmd }) => {
          const qd = window.__qd;
          const head = qd.headWorld();
          const side = hand === 'left' ? -1 : 1;
          // default: where a relaxed hand sits, a little in front of the face
          const h = head.pos, d = head.dir;
          const rx = -d[2], rz = d[0]; // right of the view direction
          const rl = Math.hypot(rx, rz) || 1;
          const rest = [h[0] + d[0] * 0.3 + (side * 0.18 * rx) / rl, h[1] - 0.25, h[2] + d[2] * 0.3 + (side * 0.18 * rz) / rl];
          const origin = cmd === 'place' ? qd.target(at) : from ? qd.target(from) : rest;
          const aimAt = cmd === 'place' ? (look ? qd.target(look) : [origin[0] + d[0], origin[1] + d[1], origin[2] + d[2]]) : qd.target(at);
          const p = qd.toXR(origin);
          const q = qd.lookQuat(origin, aimAt);
          return window.__quest.remote.dispatch('set_transform', {
            device: hand === 'left' ? 'controller-left' : 'controller-right',
            position: { x: p.x, y: p.y, z: p.z },
            orientation: { x: q.x, y: q.y, z: q.z, w: q.w },
          });
        }, { ...c, hand });
        await this.frames(3);
        return { hand, controller: await p.evaluate((h) => window.__qd.controllerWorld(h), hand), ray: await p.evaluate((h) => window.__qd.ray(h), hand) };
      }
      case 'move': {
        const dev = c.hand === 'head' ? 'headset' : DEVICE[hand];
        const pos = await p.evaluate((to) => {
          const x = window.__qd.toXR(window.__qd.target(to));
          return { x: x.x, y: x.y, z: x.z };
        }, c.to);
        await this.dispatch('animate_to', { device: dev, position: pos, duration: (c.ms ?? 600) / 1000 });
        await this.frames(2);
        return { ok: true };
      }
      case 'press':
      case 'down':
      case 'up': {
        const names = BUTTONS[c.button || 'trigger'];
        if (!names) throw new Error(`unknown button ${c.button}`);
        const dev = DEVICE[hand];
        const index = await this.control(dev, 'buttons', names);
        const set = (value) => this.dispatch('set_gamepad_state', { device: dev, buttons: [{ index, value, touched: value > 0 }] });
        // a tap is one frame long: IWER puts a press and its release on
        // separate frames, and this headless GPU runs slowly, so waiting
        // between them would turn taps into holds
        if (c.cmd !== 'up') await set(1);
        if (c.cmd === 'press' && c.ms) {
          await this.frames(1);
          await p.waitForTimeout(c.ms);
        }
        // (a long press may have ended the session, e.g. holding B to exit)
        if (c.cmd !== 'down' && (await p.evaluate(() => window.__cc.renderer.xr.isPresenting))) await set(0);
        await this.frames(3);
        return { ok: true, presenting: await p.evaluate(() => window.__cc.renderer.xr.isPresenting), status: await p.evaluate(() => document.getElementById('status')?.textContent || '') };
      }
      case 'stick': {
        const dev = DEVICE[hand];
        const ix = await this.control(dev, 'axes', ['thumbstick-x']);
        const iy = await this.control(dev, 'axes', ['thumbstick-y']);
        await this.dispatch('set_gamepad_state', { device: dev, axes: [{ index: ix, value: c.x || 0 }, { index: iy, value: c.y || 0 }] });
        await this.frames(2);
        await p.waitForTimeout(c.ms ?? 500);
        await this.dispatch('set_gamepad_state', { device: dev, axes: [{ index: ix, value: 0 }, { index: iy, value: 0 }] });
        await this.frames(2);
        return { ok: true, head: await p.evaluate(() => window.__qd.headWorld()) };
      }
      case 'shake': {
        // quick up-down strokes, one per frame or so (whatever is held moves too)
        const dev = DEVICE[hand];
        const r = await p.evaluate(
          async ({ dev, amp, count, period }) => {
            const c = window.__quest.controllers[dev === 'controller-left' ? 'left' : 'right'].position;
            const base = { x: c.x, y: c.y, z: c.z };
            const moves = [];
            for (let i = 0; i < count; i++) moves.push(window.__quest.remote.dispatch('animate_to', { device: dev, position: { ...base, y: base.y + (i % 2 ? -amp : amp) }, duration: period }));
            moves.push(window.__quest.remote.dispatch('animate_to', { device: dev, position: base, duration: period }));
            await Promise.all(moves);
            return { strokes: count };
          },
          { dev, amp: c.amplitude ?? 0.12, count: c.count ?? 16, period: c.period ?? 0.12 },
        );
        await this.frames(2);
        return r;
      }
      case 'wait':
        if (c.frames) await this.frames(c.frames);
        if (c.ms) await p.waitForTimeout(c.ms);
        return { ok: true };
      case 'shot': {
        const file = path.resolve(this.out, c.file || `quest-${Date.now()}.png`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await this.frames(2);
        await p.evaluate(() => (window.__cc.paused = true));
        try {
          await p.screenshot({ path: file, timeout: 120000 });
        } finally {
          await p.evaluate(() => (window.__cc.paused = false));
        }
        return { file };
      }
      case 'find':
        return p.evaluate((n) => window.__qd.find(n), c.name);
      case 'ray':
        return p.evaluate((h) => window.__qd.ray(h), hand);
      case 'state':
        return p.evaluate(() => {
          const a = window.__cc;
          const s = a.stage;
          return {
            mode: a.mode,
            presenting: a.renderer.xr.isPresenting,
            asset: s.asset ? s.asset.info.id || s.asset.info.name : null,
            loading: s.loading ? s.loading.label : null,
            stageMode: s.mode,
            scale: +s.holder.scale.x.toFixed(5),
            grabbed: s.grabbed,
            status: document.getElementById('status')?.textContent || '',
            head: window.__qd.headWorld(),
            controllers: { left: window.__qd.controllerWorld('left').map((x) => +x.toFixed(3)), right: window.__qd.controllerWorld('right').map((x) => +x.toFixed(3)) },
            fps: a.stats?.fps,
            drawCalls: a.stats?.drawCalls,
          };
        });
      case 'eval':
        return p.evaluate((js) => (0, eval)(js), c.js);
      default:
        throw new Error(`unknown command ${c.cmd}`);
    }
  }
}

// ------------------------------------------------------------------ CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const opt = (k, d) => {
    const i = args.indexOf('--' + k);
    return i >= 0 ? args[i + 1] : d;
  };
  const mode = args[0];
  const size = opt('size', '1280x720').split('x').map(Number);
  const out = path.resolve(opt('out', process.cwd()));
  if (mode === 'serve') {
    const q = await launchQuest({ query: opt('query', '?instant'), size, out });
    const port = Number(opt('port', 9555));
    let chain = Promise.resolve();
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        chain = chain.then(async () => {
          let reply;
          try {
            const c = JSON.parse(body || '{"cmd":"state"}');
            if (c.cmd === 'quit') {
              res.end('{"bye":true}\n');
              await q.close();
              process.exit(0);
            }
            reply = { ok: true, result: await q.run(c) };
          } catch (e) {
            reply = { ok: false, error: String(e.message || e).split('\n')[0] };
          }
          if (q.errors.length) reply.pageErrors = q.errors.splice(0);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(reply) + '\n');
        });
      });
    });
    srv.listen(port, '127.0.0.1', () => console.log(`quest driver listening on http://127.0.0.1:${port}/`));
  } else if (mode === 'run') {
    const steps = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const q = await launchQuest({ query: opt('query', '?instant'), size, out });
    let failed = false;
    for (const c of steps) {
      try {
        const r = await q.run(c);
        console.log(JSON.stringify({ cmd: c.cmd, result: r }));
      } catch (e) {
        failed = true;
        console.log(JSON.stringify({ cmd: c.cmd, error: String(e.message || e).split('\n')[0] }));
        break;
      }
    }
    if (q.errors.length) console.log(JSON.stringify({ pageErrors: q.errors }));
    await q.close();
    process.exit(failed ? 1 : 0);
  } else {
    console.log('usage: node tools/xr/quest.mjs serve [--port 9555] [--query "?instant"] [--size 1280x720] [--out dir]\n       node tools/xr/quest.mjs run steps.json [--out dir]');
    process.exit(2);
  }
}
