import * as THREE from 'three';
import { MaterialKit } from '../core/materials.js';
import { BulbString } from '../core/bulbs.js';
import { disposeDeep } from '../core/geometry.js';
import { Emitter, Timeline, ease } from '../core/asset.js';
import { D } from './dimensions.js';
import { SCORE } from './score.js';
import { buildPlinth } from './plinth.js';
import { buildColumn } from './column.js';
import { buildRotor } from './rotor.js';
import { buildHorses } from './horses.js';

export const info = {
  id: 'carousel',
  name: 'Le Grand Carrousel',
  maker: 'Atelier Merveille, Paris (imagined), c. 1898',
  blurb:
    'A clockwork music-box carousel: 24 carved horses on barley-twist poles, driven by real crankshafts geared to a crown wheel. Wind the key and watch the pinned cylinder pluck the comb through the window.',
  scale: 1 / 22, // shown as a toy: about half a metre across
  bounds: { center: [0, 4.9, 0], radius: 6.6 },
  // life size: deck at the floor, viewer just outside the platform
  life: { label: 'Life size', scale: 1, floor: 1.52, viewer: [0, 7.4], yaw: 0, focus: [0, 3.8, 0] },
};

const RUN_SECONDS = 150; // a full wind runs this long
const OMEGA = (Math.PI * 2) / 9; // rad/s at full speed: one turn every 9 s

/**
 * Builds the carousel.
 * @param {{ step: () => Promise<void>, progress?: (f:number, label:string)=>void }} ctx
 * @param {{ lod: 'hero'|'shelf' }} opts
 */
