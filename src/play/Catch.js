import * as THREE from 'three';
import { thup, lobWhoosh, bigSplat, rallyTada } from '../audio/CatchSounds.js';

/**
 * Catch! — play catch with Dot (and with your own hands).
 *
 * Squeeze as a flying paint ball reaches your hand and it is yours again
 * (let go to throw it on). Throw a ball at Dot and she darts to meet it,
 * catches it with a squash and a "Got it!", then lobs it back in a lazy
 * arc to where your hand is. Every catch makes the ball bigger and
 * brighter, three in a row is a "Rally!", and when the ball finally lands
 * it splats huge. Dot starts the first game herself right after the
 * player's first splat. A missed catch is just a splat — no failure.
 *
 * Registered with app.addSystemBefore(catch, app.splats): it runs BEFORE
 * Splats so a catch consumes the squeeze (hand.grabBlocked) before Splats
 * would conjure a fresh ball from the same press.
 */
const HAND_REACH = 0.2; // a ball whose path passes this close to the tip can be caught
const PALM_REACH = 0.08; // tracked hands: a ball touching the closed fist sticks by itself
const LATE = 0.15; // kids are late: the squeeze may come this long after the ball passed
const EARLY = 0.6; // ...and early: a squeeze while the ball is this close (s) to arriving waits for it instead of conjuring
const TOSS = 0.4; // a ball in flight for less than this is a re-grab, not a catch (no growth, no rally)
const DOT_REACH = 0.35; // Dot catches a ball passing this close to her
const DOT_CONE = Math.cos((35 * Math.PI) / 180); // "thrown at Dot": heading within 35° of her (horizontal)
const DOT_MISS = 1.6; // ...and predicted to pass within this of her, otherwise she just watches
const DART_SPEED = 4; // m/s sprint toward the interception point (on top of Buddy's own approach)
const LOB_DELAY = 0.7; // s between Dot's catch and her throw-back
const LOB_T = 1.1; // flight time of the lob (grows a little for far players)
const GRAVITY = 6.5; // Splats' gravity
const DRAG = 0.08; // Splats' air drag per second
const MAX_CHARGE = 6; // scale 1.6, splat radius ×1.9

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _sa = new THREE.Vector3();
const _sb = new THREE.Vector3();
const _head = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _p = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _best = new THREE.Vector3();
const _target = new THREE.Vector3();
const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

/** distance from point p to the segment a→b */
function segDist(p, a, b) {
  _sb.subVectors(b, a);
  const l2 = _sb.lengthSq();
  let t = 0;
  if (l2 > 1e-8) t = Math.max(0, Math.min(1, _sa.subVectors(p, a).dot(_sb) / l2));
  return _sa.copy(a).addScaledVector(_sb, t).distanceTo(p);
}

export class Catch {
  constructor(app) {
    this.app = app;
    this.rally = 0; // consecutive catches on the ball in play
    this.best = 0; // longest rally this session
    this.catches = 0; // total catches (hand + Dot)
    this.handCatches = 0;
    this.dotCatches = 0;
    this.lobs = 0; // balls Dot threw to the player
    this.opened = false; // Dot has started the first game (once per session)
    this.openAt = -1;
    this.sawSplat = false;
    this.pending = null; // Dot's throw-back { t, color, charge, catches }
    this.pendingColor = new THREE.Color();
    this.chase = null; // the ball Dot is going for
    this.chaseT = -1;
    this.dotT = 0;
    this.dartGoal = new THREE.Vector3();
    this.lastLob = null; // { from, target, catches, T } — for tests and tuning
    this.balls = []; // flying balls we have seen (swept paths, landing detection)
    this.reach = { left: { ball: null, t: -1e9 }, right: { ball: null, t: -1e9 } };
    this.handList = [app.hands.left, app.hands.right];
    const ev = app.events;
    ev.on('splat', () => {
      this.sawSplat = true;
      this._maybeOpen();
    });
    ev.on('introdone', () => this._maybeOpen());
    ev.on('ballconsumed', (b) => {
      if (b) b.consumed = true;
    });
    ev.on('reset', () => this._clear());
    ev.on('sessionend', () => this._clear());
  }

  /** a ball is in play with Dot (she is chasing one or about to throw one back) */
  get busy() {
    return !!(this.chase || this.pending);
  }

