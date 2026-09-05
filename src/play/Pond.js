import * as THREE from 'three';
import { WORLD } from '../config.js';
import { Fish } from '../creatures/Fish.js';
import { plop, gulp, ripple } from '../audio/PondSounds.js';

/**
 * Pond life — the pond gets a job and throwing gets a target.
 *
 *  - A paint ball that hits the water goes KERSPLOOSH: a ring of droplets,
 *    the whole pond takes the colour (the water shader reads the paint map),
 *    the fountain is FED that colour and every koi leaps.
 *  - Painting over the water feeds the fountain too (the hand-tracking path).
 *  - The fountain remembers every colour (Props.js Fountain.fed/level): each
 *    new one makes it gush higher and bubblier; twelve = a rainbow fountain.
 *  - The koi (creatures/Fish.js) come to your wand, nibble and leap.
 *
 * Owns the Splats water hook (`splats.waterHandler`), drives the fountain's
 * update, and persists the fed colours through SaveGame ('pond').
 */
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const EMPTY = new Set();
const SPLASH_LINES = ['Kersploosh!', 'Big splash!', 'The fountain loves it!', 'Whoa, so wet!'];
const FEED_LINES = ['Ooh, a new colour!', 'Look at it go!', 'It grew!', 'Feed it more!'];
const FISH_LINES = ['A fish! It likes you!', 'Wheee, splash!', 'It took your colour!', 'Hello, fishy!'];