export async function createCarousel(ctx, { lod = 'hero' } = {}) {
  const hero = lod === 'hero';
  const progress = ctx.progress || (() => {});
  const kit = new MaterialKit();
  const shared = {
    gold: kit.gold(),
    brass: kit.brass(),
    steel: kit.steel(),
    paint: kit.paint(),
    paintDouble: kit.paint({ side: THREE.DoubleSide }),
    mirror: kit.mirror(),
    glass: kit.glass(),
    jewel: kit.standard({ color: 0xffffff, roughness: 0.08, metalness: 0.3, vertexColors: true }),
  };
  const root = new THREE.Group();
  root.name = `carousel:${lod}`;

  progress(0.05, 'turning the base');
  const plinth = buildPlinth(ctx, kit, shared, { lod });
  root.add(plinth.group);
  await ctx.step();

  progress(0.15, 'gilding the centre column');
  const fixedBulbs = new BulbString({ radius: 0.05, glow: 0.42, detail: hero ? 1 : 0 });
  const column = buildColumn(ctx, kit, shared, fixedBulbs, { lod });
  root.add(column.group);
  await ctx.step();

  progress(0.3, 'raising the canopy');
  const rotor = new THREE.Group();
  rotor.name = 'rotating';
  root.add(rotor);
  const turnBulbs = new BulbString({ radius: 0.055, glow: 0.46, detail: hero ? 1 : 0 });
  const top = buildRotor(ctx, kit, shared, turnBulbs, { lod });
  rotor.add(top.group);
  await ctx.step();

  progress(0.45, 'carving the horses');
  const herd = await buildHorses(ctx, kit, { lod });
  rotor.add(herd.group);
  progress(0.9, 'stringing the lights');
  // bulbs ride on the parts they're screwed into, so they arrive with them
  top.parts.canopy.add(turnBulbs.build(kit));
  column.group.add(fixedBulbs.build(kit));
  await ctx.step();

  // ------------------------------------------------------------- state
  const state = {
    time: 0,
    wind: hero ? 0 : 0.6,
    speed: hero ? 0 : 0.35,
    angle: 0,
    crank: 0,
    musicBeat: 0,
    windAngle: 0,
    winding: false,
    assembled: !hero,
  };
  const events = new Emitter();
  let noteIdx = 0;
  let lastClick = 0;

  // ----------------------------------------------------- assembly script
  const parts = {
    plinth: plinth.group,
    deck: top.parts.deck,
    column: column.group,
    mech: top.parts.mech,
    canopy: top.parts.canopy,
    cupola: top.parts.top,
  };
  const timeline = new Timeline();
  if (hero) {
    const drop = (obj, at, dur, from, sfx, pitch = 1) => {
      obj.visible = false;
      timeline.add(at, dur, (k) => {
        obj.visible = k > 0;
        const e = ease.outBack(k);
        obj.position.y = (1 - e) * from;
        obj.scale.setScalar(0.9 + 0.1 * Math.min(1, k * 2));
      });
      if (sfx) timeline.cue(at + dur * 0.55, () => events.emit('sfx', { name: sfx, pitch }));
    };
    const rise = (obj, at, dur, sfx, pitch = 1) => {
      obj.visible = false;
      timeline.add(at, dur, (k) => {
        obj.visible = k > 0;
        obj.scale.y = Math.max(0.001, ease.outBack(k));
      });
      if (sfx) timeline.cue(at + dur * 0.5, () => events.emit('sfx', { name: sfx, pitch }));
    };
    rise(parts.plinth, 0.0, 0.7, 'thunk', 0.8);
    drop(parts.deck, 0.55, 0.7, 4, 'thunk', 1);
    timeline.add(0.55, 0.7, (k) => (parts.deck.rotation.y = (1 - k) * 2.5));
    rise(parts.column, 1.15, 0.8, 'thunk', 1.25);
    herd.horses.forEach((h, i) => {
      h.pole = 0;
      h.drop = 0;
      const order = (i % D.sweeps) * 2 + (h.outer ? 0 : 1);
      timeline.add(1.8 + order * 0.035, 0.35, (k) => (h.pole = ease.outCubic(k)));
      timeline.add(2.6 + order * 0.075, 0.7, (k) => (h.drop = k));
      timeline.cue(2.6 + order * 0.075 + 0.26, () => events.emit('sfx', { name: 'clop', pitch: 0.9 + (order % 6) * 0.06 }));
    });
    drop(parts.mech, 4.6, 0.6, 3, 'clank', 1);
    drop(parts.canopy, 5.1, 0.85, 6, 'thunk', 0.7);
    drop(parts.cupola, 5.8, 0.55, 3, 'pop', 1.2);
    for (const b of [turnBulbs, fixedBulbs]) {
      b.wave = 0;
      timeline.add(6.3, 1.1, (k) => (b.wave = k));
    }
    timeline.cue(6.3, () => events.emit('sfx', { name: 'chime' }));
    timeline.cue(
      7.5,
      () => {
        state.assembled = true;
        events.emit('assembled');
      },
      true,
    );
  }

  // ------------------------------------------------------------ interactions
  const interactions = [
    {
      id: 'wind',
      label: 'Wind the key',
      proxy: plinth.keyProxy,
      kind: 'hold',
      onStart() {
        state.winding = true;
      },
      onHold(dt) {
        if (!state.assembled) return;
        const before = state.windAngle;
        state.windAngle += dt * 7;
        state.wind = Math.min(1, state.wind + dt * 0.22);
        if (Math.floor(state.windAngle / (Math.PI / 5)) !== Math.floor(before / (Math.PI / 5))) {
          events.emit('sfx', { name: 'ratchet', pitch: 0.9 + state.wind * 0.4 });
          events.emit('haptic', { strength: 0.35, ms: 18 });
        }
      },
      onEnd() {
        state.winding = false;
      },
    },
  ];

  const _cam = new THREE.Vector3();

  function update(dt, view = {}) {
    dt = Math.min(dt, 0.1);
    state.time += dt;
    if (timeline.active) timeline.update(dt);

    // spring + flywheel inertia: slows to a halt as the spring runs down
    const target = state.assembled ? smoothstep(0, 0.14, state.wind) : 0;
    state.speed += (target - state.speed) * (1 - Math.exp(-dt * (target > state.speed ? 0.9 : 0.6)));
    if (state.speed < 0.002 && target === 0) state.speed = 0;
    state.wind = Math.max(0, state.wind - (state.speed * dt) / RUN_SECONDS);

    state.angle += state.speed * OMEGA * dt;
    // each pinion rolls on top of the fixed crown gear: its lowest tooth must
    // stand still, so as the deck turns anticlockwise (seen from above) the
    // shaft spins backwards about its outward axis, ratio times as fast
    state.crank = -state.angle * D.ratio;
    rotor.rotation.y = state.angle;

    // the music box: advance the cylinder, pluck what passes the comb
    const beats = state.speed * (SCORE.bpm / 60) * dt;
    if (beats > 0) {
      const from = state.musicBeat;
      let to = from + beats;
      const notes = SCORE.notes;
      const fire = (n) => {
        events.emit('note', { midi: n[1], velocity: n[3], duration: n[2], speed: state.speed });
        if (plinth.movement) plinth.movement.pluck(n[1], state.time);
      };
      while (noteIdx < notes.length && notes[noteIdx][0] < to) {
        if (notes[noteIdx][0] >= from) fire(notes[noteIdx]);
        noteIdx++;
      }
      if (to >= SCORE.length) {
        to -= SCORE.length;
        noteIdx = 0;
        while (noteIdx < notes.length && notes[noteIdx][0] < to) fire(notes[noteIdx++]);
      }
      state.musicBeat = to;
    }
    plinth.key.rotation.x = state.windAngle;

    // soft ticking while running
    if (state.speed > 0.05 && state.time - lastClick > 0.5 / Math.max(0.2, state.speed)) {
      lastClick = state.time;
      events.emit('sfx', { name: 'tick', pitch: 0.8 + state.speed * 0.3, gain: state.speed * 0.5 });
    }

    if (view.cameraLocal) _cam.copy(view.cameraLocal);
    else _cam.set(0, 6, 40);
    // horses + mechanism + lights
    const camRotor = _cam.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -state.angle);
    herd.update(state.crank, camRotor, view.worldScale ?? info.scale);
    top.update(state);
    column.update(state);
    plinth.update(state, dt);
    turnBulbs.update(state.time, state.speed);
    fixedBulbs.update(state.time, state.speed);
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
    stats: { horseTris: herd.tris },
    update,
    /** start the assembly animation (hero only) */
    assemble() {
      timeline.play();
    },
    skipAssembly() {
      timeline.finish();
    },
    wind(amount) {
      state.wind = Math.min(1, state.wind + amount);
    },
    dispose() {
      disposeDeep(root);
      kit.dispose();
      events.clear();
    },
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

