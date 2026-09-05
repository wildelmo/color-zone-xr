import * as THREE from 'three';
import { WORLD } from '../config.js';
import { glowTexture } from '../util/PropMaterial.js';
import { TAU, damp } from '../util/math.js';
import { dart, tada } from '../audio/GuideSounds.js';

/**
 * Guide — Dot leads you to the next thing to do.
 *
 * The pacing spine: when the player has been idle for a moment, Dot picks the
 * nearest thing that still wants colour (a sleeping critter, an unpainted
 * tree, the grey pond), flies over, hovers above it bobbing while a soft
 * beacon pulses there, and comes back to your side once you are close (or
 * once you get busy painting). When the thing is done the celebration
 * happens THERE, and after a breather she picks the next one, a little
 * farther away each time. She never nags: no timers, no failure, at most a
 * gentle "over here" after a long idle, and she waits while you paint.
 *
 *   idle → pick → lead → (resolved | rest) → cooldown → pick → …
 *
 * Public: target { kind, index, pos } | null, resolvedCount, state.
 * Events: guidetarget { kind, index, pos }, guideresolved { kind, index, pos }.
 * Optional friends: app.critters (F1), app.boops (F3), the pondfeed event (F5).
 */
const BANDS = [
  [2, 9],
  [4, 15],
  [8, 24],
  [12, 34],
]; // metres from the head, by targets resolved on this island
const IDLE_TO_PICK = 6; // s without painting/throwing before Dot looks for something to show
const IDLE_AFTER_RESOLVE = 3; // s (after the cooldown): the player is already in the flow
const RETRY = 5; // s between looks when nothing qualified
const VISIT = 25; // s Dot hovers over the target before coming back
const RECALL_IDLE = 20; // s of idling at the player's side before Dot calls again
const MAX_CALLS = 2; // calls per target before Dot gives it a rest and picks another
const ARRIVE = 4; // m: the player is "there"
const BUSY_RETURN = 2.5; // s of continuous painting → Dot comes back to watch
const POLL = 0.25; // s between resolve checks
const HINT_IDLE = 12; // s idle before a situational hint
const LINE_GAP = 12; // s minimum between Dot's guide lines (grows while the player keeps idling)
const HOVER_Y = 1.1; // m above the target where Dot hovers

const LINES = {
  critter: ["Someone's asleep over here!", 'Psst! Someone is sleeping here!'],
  tree: ['This tree needs colour!', 'Paint this tree!'],
  pond: ["Let's wake up the pond!", 'The pond is all grey!'],
};
const RECALL = ['Over here!', 'This way!', 'Come see!'];
const YAY = ['Yay!', 'Hooray!', 'You did it!'];
const DONE = ['Look at all the colours!', 'So pretty!', 'You made this!'];

const _head = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);

export class Guide {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'guide';

    this.state = 'idle'; // idle | lead | cooldown
    this.target = null; // { kind: 'critter'|'tree'|'pond', index, pos: Vector3 }
    this.resolvedCount = 0;
    this.ready = false; // after introdone
    this.idleT = 0; // s since the player last painted / threw / popped
    this.busyT = 0; // s of continuous painting or holding a paint ball
    this.stateT = 0;
    this.cooldown = 0;
    this.pickIdle = IDLE_TO_PICK;
    this.retryT = 0;
    this.nothingLeft = false; // the last look found nothing that wants colour
    this.pollT = 0;
    this.calls = 0;
    this.callT = 0; // app.time of the last call
    this.callDist = 0; // player-to-target distance at the last call
    this.flyUntil = 0; // app.time until which Dot hovers over the target
    this.waitT = 0; // idle s since Dot came back to the player's side
    this.skip = null; // { kind, index }: a target Dot gave a rest after being ignored
    this.hover = new THREE.Vector3(); // where Dot is asked to hover right now
    this.lastLineT = -1e9;
    this.hintCount = 0;
    this.everTeleported = false;
    this.everHeld = false; // the player has found the squeeze (conjured a paint ball)
    this.sparkleT = 0;
    this.orbit = 0;

