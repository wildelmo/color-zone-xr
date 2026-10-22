import * as THREE from 'three';
import { hslToRgb } from '../util/math.js';

/**
 * Turns one hand's motion into paint. Handles smoothing, pressure, per-brush
 * behaviour (tubes, stickers, bubbles), and the side effects that make
 * painting feel magical: ground colour, sparkles, chimes and haptics.
 */
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
const _p3 = new THREE.Vector3();
const _cr = new THREE.Vector3();

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t;
  const t3 = t2 * t;
  out.x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  out.y = 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  out.z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return out;
}

export class Brush {
  constructor(app, hand) {
    this.app = app;
    this.hand = hand;
    this.smooth = new THREE.Vector3();
    this.last = new THREE.Vector3();
    this.entry = null; // active paint entry
    this.painting = false;
    this.brushId = null;
    this.distAcc = 0; // distance since last side-effect
    this.noteAcc = 0;
    this.stampAcc = 0;
    this.groundAcc = 0;
    this.hue = 0;
    this.strokeStart = 0;
    this.hist = [];
  }

  get radius() {
    const paint = this.app.paint;
    const h = this.hand;
    const pressure = h.isTrackedHand ? 1 : Math.max(0, Math.min(1, (h.trigger - 0.5) / 0.5));
    const base = paint.size * (0.62 + 0.38 * pressure);
    return this.brushId === 'cotton' ? base * 2.2 : this.brushId === 'sparkle' ? base * 0.7 : base;
  }

  begin(time) {
    const paint = this.app.paint;
    this.brushId = paint.brush.id;
    this.painting = true;
    this.smooth.copy(this.hand.tip);
    this.last.copy(this.hand.tip);
    this.distAcc = this.noteAcc = this.stampAcc = this.groundAcc = 0;
    this.strokeStart = time;
    this.hist.length = 0;
    this.hue = this.app.rng.float();
    if (this.brushId === 'stamp') {
      this.entry = paint.beginStamps(this.app.rng.chance(0.5) ? 'star' : 'heart');
      this._placeStamp(this.hand.tip, time);
    } else if (this.brushId === 'bubble') {
      this.entry = null;
    } else {
      this.entry = paint.beginStroke(this.brushId);
      this._addPoint(this.hand.tip);
    }
    if (this.app.fx && this.brushId !== 'bubble') this.app.fx.burst(this.hand.tip, this._color(_c), 10, 0.55, 0.028);
    this.app.events.emit('paintstart', { hand: this.hand, brush: this.brushId });
  }

  end() {
    if (!this.painting) return;
    this.painting = false;
    this._flushTail();
    if (this.entry && this.entry.kind === 'tube') this.app.paint.endStroke(this.entry);
    if (this.app.fx && this.brushId !== 'bubble') this.app.fx.burst(this.hand.tip, this._color(_c), 6, 0.4, 0.022);
    this.entry = null;
    this.app.events.emit('paintend', { hand: this.hand, brush: this.brushId });
  }

  cancel() {
    this.end();
  }

  _color(out) {
    const paint = this.app.paint;
    if (this.brushId === 'rainbow') {
      const len = this.entry ? this.entry.stroke.length : 0;
      const [r, g, b] = hslToRgb((this.hue + len * 0.55) % 1, 0.95, 0.6);
      return out.setRGB(r, g, b, THREE.SRGBColorSpace);
    }
    return out.copy(paint.color);
  }

  _addRaw(p) {
    const stroke = this.entry.stroke;
    this._color(_c);
    if (stroke.isFull) {
      // seamless continuation into a fresh stroke
      this.app.paint.endStroke(this.entry);
      const prevColor = _c.clone();
      this.entry = this.app.paint.beginStroke(this.brushId);
      this.entry.stroke.addPoint(this.last, this.radius, prevColor);
    }
    return this.entry.stroke.addPoint(p, this.radius, _c);
  }

  /**
   * Add a point through a Catmull-Rom spline. The tube lags one sample
   * behind the hand (~10 ms) so consecutive segments share tangents and
   * the stroke stays silky even when the hand moves fast.
   */
  _addPoint(p) {
    const hist = this.hist;
    hist.push(p.clone());
    if (hist.length > 4) hist.shift();
    const n = hist.length;
    if (n === 1) return this._addRaw(p);
    if (n === 2) return true;
    const p0 = n >= 4 ? hist[n - 4] : hist[n - 3];
    return this._subdivide(p0, hist[n - 3], hist[n - 2], hist[n - 1]);
  }