  _clear() {
    this.pending = null;
    this.openAt = -1;
    this._endChase();
    this.balls.length = 0;
    this.rally = 0;
    this.reach.left.ball = this.reach.right.ball = null;
  }

  /** Dot starts the very first game ~2 s after the player's first splat */
  _maybeOpen() {
    const app = this.app;
    if (this.opened || this.openAt >= 0 || !this.sawSplat) return;
    if (!app.intro?.done || app.saveGame?.loading || app.mode === 'attract') return;
    this.openAt = app.time + 2;
  }

  _open() {
    this.openAt = -1;
    if (this.opened || this.busy) return;
    this.opened = true;
    const buddy = this.app.buddy;
    buddy.say('Catch!', 1.3);
    buddy.setMood('happy', 1.5);
    this._lob({ color: this.pendingColor.copy(this.app.paint.color), charge: 0, catches: 0 });
  }

  update(dt, time) {
    const app = this.app;
    if (!app.splats || !app.buddy) return;
    if (this.openAt >= 0 && time >= this.openAt) this._open();
    if (this.pending && time >= this.pending.t) this._lob(this.pending);
    this._scan();
    this._hands(time);
    this._dot(dt, time);
    this._trail();
  }

  /** notice balls that left the world (a rally ball landing is a big deal) and adopt new ones */
  _scan() {
    const splats = this.app.splats;
    const list = this.balls;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (splats.balls.indexOf(b) >= 0) continue;
      list.splice(i, 1);
      if (splats.held.left === b || splats.held.right === b) continue; // caught by a hand: still in play
      if (b === this.chase) {
        this._endChase();
        if (!b.consumed) this.app.buddy.setMood('surprised', 0.8); // she went for it and it got away
      }
      if (b.consumed) continue; // Dot caught it (the rally goes on) or the pond swallowed it
      this._landed(b);
    }
    for (let i = 0; i < splats.balls.length; i++) {
      const b = splats.balls[i];
      if (!b.flying || list.indexOf(b) >= 0) continue;
      if (!b.cprev) b.cprev = new THREE.Vector3();
      b.cprev.copy(b.mesh.position);
      list.push(b);
    }
  }

  /** a ball that had been caught finally splatted: the rally is over, and the bigger it was the bigger the party */
  _landed(b) {
    const catches = b.catches || 0;
    if (catches <= 0) return; // an ordinary throw: Splats' splat is all the fanfare it needs
    this.rally = 0;
    const app = this.app;
    const p = b.mesh.position;
    if (p.y < -5 || !app.world.terrain.isOnIsland(p.x, p.z, 0.5)) return; // fell off the world
    const k = Math.min(6, catches);
    if (app.fx) {
      app.fx.confetti(p, 14 + 8 * k, null, 2.2 + 0.2 * k);
      app.fx.burst(p, b.color, 20 + 10 * k, 3 + 0.4 * k, 0.06);
    }
    bigSplat(app.audio, p, catches);
    if (catches >= 3) {
      const buddy = app.buddy;
      buddy.react(0.8);
      buddy.spinVel += 10;
      buddy.say(app.rng.pick(['Ka-splat!', 'Big one!', 'Whoa, huge!']), 1.6);
    }
  }

  /** hands: squeeze as a ball reaches you and it is yours again */
  _hands(time) {
    const app = this.app;
    const splats = app.splats;
    const balls = splats.balls;
    if (!balls.length) return;
    for (let h = 0; h < 2; h++) {
      const hand = this.handList[h];
      const key = hand.handedness;
      if (!hand.connected || !hand.hasTip || hand.uiBlocked) continue;
      // a conjured ball (the squeeze came early) gives way to the ball that arrives; a caught one never does
      const held = splats.held[key];
      if (held && held.catches > 0) continue;
      const tip = hand.tip;
      const r = this.reach[key];
      let caught = null;
      let incoming = false;
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        if (!b.flying || b.age < 0.12) continue; // a ball just thrown must leave the hand first
        const d = segDist(tip, b.cprev || b.mesh.position, b.mesh.position);
        if (d < HAND_REACH) {
          r.ball = b;
          r.t = time;
        }
        if (hand.isTrackedHand && hand.fist && d < PALM_REACH) {
          caught = b; // it touched the closed fist: it sticks
          break;
        }
        if (!held && !incoming && hand.squeezePressed && d < 2.5 && this._arriving(b, tip)) incoming = true;
      }
      if (!caught && hand.squeezeDown && r.ball && time - r.t <= LATE && r.ball.flying && balls.indexOf(r.ball) >= 0) caught = r.ball;
      if (caught) {
        if (held) {
          caught.charge = Math.max(caught.charge || 0, held.charge || 0); // the bigness you built up stays
          splats.held[key] = null;
          splats.consume(held);
        }
        this._handCatch(hand, caught, time);
      } else if (incoming) hand.grabBlocked = true; // squeezed a moment early: wait for the ball instead of conjuring a new one
    }
  }

  /** will this ball pass within reach of the tip in the next EARLY seconds? (Splats' gravity + drag, fine steps) */
  _arriving(b, tip) {
    _p.copy(b.mesh.position);
    _vel.copy(b.vel);
    const g = b.gravity || GRAVITY;
    const h = 0.025;
    const steps = Math.ceil(EARLY / h);
    for (let k = 0; k < steps; k++) {
      _vel.y -= g * h;
      _vel.multiplyScalar(1 - DRAG * h);
      _p.addScaledVector(_vel, h);
      if (_p.distanceTo(tip) < HAND_REACH + 0.05) return true;
    }
    return false;
  }

  _handCatch(hand, b, time) {
    const app = this.app;
    const splats = app.splats;
    const key = hand.handedness;
    const i = splats.balls.indexOf(b);
    if (i >= 0) splats.balls.splice(i, 1);
    const li = this.balls.indexOf(b);
    if (li >= 0) this.balls.splice(li, 1);
    if (b === this.chase) this._endChase();
    const toss = b.fromDot || b.age >= TOSS; // a real catch, not a quick re-grab of a ball you just let go of
    b.flying = false;
    b.fromDot = false; // a ball in the player's hand is the player's throw next
    b.vel.set(0, 0, 0);
    b.mesh.position.copy(hand.tip);
    splats.held[key] = b;
    hand.grabBlocked = true;
    this.reach[key].ball = null;
    if (!toss) {
      hand.pulse(0.4, 30);
      thup(app.audio, hand.tip, 0);
      return;
    }
    this._grow(b);
    hand.pulse(0.8, 40);
    thup(app.audio, hand.tip, b.charge);
    if (app.fx) app.fx.burst(hand.tip, b.color, 10, 0.7, 0.03);
    this.handCatches++;
    this._score('hand', hand.tip, hand, b, time);
  }

  /** one more catch on this ball: bigger and brighter */
  _grow(b) {
    b.catches = (b.catches || 0) + 1;
    b.charge = Math.min(MAX_CHARGE, (b.charge || 0) + 1);
    this._style(b, true);
  }

  /** the look of a charged / rallied ball (scale from charge, glow with it) */
  _style(b, withScale) {
    const k = Math.min(MAX_CHARGE, b.charge || 0);
    if (withScale) b.mesh.scale.setScalar(1 + 0.1 * k);
    b.glow.material.opacity = Math.min(1, 0.7 + 0.05 * k);
    b.glow.scale.setScalar(0.22 + 0.025 * k);
    const u = b.mesh.material.uniforms;
    if (u && u.emissive) u.emissive.value.copy(b.color).multiplyScalar(0.25 + 0.1 * k);
  }

  _score(by, pos, hand, b, time) {
    const app = this.app;
    this.catches++;
    this.rally++;
    if (this.rally > this.best) this.best = this.rally;
    app.bumpEnergy(0.15);
    app.events.emit('catch', { by, position: pos.clone(), hand: hand ? hand.handedness : null, rally: this.rally, catches: b.catches || 0, time });
    if (this.rally % 3 === 0) this._rallyCheer(pos, b);
  }

  _rallyCheer(pos, b) {
    const app = this.app;
    const n = this.rally;
    const text = n === 3 ? 'Rally!' : n === 6 ? 'Super rally!' : n === 9 ? 'Mega rally!' : `Rally ×${n}!`;
    app.events.emit('toast', { text, duration: 2 });
    if (app.fx) {
      app.fx.confetti(pos, 40, null, 2.4);
      app.fx.burst(pos, b.color, 30, 2.5, 0.05);
    }
    rallyTada(app.audio, pos);
    const buddy = app.buddy;
    buddy.react(1);
    buddy.spinVel += 16;
    buddy.setMood('happy', 2);
    buddy.say(app.rng.pick(['Rally!', "We're a great team!", 'Keep it going!']), 1.8);
  }

  /** Dot: catch what comes close, dart after what is thrown her way */
  _dot(dt, time) {
    const app = this.app;
    const buddy = app.buddy;
    const balls = app.splats.balls;
    const dot = buddy.group.position;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!b.flying || b.fromDot) continue;
      if (segDist(dot, b.cprev || b.mesh.position, b.mesh.position) < DOT_REACH) {
        this._dotCatch(b, time);
        return;
      }
    }
    if (this.chase && (!this.chase.flying || balls.indexOf(this.chase) < 0)) this._endChase();
    if (this.chase) {
      // past her and leaving (horizontally, so a high lob still counts as coming): let it go
      _v.subVectors(dot, this.chase.mesh.position);
      _v.y = 0;
      _w.copy(this.chase.vel);
      _w.y = 0;
      if (_v.dot(_w) < 0 && _v.length() > 0.6) this._endChase();
    }
    if (time - this.dotT >= 0.1) {
      this.dotT = time;
      if (!this.chase) {
        for (let i = 0; i < balls.length; i++) {
          const b = balls[i];
          if (!b.flying || b.fromDot || !this._towardDot(b, dot)) continue;
          if (this._intercept(b, dot) > DOT_MISS) continue;
          this.chase = b;
          buddy.setMood('surprised', 0.6);
          buddy.react(0.3);
          break;
        }
      } else this._intercept(this.chase, dot);
    }
    if (this.chase) {
      buddy.visit(this.dartGoal, 0.6);
      // Buddy's own approach is lazy; a catch needs a sprint
      _v.subVectors(this.dartGoal, buddy.pos);
      const d = _v.length();
      if (d > 0.02) buddy.pos.addScaledVector(_v, Math.min(1, (DART_SPEED * dt) / d));
    }
  }

  /** is this ball heading roughly at Dot (horizontal cone)? */
  _towardDot(b, dot) {
    _v.subVectors(dot, b.mesh.position);
    _v.y = 0;
    const d = _v.length();
    if (d < 0.05 || d > 12) return false;
    _w.copy(b.vel);
    _w.y = 0;
    const sp = _w.length();
    if (sp < 0.4) return false;
    return _v.dot(_w) / (d * sp) > DOT_CONE;
  }

  /** predict the ball's path and pick the point closest to Dot as her dart goal; returns that distance */
  _intercept(b, dot) {
    const world = this.app.world;
    _p.copy(b.mesh.position);
    _vel.copy(b.vel);
    const g = b.gravity || GRAVITY;
    let best = Infinity;
    _best.copy(_p);
    for (let k = 0; k < 30; k++) {
      _vel.y -= g * 0.05;
      _vel.multiplyScalar(1 - DRAG * 0.05);
      _p.addScaledVector(_vel, 0.05);
      if (_p.y < world.heightAt(_p.x, _p.z) + 0.1) break; // it lands here
      const d = _p.distanceTo(dot);
      if (d < best) {
        best = d;
        _best.copy(_p);
      }
    }
    const gy = world.heightAt(_best.x, _best.z);
    if (_best.y < gy + 0.5) _best.y = gy + 0.5; // Buddy never flies lower than this anyway
    this.dartGoal.copy(_best);
    return best;
  }

  _endChase() {
    this.chase = null;
    const buddy = this.app.buddy;
    const g = buddy && buddy.goal;
    if (g && g.pos.equals(this.dartGoal)) buddy.stopVisit(); // only our own visit, never a guide's
  }

  _dotCatch(b, time) {
    const app = this.app;
    const buddy = app.buddy;
    const p = _p.copy(b.mesh.position);
    b.catches = (b.catches || 0) + 1;
    b.charge = Math.min(MAX_CHARGE, (b.charge || 0) + 1);
    const li = this.balls.indexOf(b);
    if (li >= 0) this.balls.splice(li, 1);
    if (b === this.chase) this._endChase();
    app.splats.consume(b);
    buddy.react(0.5);
    buddy.squash = Math.min(1.5, buddy.squash + 1);
    buddy.setMood('happy', 1.4);
    buddy.color.copy(b.color);
    buddy.say(app.rng.pick(['Got it!', 'Got it!', 'Gotcha!', 'Mine!']), 1.1);
    if (app.fx) app.fx.burst(p, b.color, 18, 1.3, 0.04);
    thup(app.audio, p, b.charge);
    this.dotCatches++;
    this.pending = { t: time + LOB_DELAY, color: this.pendingColor.copy(b.color), charge: b.charge, catches: b.catches };
    this._score('dot', p, null, b, time);
  }

  /** where Dot throws to: the player's hand (nudged toward the head), or the chest if there is no hand */
  _aim(out) {
    const app = this.app;
    app.headPosition(_head);
    const h = app.hands;
    let hand = h.right.connected && h.right.hasTip ? h.right : h.left.connected && h.left.hasTip ? h.left : null;
    if (hand && hand.tip.distanceTo(_head) > 1.3) hand = null; // tracking went somewhere silly
    if (hand) {
      out.copy(hand.tip);
      _w.subVectors(_head, out);
      const d = _w.length();
      if (d > 1e-3) out.addScaledVector(_w, Math.min(1, 0.15 / d));
    } else {
      app.headQuaternion(_q);
      _w.set(0, 0, -1).applyQuaternion(_q);
      _w.y = 0;
      if (_w.lengthSq() < 1e-4) _w.set(0, 0, -1);
      _w.normalize();
      out.copy(_head).addScaledVector(_w, 0.25);
      out.y -= 0.3;
    }
    return out;
  }

  /** Dot lobs a ball to the player: a lazy arc that lands right where the hand is */
  _lob(pending) {
    const app = this.app;
    const buddy = app.buddy;
    this.pending = null;
    app.headPosition(_head);
    const dot = buddy.group.position;
    // from just in front of Dot (toward the player) so the ball pops out of her, not through her
    _fwd.subVectors(_head, dot);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    else _fwd.normalize();
    _p.copy(dot).addScaledVector(_fwd, 0.14);
    _p.y += 0.04;
    this._aim(_target);
    _v.subVectors(_target, _p);
    const dist = _v.length();
    const T = Math.min(2, LOB_T + Math.max(0, dist - 2.5) * 0.12);
    // exact launch velocity under gravity + Splats' linear drag: v = D·A + ŷ·(g/k)(T·A − 1), A = k / (1 − e^(−kT))
    const A = DRAG / (1 - Math.exp(-DRAG * T));
    _vel.copy(_v).multiplyScalar(A);
    _vel.y += (GRAVITY / DRAG) * (T * A - 1);
    const sp = _vel.length();
    if (sp > 12) _vel.multiplyScalar(12 / sp);
    const nb = app.splats.launch(_p, _vel, pending.color, { scale: 1, gravity: GRAVITY });
    nb.catches = pending.catches;
    nb.charge = pending.charge;
    nb.fromDot = true;
    this._style(nb, true);
    buddy.react(0.4);
    buddy.squash = Math.min(1.5, buddy.squash + 0.5);
    buddy.spinVel += 9;
    lobWhoosh(app.audio, _p);
    if (app.fx) app.fx.burst(_p, pending.color, 12, 0.9, 0.03);
    this.lobs++;
    this.lastLob = { from: _p.clone(), target: _target.clone(), catches: pending.catches, T };
    app.events.emit('lob', { position: _p.clone(), target: _target.clone(), catches: pending.catches });
  }

  /** sparkling trail behind rallied / charged balls, a brighter held ball while it charges; remember positions for the sweeps */
  _trail() {
    const app = this.app;
    const fx = app.fx;
    const rng = app.rng;
    const splats = app.splats;
    const balls = splats.balls;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!b.flying) continue;
      const k = Math.min(MAX_CHARGE, b.charge || 0);
      if (fx && (b.fromDot || k >= 1.5) && rng.chance(0.45 + 0.08 * k)) {
        _v.set(rng.gauss() * 0.3, 0.1 + rng.float() * 0.3, rng.gauss() * 0.3);
        _c.copy(b.color).lerp(WHITE, 0.3 + rng.float() * 0.5);
        fx.sparkle(b.mesh.position, _v, _c, 0.35 + rng.float() * 0.4, 0.02 + 0.005 * k);
      }
      if (b.cprev) b.cprev.copy(b.mesh.position);
    }
    for (let h = 0; h < 2; h++) {
      const held = splats.held[this.handList[h].handedness];
      if (held) this._style(held, false);
    }
  }
}