export class Pond {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'pond-life';
    this.fish = new Fish(app);
    this.group.add(this.fish.sketch, this.fish.colored);
    this.hits = 0; // paint balls that hit the water
    this.feeds = 0; // feeds (balls + strokes over the water)
    this.paintFeedT = 0;
    this.sayT = 0;
    this.fishSaid = 0;
    this._handler = (b) => this.plop(b);
    this._hook();
    this._registerSave();
    app.events.on('reset', () => this._onReset());
    app.events.on('fishleap', (e) => this._onFishLeap(e));
  }

  /** the fountain has been fed at least one colour */
  get awake() {
    return this.fed.size > 0;
  }

  /** the colours the fountain has been fed (Set of '#rrggbb' palette keys) */
  get fed() {
    return this.app.world.fountain ? this.app.world.fountain.fed : EMPTY;
  }

  /** wire up the water hook and hand the (possibly rebuilt) fountain its app reference */
  _hook() {
    const app = this.app;
    if (app.splats && app.splats.waterHandler !== this._handler) app.splats.waterHandler = this._handler;
    const f = app.world.fountain;
    if (f && f.app !== app) f.app = app;
  }

  _registerSave() {
    const app = this.app;
    const handler = { serialize: () => this.serialize(), restore: (d) => this.restore(d) };
    if (app.saveGame) {
      app.saveGame.register('pond', handler);
      return;
    }
    // SaveGame is constructed (and loads) right after the play layer, so catch the
    // assignment and register in time for its restore pass. Chains any earlier hook.
    const prev = Object.getOwnPropertyDescriptor(app, 'saveGame');
    let value = prev && !prev.get ? prev.value : undefined;
    Object.defineProperty(app, 'saveGame', {
      configurable: true,
      enumerable: true,
      get: () => (prev && prev.get ? prev.get.call(app) : value),
      set: (v) => {
        if (prev && prev.set) prev.set.call(app, v);
        value = v;
        if (v && typeof v.register === 'function') v.register('pond', handler);
      },
    });
  }

  serialize() {
    const f = this.app.world.fountain;
    return f && f.fed.size ? { fed: Array.from(f.fed) } : undefined;
  }

  /** silent restore: the fountain remembers its colours and the water keeps the last one */
  restore(d) {
    const f = this.app.world.fountain;
    if (!f || !d || !Array.isArray(d.fed)) return;
    f.app = this.app;
    for (const hex of d.fed) {
      if (typeof hex !== 'string') continue;
      _c.set(hex);
      f.feed(_c, { quiet: true });
    }
    const last = f.fedColors[f.fedColors.length - 1];
    if (last) this.app.world.paintMap.stamp(WORLD.pond.x, WORLD.pond.z, WORLD.pond.radius * 0.95, last, 0.7, 0.35);
  }

  _onReset() {
    const f = this.app.world.fountain;
    if (f) {
      f.app = this.app;
      f.clearFed(); // the colour is wiped, so the fountain forgets too
    }
    this.fish.reset();
    this._hook();
  }

  _onFishLeap(e) {
    const buddy = this.app.buddy;
    if (!buddy || !e || !e.byHand) return;
    if (this.sayT > 0 || this.fishSaid >= 4) return;
    this.sayT = 8;
    this.fishSaid++;
    buddy.react(0.7);
    buddy.setMood('happy', 1.5);
    buddy.say(this.fishSaid === 1 ? FISH_LINES[0] : this.app.rng.pick(FISH_LINES), 1.8);
  }

  /** a paint ball reached the water: kersploosh (called by Splats through waterHandler) */
  plop(b) {
    const app = this.app;
    const world = app.world;
    const rng = app.rng;
    const wl = world.terrain.waterLevel;
    const p = b.mesh.position;
    _p.set(p.x, wl + 0.01, p.z);
    _c.copy(b.color);
    const speed = b.vel.length();
    const big = Math.min(1.6, 0.8 + speed * 0.1) * Math.max(0.5, b.mesh.scale.x || 1);
    if (app.fx) {
      app.fx.splash(_p, _c, Math.round(40 * big), 3.0 + speed * 0.25);
      app.fx.burst(_p, _c, Math.round(30 * big), 2.6, 0.06);
      app.fx.confetti(_p, 10, [_c], 1.6);
      // a spreading ring of droplets at the water level
      const n = 24;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rng.float() * 0.2;
        _v.set(Math.cos(a) * (2.0 + rng.float()), 1.6 + rng.float() * 0.8, Math.sin(a) * (2.0 + rng.float())).multiplyScalar(big);
        app.fx.bits.emit(_p.x, _p.y, _p.z, _v.x, _v.y, _v.z, _c.r, _c.g, _c.b, app.time, 0.8 + rng.float() * 0.5, 0.03 + rng.float() * 0.02, 2, rng.float());
      }
    }
    // the whole pond takes the colour (no decal: water keeps no splat)
    world.paintMap.stamp(p.x, p.z, 4, _c, 0.9, 0.5);
    world.paintMap.stamp(WORLD.pond.x, WORLD.pond.z, WORLD.pond.radius * 0.95, _c, 0.7, 0.35);
    if (app.audio) plop(app.audio, _p, big);
    for (const hand of [app.hands.left, app.hands.right]) if (hand.connected) hand.pulse(0.5, 60);
    this.fish.leapAll(_p, _c);
    this.feed(_c, { by: 'ball' });
    app.bumpEnergy(0.5);
    this.hits++;
    const buddy = app.buddy;
    if (buddy) {
      buddy.react(1);
      buddy.setMood('surprised', 0.8);
      buddy.spinVel += 8;
      if (this.sayT <= 0) {
        this.sayT = 4;
        buddy.say(rng.pick(SPLASH_LINES), 1.8);
      }
    }
    app.events.emit('waterhit', { position: _p.clone(), color: _c.clone(), radius: 4, speed });
    app.splats.consume(b);
  }

  /** feed the fountain a colour (ball or brush). Returns true when the colour was new. */
  feed(color, { by = 'ball' } = {}) {
    const app = this.app;
    const f = app.world.fountain;
    if (!f) return false;
    if (f.app !== app) f.app = app;
    const isNew = f.feed(color);
    this.feeds++;
    if (app.audio) gulp(app.audio, f.top, f.level, isNew);
    if (isNew) {
      app.bumpEnergy(0.3);
      const buddy = app.buddy;
      if (buddy && this.sayT <= 0 && by === 'paint') {
        this.sayT = 5;
        buddy.react(0.6);
        buddy.say(app.rng.pick(FEED_LINES), 1.6);
      }
      if (f.fed.size >= 12) {
        // every colour: a rainbow fountain!
        if (app.fx) {
          app.fx.confetti(f.top, 80, null, 3.0);
          app.fx.burst(f.top, new THREE.Color('#ffffff'), 60, 3.0, 0.08);
        }
        app.events.emit('toast', { text: 'Rainbow fountain!', icon: '🌈', big: true, duration: 3 });
        if (buddy) {
          buddy.react(1);
          buddy.setMood('happy', 3);
          buddy.spinVel += 16;
          buddy.say('A RAINBOW fountain!', 2.6);
        }
      }
    }
    if (app.saveGame && !app.saveGame.loading) app.saveGame.markDirty();
    return isNew;
  }

  /** painting over the water feeds the fountain too (throttled), with a small splash under the brush */
  _paintFeeds(dt, wl) {
    const app = this.app;
    const world = app.world;
    this.paintFeedT -= dt;
    if (this.paintFeedT > 0) return;
    for (const brush of app.brushes) {
      if (!brush.painting) continue;
      const s = brush.smooth;
      if (!world.terrain.isWater(s.x, s.z)) continue;
      this.paintFeedT = 0.5;
      brush.currentColor(_c);
      _p.set(s.x, wl + 0.01, s.z);
      if (app.fx) {
        app.fx.splash(_p, _c, 10, 1.3);
        app.fx.burst(_p, _c, 8, 0.8, 0.03);
      }
      world.paintMap.stamp(s.x, s.z, 2.0, _c, 0.5, 0.6); // colour swirls out across the water
      if (app.audio) ripple(app.audio, _p);
      this.feed(_c, { by: 'paint' });
      break;
    }
  }

  update(dt, time) {
    const app = this.app;
    this._hook(); // World.buildIsland recreates the fountain on a new island
    const wl = app.world.terrain.waterLevel;
    this.sayT -= dt;
    const f = app.world.fountain;
    if (f && f.update) f.update(dt, time);
    this._paintFeeds(dt, wl);
    this.fish.update(dt, time);
  }
}
