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

/**
 * Walk the live session down the quality ladder with fed slow frames (the
 * automatic fall-back is off under automation, where every software-rendered
 * frame is slow), then feed more slow and good frames to show it stays put.
 */
async function driveLadder(page) {
  await page.waitForFunction(() => !window.__cc.stage.tween && !window.__cc.stage.loading, null, { timeout: 60000 }).catch(() => {});
  return page.evaluate(async () => {
    const q = window.__cc.quality;
    const xr = window.__cc.renderer.xr;
    // (each phase is one synchronous run, so no real frame interleaves)
    const until = (ms, limit) => {
      const r0 = q.state.rung;
      let fed = 0;
      while (q.state.rung === r0 && fed < limit) {
        q.feed(ms);
        fed += ms;
      }
      return fed;
    };
    const r = { auto: q.state.auto, rung0: q.state.rung, rate0: xr.getSession().frameRate };
    r.fed1 = until(25, 20000);
    r.rung1 = q.state.rung;
    await q.pending;
    r.rate1 = xr.getSession().frameRate;
    r.fov1 = xr.getFoveation();
    r.fed2 = until(25, 20000);
    r.rung2 = q.state.rung;
    r.fov2 = xr.getFoveation();
    q.feed(25, 40 * 20);
    q.feed(1000 / 90, 90 * 20);
    r.rung3 = q.state.rung;
    r.fov3 = xr.getFoveation();
    r.rate3 = xr.getSession().frameRate;
    r.steps = q.state.steps.map((s) => s.step).join(', ');
    // under automation the "90 Hz did not hold" record is never written
    r.stored = q.state.steps[0]?.stored;
    try {
      r.record = localStorage.getItem('curio-cabinet:quality');
    } catch (e) {
      r.record = 'unreadable';
    }
    return r;
  });
}
const ladderOk = (r) => !r.auto && r.rung0 === 0 && r.rate0 === 90 && r.rung1 === 1 && r.rate1 === 72 && r.fov1 === 0.6 && r.rung2 === 2 && r.fov2 === 1 && r.rung3 === 2 && r.fov3 === 1 && r.rate3 === 72 && r.stored === false && r.record === null;
const ladderMsg = (r) => `fed slow frames, the live session first goes back ${r.rate0} -> ${r.rate1} Hz with foveation ${r.fov1} (after ${(r.fed1 / 1000).toFixed(2)} s), then foveation -> ${r.fov2} (after ${(r.fed2 / 1000).toFixed(2)} s more), stays there through 20 s more slow and 20 s good frames (${r.steps}), and stores no 90 Hz record under automation (localStorage: ${r.record})`;

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
// ------------------------------------------------- the carousel horse's mane
// (pure geometry, no browser) a mane grows from the crest, the top line of
// the neck, and falls to the side: along the whole neck the hair must cover
// the crest and stand proud of it, with no bare strip down the middle
console.log("\n▶ The horses' manes");
{
  const { layers } = await import('../../library/carousel/horseModel.js');
  const body = layers.body.sdf, mane = layers.mane.sdf;
  const OXH = -0.06;
  const top = (f, x, z) => {
    for (let y = 1.0; y > 0; y -= 0.002) if (f(x + OXH, y, z) < 0) return y;
    return null;
  };
  let bare = 0, buried = 0, n = 0;
  for (let x = 0.34; x <= 0.62; x += 0.04) {
    const bt = top(body, x, 0), mt = top(mane, x, 0);
    if (mt === null || mt < bt + 0.01) buried++;
    // across the top of the neck: hair over the body at every point of the crest band
    for (let z = -0.06; z <= 0.061; z += 0.02) {
      n++;
      const b = top(body, x, z), m = top(mane, x, z);
      if (m === null || (b !== null && m <= b + 0.003)) bare++;
    }
  }
  check(buried === 0 && bare === 0, `the mane covers the crest from withers to poll (${n} points across the top of the neck: ${bare} bare, ${buried} places where the hair sinks into the neck)`);
  // and as the carousel actually draws it: meshed at each level of detail,
  // seen from straight above, it's hair all the way across the crest
  const { maneCoverage } = await import('./maneCoverage.js');
  const { HORSE_CELLS } = await import('../../library/carousel/dimensions.js');
  for (const [level, cell] of Object.entries(HORSE_CELLS)) {
    const r = maneCoverage(layers, cell);
    check(r.bare === 0, `meshed at the ${level} level (cell ${cell}), the neck shows through the mane at ${r.bare} of ${r.n} points down the crest`);
    if (r.bare) console.log(r.map.map((row) => '      ' + row).join('\n'));
  }
}

