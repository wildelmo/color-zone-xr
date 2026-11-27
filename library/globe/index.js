import * as THREE from 'three';
import { MaterialKit } from '../core/materials.js';
import { BulbString } from '../core/bulbs.js';
import { GeoBag, disposeDeep, mat } from '../core/geometry.js';
import { meshLayer, modelDetails } from '../core/sdfClient.js';
import { Emitter, Timeline, ease } from '../core/asset.js';
import { G } from './dimensions.js';
import { T } from './terrain.js';
import { buildTown, townUniforms, townMaterial } from './town.js';
import { buildSmoke } from './smoke.js';
import { groundMaterial } from './ground.js';
import { buildTownfolk } from './townfolk.js';
import { buildDragons } from './dragons.js';
import { buildGlass, collarGeometry } from './glass.js';
import { buildWater } from './water.js';
import { buildCrystals } from './crystals.js';
import { buildSnow } from './snow.js';
import { SCORE } from './score.js';

const ROCK = new URL('./islandModel.js', import.meta.url).href;

const GATE_A = T.gateA;

export const info = {
  id: 'globe',
  name: 'Le Royaume de Givre',
  maker: 'A crystal snow globe, carved from the winter itself',
  blurb:
    'A floating island kingdom inside a crystal globe: a walled castle town of some forty houses, a keep and a cathedral, waterfalls spilling into mist, and two small dragons who fly, perch and puff smoke. Shake it to make it snow. Wind the key crystal for the lullaby and the aurora.',
  scale: 1 / 240, // about 43 cm across on the table
  bounds: { center: [0, 62, 0], radius: 64 },
  // "up close": just what's inside the globe (the island, the town and the
  // dragons, no glass or base) blown up to about 5 m across, floating in a
  // snowy night with its streets at waist height. You stand on a walkway
  // round it, by the main gate, and can lean right in over the rooftops.
  life: {
    label: 'Up close',
    scale: 1 / 12,
    floor: G.islandY - 0.95 * 12, // the lowest terrace at waist height
    viewer: [Math.cos(GATE_A) * 4, Math.sin(GATE_A) * 4],
    yaw: Math.atan2(Math.cos(GATE_A), Math.sin(GATE_A)),
    focus: [0, G.islandY + 3, 0],
    hideHall: true,
    walkway: [3.1, 5.4], // metres from the centre
  },
};

const RUN_SECONDS = 120;

/**
 * The carved trim (window frames, beams, railings, icicles: members about
 * 0.07 across) is shown only while one subtends more than about 1.2 mrad
 * (two Quest 3 pixels), measured from the camera to the nearest point of the
 * trim's bounding sphere, and hidden again below 0.9 mrad (the gap keeps it
 * from flickering at the boundary). Scale cancels out: a size s at a local
 * distance d subtends s / d radians.
 */
export const TRIM_LOD = { size: 0.07, show: 1.2e-3, hide: 0.9e-3 };

/**
 * The shelf's island has no ground shader: bake its look into the vertex
 * colours instead (as ground.js paints it): snow on the flat tops, bare
 * blue-grey rock on the cliffs and darker rock underneath.
 */
function shelfIslandColors(geo) {
  const n = geo.attributes.normal, c = geo.attributes.color;
  if (!n || !c) return geo;
  const ss = (e0, e1, x) => THREE.MathUtils.smoothstep(x, e0, e1);
  const rock = [0.25, 0.27, 0.31], snow = [0.92, 0.95, 1.0];
  for (let i = 0; i < c.count; i++) {
    const up = n.getY(i);
    const col = [c.getX(i), c.getY(i), c.getZ(i)];
    const snowy = ss(0.72, 0.86, (col[0] + col[1] + col[2]) / 3);
    const flat = ss(0.55, 0.8, up), steep = 1 - ss(0.5, 0.78, up), under = 1 - ss(-0.3, 0.1, up);
    for (let k = 0; k < 3; k++) {
      let v = col[k] + (snow[k] - col[k]) * snowy * flat;
      v += (rock[k] - v) * steep * snowy;
      v += (rock[k] * 0.8 - v) * under;
      col[k] = v;
    }
    c.setXYZ(i, col[0], col[1], col[2]);
  }
  return geo;
}

