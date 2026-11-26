/**
 * Small shared pieces of the asset contract.
 *
 * An asset module exports `info` and a `create...(ctx, { lod })` function
 * returning an object with:
 *   root          THREE.Object3D in life-size units (viewer applies info.scale)
 *   update(dt, view)  view = { cameraLocal: Vector3 in root space, worldScale }
 *   interactions  [{ id, label, proxy: Object3D, kind: 'hold', onStart, onHold(dt), onEnd }]
 *   events        Emitter: 'sfx' {name,pitch}, 'note' {midi,velocity}, 'haptic', 'assembled'
 *   assemble() / skipAssembly()  optional build-up animation for the hero
 *   dispose()     frees every geometry, material and texture
 */

export class Emitter {
  constructor() {
    this.map = new Map();
  }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.map.get(type)?.delete(fn);
  }

  emit(type, data) {
    const set = this.map.get(type);
    if (set) for (const fn of set) fn(data);
  }

  clear() {
    this.map.clear();
  }
}

/** keyframe-free animation script: tracks (at, dur, fn(k)) and cues */
export class Timeline {
  constructor() {
    this.tracks = [];
    this.cues = [];
    this.t = 0;
    this.active = false;
    this.end = 0;
  }

  add(at, dur, fn) {
    this.tracks.push({ at, dur, fn });
    this.end = Math.max(this.end, at + dur);
    return this;
  }

  cue(at, fn, essential = false) {
    this.cues.push({ at, fn, fired: false, essential });
    this.end = Math.max(this.end, at);
    return this;
  }

  play() {
    this.t = 0;
    this.active = this.tracks.length > 0 || this.cues.length > 0;
    for (const c of this.cues) c.fired = false;
    for (const tr of this.tracks) tr.fn(0);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    for (const tr of this.tracks) {
      if (this.t < tr.at - 0.05) continue;
      tr.fn(Math.min(1, Math.max(0, (this.t - tr.at) / tr.dur)));
    }
    for (const c of this.cues) {
      if (!c.fired && this.t >= c.at) {
        c.fired = true;
        c.fn();
      }
    }
    if (this.t > this.end + 0.05) this.active = false;
  }

  /** jump to the end (essential cues still fire) */
  finish() {
    for (const tr of this.tracks) tr.fn(1);
    for (const c of this.cues) {
      if (!c.fired && c.essential) c.fn();
      c.fired = true;
    }
    this.t = this.end;
    this.active = false;
  }
}

export const ease = {
  outCubic: (k) => 1 - Math.pow(1 - k, 3),
  inOutCubic: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outBack: (k) => {
    const c1 = 1.4, c3 = c1 + 1;
    return k <= 0 ? 0 : 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  },
};