// ------------------------------------------- VR frame rate and quality ladder
// (plain arithmetic, no browser) src/app/Quality.js against a fake renderer and
// session: it asks for 90 Hz, steps back to 72 Hz and then to stronger
// foveation when frames keep missing, never steps back up, remembers for 14
// days that 90 Hz did not hold, and ignores the frames that are meant to be
// slow. Its clock is the sum of the intervals it is fed.
console.log('\n▶ VR frame rate and quality ladder (no browser)');
{
  const { Quality, RULE, MEMORY } = await import('../../src/app/Quality.js');
  const memory = () => {
    const m = new Map();
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  };
  const DAY = 24 * 3600 * 1000;
  const fakeSession = (rates = [72, 80, 90, 120], rate = 72) => {
    const on = {};
    return {
      supportedFrameRates: rates && new Float32Array(rates),
      frameRate: rate,
      visibilityState: 'visible',
      asked: [],
      on,
      updateTargetFrameRate(r) {
        this.asked.push(r);
        this.frameRate = r;
        return Promise.resolve();
      },
      addEventListener(type, f) { on[type] = f; },
      removeEventListener(type) { delete on[type]; },
    };
  };
  const make = (query = '', session = fakeSession(), opts = { auto: true }) => {
    const xr = {
      fov: 0.6, calls: [],
      setFoveation(v) { this.fov = v; this.calls.push(`fov ${v}`); },
      getFoveation() { return this.fov; },
      setFramebufferScaleFactor(v) { this.calls.push(`scale ${v}`); },
    };
    const app = { params: new URLSearchParams(query), paused: false, renderer: { xr }, stage: { loading: null, mode: 'toy', tween: null } };
    const q = new Quality(app, { storage: memory(), ...opts });
    return { app, q, xr, session };
  };
  // feed `ms` intervals until the rung changes or `limit` ms pass; returns the ms fed
  const until = (q, ms, limit) => {
    const r0 = q.state.rung;
    let fed = 0;
    while (q.state.rung === r0 && fed < limit) {
      q.feed(ms);
      fed += ms;
    }
    return fed;
  };
  // catch the controller's own console lines (and keep everything else printing)
  const log = console.log, warn = console.warn;
  const logged = [];
  const spy = (orig) => (...a) => {
    const l = a.join(' ');
    if (l.startsWith('[quality]')) logged.push(l);
    else orig(...a);
  };
  console.log = spy(log);
  console.warn = spy(warn);
  const near = (a, b) => Math.abs(a - b) <= 25; // within one fed frame
  try {
    const SLOW = 25, OK = 1000 / 90; // a 25 ms interval misses at 90 Hz (limit 15.6 ms) and at 72 Hz (19.4 ms)
    // asks for 90 Hz and reads back what was applied
    let { q, xr, session } = make();
    check(xr.calls.length === 0, `with no URL options it sets neither foveation nor render scale (${xr.calls.join(', ') || 'no calls'})`);
    q.start(session);
    await q.pending;
    check(session.asked.join() === '90' && q.state.requested === 90 && q.state.rate === 90, `a session that runs at 72 Hz is asked for 90 and reports ${q.state.rate} Hz`);
    // healthy frames, and a sixth of frames missing, never step; a quarter does
    q.feed(OK, 90 * 60);
    for (let i = 0; i < 90 * 60 / 6; i++) {
      q.feed(OK, 5);
      q.feed(16, 1);
    }
    check(q.state.rung === 0 && q.state.windows > 30, `a minute on time, then a minute with one frame in six at 16 ms: no step (${q.state.windows} verdicts, ${q.state.misses} misses)`);
    for (let i = 0; i < 90 * 10 / 4 && q.state.rung === 0; i++) {
      q.feed(OK, 3);
      q.feed(16, 1);
    }
    check(q.state.rung === 1 && Math.abs(q.state.steps[0]?.missed - 0.25) < 0.02, `one frame in four at 16 ms does step (${q.state.steps[0]?.missed} of a window missed)`);
    // sustained slow frames: back to 72 Hz first, then foveation, then nothing more
    let wall = Date.UTC(2026, 10, 1);
    const store = memory();
    ({ q, xr, session } = make('', fakeSession(), { auto: true, storage: store, clock: () => wall }));
    q.start(session);
    await q.pending;
    logged.length = 0;
    let fed = until(q, SLOW, 60000);
    await q.pending;
    check(q.state.rung === 1 && session.asked.join() === '90,72' && q.state.rate === 72 && xr.fov === 0.6 && near(fed, RULE.startHold + RULE.window), `slow frames from the start: after the ${RULE.startHold / 1000} s start-up hold and one ${RULE.window / 1000} s window (${fed} ms) it goes back to ${q.state.rate} Hz with foveation ${xr.fov}, exactly the browser default`);
    check(/^\[quality\] 100% of frames over 15\.6 ms for 3 s at 90 Hz: frame rate 90 -> 72 Hz$/.test(logged[0]), `and logs one line: "${logged[0]}"`);
    const rec = JSON.parse(store.getItem(MEMORY.key) || 'null');
    check(rec?.rate === 90 && rec?.at === wall && q.state.steps[0].stored === true, `and remembers that 90 Hz did not hold (${store.getItem(MEMORY.key)})`);
    fed = until(q, SLOW, 60000);
    check(q.state.rung === 2 && xr.fov === 1 && near(fed, RULE.settle + RULE.window), `still slow at 72 Hz: after ${RULE.settle / 1000} s to settle and another window (${fed} ms) foveation goes 0.6 -> ${xr.fov}`);
    check(/^\[quality\] 100% of frames over 19\.4 ms for 3 s at 72 Hz: foveation 0\.6 -> 1$/.test(logged[1]), `and logs: "${logged[1]}"`);
    q.feed(SLOW, 40 * 60);
    q.feed(OK, 90 * 120);
    check(q.state.rung === 2 && q.state.steps.length === 2 && xr.fov === 1 && session.frameRate === 72 && session.asked.length === 2, `then nothing: no rung below that, and two minutes of good frames do not step back up (${q.state.steps.map((s) => s.step).join(', ')})`);
    check(logged.filter((l) => l.startsWith('[quality]')).length === 2, 'one console line per step');
    // the next session: foveation restored, 90 Hz skipped while the record is young
    q.end();
    check(xr.fov === 0.6, `ending the session puts foveation back to ${xr.fov}`);
    wall += 13 * DAY;
    session = fakeSession();
    logged.length = 0;
    q.start(session);
    await q.pending;
    check(q.state.rung === 0 && q.state.steps.length === 0 && session.asked.length === 0 && q.state.remembered === true && q.state.rate === 72, `13 days later the next session skips the 90 Hz request and stays at ${q.state.rate} Hz (remembered)`);
    check(logged.length === 1 && /^\[quality\] 90 Hz did not hold here recently: staying at 72 Hz until 2026-11-15 \(\?hz=90 forces it\)$/.test(logged[0]), `and says so once: "${logged[0]}"`);
    fed = until(q, SLOW, 60000);
    check(q.state.rung === 2 && q.state.steps.map((s) => s.step).join() === 'foveation' && near(fed, RULE.startHold + RULE.window), 'at 72 Hz the only rung is foveation');
    q.end();
    wall += 1 * DAY;
    session = fakeSession();
    q.start(session);
    await q.pending;
    check(session.asked.join() === '90' && q.state.remembered === false && q.state.rate === 90 && store.getItem(MEMORY.key) === null, 'after 14 days the record expires (and is removed): the next session asks for 90 Hz again');
    // a forced ?hz= ignores the record
    for (const hz of [90, 72]) {
      const st = memory();
      st.setItem(MEMORY.key, JSON.stringify({ rate: 90, at: wall }));
      ({ q, xr, session } = make(`?hz=${hz}`, fakeSession(), { auto: true, storage: st, clock: () => wall }));
      q.start(session);
      await q.pending;
      check(session.asked.join() === String(hz) && q.state.remembered === false, `?hz=${hz} ignores a fresh record and asks for ${hz} Hz`);
    }
    // a broken store never gets in the way
    {
      const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('denied'); } };
      ({ q, xr, session } = make('', fakeSession(), { auto: true, storage: bad }));
      q.start(session);
      await q.pending;
      until(q, SLOW, 60000);
      await q.pending;
      const junk = memory();
      junk.setItem(MEMORY.key, '{not json');
      const r2 = make('', fakeSession(), { auto: true, storage: junk });
      r2.q.start(r2.session);
      await r2.q.pending;
      check(session.asked.join() === '90,72' && q.state.steps[0].stored === false && r2.session.asked.join() === '90' && junk.getItem(MEMORY.key) === null, 'a store that throws, or holds junk, is ignored (and the junk removed)');
    }
    // loading a curio: never steps, and holds for a while after
    ({ q, xr, session } = make());
    q.start(session);
    await q.pending;
    q.feed(OK, 90 * 5);
    q.app.stage.loading = { label: 'opening the crate' };
    q.feed(SLOW, 40 * 30);
    const during = q.state.ignored;
    q.app.stage.loading = null;
    fed = until(q, SLOW, 60000);
    check(q.state.steps.length === 1 && during >= 40 * 30 && near(fed, RULE.loadHold + RULE.window), `30 s of slow frames while a curio loads: no step; after it finishes, ${RULE.loadHold / 1000} s hold and a window (${fed} ms) before the first step`);
    // switching to the big view, and its tween
    ({ q, xr, session } = make());
    q.start(session);
    await q.pending;
    q.feed(10, 400); // on time until the start-up hold ends (exactly 4 s)
    q.feed(SLOW, 100); // 2.5 s into a window...
    q.app.stage.mode = 'life';
    q.app.stage.tween = {};
    q.feed(SLOW, 40 * 3);
    q.app.stage.tween = null;
    fed = until(q, SLOW, 60000);
    check(q.state.steps.length === 1 && near(fed, RULE.viewHold + RULE.window), `switching to the big view restarts the window: no step during the tween, then ${RULE.viewHold / 1000} s hold and a window (${fed} ms)`);
    // paused (test hook), not visible, and long gaps
    ({ q, xr, session } = make());
    q.start(session);
    await q.pending;
    q.app.paused = true;
    q.feed(SLOW, 40 * 30);
    q.app.paused = false;
    session.visibilityState = 'visible-blurred';
    session.on.visibilitychange();
    q.feed(SLOW, 40 * 30);
    session.visibilityState = 'visible';
    session.on.visibilitychange();
    check(q.state.rung === 0 && q.state.misses === 0, `30 s paused and 30 s not visible (system menu): nothing counted, no step (${q.state.ignored} frames ignored)`);
    let now = 1000;
    q.frame(now);
    for (let i = 0; i < 30; i++) q.frame((now += 5000)); // headset off: a frame every 5 s
    for (let i = 0; i < 40; i++) {
      for (let k = 0; k < 9; k++) q.frame((now += SLOW));
      q.frame((now += 400)); // a hitch every tenth frame: each one restarts the hold
    }
    check(q.state.rung === 0 && q.state.gaps === 70 && q.state.misses === 0, `long gaps between frames (headset off, tab hidden) are not misses and never step (${q.state.gaps} gaps)`);
    // the fall-back is off under automation, but frames are still counted
    ({ q, xr, session } = make('', fakeSession(), { auto: false }));
    q.start(session);
    await q.pending;
    now = 0;
    q.frame(now);
    for (let i = 0; i < 40 * 60; i++) q.frame((now += 100)); // a minute at 10 fps, like the software-rendered emulators
    check(q.state.rung === 0 && q.state.misses > 500 && session.frameRate === 90, `with the fall-back off (automation), a minute at 10 fps counts ${q.state.misses} misses and changes nothing`);
    fed = until(q, SLOW, 60000);
    check(q.state.rung === 1 && near(fed, RULE.window), `but fed intervals still drive the ladder (the test hook): one window (${fed} ms), one step`);
    // URL overrides
    ({ q, xr, session } = make('?hz=72'));
    q.start(session);
    await q.pending;
    q.feed(SLOW, 40 * 60);
    check(session.asked.join() === '72' && q.state.steps.map((s) => s.step).join() === 'foveation', `?hz=72 asks for 72 Hz and keeps it: only foveation steps (${q.state.steps.map((s) => s.step).join(', ')})`);
    ({ q, xr, session } = make('?fov=0.8'));
    const fovCalls = xr.calls.join();
    q.start(session);
    await q.pending;
    q.feed(SLOW, 40 * 60);
    await q.pending;
    check(fovCalls === 'fov 0.8' && xr.fov === 0.8 && q.state.steps.map((s) => s.step).join() === 'rate' && session.frameRate === 72, `?fov=0.8 fixes foveation: the only step is the rate (${q.state.steps.map((s) => s.step).join(', ')})`);
    ({ q, xr, session } = make('?hz=90&fov=0'));
    q.start(session);
    await q.pending;
    q.feed(SLOW, 40 * 60);
    check(xr.fov === 0 && q.state.rung === 0 && q.state.misses > 2000, '?hz=90&fov=0: both fixed (0 is a valid foveation), slow frames change nothing');
    ({ q, xr, session } = make('?scale=1.25'));
    check(xr.calls.join() === 'scale 1.25' && q.state.scale === 1.25, `?scale=1.25 sets the render scale before any session (${xr.calls.join()})`);
    ({ q, xr, session } = make('?hz=60&fov=2&scale=3'));
    q.start(session);
    await q.pending;
    check(xr.calls.length === 0 && session.asked.join() === '90', 'out-of-range ?hz=60&fov=2&scale=3 are ignored');
    ({ q, xr, session } = make('?hz=120', fakeSession([72, 80, 90])));
    q.start(session);
    check(session.asked.length === 0 && logged.some((l) => l.includes('?hz=120: not offered')), 'a forced rate the headset does not offer is not requested (and says so)');
    // browsers without the frame-rate API, or with a broken one
    ({ q, xr, session } = make('', { addEventListener() {}, removeEventListener() {} }));
    q.start(session);
    q.feed(SLOW, 40 * 60);
    check(q.state.requested === null && q.state.rate === null && q.state.rung === 0, 'no frame-rate API: nothing requested, and with no known frame time nothing steps');
    ({ q, xr, session } = make('', fakeSession([72, 80])));
    q.start(session);
    check(session.asked.length === 0, '90 Hz not offered: the default rate is left alone');
    let unhandled = 0;
    const onUnhandled = () => unhandled++;
    process.on('unhandledRejection', onUnhandled);
    for (const bad of [() => { throw new Error('nope'); }, () => Promise.reject(new Error('nope'))]) {
      ({ q, xr, session } = make());
      session.updateTargetFrameRate = bad;
      q.start(session);
      await q.pending;
    }
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', onUnhandled);
    check(unhandled === 0 && q.state.rate === 72 && !q.switching, 'updateTargetFrameRate throwing or rejecting is caught; the session carries on at its own rate');
    // a refused 72 Hz request is recorded as such, and the session carries on
    ({ q, xr, session } = make());
    q.start(session);
    await q.pending;
    session.updateTargetFrameRate = () => Promise.reject(new Error('refused'));
    until(q, SLOW, 60000);
    await q.pending;
    check(q.state.rung === 1 && q.state.steps[0]?.failed === true && q.state.steps[0].stored === false && q.state.rate === 90 && !q.switching, `a refused rate step is marked failed, writes no record, and the rate stays ${q.state.rate} Hz`);
    until(q, SLOW, 60000);
    check(q.state.rung === 2 && xr.fov === 1, 'and the ladder carries on to foveation');
    // the headset path: real frame times through frame(), fall-back armed by default
    ({ q, xr, session } = make('', fakeSession(), {}));
    check(q.auto === true && q.state.auto === true, 'outside automation (no navigator.webdriver, no emulator) the fall-back is armed by default');
    q.start(session);
    await q.pending;
    now = 0;
    q.frame(now);
    while (q.state.rung === 0 && now < 60000) q.frame((now += SLOW));
    await q.pending;
    check(q.state.rung === 1 && session.frameRate === 72 && near(now, RULE.startHold + RULE.window), `frame(performance.now()) at 40 fps steps on its own, after ${now} ms`);
    // desktop: no session, nothing happens
    ({ q, xr, session } = make());
    for (let i = 0; i < 100; i++) q.frame(i * 100);
    check(q.state.frames === 0 && !q.state.active, 'outside VR it does nothing');
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

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
  await page.waitForFunction(() => window.__cc.quality.state.rate === 90, null, { timeout: 30000 }).catch(() => {});
  const hz = await page.evaluate(() => ({ ...window.__cc.quality.state, session: window.__cc.renderer.xr.getSession().frameRate }));
  check(hz.requested === 90 && hz.rate === 90 && hz.session === 90, `entering VR asks for 90 Hz and gets it (this emulator starts at 72 and offers ${hz.supported?.join(', ')}; now ${hz.session} Hz)`);
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
  const qa = await page.evaluate(() => {
    const st = window.__cc.quality.state;
    const xr = window.__cc.renderer.xr;
    return { auto: st.auto, rung: st.rung, steps: st.steps.length, frames: st.frames, misses: st.misses, gaps: st.gaps, ignored: st.ignored, fov: xr.getFoveation(), rate: xr.getSession().frameRate };
  });
  check(!qa.auto && qa.rung === 0 && qa.steps === 0 && qa.fov === 0.6 && qa.rate === 90, `under automation the fall-back stays off: of ${qa.frames} software-GL frames, ${qa.misses} missed, ${qa.gaps} were gaps over 250 ms, ${qa.ignored} fell in a hold-off; no step (foveation ${qa.fov}, ${qa.rate} Hz)`);
  // the during-load rule on the live app without racing a real build: a
  // stand-in stage.loading held for one synchronous feed (no frame can
  // interleave), then restored; good frames afterwards show the hold ends
  const held = await page.evaluate(() => {
    const a = window.__cc;
    const q = a.quality;
    const prev = a.stage.loading;
    const i0 = q.state.ignored;
    a.stage.loading = prev || { label: 'test stand-in', progress: 0 };
    try {
      q.feed(25, 40 * 30);
    } finally {
      a.stage.loading = prev;
    }
    const r = { rung: q.state.rung, steps: q.state.steps.length, ignored: q.state.ignored - i0 };
    const i1 = q.state.ignored;
    q.feed(1000 / 90, 90 * 5);
    r.counted = 90 * 5 - (q.state.ignored - i1);
    r.rungAfter = q.state.rung;
    r.restored = a.stage.loading === prev;
    return r;
  });
  check(held.rung === 0 && held.steps === 0 && held.ignored === 1200 && held.counted > 0 && held.rungAfter === 0 && held.restored, `30 s of slow frames fed while stage.loading is set: all ${held.ignored} ignored, no step; once it clears, ${held.counted} of the next 450 good frames count (after the 3 s load hold)`);

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
  const ladder = await driveLadder(page);
  check(ladderOk(ladder), ladderMsg(ladder));
  await page.evaluate(() => window.__xrEmu.setButton('right', 5, true));
  await page.waitForFunction(() => window.__cc.closed, null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(() => window.__xrEmu.setButton('right', 5, false));
  check(await page.evaluate(() => window.__cc.closed && !window.__cc.renderer.xr.isPresenting), 'holding B exits');
  const after = await page.evaluate(() => window.__cc.quality.state);
  check(!after.active && after.foveation === 0.6, `ending the session puts foveation back to ${after.foveation} for the next one`);
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
  await q.page.waitForFunction(() => window.__cc.quality.state.rate === 90, null, { timeout: 30000 }).catch(() => {});
  const iq = await q.page.evaluate(() => ({ ...window.__cc.quality.state, session: window.__cc.renderer.xr.getSession().frameRate }));
  check(iq.requested === 90 && iq.session === 90, `asks for 90 Hz and runs at ${iq.session} Hz (IWER's Quest 3 offers ${iq.supported?.join(', ')} and already starts at 90)`);
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
  // the globe's load, the Up close view and the shake on software GL did not move the quality ladder
  const iqa = await q.page.evaluate(() => {
    const st = window.__cc.quality.state;
    return { auto: st.auto, rung: st.rung, steps: st.steps.length, frames: st.frames, misses: st.misses, gaps: st.gaps, ignored: st.ignored, fov: window.__cc.renderer.xr.getFoveation() };
  });
  check(!iqa.auto && iqa.rung === 0 && iqa.steps === 0 && iqa.fov === 0.6, `under automation the fall-back stays off: of ${iqa.frames} software-GL frames, ${iqa.misses} missed, ${iqa.gaps} were gaps over 250 ms, ${iqa.ignored} fell in a hold-off; no step`);
  const iladder = await driveLadder(q.page);
  check(ladderOk(iladder), ladderMsg(iladder));
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
