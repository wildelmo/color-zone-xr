import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { meshLayer, modelDetails } from '../core/sdfClient.js';
import { normalizeGeometry } from '../core/geometry.js';
import { paintMaskMaterial } from '../core/materials.js';
import { GlowPoints } from '../core/glowPoints.js';
import { buildWing, wingMatrices } from './wings.js';
import { G } from './dimensions.js';

const MODEL = new URL('./dragonModel.js', import.meta.url).href;
const SCALE = 1.8; // model units -> metres in the globe (~8 m wingspan)

const LIVERY = [
  { name: 'Émeraude', coat: '#1f7a4a', belly: '#ecd590', wing: '#17563a', spikes: '#d9a84e', horns: '#efe3c4', eye: '#f0a81c' },
  { name: 'Rubis', coat: '#a3262a', belly: '#f2cf98', wing: '#6a1a22', spikes: '#e0b25a', horns: '#2a2420', eye: '#f2d23a' },
];

/**
 * Two little dragons that live in the globe. Each runs a small behaviour
 * loop so they never look like they're on rails:
 *
 *   fly       wander between random points around the towers, banking into
 *             turns, beating harder when climbing, gliding when descending
 *   approach  pick a free perch (keep tower, steeple, a wall tower, a base
 *             crystal), circle in, glide down and flare the wings to land
 *   perched   fold the wings, look around, shift, stretch, puff smoke/flame
 *   takeoff   crouch, leap, a burst of strong beats, climb away
 *
 * Shaking the globe startles any perched dragon into the air.
 */