    // the beacon: one soft additive glow pulsing above the target (+ orbiting sparkles from the FX pool)
    this.beaconColor = new THREE.Color(1, 1, 1);
    this.confettiColors = [new THREE.Color(), new THREE.Color(), new THREE.Color(1, 1, 1)];
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    this.beacon.name = 'guide-beacon';
    this.beacon.scale.setScalar(0.8);
    this.beacon.visible = false;
    this.beacon.renderOrder = 20;
    this.group.add(this.beacon);

    // Dot's generic idle hints are replaced by situational ones from here on
    if (app.buddy) app.buddy.autoHints = false;

    const ev = app.events;
    const busy = () => {
      this.idleT = 0;
      this.hintCount = 0;
    };
    ev.on('paintstart', busy);
    ev.on('strokeend', busy);
    ev.on('splat', busy);
    ev.on('bubblepop', (e) => {
      if (e && e.byHand) busy();
    });
    ev.on('teleport', () => {
      this.everTeleported = true;
    });
    ev.on('introdone', () => {
      this.ready = true;
      this.idleT = 0;
      this.pickIdle = IDLE_TO_PICK;
    });
    ev.on('reset', () => this.reset());
    ev.on('critterwake', (e) => {
      const t = this.target;
      if (t && t.kind === 'critter' && e && e.index === t.index) this._resolve();
    });
    ev.on('pondfeed', () => {
      if (this.target && this.target.kind === 'pond') this._resolve();
    });
  }

  /** same island cleared, or a brand new one: forget everything and start gently */
  reset() {
    this._clearTarget();
    this.state = 'idle';
    this.stateT = 0;
    this.resolvedCount = 0;
    this.skip = null;
    this.calls = 0;
    this.idleT = 0;
    this.retryT = 0;
    this.nothingLeft = false;
    this.pickIdle = IDLE_TO_PICK;
    this.hintCount = 0;
  }

  update(dt, time) {
    const app = this.app;
    if (!this.ready && app.intro && app.intro.done) this.ready = true;
    if (!this.ready || app.mode === 'attract' || !app.buddy) {
      this._beacon(dt, time, false);
      return;
    }
    let painting = false;
    for (const b of app.brushes) if (b.painting) painting = true;
    const held = !!(app.splats && (app.splats.held.left || app.splats.held.right));
    if (held) this.everHeld = true;
    if (painting || held) {
      this.idleT = 0;
      this.busyT += dt;
      this.hintCount = 0;
    } else {
      this.idleT += dt;
      this.busyT = 0;
    }
    this.stateT += dt;
    this.retryT -= dt;
    app.headPosition(_head);

    if (this.state === 'idle') {
      if (this.idleT >= this.pickIdle && this.retryT <= 0) this._pick();
    } else if (this.state === 'cooldown') {
      if (this.stateT >= this.cooldown && this.idleT >= IDLE_AFTER_RESOLVE && this.retryT <= 0) this._pick();
    } else if (this.state === 'lead') {
      this._lead(dt, time);
    }
    this._hints(time);
    this._beacon(dt, time, this.state === 'lead' && !!this.target);
  }

  // ---- picking ----

  _pick() {
    const app = this.app;
    const band = BANDS[Math.min(BANDS.length - 1, this.resolvedCount)];
    // the nearest thing inside the band (sleepers first), else the nearest thing anywhere: there is always a "next"
    let t = this._find(band[0], band[1], true) || this._find(0, Infinity, false);
    if (!t && this.skip) {
      this.skip = null;
      t = this._find(0, Infinity, false);
    }
    if (!t) {
      // nothing wants colour right now: stay idle, Dot just chats
      this.retryT = RETRY;
      this.nothingLeft = true;
      if (this.state !== 'idle') {
        this.state = 'idle';
        this.stateT = 0;
      }
      return;
    }
    this.nothingLeft = false;
    this.target = t;
    this.state = 'lead';
    this.stateT = 0;
    this.calls = 0;
    this.pollT = POLL;
    this._call(false);
    app.events.emit('guidetarget', { kind: t.kind, index: t.index, pos: t.pos.clone() });
  }

  /** nearest unresolved target with head distance in [min, max]; byPriority: sleeper > tree > pond, else nearest of all */
  _find(min, max, byPriority) {
    const app = this.app;
    const pm = app.world.paintMap;
    const skip = this.skip;
    let best = null;
    let bestD = Infinity;
    // 1. a sleeping critter (F1), when that feature is present
    const c = app.critters?.nearestSleeping?.(_head);
    if (c && c.pos && !c.awake && !(skip && skip.kind === 'critter' && skip.index === c.index)) {
      const d = Math.hypot(c.pos.x - _head.x, c.pos.z - _head.z);
      if (d >= min && d <= max) {
        best = this._target('critter', c.index, c.pos.x, c.pos.y, c.pos.z);
        bestD = d;
        if (byPriority) return best;
      }
    }
    // 2. an unpainted tree
    const trees = app.world.flora ? app.world.flora.trees : null;
    if (trees) {
      let ti = -1;
      let td = Infinity;
      for (let i = 0; i < trees.length; i++) {
        const tr = trees[i];
        if (skip && skip.kind === 'tree' && skip.index === i) continue;
        const d = Math.hypot(tr.x - _head.x, tr.z - _head.z);
        if (d < min || d > max || d >= td) continue;
        if (pm.coverageAt(tr.x, tr.z) >= 0.3) continue;
        ti = i;
        td = d;
      }
      if (ti >= 0 && td < bestD) {
        const tr = trees[ti];
        best = this._target('tree', ti, tr.x, tr.canopyY + tr.r * 0.9, tr.z);
        bestD = td;
        if (byPriority) return best;
      }
    }
    // 3. the pond, while it is still grey
    const P = WORLD.pond;
    if (!(skip && skip.kind === 'pond')) {
      const d = Math.hypot(P.x - _head.x, P.z - _head.z);
      if (d >= min && d <= max && d < bestD && pm.coverageAt(P.x, P.z) < 0.4) {
        const y = Math.max(app.world.terrain.waterLevel, app.world.heightAt(P.x, P.z)) + 0.05;
        best = this._target('pond', 0, P.x, y, P.z);
      }
    }
    return best;
  }

  _target(kind, index, x, y, z) {
    return { kind, index, pos: new THREE.Vector3(x, y, z) };
  }

  // ---- leading ----

  /** Dot flies over to the target and says why */
  _call(again) {
    const app = this.app;
    const buddy = app.buddy;
    const t = this.target;
    this.calls++;
    this.waitT = 0;
    this.callT = app.time;
    this.callDist = Math.hypot(t.pos.x - _head.x, t.pos.z - _head.z);
    this.flyUntil = app.time + VISIT;
    this._hover(app.time);
    buddy.visit(this.hover, VISIT);
    buddy.react(0.5);
    buddy.setMood('happy', 1.6);
    this._say(app.rng.pick(again ? RECALL : LINES[t.kind]), 2.4);
    if (app.audio) dart(app.audio, buddy.group.position);
  }

  _say(text, duration) {
    this.app.buddy.say(text, duration);
    this.lastLineT = this.app.time;
  }

  /** where Dot hovers: above the target, bobbing and swaying a little */
  _hover(time) {
    const p = this.target.pos;
    this.hover.set(p.x + Math.sin(time * 0.9) * 0.18, p.y + HOVER_Y + Math.sin(time * 2.4) * 0.13, p.z + Math.cos(time * 0.7) * 0.18);
  }

  /** is Dot's current visit ours (another system may borrow her for a moment)? */
  _goalIsMine() {
    const g = this.app.buddy.goal;
    return !!g && g.pos.distanceToSquared(this.hover) < 1;
  }

  _lead(dt, time) {
    const app = this.app;
    const buddy = app.buddy;
    const t = this.target;
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = POLL;
      if (this._check()) {
        this._resolve();
        return;
      }
    }
    const dist = Math.hypot(t.pos.x - _head.x, t.pos.z - _head.z);
    if (time < this.flyUntil) {
      const dotThere = buddy.pos.distanceToSquared(this.hover) < 0.25;
      const arrived = dist < ARRIVE && (dist < this.callDist - 1 || (dotThere && time - this.callT > 2.5));
      if (arrived || this.busyT > BUSY_RETURN) {
        // the player is here (or got busy painting): Dot comes back to their side
        this.flyUntil = 0;
        if (this._goalIsMine()) buddy.stopVisit();
        if (arrived) buddy.setMood('happy', 1.5);
        this.waitT = 0;
      } else {
        const mine = this._goalIsMine();
        this._hover(time);
        if (mine || !buddy.visiting) buddy.visit(this.hover, this.flyUntil - time);
      }
    } else {
      // Dot is at the player's side; if they idle for a while and the target is still far, she calls again
      this.waitT = this.idleT > 0 ? this.waitT + dt : 0;
      if (this.waitT >= RECALL_IDLE && dist >= ARRIVE) {
        if (this.calls >= MAX_CALLS) this._rest();
        else this._call(true);
      }
    }
  }

  /** the player is not interested right now: give this target a rest and look for another later */
  _rest() {
    const t = this.target;
    this.skip = { kind: t.kind, index: t.index };
    this._clearTarget();
    this.state = 'cooldown';
    this.stateT = 0;
    this.cooldown = 8;
    this.hintCount = 0;
  }

  // ---- resolving ----

  _check() {
    const app = this.app;
    const t = this.target;
    const pm = app.world.paintMap;
    if (t.kind === 'critter') {
      const items = app.critters?.items;
      if (!items) return false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it && it.index === t.index) return !!it.awake;
      }
      return false;
    }
    if (t.kind === 'tree') {
      const tr = app.world.flora && app.world.flora.trees[t.index];
      if (!tr) return false;
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU;
        sum += pm.coverageAt(tr.x + Math.cos(a) * 0.6, tr.z + Math.sin(a) * 0.6);
      }
      return sum / 3 >= 0.5;
    }
    if (t.kind === 'pond') {
      const P = WORLD.pond;
      let sum = pm.coverageAt(P.x, P.z);
      if (sum >= 0.5) return true;
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU;
        sum += pm.coverageAt(P.x + Math.cos(a) * 2.6, P.z + Math.sin(a) * 2.6);
      }
      return sum / 5 >= 0.5;
    }
    return false;
  }

  /** celebrate at the place, then a breather */
  _resolve() {
    if (this.state !== 'lead' || !this.target) return;
    const app = this.app;
    const t = this.target;
    const p = t.pos;
    const fx = app.fx;
    const quiet = !!(app.saveGame && app.saveGame.loading);
    app.world.paintMap.colorAt(p.x, p.z, _c);
    if (_c.r + _c.g + _c.b < 0.15) _c.copy(app.paint.color);
    if (fx && !quiet) {
      if (t.kind === 'tree') {
        const tr = app.world.flora && app.world.flora.trees[t.index];
        _p.set(p.x, tr ? tr.canopyY : p.y, p.z);
        this.confettiColors[0].copy(_c);
        this.confettiColors[1].copy(_c).lerp(_white, 0.45);
        fx.confetti(_p, 34, this.confettiColors, 1.9);
        fx.burst(_p, _c, 26, 1.5, 0.05);
        app.boops?.pokeTree?.(t.index);
      } else if (t.kind === 'pond') {
        _p.copy(p);
        fx.splash(_p, _c, 30, 2.4);
        fx.burst(_p, _c, 26, 1.6, 0.05);
      } else {
        _p.set(p.x, p.y + 0.3, p.z);
        fx.burst(_p, _c, 18, 1.2, 0.045);
      }
      if (app.audio) tada(app.audio, _p, t.kind === 'critter' ? 0.35 : 0);
    }
    if (!quiet) {
      const buddy = app.buddy;
      buddy.react(1);
      buddy.spinVel += 16;
      buddy.setMood('happy', 2.5);
      buddy.say(app.rng.pick(YAY), 1.8);
      app.bumpEnergy(0.4);
    }
    this.resolvedCount++;
    this.skip = null;
    this.hintCount = 0;
    this._clearTarget();
    this.state = 'cooldown';
    this.stateT = 0;
    this.cooldown = 8 + app.rng.float() * 7;
    app.events.emit('guideresolved', { kind: t.kind, index: t.index, pos: p });
  }

  _clearTarget() {
    const buddy = this.app.buddy;
    if (buddy && this.target && this._goalIsMine()) buddy.stopVisit();
    this.target = null;
    this.flyUntil = 0;
  }

  // ---- hints ----

  /** situational nudges instead of Dot's generic idle hints; only after a long idle, never more than one per 12 s */
  _hints(time) {
    const app = this.app;
    if (this.idleT < HINT_IDLE) return;
    const gap = LINE_GAP + 8 * Math.min(3, this.hintCount);
    if (time - this.lastLineT < gap) return;
    if (this.state === 'lead' && this.target) {
      const h = app.hands;
      const controllers = app.mode === 'xr' && ((h.left.connected && !h.left.isTrackedHand) || (h.right.connected && !h.right.isTrackedHand));
      const tracked = (h.left.connected && h.left.isTrackedHand) || (h.right.connected && h.right.isTrackedHand);
      let line;
      if (this.resolvedCount === 0 && !this.everTeleported && controllers) line = 'Push the stick forward to hop closer!';
      else if (this.resolvedCount === 0 && !this.everTeleported && app.mode === 'desktop') line = 'Walk over with the W key!';
      else if (!this.everHeld && app.world.progress > 0.1 && (controllers || tracked)) line = tracked ? 'Make a fist to throw paint!' : 'Squeeze to throw paint!';
      else line = app.rng.pick(LINES[this.target.kind]);
      app.buddy.react(0.4);
      this._say(line, 2.6);
      this.hintCount++;
      // three nudges with no progress while Dot is at your side: this one can wait, she will find something else
      if (this.hintCount >= 3 && time >= this.flyUntil) this._rest();
    } else if (this.state === 'idle' && this.nothingLeft && app.world.progress > 0.5 && time - this.lastLineT > 60) {
      // nothing left to point at: an occasional happy observation is all
      this._say(app.rng.pick(DONE), 2.4);
    }
  }

  // ---- beacon ----

  _beacon(dt, time, on) {
    const mat = this.beacon.material;
    if (!on) {
      if (this.beacon.visible) {
        mat.opacity = damp(mat.opacity, 0, 10, dt);
        if (mat.opacity < 0.02) {
          mat.opacity = 0;
          this.beacon.visible = false;
        }
      }
      return;
    }
    const app = this.app;
    const p = this.target.pos;
    // a pale version of the current paint colour, pulsing; bigger when far so it reads across the island
    this.beaconColor.copy(app.paint.color).lerp(_white, 0.55);
    mat.color.copy(this.beaconColor);
    const dist = Math.hypot(p.x - _head.x, p.z - _head.z);
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);
    const size = (0.7 + Math.min(1.1, dist * 0.03)) * (0.8 + pulse * 0.35);
    this.beacon.scale.setScalar(size);
    this.beacon.position.set(p.x, p.y + 0.4 + Math.sin(time * 2.2) * 0.06, p.z);
    this.beacon.visible = true;
    mat.opacity = damp(mat.opacity, 0.3 + pulse * 0.4, 6, dt);
    // three lazy sparkles orbiting the glow
    this.sparkleT -= dt;
    if (this.sparkleT <= 0 && app.fx) {
      this.sparkleT = 0.25;
      this.orbit += 0.5;
      const r = 0.4 + Math.min(0.6, dist * 0.02);
      const sz = 0.03 + Math.min(0.05, dist * 0.002);
      for (let k = 0; k < 3; k++) {
        const a = this.orbit + (k / 3) * TAU;
        _p.set(p.x + Math.cos(a) * r, this.beacon.position.y + Math.sin(a * 2 + time * 1.3) * 0.15, p.z + Math.sin(a) * r);
        _v.set(-Math.sin(a) * 0.3, 0.1, Math.cos(a) * 0.3);
        app.fx.sparkle(_p, _v, this.beaconColor, 1.0, sz);
      }
    }
  }
}