export async function createGlobe(ctx, { lod = 'hero' } = {}) {
  const hero = lod === 'hero';
  const progress = ctx.progress || (() => {});
  const kit = new MaterialKit();
  const U = townUniforms();
  const root = new THREE.Group();
  root.name = `globe:${lod}`;

  // ---------------------------------------------------------------- rock
  progress(0.05, 'hewing the rock');
  // (the shelf preview is about 26 cm across, seen from 60 cm or more)
  const cells = hero ? { island: 0.8, floor: 1.2, base: 1.25 } : { island: 3.4, floor: 5.5, base: 5.6 };
  const [islandGeo, floorGeo, baseGeo, anchors] = await Promise.all([
    meshLayer(ROCK, 'island', cells.island),
    meshLayer(ROCK, 'floor', cells.floor),
    meshLayer(ROCK, 'base', cells.base),
    modelDetails(ROCK),
  ]);
  await ctx.step();
  const island = new THREE.Group();
  island.name = 'island';
  island.position.y = G.islandY;
  let base = null, floor = null;
  if (hero) {
    const rockMat = groundMaterial(kit, U);
    const floorMat = kit.standard({ vertexColors: true, roughness: 0.9 });
    const baseMat = kit.standard({ vertexColors: true, roughness: 0.32, metalness: 0.25, envMapIntensity: 1.8 });
    base = new THREE.Mesh(baseGeo, baseMat);
    base.name = 'globe:base';
    base.castShadow = base.receiveShadow = true;
    floor = new THREE.Mesh(floorGeo, floorMat);
    floor.name = 'globe:floor';
    floor.receiveShadow = true;
    const rock = new THREE.Mesh(islandGeo, rockMat);
    rock.name = 'island:rock';
    rock.castShadow = rock.receiveShadow = true;
    island.add(rock);
    root.add(base, floor, island);
  } else {
    // the shelf: base, snowy floor, the island's rock and the silver collar
    // as one coarse vertex-coloured mesh (one draw call)
    const bag = new GeoBag();
    bag.add(baseGeo, null, 'rock');
    bag.add(floorGeo, null, 'rock');
    bag.add(shelfIslandColors(islandGeo), mat(0, G.islandY, 0), 'rock');
    // (darker than the silver itself: a plain material can't mirror the dim room)
    bag.add(collarGeometry(4, 32), null, 'rock', '#5a5d63');
    const ground = bag.build({ rock: kit.standard({ vertexColors: true, roughness: 0.6, metalness: 0.12, envMapIntensity: 1.4 }) }, { name: 'globe' }).children[0];
    ground.name = 'globe:rock';
    root.add(ground, island);
  }

  progress(0.25, 'growing the crystals');
  const crystals = buildCrystals(kit, anchors, { lod, underY: G.islandY });
  root.add(crystals.group);
  island.add(crystals.under);
  await ctx.step();

  // ---------------------------------------------------------------- town
  progress(0.4, 'raising the town');
  const town = await buildTown(kit, U, { lod, step: () => ctx.step() });
  island.add(town.group);
  await ctx.step();
  const water = buildWater(kit, { lod });
  island.add(water.group);
  if (water.foam) island.add(water.foam.mesh);
  if (water.mist) root.add(water.mist.mesh);
  // lanterns: warm glows (island space; too small for the shelf, where the lit windows do)
  const lights = hero ? new BulbString({ radius: 0.12, glow: 1.4, detail: 1 }) : null;
  if (lights) {
    town.lanterns.forEach((p, i) => lights.add(p, 0, i, town.lanterns.length, '#ffc070'));
    island.add(lights.build(kit));
  }
  // little string lights along some eaves
  const fairy = town.fairy.length ? new BulbString({ radius: 0.045, glow: 0.42, detail: 0 }) : null;
  if (fairy) {
    town.fairy.forEach((b, i) => fairy.add(b.p, 0, i, town.fairy.length, b.color));
    island.add(fairy.build(kit));
  }
  const smoke = hero ? buildSmoke(kit, town.chimneys) : null;
  if (smoke) island.add(smoke.mesh);
  const folk = hero ? buildTownfolk(kit, U, townMaterial, { count: 26, blockers: town.blockers }) : null;
  if (folk) island.add(folk.mesh);
  await ctx.step();

  // ------------------------------------------------------------- dragons
  progress(0.6, 'waking the dragons');
  const perches = town.perches.map((p) => ({ ...p, p: p.p.clone().add(new THREE.Vector3(0, G.islandY, 0)) }));
  // the town's height map (island-local) lifted into asset space, for flight avoidance
  const heightAt = (x, z, dilated = true) => G.islandY + town.heightAt(x, z, dilated);
  // (on the shelf a dragon would be a centimetre speck: left out)
  const dragons = hero ? await buildDragons(ctx, kit, { lod, perches, heightAt }) : null;
  if (dragons) root.add(dragons.group);
  await ctx.step();

  // -------------------------------------------------------- snow + glass
  progress(0.85, 'filling it with snow');
  const snow = buildSnow(kit, { lod });
  root.add(snow.mesh);
  const glass = buildGlass(kit, { lod });
  root.add(glass.group);
  // the key crystal's grab target (only the one on the table is wound by hand)
  const keyProxy = hero ? new THREE.Mesh(new THREE.SphereGeometry(8, 8, 6), new THREE.MeshBasicMaterial({ visible: false })) : null;
  if (keyProxy) {
    keyProxy.name = 'proxy:key-crystal';
    if (anchors.key) keyProxy.position.set(anchors.key.p[0], anchors.key.p[1] + 3, anchors.key.p[2] + 2);
    root.add(keyProxy);
  }

  // the carved trim's level of detail (see TRIM_LOD); its bounding sphere is
  // island-local (the town group sits at the island's origin)
  const trimSphere = town.trim.length ? town.trim.reduce((s, m) => (s ? s.union(m.geometry.boundingSphere) : m.geometry.boundingSphere.clone()), null) : null;
  const trimCentre = new THREE.Vector3();
  let trimOn = false;
  let trimAngle = 0; // the last angle measured (radians), for inspection
  // the first frame the island is drawn, the trim is drawn too (unculled), so
  // its buffers go up to the GPU with the rest of the town, not as a hitch
  // the first time someone leans in
  let trimPrime = trimSphere ? 'pending' : 'done';
  const setTrim = (on) => {
    trimOn = on;
    for (const m of town.trim) m.visible = on;
  };

  // ---------------------------------------------------------------- state
  const state = {
    time: 0,
    wind: hero ? 0 : 0.5,
    speed: hero ? 0 : 0.3,
    night: 0.55,
    agitation: hero ? 0 : 0.0,
    musicBeat: 0,
    assembled: !hero,
    winding: false,
  };
  const events = new Emitter();
  let noteIdx = 0;
  let lastTinkle = 0;
  if (dragons) dragons.events.onPuff = (d, flame) => events.emit('sfx', { name: flame ? 'roar' : 'puff', pitch: d.i ? 1.15 : 0.95 });

  // inspection hooks (tests and the Quest tour)
  const debug = {
    dragons: dragons?.dragons ?? [],
    perches,
    snow,
    simulateDragons: dragons?.simulate ?? (() => {}),
    heightAt,
    houses: town.houseList,
    snowmen: town.snowmen,
    island,
    uniforms: U,
    folk,
    town,
    freezeDragons: false,
    freezeTown: false,
    /** the carved trim: its meshes, whether it is showing, its island-local bounding sphere */
    trim: {
      meshes: town.trim,
      sphere: trimSphere,
      get on() {
        return trimOn;
      },
      get angle() {
        return trimAngle;
      },
    },
  };

  // ------------------------------------------------------- assembly script
  const timeline = new Timeline();
  if (hero) {
    base.visible = floor.visible = false;
    timeline.add(0, 0.8, (k) => {
      base.visible = k > 0;
      base.scale.y = Math.max(0.001, ease.outBack(k));
    });
    timeline.cue(0.35, () => events.emit('sfx', { name: 'thunk', pitch: 0.6 }));
    crystals.group.scale.setScalar(0.001);
    timeline.add(0.6, 0.9, (k) => crystals.group.scale.setScalar(Math.max(0.001, ease.outBack(k))));
    timeline.cue(0.8, () => events.emit('sfx', { name: 'tinkle' }));
    timeline.add(1.1, 0.5, (k) => {
      floor.visible = k > 0;
      floor.scale.y = Math.max(0.001, k);
    });
    glass.uniforms.uFade.value = 0;
    glass.group.visible = false;
    timeline.add(1.4, 1.0, (k) => {
      glass.group.visible = k > 0;
      glass.uniforms.uFade.value = k;
    });
    timeline.cue(1.5, () => events.emit('sfx', { name: 'chime' }));
    island.visible = false;
    timeline.add(2.0, 1.6, (k) => {
      island.visible = k > 0;
      island.position.y = G.islandY - (1 - ease.outCubic(k)) * 26;
    });
    U.uBuild.value = 0;
    timeline.add(3.2, 3.2, (k) => (U.uBuild.value = k));
    for (let i = 0; i < 8; i++) timeline.cue(3.3 + i * 0.38, () => events.emit('sfx', { name: 'clop', pitch: 0.8 + i * 0.07 }));
    water.group.visible = false;
    water.mist.mesh.visible = false;
    timeline.add(5.6, 0.1, (k) => {
      water.group.visible = k > 0;
      water.mist.mesh.visible = k > 0;
    });
    for (const d of dragons.dragons) d.enter = 0;
    timeline.add(5.8, 2.4, (k) => {
      for (const d of dragons.dragons) d.enter = ease.outCubic(k);
    });
    timeline.cue(6.2, () => events.emit('sfx', { name: 'whoosh' }));
    timeline.cue(7.4, () => {
      state.agitation = 0.9;
      events.emit('sfx', { name: 'tinkle' });
    });
    timeline.cue(
      8.4,
      () => {
        state.assembled = true;
        events.emit('assembled');
      },
      true,
    );
  }

  // --------------------------------------------------------- interactions
  const interactions = !hero ? [] : [
    {
      id: 'wind',
      label: 'Turn the key crystal',
      proxy: keyProxy,
      kind: 'hold',
      onStart() {
        state.winding = true;
      },
      onHold(dt) {
        if (!state.assembled) return;
        const before = state.wind;
        state.wind = Math.min(1, state.wind + dt * 0.25);
        if (Math.floor(before * 30) !== Math.floor(state.wind * 30)) {
          events.emit('sfx', { name: 'tinkle', gain: 0.4 });
          events.emit('haptic', { strength: 0.25, ms: 14 });
        }
      },
      onEnd() {
        state.winding = false;
      },
    },
  ];

  const prevPos = new THREE.Vector3();
  const prevVel = new THREE.Vector3();
  const curPos = new THREE.Vector3();
  let hasPrev = false;

  function update(dt, view = {}) {
    dt = Math.min(dt, 0.1);
    state.time += dt;
    if (timeline.active) timeline.update(dt);

    // shaking: measure how hard the globe is being moved (world space, m/s^2)
    root.getWorldPosition(curPos);
    if (hasPrev && dt > 0) {
      const v = curPos.clone().sub(prevPos).divideScalar(dt);
      const a = v.clone().sub(prevVel).divideScalar(dt).length();
      prevVel.copy(v);
      if (a > 6 && state.assembled) state.agitation = Math.min(1, state.agitation + (a - 6) * 0.0035);
    }
    prevPos.copy(curPos);
    hasPrev = true;
    state.agitation = Math.max(0, state.agitation - dt * 0.12);
    if (state.agitation > 0.25 && state.time - lastTinkle > 0.6) {
      lastTinkle = state.time;
      events.emit('sfx', { name: 'tinkle', gain: state.agitation });
    }

    // the key crystal: music, deeper night, brighter aurora and crystals
    const target = state.assembled ? Math.min(1, state.wind * 6) : 0;
    state.speed += (target - state.speed) * (1 - Math.exp(-dt * 1.2));
    state.wind = Math.max(0, state.wind - (state.speed * dt) / RUN_SECONDS);
    state.night += (0.5 + 0.45 * state.speed - state.night) * Math.min(1, dt * 0.5);
    crystals.level.value = 0.25 + state.speed * 0.75;

    // the lullaby
    const beats = state.speed * (SCORE.bpm / 60) * dt;
    if (beats > 0) {
      const from = state.musicBeat;
      let to = from + beats;
      const fire = (n) => events.emit('note', { midi: n[1], velocity: n[3] * 0.9, duration: n[2] });
      while (noteIdx < SCORE.notes.length && SCORE.notes[noteIdx][0] < to) {
        if (SCORE.notes[noteIdx][0] >= from) fire(SCORE.notes[noteIdx]);
        noteIdx++;
      }
      if (to >= SCORE.length) {
        to -= SCORE.length;
        noteIdx = 0;
        while (noteIdx < SCORE.notes.length && SCORE.notes[noteIdx][0] < to) fire(SCORE.notes[noteIdx++]);
      }
      state.musicBeat = to;
    }

    // town-wide shader state
    U.uTime.value = state.time;
    U.uNight.value = state.night;
    const settled = Math.min(1, snow.onIsland / 220);
    U.uSnow.value += (0.3 + settled * 0.6 - U.uSnow.value) * Math.min(1, dt * 0.3);

    if (dragons && !debug.freezeDragons) dragons.update(dt, state.time, { startle: state.agitation });
    snow.update(dt, state.time, state.agitation);
    if (!debug.freezeTown) town.update(state.time, dt, state.speed);
    // the townsfolk come out and the fires are lit once the town has risen
    const risen = U.uBuild.value > 0.92;
    if (smoke) smoke.mesh.visible = risen;
    if (folk) folk.mesh.visible = risen;
    if (risen) {
      smoke?.update(state.time, { night: state.night, agitation: state.agitation });
      folk?.update(state.time);
    }
    water.update(state.time, dt);
    crystals.update(state.time);
    glass.update(state.time, state.night);
    lights?.update(state.time, 0.02);
    fairy?.update(state.time, 0.04);

    // the carved trim: shown only when it is big enough to make out
    if (trimPrime !== 'done' && view.cameraLocal) {
      if (trimPrime === 'pending' && island.visible) {
        for (const m of town.trim) {
          m.visible = true;
          m.frustumCulled = false;
        }
        trimPrime = 'drawn';
      } else if (trimPrime === 'drawn') {
        for (const m of town.trim) m.frustumCulled = true;
        setTrim(trimOn);
        trimPrime = 'done';
      }
    } else if (trimSphere && view.cameraLocal) {
      trimCentre.copy(trimSphere.center).add(island.position);
      const d = Math.max(1e-6, view.cameraLocal.distanceTo(trimCentre) - trimSphere.radius);
      trimAngle = TRIM_LOD.size / d;
      if (trimOn ? trimAngle < TRIM_LOD.hide : trimAngle > TRIM_LOD.show) setTrim(!trimOn);
    }
  }

  update(0);

  return {
    info,
    lod,
    root,
    state,
    events,
    interactions,
    timeline,
    stats: { houses: town.houses },
    debug,
    update,
    assemble() {
      timeline.play();
    },
    skipAssembly() {
      timeline.finish();
    },
    wind(amount) {
      state.wind = Math.min(1, state.wind + amount);
    },
    /** give it a shake (from a button; in VR just shake it) */
    shake(amount = 0.8) {
      state.agitation = Math.min(1, state.agitation + amount);
    },
    /** 'life' shows just what's inside (no glass, base or crystals); 'toy' the whole globe */
    setView(mode) {
      const inside = mode === 'life';
      for (const o of [base, floor, crystals.group, glass.glass, glass.collar, keyProxy]) if (o) o.visible = !inside;
    },
    dispose() {
      disposeDeep(root);
      kit.dispose();
      events.clear();
    },
  };
}