export async function buildDragons(ctx, kit, { lod, perches }) {
  const hero = lod === 'hero';
  const cell = hero ? 0.036 : 0.075;
  const det = await modelDetails(MODEL);
  const [body, horns, spikes] = await Promise.all([meshLayer(MODEL, 'body', cell), meshLayer(MODEL, 'horns', cell * 0.6), meshLayer(MODEL, 'spikes', cell * 0.6)]);
  await ctx.step();
  // eyes: golden iris + slit pupil
  const eyeParts = [];
  for (const e of det.eyes) {
    const iris = new THREE.SphereGeometry(e.r, hero ? 16 : 8, hero ? 12 : 6).translate(...e.p);
    eyeParts.push(normalizeGeometry(iris, '#ffffff'));
    const pupil = new THREE.SphereGeometry(e.r * 0.55, 10, 8).scale(0.32, 1, 0.32).translate(e.p[0] + e.r * 0.25, e.p[1], e.p[2] + Math.sign(e.p[2]) * e.r * 0.9);
    eyeParts.push(normalizeGeometry(pupil, '#060404'));
  }
  const eyes = mergeGeometries(eyeParts, false);
  eyeParts.forEach((g) => g.dispose());
  const wing = buildWing(hero ? 1 : 0);
  await ctx.step();

  const N = LIVERY.length;
  const mats = {
    body: paintMaskMaterial(kit, { roughness: 0.3, stripe: 0.02, stripeWidth: 0.006, scales: hero ? { size: 0.045, depth: 0.03 } : null }),
    horns: kit.standard({ color: 0xffffff, roughness: 0.35, metalness: 0.1 }),
    spikes: kit.standard({ color: 0xffffff, roughness: 0.28, metalness: 0.75 }),
    eyes: kit.standard({ color: 0xffffff, roughness: 0.05, metalness: 0.2, vertexColors: true, emissive: 0x2a1600 }),
    membrane: kit.standard({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }),
    bones: kit.standard({ color: 0xffffff, roughness: 0.3, metalness: 0.7 }),
  };
  const group = new THREE.Group();
  group.name = 'dragons';
  const inst = (geo, mat, count, name, color) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.name = name;
    m.castShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (color) for (let i = 0; i < count; i++) m.setColorAt(i, new THREE.Color(color(i)));
    group.add(m);
    return m;
  };
  body.setAttribute('instanceCoat', new THREE.InstancedBufferAttribute(new Float32Array(LIVERY.flatMap((l) => new THREE.Color(l.coat).toArray())), 3));
  body.setAttribute('instanceTrim', new THREE.InstancedBufferAttribute(new Float32Array(LIVERY.flatMap((l) => new THREE.Color(l.belly).toArray())), 3));
  const meshes = {
    body: inst(body, mats.body, N, 'dragon:body'),
    horns: inst(horns, mats.horns, N, 'dragon:horns', (i) => LIVERY[i].horns),
    spikes: inst(spikes, mats.spikes, N, 'dragon:spikes', (i) => LIVERY[i].spikes),
    eyes: inst(eyes, mats.eyes, N, 'dragon:eyes', (i) => LIVERY[i].eye),
    innerMem: inst(wing.inner.membrane, mats.membrane, N * 2, 'dragon:wing', (i) => LIVERY[i >> 1].wing),
    innerBone: inst(wing.inner.bones, mats.bones, N * 2, 'dragon:wingbone', (i) => LIVERY[i >> 1].spikes),
    outerMem: inst(wing.outer.membrane, mats.membrane, N * 2, 'dragon:wing2', (i) => LIVERY[i >> 1].wing),
    outerBone: inst(wing.outer.bones, mats.bones, N * 2, 'dragon:wingbone2', (i) => LIVERY[i >> 1].spikes),
  };

  // flame / smoke puffs
  const fx = new GlowPoints(kit, 80, { additive: true, soft: 0.8, name: 'dragon:breath' });
  group.add(fx.mesh);
  const puffs = [];

  // ------------------------------------------------------------- behaviour
  const center = new THREE.Vector3(0, G.islandY + 16, 0);
  const rnd = Math.random;
  const randomWaypoint = (d) => {
    for (let k = 0; k < 20; k++) {
      const a = rnd() * Math.PI * 2;
      const r = 12 + rnd() * 26;
      const y = G.islandY + 12 + rnd() * 26;
      const p = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      if (p.distanceTo(new THREE.Vector3(0, G.globeY, 0)) < G.globeR - 9 && (!d || p.distanceTo(d.pos) > 12)) return p;
    }
    return center.clone();
  };
  const dragons = LIVERY.map((liv, i) => {
    const a = i * Math.PI;
    return {
      i,
      liv,
      state: 'fly',
      t: 0,
      timer: 10 + i * 7 + rnd() * 6,
      pos: new THREE.Vector3(Math.cos(a) * 26, G.islandY + 20 + i * 6, Math.sin(a) * 26),
      vel: new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(8),
      target: null,
      perch: null,
      flapPhase: rnd() * 6,
      flap: 0,
      fold: 0.2,
      sweep: 0,
      roll: 0,
      pitch: 0,
      yaw: 0,
      headYaw: 0,
      bob: 0,
      matrix: new THREE.Matrix4(),
      enter: 1, // assembly: 0 = still flying in from outside
      nextPuff: 3 + rnd() * 4,
    };
  });
  for (const d of dragons) d.target = randomWaypoint(d);

  const claim = (d) => {
    const free = perches.filter((p) => !dragons.some((o) => o !== d && o.perch === p));
    if (!free.length) return null;
    // prefer perches that are far from where the dragon last sat
    free.sort(() => rnd() - 0.5);
    return free[0];
  };

  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3(SCALE, SCALE, SCALE);
  const _p = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _mi = new THREE.Matrix4(), _mo = new THREE.Matrix4();
  const roots = det.wingRoots.map((r) => new THREE.Vector3(...r));
  const mouth = new THREE.Vector3(...det.mouth);
  const globeC = new THREE.Vector3(0, G.globeY, 0);

  function steer(d, desired, dt, maxTurn, speed) {
    // turn the velocity toward `desired` (a direction) at a limited rate
    const v = d.vel;
    const cur = v.clone().normalize();
    const want = desired.clone().normalize();
    const ang = cur.angleTo(want);
    const k = ang > 1e-4 ? Math.min(1, (maxTurn * dt) / ang) : 1;
    const nd = cur.lerp(want, k).normalize();
    // banking: signed turn rate about the up axis
    const turn = (cur.x * nd.z - cur.z * nd.x) / Math.max(dt, 1e-3);
    d.roll += (THREE.MathUtils.clamp(-turn * 0.9, -0.9, 0.9) - d.roll) * Math.min(1, dt * 3);
    const sp = v.length() + (speed - v.length()) * Math.min(1, dt * 1.5);
    v.copy(nd).multiplyScalar(sp);
  }

  function avoid(d, desired) {
    // stay inside the glass and off the island
    const fromC = d.pos.clone().sub(globeC);
    const r = fromC.length();
    if (r > G.globeR - 12) desired.addScaledVector(fromC.normalize(), -(r - (G.globeR - 12)) * 0.5);
    const rh = Math.hypot(d.pos.x, d.pos.z);
    if (rh < G.edgeR + 4 && d.pos.y < G.islandY + 14 && d.state === 'fly') desired.y += (G.islandY + 14 - d.pos.y) * 0.4;
    if (rh < 6 && d.pos.y < G.islandY + 36 && d.state === 'fly') desired.addScaledVector(new THREE.Vector3(d.pos.x, 0, d.pos.z).normalize(), 2);
  }

  function puff(d, flame) {
    // a little breath from the mouth: flame (orange) or smoke (grey)
    d.matrix.decompose(_p, _q, new THREE.Vector3());
    const m = mouth.clone().multiplyScalar(SCALE).applyQuaternion(_q).add(_p);
    const fwd = new THREE.Vector3(1, 0.15, 0).applyQuaternion(_q);
    for (let k = 0; k < (flame ? 14 : 8); k++) {
      puffs.push({
        p: m.clone(),
        v: fwd.clone().multiplyScalar((flame ? 6 : 2) + rnd() * 3).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).multiplyScalar(1.5)),
        life: 0,
        max: (flame ? 0.6 : 1.4) + rnd() * 0.4,
        flame,
      });
    }
    if (puffs.length > 80) puffs.splice(0, puffs.length - 80);
    return flame;
  }

  const events = { onPuff: null };

  function update(dt, t, { startle = 0 } = {}) {
    dt = Math.min(dt, 0.05);
    for (const d of dragons) {
      d.t += dt;
      d.timer -= dt;
      if (d.state === 'fly') {
        if (d.pos.distanceTo(d.target) < 7) d.target = randomWaypoint(d);
        const desired = d.target.clone().sub(d.pos).normalize();
        avoid(d, desired);
        steer(d, desired, dt, 0.9, 9);
        if (d.timer <= 0 && d.enter >= 1) {
          d.perch = claim(d);
          if (d.perch) {
            d.state = 'approach';
            d.t = 0;
          } else d.timer = 6;
        }
      } else if (d.state === 'approach') {
        const goal = d.perch.p.clone().add(new THREE.Vector3(0, 1.0, 0));
        const to = goal.clone().sub(d.pos);
        const dist = to.length();
        // come in from above and slow down near the perch
        const desired = to.clone().normalize();
        if (dist > 14) desired.y += 0.25;
        avoid(d, desired);
        steer(d, desired, dt, dist < 10 ? 2.5 : 1.3, THREE.MathUtils.clamp(dist * 0.55, 2.2, 9));
        if (dist < 1.2 || d.t > 25) {
          d.state = 'perched';
          d.t = 0;
          d.timer = 8 + rnd() * 10;
          d.pos.copy(goal);
          d.vel.multiplyScalar(0.01);
          d.yaw = Math.atan2(-to.z, to.x);
        }
      } else if (d.state === 'perched') {
        d.vel.set(0, 0, 0);
        // look around now and then
        d.headYaw = Math.sin(d.t * 0.5 + d.i) * 0.6 + Math.sin(d.t * 1.3) * 0.15;
        d.nextPuff -= dt;
        if (d.nextPuff <= 0) {
          const flame = rnd() < 0.5;
          puff(d, flame);
          events.onPuff?.(d, flame);
          d.nextPuff = 3 + rnd() * 5;
        }
        if (d.timer <= 0 || startle > 0.3) {
          d.state = 'takeoff';
          d.t = 0;
          const away = new THREE.Vector3(Math.cos(d.yaw), 0, -Math.sin(d.yaw));
          d.vel.copy(away).multiplyScalar(3).add(new THREE.Vector3(0, 7, 0));
          d.lastPerch = d.perch;
          d.perch = null;
        }
      } else if (d.state === 'takeoff') {
        const desired = d.vel.clone().normalize().add(new THREE.Vector3(0, 0.6, 0));
        avoid(d, desired);
        steer(d, desired, dt, 1.2, 8);
        if (d.t > 2.2) {
          d.state = 'fly';
          d.t = 0;
          d.timer = 14 + rnd() * 14;
          d.target = randomWaypoint(d);
        }
      }
      if (d.state !== 'perched') d.pos.addScaledVector(d.vel, dt);

      // ---- wings
      const climbing = d.vel.y;
      if (d.state === 'perched') {
        // folded, with an occasional stretch
        const stretch = Math.max(0, Math.sin(d.t * 0.7 + d.i * 2) - 0.93) * 14;
        d.flap += ((-0.95 + stretch * 1.3) - d.flap) * Math.min(1, dt * 4);
        d.fold += ((1.7 - stretch * 1.4) - d.fold) * Math.min(1, dt * 4);
        d.sweep += ((-0.55 + stretch * 0.4) - d.sweep) * Math.min(1, dt * 4);
        d.bob = Math.sin(d.t * 1.6) * 0.04;
      } else {
        const landing = d.state === 'approach' && d.perch && d.pos.distanceTo(d.perch.p) < 9;
        const beat = d.state === 'takeoff' || landing ? 2.2 : climbing > 1 ? 1.6 : climbing < -1.5 ? 0 : 0.9;
        d.flapPhase += dt * Math.PI * 2 * (beat > 0 ? 1.1 + beat * 0.5 : 0);
        const amp = beat > 0 ? 0.45 + beat * 0.2 : 0.05;
        const glide = beat > 0 ? 0 : 0.18; // a held dihedral when gliding
        const target = Math.sin(d.flapPhase) * amp + glide + (landing ? 0.35 : 0);
        d.flap += (target - d.flap) * Math.min(1, dt * 10);
        d.fold += (Math.max(0, -Math.sin(d.flapPhase - 0.6)) * 0.55 * (beat > 0 ? 1 : 0) + 0.1 - d.fold) * Math.min(1, dt * 10);
        d.sweep += ((landing ? 0.3 : 0.05) - d.sweep) * Math.min(1, dt * 4);
        d.bob = -Math.sin(d.flapPhase) * 0.18 * (beat > 0 ? 1 : 0);
        d.headYaw *= 0.95;
      }

      // ---- body orientation from velocity
      if (d.state !== 'perched') {
        const v = d.vel;
        const h = Math.hypot(v.x, v.z);
        if (h > 0.2) d.yaw = Math.atan2(-v.z, v.x);
        const pitchT = THREE.MathUtils.clamp(Math.atan2(v.y, Math.max(h, 0.1)), -0.6, 0.7) + (d.state === 'approach' && d.perch && d.pos.distanceTo(d.perch.p) < 6 ? 0.45 : 0);
        d.pitch += (pitchT - d.pitch) * Math.min(1, dt * 3);
      } else {
        d.pitch += (0.05 - d.pitch) * Math.min(1, dt * 3);
        d.roll *= 0.9;
        d.yaw += Math.sin(d.t * 0.3 + d.i) * 0.002;
      }
      _e.set(d.roll * 0.8, d.yaw + d.headYaw * 0.25, d.pitch, 'YZX');
      _q.setFromEuler(_e);
      // assembly: fly in from far outside the glass
      const enterOff = (1 - d.enter) * 60;
      _p.copy(d.pos).add(new THREE.Vector3(0, d.bob + enterOff * 0.5, 0)).addScaledVector(new THREE.Vector3(Math.cos(d.i * 2.4), 0, Math.sin(d.i * 2.4)), enterOff);
      d.matrix.compose(_p, _q, _s);
      meshes.body.setMatrixAt(d.i, d.matrix);
      meshes.horns.setMatrixAt(d.i, d.matrix);
      meshes.spikes.setMatrixAt(d.i, d.matrix);
      meshes.eyes.setMatrixAt(d.i, d.matrix);
      for (const [k, side] of [[0, 1], [1, -1]]) {
        wingMatrices(d.matrix, roots[k], side, d.flap, d.fold, d.sweep, _mi, _mo);
        meshes.innerMem.setMatrixAt(d.i * 2 + k, _mi);
        meshes.innerBone.setMatrixAt(d.i * 2 + k, _mi);
        meshes.outerMem.setMatrixAt(d.i * 2 + k, _mo);
        meshes.outerBone.setMatrixAt(d.i * 2 + k, _mo);
      }
      _dir.set(0, 0, 0);
    }
    for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;

    // breath particles
    let n = 0;
    for (let k = puffs.length - 1; k >= 0; k--) {
      const p = puffs[k];
      p.life += dt;
      if (p.life > p.max) {
        puffs.splice(k, 1);
        continue;
      }
      p.p.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - dt * 1.5);
      p.v.y += dt * 1.2;
      const u = p.life / p.max;
      if (p.flame) fx.set(n++, p.p.x, p.p.y, p.p.z, 1.6 * (1 - u), 0.7 * (1 - u) * (1 - u), 0.15 * (1 - u), 0.8 + u * 1.6);
      else fx.set(n++, p.p.x, p.p.y, p.p.z, 0.35 * (1 - u), 0.35 * (1 - u), 0.38 * (1 - u), 0.6 + u * 2.4);
    }
    fx.commit(n);
  }

  update(0, 0);
  return { group, dragons, update, events, liveries: LIVERY };
}
