import * as THREE from 'three';
import * as S from '../audio/BoopSounds.js';

/**
 * Boops — the reaction layer: poke anything with a wand tip and it answers.
 * Flowers, grass and mushrooms boing (a rewrite of their bloom time popT
 * replays the elastic pop), trees shiver and shed petals, rocks bonk, the
 * fountain clonks and blows a ring of bubbles, the signpost wobbles, Dot
 * squeaks. Paint balls hit things too: a canopy catches a ball and the tree
 * takes its colour, rocks ricochet balls, mushroom caps are trampolines,
 * and every splat sends a hop through the meadow. One spatial grid over
 * every plant, tree and rock keeps all of it to a few distance checks per
 * frame; nothing here adds a draw call.
 *
 * Public: count, stats, pokeBloomer(bloomer, i), pokeTree(index),
 * pokeRock(index), pokeFountain(), pokeSign(), pokeDot(hand),
 * wave(position, radius), query(x, z, r) → this.hits.
 * Event: boop { kind: 'flower'|'grass'|'mushroom'|'tree'|'rock'|'fountain'|'sign'|'dot', position, index, hand }.
 */
const HIDDEN = 1e9; // Flora: popT of a plant that has not bloomed yet
const CELL = 2;
const ORIGIN = -46; // grid covers [-46, 46] m on x and z
const G = 46; // cells per axis
const K_BLOOMER = 0;
const K_TREE = 1;
const K_ROCK = 2;
const COOLDOWN = 0.4; // per-thing, wand pokes
const BALL_COOLDOWN = 0.15; // per-thing, ball hits (the physics always applies; this gates sound/sparkle)
// popT is rewritten to `time - offset`; the shader's elasticOut((time - popT) / 1.1) then replays
// part of the bloom pop: 0.066 → a deep squash, a 36 % stretch and a settle (a poke);
// 0.14 → starts in the stretch: the plant hops (the splat wave); 0.3 → a small bob.
const POKE_BOING = 0.066;
const WAVE_BOING = 0.14;
const WAVE_CAP = 120;
const PAPER = new THREE.Color('#ece6d8'); // puff colour for sketch (unpainted) things: eraser crumbs
const WOOD = new THREE.Color('#c48a5a');
const SPRAY = new THREE.Color('#cdeeff');
const WHITE = new THREE.Color(1, 1, 1);

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _q = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

const cellIndex = (v) => Math.max(0, Math.min(G - 1, Math.floor((v - ORIGIN) / CELL)));

export class Boops {
  constructor(app) {
    this.app = app;
    this.count = 0; // every boop, by wand or by ball
    this.stats = { tip: 0, ball: 0, wave: 0, hops: 0, bounce: 0, ricochet: 0, caught: 0 };
    this.flora = null;
    this.hits = new Int32Array(1024); // filled by query()
    this.hitCount = 0;
    this._pal = [new THREE.Color()];
    // wave queue: plants waiting to hop after a splat (typed, allocation-free)
    this.qCap = 640;
    this.qRef = new Int16Array(this.qCap);
    this.qIdx = new Int32Array(this.qCap);
    this.qT = new Float32Array(this.qCap);
    this.qN = 0;
    // edge-triggering: what each tip was inside last frame
    this.handState = { left: this._newHandState(), right: this._newHandState() };
    this.dotCooldown = 0;
    this.signCooldown = 0;
    this.fountainCooldown = 0;
    this.soundT = 0; // plant sounds: at most one per 70 ms
    // signpost wobble: two damped springs (roll about its z, nod about its x)
    this.signBase = app.helpSign ? app.helpSign.group.quaternion.clone() : null;
    if (app.helpSign) app.helpSign.group.updateWorldMatrix(true, false); // worldToLocal needs it before the first render
    this.signAngle = 0;
    this.signVel = 0;
    this.signNod = 0;
    this.signNodVel = 0;
    this._build();
    app.events.on('reset', () => this._onReset());
    app.events.on('splat', (e) => {
      if (e && e.position) this.wave(e.position, e.radius || 2);
    });
  }

  _newHandState() {
    return { cur: new Int32Array(64), prev: new Int32Array(64), n: 0, dot: false, sign: false, fountain: false };
  }