  _subdivide(p0, p1, p2, p3) {
    const d = p1.distanceTo(p2);
    const step = 0.008 + this.radius * 0.3;
    const n = Math.min(24, Math.max(1, Math.round(d / step)));
    for (let i = 1; i <= n; i++) {
      catmull(p0, p1, p2, p3, i / n, _cr);
      this._addRaw(_cr);
    }
    return true;
  }

  /** flush the lagging final segment when the stroke ends */
  _flushTail() {
    const hist = this.hist;
    const n = hist.length;
    if (n < 2 || !this.entry || this.entry.kind !== 'tube') return;
    const p1 = hist[n - 2];
    const p2 = hist[n - 1];
    const p0 = n >= 3 ? hist[n - 3] : p1;
    _p3.copy(p2).multiplyScalar(2).sub(p1);
    this._subdivide(p0, p1, p2, _p3);
  }

  _placeStamp(p, time) {
    const paint = this.app.paint;
    const rng = this.app.rng;
    _q.copy(this.hand.tipQuat);
    // random spin around the wand axis so stickers look scattered
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rng.float() * Math.PI * 2);
    _q.multiply(spin);
    this._color(_c);
    const scale = 0.7 + paint.sizeT * 2.6 + rng.float() * 0.3;
    return paint.placeStamp(this.entry, p, _q, scale, _c, time);
  }

  update(dt, time) {
    const h = this.hand;
    const app = this.app;
    if (!h.connected || h.uiBlocked || h.locoBusy) {
      if (this.painting) this.end();
      return;
    }
    if (h.triggerPressed && !this.painting) this.begin(time);
    if (!this.painting) return;
    if (h.triggerReleased) {
      this.end();
      return;
    }

    // smooth the tip: removes tracking jitter without feeling laggy
    this.smooth.lerp(h.tip, 1 - Math.exp(-dt * 30));
    const d = this.smooth.distanceTo(this.last);
    const r = this.radius;
    const minSeg = 0.006 + r * 0.35;
    if (d < minSeg) return;

    this._color(_c);
    if (this.brushId === 'stamp' || this.brushId === 'bubble') {
      // place along the segment so fast sweeps still leave an even trail
      const spacing = this.brushId === 'stamp' ? 0.05 + app.paint.sizeT * 0.12 : 0.07;
      let travelled = 0;
      let placed = 0;
      while (this.stampAcc + (d - travelled) >= spacing && placed < 12) {
        const need = spacing - this.stampAcc;
        travelled += need;
        this.stampAcc = 0;
        _p.copy(this.last).lerp(this.smooth, travelled / d);
        if (this.brushId === 'stamp') {
          this._placeStamp(_p, time);
          if (app.fx) app.fx.burst(_p, _c, 6, 0.5);
          if (app.audio) app.audio.tick(_p.y);
        } else if (app.bubbles) {
          app.bubbles.spawn(_p, _c, 0.05 + app.paint.sizeT * 0.12, h.tipVel);
          if (app.audio) app.audio.bubbleBlow();
        }
        placed++;
      }
      this.stampAcc += d - travelled;
      if (placed > 0) h.tick(this.brushId === 'stamp' ? 0.35 : 0.2, 25);
    } else {
      this._addPoint(this.smooth);
      if (app.fx) app.fx.trail(this.smooth, _c, this.brushId, r, h.tipVel);
    }
    this.last.copy(this.smooth);

    // side effects metered by distance travelled
    this.distAcc += d;
    this.noteAcc += d;
    this.groundAcc += d;
    const speed = h.tipVel.length();
    h.tick(0.08 + Math.min(0.25, speed * 0.08), 40);
    if (app.audio) app.audio.brushMotion(speed, this.smooth.y);
    if (this.noteAcc >= 0.11) {
      this.noteAcc = 0;
      if (app.audio) app.audio.paintNote(this.smooth.y, _c, this.brushId);
    }
    if (this.groundAcc >= 0.12) {
      this.groundAcc = 0;
      const world = app.world;
      const gr = 0.45 + r * 6 + app.paint.sizeT * 0.6;
      world.paintMap.stamp(this.smooth.x, this.smooth.z, gr, _c, 0.5, 0.85);
      if (app.fx && app.rng.chance(0.35)) app.fx.drip(this.smooth, _c);
    }
  }
}