  _onReset() {
    this.qN = 0;
    for (const hs of [this.handState.left, this.handState.right]) {
      hs.n = 0;
      hs.dot = hs.sign = hs.fountain = false;
    }
    if (this.app.world.flora !== this.flora) this._build();
    else this.lastHit.fill(-9);
  }

  /** spatial grid (CSR) over every bloomer, tree and rock of the current island */
  _build() {
    const flora = this.app.world.flora;
    this.flora = flora;
    const bl = flora.bloomers;
    this.bloomerKind = bl.map((b) => (b.mesh.name === 'grass' ? 'grass' : b.mesh.name === 'mushrooms' ? 'mushroom' : 'flower'));
    let n = flora.trees.length + flora.rocks.length;
    for (const b of bl) n += b.count;
    this.n = n;
    const ex = (this.ex = new Float32Array(n));
    const ez = (this.ez = new Float32Array(n));
    const er = (this.er = new Float32Array(n)); // hit radius in the ground plane
    const ekind = (this.ekind = new Uint8Array(n));
    const eref = (this.eref = new Int16Array(n)); // bloomer / tree / rock array index
    const eidx = (this.eidx = new Int32Array(n)); // instance index
    this.lastHit = new Float32Array(n).fill(-9);
    this.visit = new Int32Array(n);
    this.visitId = 0;
    let e = 0;
    bl.forEach((b, bi) => {
      const r = this.bloomerKind[bi] === 'mushroom' ? 0.22 : this.bloomerKind[bi] === 'grass' ? 0.15 : 0.13;
      for (let i = 0; i < b.count; i++, e++) {
        ex[e] = b.xs[i];
        ez[e] = b.zs[i];
        er[e] = r;
        ekind[e] = K_BLOOMER;
        eref[e] = bi;
        eidx[e] = i;
      }
    });
    flora.trees.forEach((t, ti) => {
      ex[e] = t.x;
      ez[e] = t.z;
      er[e] = Math.max(t.r, 0.3 * t.s) + 0.05;
      ekind[e] = K_TREE;
      eref[e] = ti;
      eidx[e] = t.i;
      e++;
    });
    flora.rocks.forEach((r, ri) => {
      ex[e] = r.x;
      ez[e] = r.z;
      er[e] = r.r + 0.06;
      ekind[e] = K_ROCK;
      eref[e] = ri;
      eidx[e] = r.i;
      e++;
    });
    // every entry lands in each cell its radius overlaps (queries dedupe with visit ids)
    const cells = G * G;
    const start = new Int32Array(cells + 1);
    const each = (k, fn) => {
      const x0 = cellIndex(ex[k] - er[k]);
      const x1 = cellIndex(ex[k] + er[k]);
      const z0 = cellIndex(ez[k] - er[k]);
      const z1 = cellIndex(ez[k] + er[k]);
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) fn(cz * G + cx);
    };
    for (let k = 0; k < n; k++) each(k, (c) => start[c + 1]++);
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const cursor = new Int32Array(cells);
    const items = new Int32Array(start[cells]);
    for (let k = 0; k < n; k++) each(k, (c) => (items[start[c] + cursor[c]++] = k));
    this.cellStart = start;
    this.cellItems = items;
  }

  /** entries whose ground-plane hit circle comes within r of (x, z): fills this.hits, returns the count */
  query(x, z, r) {
    const id = ++this.visitId;
    const { hits, visit, ex, ez, er, cellStart, cellItems } = this;
    let n = 0;
    const x0 = cellIndex(x - r);
    const x1 = cellIndex(x + r);
    const z0 = cellIndex(z - r);
    const z1 = cellIndex(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cz * G + cx;
        for (let k = cellStart[c], end = cellStart[c + 1]; k < end; k++) {
          const e = cellItems[k];
          if (visit[e] === id) continue;
          visit[e] = id;
          const dx = ex[e] - x;
          const dz = ez[e] - z;
          const rr = r + er[e];
          if (dx * dx + dz * dz <= rr * rr && n < hits.length) hits[n++] = e;
        }
      }
    }
    this.hitCount = n;
    return n;
  }

  update(dt, time) {
    const app = this.app;
    if (app.world.flora !== this.flora) this._build();
    this.soundT -= dt;
    this.dotCooldown -= dt;
    this.signCooldown -= dt;
    this.fountainCooldown -= dt;
    this._hand(app.hands.left, time);
    this._hand(app.hands.right, time);
    this._balls(time);
    this._waveStep(time);
    this._signSpring(dt);
  }

  // ---------------------------------------------------------------- wand tips

  _hand(hand, time) {
    const hs = this.handState[hand.handedness];
    if (!hand.connected || !hand.hasTip) {
      hs.n = 0;
      hs.dot = hs.sign = hs.fountain = false;
      return;
    }
    const app = this.app;
    const world = app.world;
    const tip = hand.tip;
    const prev = hs.cur;
    const prevN = hs.n;
    hs.cur = hs.prev;
    hs.prev = prev;
    let n = 0;
    const gy = world.heightAt(tip.x, tip.z);
    const cnt = this.query(tip.x, tip.z, 0.05);
    for (let k = 0; k < cnt; k++) {
      const e = this.hits[k];
      if (!this._tipInside(e, tip, gy)) continue;
      if (n < hs.cur.length) hs.cur[n++] = e;
      let wasIn = false;
      for (let j = 0; j < prevN; j++) {
        if (prev[j] === e) {
          wasIn = true;
          break;
        }
      }
      if (wasIn || time - this.lastHit[e] < COOLDOWN) continue;
      this.lastHit[e] = time;
      this.stats.tip++;
      const kind = this.ekind[e];
      if (kind === K_BLOOMER) this.pokeBloomer(this.flora.bloomers[this.eref[e]], this.eidx[e], hand);
      else if (kind === K_TREE) this.pokeTree(this.eref[e], hand);
      else this.pokeRock(this.eref[e], hand);
    }
    hs.n = n;

    // Dot
    const buddy = app.buddy;
    if (buddy) {
      const inside = tip.distanceTo(buddy.group.position) < 0.18;
      if (inside && !hs.dot && this.dotCooldown <= 0) {
        this.dotCooldown = 0.6;
        this.stats.tip++;
        this.pokeDot(hand);
      }
      hs.dot = inside;
    }
    // the signpost (board or post, in its own frame)
    const sign = app.helpSign;
    if (sign && sign.group) {
      _v.copy(tip);
      sign.group.worldToLocal(_v);
      const board = Math.abs(_v.x) < 0.6 && _v.y > 1.14 && _v.y < 1.98 && Math.abs(_v.z) < 0.1;
      const post = Math.abs(_v.x) < 0.09 && Math.abs(_v.z) < 0.09 && _v.y > 0.15 && _v.y <= 1.14;
      const inside = board || post;
      if (inside && !hs.sign && this.signCooldown <= 0) {
        this.signCooldown = COOLDOWN;
        this.stats.tip++;
        this.pokeSign(hand, _v.x);
      }
      hs.sign = inside;
    }
    // the fountain (basin below, column and stone ball above)
    const f = world.fountain;
    if (f && f.top) {
      const dx = tip.x - f.top.x;
      const dz = tip.z - f.top.z;
      const wl = world.terrain.waterLevel;
      const r = tip.y > wl + 0.45 ? 0.36 : 1.25;
      const inside = tip.y > wl - 0.3 && tip.y < f.top.y + 0.25 && dx * dx + dz * dz < r * r;
      if (inside && !hs.fountain && this.fountainCooldown <= 0) {
        this.fountainCooldown = COOLDOWN;
        this.stats.tip++;
        this.pokeFountain(hand);
      }
      hs.fountain = inside;
    }
  }

  /** precise 3D test for one grid entry (the ground-plane circle already matched) */
  _tipInside(e, tip, gy) {
    const kind = this.ekind[e];
    if (kind === K_BLOOMER) {
      const b = this.flora.bloomers[this.eref[e]];
      if (b.popT.array[this.eidx[e]] >= HIDDEN) return false; // still hidden in the sketch
      const top = this.bloomerKind[this.eref[e]] === 'mushroom' ? 0.5 : 0.38;
      return tip.y > gy - 0.06 && tip.y < gy + top;
    }
    if (kind === K_TREE) {
      const t = this.flora.trees[this.eref[e]];
      const dx = tip.x - t.x;
      const dz = tip.z - t.z;
      const d2 = dx * dx + dz * dz;
      const trunk = 0.22 * t.s + 0.06;
      if (d2 < trunk * trunk && tip.y >= t.y && tip.y <= t.canopyY) return true;
      const dy = tip.y - t.canopyY;
      return d2 + dy * dy < t.r * t.r;
    }
    const r = this.flora.rocks[this.eref[e]];
    const dx = tip.x - r.x;
    const dy = tip.y - (r.y + 0.5 * r.s);
    const dz = tip.z - r.z;
    const rr = r.r + 0.05;
    return dx * dx + dy * dy + dz * dz < rr * rr;
  }

  // ---------------------------------------------------------------- reactions

  /** colour of the paint under (x, z), or eraser-crumb paper for sketch things */
  _colorAt(x, z, out) {
    this.app.world.paintMap.colorAt(x, z, out);
    if (out.r + out.g + out.b < 0.15) out.copy(PAPER);
    return out;
  }

  /** a puff of 4–8 sparkles in the thing's colour, swept along with the hand */
  _puff(p, color, n, hand = null, speed = 0.7) {
    const fx = this.app.fx;
    if (!fx) return;
    const rng = this.app.rng;
    for (let k = 0; k < n; k++) {
      _n.set(rng.gauss() * speed, speed * (0.5 + rng.float() * 0.9), rng.gauss() * speed);
      if (hand) _n.addScaledVector(hand.tipVel, 0.2);
      _c2.copy(color).lerp(WHITE, rng.float() * 0.45);
      fx.sparkle(p, _n, _c2, 0.45 + rng.float() * 0.45, 0.018 + rng.float() * 0.016);
    }
  }

  _emit(kind, position, index, hand) {
    this.count++;
    this.app.events.emit('boop', { kind, position: position.clone(), index, hand });
  }

  /** boing a bloomed plant (flower / grass tuft / mushroom): squash-pop, puff, sound, haptic, maybe a bubble */
  pokeBloomer(b, i, hand = null) {
    const app = this.app;
    if (!b || i < 0 || i >= b.count || b.popT.array[i] >= HIDDEN) return false;
    const time = app.time;
    b.popT.array[i] = time - POKE_BOING;
    b.popT.needsUpdate = true;
    const kind = this.bloomerKind[this.flora.bloomers.indexOf(b)] || 'flower';
    const x = b.xs[i];
    const z = b.zs[i];
    const gy = app.world.heightAt(x, z);
    _p.set(x, gy + (kind === 'mushroom' ? 0.24 : 0.14), z);
    this._colorAt(x, z, _c);
    this._puff(_p, _c, kind === 'grass' ? 4 : kind === 'flower' ? 6 : 8, hand);
    // no plant sounds while that hand is painting (the whoosh already plays; no chatter over strokes)
    if (app.audio && this.soundT <= 0 && !(hand && hand.triggerDown)) {
      this.soundT = 0.07;
      if (kind === 'grass') S.rustle(app.audio, _p);
      else if (kind === 'flower') S.plip(app.audio, _p);
      else S.boing(app.audio, _p, 1.1);
    }
    if (kind === 'mushroom' && app.bubbles && app.rng.chance(0.3)) {
      _v.set(x, gy + 0.32, z);
      _n.set(app.rng.gauss() * 0.6, 1.4, app.rng.gauss() * 0.6);
      app.bubbles.spawn(_v, app.paint ? app.paint.color : _c, 0.06 + app.rng.float() * 0.05, _n);
      if (app.audio) app.audio.bubbleBlow(0.4);
    }
    if (hand) {
      if (kind === 'mushroom') hand.pulse(0.5, 40);
      else hand.tick(0.3, 40);
    }
    this._emit(kind, _p, i, hand);
    return true;
  }

  /** a tree shivers and sheds 6–10 petal/leaf bits in its colour, with a wooden tok and a hiss of leaves */
  pokeTree(index, hand = null, ballColor = null) {
    const app = this.app;
    const t = this.flora.trees[index];
    if (!t) return false;
    if (t.pokeT) {
      t.pokeT.array[t.i] = app.time;
      t.pokeT.needsUpdate = true;
    }
    this._colorAt(t.x, t.z, _c);
    if (ballColor) _c.copy(ballColor);
    _p.set(t.x, t.canopyY, t.z);
    if (app.fx) {
      this._pal[0].copy(_c);
      app.fx.confetti(_p, 6 + app.rng.int(0, 4), this._pal, 1.3);
      this._puff(_p, _c, 6, hand, 0.9);
    }
    if (app.audio) {
      _v.set(t.x, t.y + 1.0 * t.s, t.z);
      S.tok(app.audio, _v, t.s);
      S.leaves(app.audio, _p);
    }
    if (hand) hand.pulse(0.6, 45);
    this._emit('tree', _p, index, hand);
    return true;
  }

  /** a rock bonks (pitch by size) and wobbles */
  pokeRock(index, hand = null, speed = 0) {
    const app = this.app;
    const r = this.flora.rocks[index];
    if (!r) return false;
    if (r.pokeT) {
      r.pokeT.array[r.i] = app.time;
      r.pokeT.needsUpdate = true;
    }
    _p.set(r.x, r.y + 0.5 * r.s + r.r * 0.6, r.z);
    this._colorAt(r.x, r.z, _c);
    this._puff(_p, _c, 6, hand, 0.8);
    if (app.audio) S.bonk(app.audio, _p, r.s, Math.min(1, 0.7 + speed * 0.06));
    if (hand) hand.pulse(0.7, 50);
    this._emit('rock', _p, index, hand);
    return true;
  }

  /** the fountain wobbles, clonks and blows a ring of 8 bubbles in your colour from the top */
  pokeFountain(hand = null) {
    const app = this.app;
    const f = app.world.fountain;
    if (!f || !f.top) return false;
    if (f.poke) f.poke(app.time);
    else if (f.pokeT) f.pokeT.value = app.time;
    const top = f.top;
    if (app.bubbles) {
      const col = app.paint ? app.paint.color : SPRAY;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        _v.set(top.x + Math.cos(a) * 0.16, top.y - 0.05, top.z + Math.sin(a) * 0.16);
        _n.set(Math.cos(a) * 1.8, 1.0, Math.sin(a) * 1.8);
        app.bubbles.spawn(_v, col, 0.06 + app.rng.float() * 0.04, _n);
      }
    }
    if (app.fx) {
      app.fx.splash(top, SPRAY, 14, 1.8);
      this._puff(top, SPRAY, 6, hand, 0.9);
    }
    if (app.audio) {
      S.clonk(app.audio, top);
      app.audio.bubbleBlow(0.8);
    }
    if (hand) hand.pulse(0.6, 50);
    this._emit('fountain', top, 0, hand);
    return true;
  }

  /** the signpost wobbles on its post with a wooden knock; side = which side was hit (sign of local x) */
  pokeSign(hand = null, side = 1) {
    const app = this.app;
    const sign = app.helpSign;
    if (!sign || !sign.group) return false;
    if (!this.signBase) this.signBase = sign.group.quaternion.clone();
    this.signVel += (side >= 0 ? -1 : 1) * 3.2;
    this.signNodVel += 1.4;
    _p.copy(sign.group.position);
    _p.y += 1.55;
    this._puff(_p, WOOD, 6, hand, 0.8);
    if (app.audio) S.tok(app.audio, _p, 0.8);
    if (hand) hand.pulse(0.5, 40);
    this._emit('sign', _p, 0, hand);
    return true;
  }

  /** Dot: squeak + Buddy.boop (squash, spin, scoot, "Boop!") */
  pokeDot(hand = null) {
    const app = this.app;
    const buddy = app.buddy;
    if (!buddy) return false;
    _p.copy(buddy.group.position);
    if (buddy.boop) buddy.boop(hand);
    if (app.fx) app.fx.burst(_p, buddy.color, 10, 0.8, 0.03);
    if (app.audio) S.squeak(app.audio, _p);
    if (hand) hand.pulse(0.4, 30);
    this._emit('dot', _p, 0, hand);
    return true;
  }

  // ---------------------------------------------------------------- paint balls

  _balls(time) {
    const splats = this.app.splats;
    if (!splats || !splats.balls) return;
    const balls = splats.balls;
    for (let k = balls.length - 1; k >= 0; k--) {
      const b = balls[k];
      if (!b.flying) continue;
      const p = b.mesh.position;
      const ballR = 0.048 * (b.mesh.scale.x || 1);
      if (this._ballFountain(b, p, ballR, time)) continue;
      if (this._ballSign(b, p, ballR, time)) continue;
      const cnt = this.query(p.x, p.z, ballR + 0.05);
      for (let j = 0; j < cnt; j++) {
        const e = this.hits[j];
        const kind = this.ekind[e];
        let hit = false;
        if (kind === K_TREE) hit = this._ballTree(b, e, p, ballR);
        else if (kind === K_ROCK) hit = this._ballRock(b, e, p, ballR, time);
        else hit = this._ballMushroom(b, e, p, time);
        if (hit) break;
      }
    }
  }

  /** a ball inside a canopy (or against the trunk): splash, shiver, petals, then it splats at the foot of the trunk so the tree takes the colour */
  _ballTree(b, e, p, ballR) {
    const t = this.flora.trees[this.eref[e]];
    const dx = p.x - t.x;
    const dz = p.z - t.z;
    const d2 = dx * dx + dz * dz;
    const dy = p.y - t.canopyY;
    const rr = t.r + ballR;
    const inCanopy = d2 + dy * dy < rr * rr;
    const trunk = 0.22 * t.s + ballR;
    const inTrunk = d2 < trunk * trunk && p.y > t.y + 0.05 && p.y < t.canopyY;
    if (!inCanopy && !inTrunk) return false;
    const app = this.app;
    if (app.fx) {
      app.fx.burst(p, b.color, 14, 1.8, 0.045);
      app.fx.splash(p, b.color, 14, 1.6);
    }
    if (app.audio) S.thump(app.audio, p);
    this.pokeTree(this.eref[e], null, b.color);
    this.stats.ball++;
    this.stats.caught++;
    // the paint runs down the trunk: splat centred on the tree (speed kept → stamp size)
    p.set(t.x, app.world.heightAt(t.x, t.z) + 0.03, t.z);
    b.vel.y = -Math.abs(b.vel.y);
    app.splats.splat(b);
    return true;
  }

  /** a ball against a rock: ricochet (restitution 0.6) with a bonk; a slow touch just splats onto the rock */
  _ballRock(b, e, p, ballR, time) {
    const r = this.flora.rocks[this.eref[e]];
    const cy = r.y + 0.5 * r.s;
    const R = r.r + ballR;
    _n.set(p.x - r.x, p.y - cy, p.z - r.z);
    const d2 = _n.lengthSq();
    if (d2 >= R * R) return false;
    const d = Math.sqrt(d2) || 1e-3;
    _n.divideScalar(d);
    const vn = b.vel.dot(_n);
    if (vn >= 0) return false; // already on its way out
    const app = this.app;
    if (-vn < 1.2) {
      // a gentle touch: the ball breaks on the rock and the rock takes the colour
      p.set(r.x + _n.x * R, cy + _n.y * R, r.z + _n.z * R);
      this.pokeRock(this.eref[e], null, -vn);
      this.stats.ball++;
      app.splats.splat(b);
      return true;
    }
    b.vel.addScaledVector(_n, -1.6 * vn); // normal component reversed at 0.6, tangent kept
    b.vel.multiplyScalar(0.92);
    p.set(r.x + _n.x * (R + 0.01), cy + _n.y * (R + 0.01), r.z + _n.z * (R + 0.01));
    this.stats.ricochet++;
    if (time - this.lastHit[e] >= BALL_COOLDOWN) {
      this.lastHit[e] = time;
      this.stats.ball++;
      this.pokeRock(this.eref[e], null, -vn);
      if (app.fx) app.fx.burst(p, b.color, 8, 1.2, 0.035);
    }
    return true;
  }

  /** a falling ball over a bloomed mushroom cap bounces back up: a trampoline */
  _ballMushroom(b, e, p, time) {
    const bi = this.eref[e];
    if (this.bloomerKind[bi] !== 'mushroom' || b.vel.y >= 0) return false;
    const bl = this.flora.bloomers[bi];
    const i = this.eidx[e];
    if (bl.popT.array[i] >= HIDDEN) return false;
    const dx = p.x - bl.xs[i];
    const dz = p.z - bl.zs[i];
    if (dx * dx + dz * dz > 0.25 * 0.25) return false;
    const app = this.app;
    const gy = app.world.heightAt(bl.xs[i], bl.zs[i]);
    if (p.y < gy + 0.04 || p.y > gy + 0.6) return false;
    // each bounce is a little lower, and a ball sitting dead centre gets nudged so it rolls off the cap
    b.tramp = (b.tramp || 0) + 1;
    if (b.tramp > 5) return false; // enough: let it splat next to the mushroom
    b.vel.y = 5 * Math.pow(0.75, b.tramp - 1);
    b.vel.x *= 0.5;
    b.vel.z *= 0.5;
    if (b.vel.x * b.vel.x + b.vel.z * b.vel.z < 0.09) {
      b.vel.x += app.rng.gauss() * 0.7;
      b.vel.z += app.rng.gauss() * 0.7;
    }
    if (p.y < gy + 0.12) p.y = gy + 0.12;
    bl.popT.array[i] = time - POKE_BOING;
    bl.popT.needsUpdate = true;
    this._colorAt(bl.xs[i], bl.zs[i], _c);
    this._puff(p, _c, 8, null, 1.0);
    if (app.fx) app.fx.burst(p, b.color, 8, 1.4, 0.04);
    if (app.audio) S.boing(app.audio, p, 0.8);
    this.lastHit[e] = time;
    this.stats.ball++;
    this.stats.bounce++;
    this._emit('mushroom', p, i, null);
    return true;
  }

  /** the stone ball on top of the fountain: ricochet + clonk + bubbles */
  _ballFountain(b, p, ballR, time) {
    const f = this.app.world.fountain;
    if (!f || !f.top) return false;
    const cy = f.top.y - 0.17;
    const R = 0.34 + ballR;
    _n.set(p.x - f.top.x, p.y - cy, p.z - f.top.z);
    const d2 = _n.lengthSq();
    if (d2 >= R * R) return false;
    const d = Math.sqrt(d2) || 1e-3;
    _n.divideScalar(d);
    const vn = b.vel.dot(_n);
    if (vn >= 0) return false;
    b.vel.addScaledVector(_n, -1.6 * vn);
    b.vel.multiplyScalar(0.92);
    p.set(f.top.x + _n.x * (R + 0.01), cy + _n.y * (R + 0.01), f.top.z + _n.z * (R + 0.01));
    this.stats.ricochet++;
    if (this.fountainCooldown <= 0) {
      this.fountainCooldown = BALL_COOLDOWN;
      this.stats.ball++;
      this.pokeFountain(null);
      if (this.app.fx) this.app.fx.burst(p, b.color, 8, 1.2, 0.035);
    }
    return true;
  }

  /** the signpost's board: balls bounce off it with a knock and set it wobbling */
  _ballSign(b, p, ballR, time) {
    const sign = this.app.helpSign;
    if (!sign || !sign.group) return false;
    const c = sign.group.position;
    const cy = c.y + 1.55;
    const R = 0.5 + ballR;
    _n.set(p.x - c.x, p.y - cy, p.z - c.z);
    const d2 = _n.lengthSq();
    if (d2 >= R * R) return false;
    const d = Math.sqrt(d2) || 1e-3;
    _n.divideScalar(d);
    const vn = b.vel.dot(_n);
    if (vn >= 0) return false;
    b.vel.addScaledVector(_n, -1.5 * vn);
    b.vel.multiplyScalar(0.9);
    p.set(c.x + _n.x * (R + 0.01), cy + _n.y * (R + 0.01), c.z + _n.z * (R + 0.01));
    this.stats.ricochet++;
    if (this.signCooldown <= 0) {
      this.signCooldown = BALL_COOLDOWN;
      this.stats.ball++;
      _v.copy(p);
      sign.group.worldToLocal(_v);
      this.pokeSign(null, _v.x);
      if (this.app.fx) this.app.fx.burst(p, b.color, 8, 1.2, 0.035);
    }
    return true;
  }

  // ---------------------------------------------------------------- splat wave

  /** every bloomed plant within radius * 1.5 hops in turn, nearest first (≤ 120 per splat); trees nearby shiver */
  wave(position, radius) {
    const time = this.app.time;
    const r = radius * 1.5;
    const cnt = this.query(position.x, position.z, r);
    const { hits, ekind, eref, eidx, ex, ez } = this;
    const bl = this.flora.bloomers;
    let cand = 0;
    for (let k = 0; k < cnt; k++) {
      const e = hits[k];
      if (ekind[e] === K_BLOOMER && bl[eref[e]].popT.array[eidx[e]] < HIDDEN) cand++;
      else if (ekind[e] === K_TREE) {
        const t = this.flora.trees[eref[e]];
        if (t.pokeT) {
          t.pokeT.array[t.i] = time + Math.hypot(ex[e] - position.x, ez[e] - position.z) * 0.12;
          t.pokeT.needsUpdate = true;
        }
      }
    }
    this.stats.wave++;
    if (!cand) return;
    const step = Math.max(1, Math.ceil(cand / WAVE_CAP));
    let seen = 0;
    for (let k = 0; k < cnt && this.qN < this.qCap; k++) {
      const e = hits[k];
      if (ekind[e] !== K_BLOOMER || bl[eref[e]].popT.array[eidx[e]] >= HIDDEN) continue;
      if (seen++ % step) continue;
      const q = this.qN++;
      this.qRef[q] = eref[e];
      this.qIdx[q] = eidx[e];
      this.qT[q] = time + Math.hypot(ex[e] - position.x, ez[e] - position.z) * 0.12;
      this.stats.hops++;
    }
  }

  _waveStep(time) {
    const bl = this.flora.bloomers;
    for (let k = 0; k < this.qN; ) {
      if (time < this.qT[k]) {
        k++;
        continue;
      }
      const b = bl[this.qRef[k]];
      const i = this.qIdx[k];
      if (b && b.popT.array[i] < HIDDEN) {
        b.popT.array[i] = time - WAVE_BOING;
        b.popT.needsUpdate = true;
      }
      this.qN--;
      this.qRef[k] = this.qRef[this.qN];
      this.qIdx[k] = this.qIdx[this.qN];
      this.qT[k] = this.qT[this.qN];
    }
  }

  // ---------------------------------------------------------------- signpost spring

  _signSpring(dt) {
    const sign = this.app.helpSign;
    if (!sign || !sign.group || !this.signBase) return;
    const still = Math.abs(this.signAngle) < 1e-4 && Math.abs(this.signVel) < 1e-3 && Math.abs(this.signNod) < 1e-4 && Math.abs(this.signNodVel) < 1e-3;
    if (still) {
      if (this.signActive) {
        this.signActive = false;
        this.signAngle = this.signVel = this.signNod = this.signNodVel = 0;
        sign.group.quaternion.copy(this.signBase);
      }
      return;
    }
    this.signActive = true;
    // semi-implicit Euler, ~2 Hz, settles in under a second
    this.signVel += (-150 * this.signAngle - 5 * this.signVel) * dt;
    this.signAngle += this.signVel * dt;
    this.signNodVel += (-180 * this.signNod - 6 * this.signNodVel) * dt;
    this.signNod += this.signNodVel * dt;
    this.signAngle = Math.max(-0.35, Math.min(0.35, this.signAngle));
    this.signNod = Math.max(-0.25, Math.min(0.25, this.signNod));
    _q.setFromAxisAngle(_axisZ, this.signAngle);
    sign.group.quaternion.copy(this.signBase).multiply(_q);
    _q.setFromAxisAngle(_axisX, this.signNod);
    sign.group.quaternion.multiply(_q);
  }
}
