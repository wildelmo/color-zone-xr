import * as THREE from 'three';

/**
 * One brush stroke: an incrementally-extruded tube. Vertex buffers are
 * pre-allocated, so adding a point only touches two rings and uploads a
 * tiny update range — smooth even on Quest while drawing fast.
 */
const _t = new THREE.Vector3();
const _tPrev = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _ref = new THREE.Vector3();

export class Stroke {
  constructor({ maxPoints = 420, sides = 8 } = {}) {
    this.maxPoints = maxPoints;
    this.sides = sides;
    const vcount = maxPoints * sides;
    this.positions = new Float32Array(vcount * 3);
    this.normals = new Float32Array(vcount * 3);
    this.colors = new Float32Array(vcount * 3);
    this.uvs = new Float32Array(vcount * 2);
    this.aux = new Float32Array(vcount);
    const idx = new Uint32Array((maxPoints - 1) * sides * 6);
    let k = 0;
    for (let s = 0; s < maxPoints - 1; s++) {
      for (let i = 0; i < sides; i++) {
        const a = s * sides + i;
        const b = s * sides + ((i + 1) % sides);
        const c = (s + 1) * sides + i;
        const d = (s + 1) * sides + ((i + 1) % sides);
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage);
    this.auxAttr = new THREE.BufferAttribute(this.aux, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.nrmAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('uv', this.uvAttr);
    geo.setAttribute('aux', this.auxAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.geometry = geo;

    // per-point data
    this.pts = new Float32Array(maxPoints * 3);
    this.radii = new Float32Array(maxPoints);
    this.cols = new Float32Array(maxPoints * 3);
    this.ringN = new Float32Array(maxPoints * 3); // frame normal per ring
    this.count = 0;
    this.length = 0;
    this.ended = false;
    this.bounds = new THREE.Box3();
    this._firstRadius = 0;
  }

  get isFull() {
    return this.count >= this.maxPoints - 2;
  }

  /** @returns {boolean} true if the point was accepted */
  addPoint(p, radius, color) {
    if (this.ended || this.count >= this.maxPoints) return false;
    const i = this.count;
    this.pts[i * 3] = p.x;
    this.pts[i * 3 + 1] = p.y;
    this.pts[i * 3 + 2] = p.z;
    this.radii[i] = radius;
    this.cols[i * 3] = color.r;
    this.cols[i * 3 + 1] = color.g;
    this.cols[i * 3 + 2] = color.b;
    this.bounds.expandByPoint(p);
    if (i === 0) {
      this._firstRadius = radius;
      _t.set(0, 0, -1);
      this._writeRing(0, _t, radius * 0.35);
      this.count = 1;
      this._flag(0, 1);
      return true;
    }
    _t.set(p.x - this.pts[(i - 1) * 3], p.y - this.pts[(i - 1) * 3 + 1], p.z - this.pts[(i - 1) * 3 + 2]);
    const seg = _t.length();
    if (seg < 1e-5) return false;
    _t.divideScalar(seg);
    this.length += seg;
    if (i === 1) {
      this._writeRing(0, _t, this.radii[0] * 0.35);
      this._writeRing(1, _t, radius * 0.8);
    } else {
      _tPrev.set(
        this.pts[(i - 1) * 3] - this.pts[(i - 2) * 3],
        this.pts[(i - 1) * 3 + 1] - this.pts[(i - 2) * 3 + 1],
        this.pts[(i - 1) * 3 + 2] - this.pts[(i - 2) * 3 + 2]
      ).normalize();
      _tPrev.add(_t).normalize();
      this._writeRing(i - 1, _tPrev, this.radii[i - 1]);
      this._writeRing(i, _t, radius);
    }
    this.count = i + 1;
    this.geometry.setDrawRange(0, (this.count - 1) * this.sides * 6);
    this._flag(Math.max(0, i - 1), 2);
    this._updateBounds();
    return true;
  }

  /** close the tube with a rounded-ish cap */
  end() {
    if (this.ended) return;
    this.ended = true;
    const i = this.count;
    if (i >= 2 && i < this.maxPoints) {
      const r = this.radii[i - 1];
      _t.set(
        this.pts[(i - 1) * 3] - this.pts[(i - 2) * 3],
        this.pts[(i - 1) * 3 + 1] - this.pts[(i - 2) * 3 + 1],
        this.pts[(i - 1) * 3 + 2] - this.pts[(i - 2) * 3 + 2]
      ).normalize();
      _p.set(this.pts[(i - 1) * 3], this.pts[(i - 1) * 3 + 1], this.pts[(i - 1) * 3 + 2]).addScaledVector(_t, r * 0.7);
      this.ended = false;
      const col = { r: this.cols[(i - 1) * 3], g: this.cols[(i - 1) * 3 + 1], b: this.cols[(i - 1) * 3 + 2] };
      this.addPoint(_p, r * 0.45, col);
      _p.addScaledVector(_t, r * 0.35);
      this.addPoint(_p, r * 0.05, col);
      this.ended = true;
    }
    this._updateBounds();
  }

  _updateBounds() {
    const bs = this.geometry.boundingSphere;
    this.bounds.getCenter(bs.center);
    bs.radius = this.bounds.min.distanceTo(this.bounds.max) * 0.5 + 0.1;
  }

  _flag(ring, rings) {
    const s = this.sides;
    const start = ring * s;
    const count = rings * s;
    for (const [attr, itemSize] of [
      [this.posAttr, 3],
      [this.nrmAttr, 3],
      [this.colAttr, 3],
      [this.uvAttr, 2],
      [this.auxAttr, 1],
    ]) {
      attr.addUpdateRange(start * itemSize, count * itemSize);
      attr.needsUpdate = true;
    }
  }

  _writeRing(i, tangent, radius) {
    // parallel-transport the previous ring's normal so the tube never twists
    if (i === 0) _ref.set(0, 1, 0);
    else _ref.set(this.ringN[(i - 1) * 3], this.ringN[(i - 1) * 3 + 1], this.ringN[(i - 1) * 3 + 2]);
    _n.copy(_ref).addScaledVector(tangent, -_ref.dot(tangent));
    if (_n.lengthSq() < 1e-6) {
      _n.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
      if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
    }
    _n.normalize();
    _b.crossVectors(tangent, _n).normalize();
    this.ringN[i * 3] = _n.x;
    this.ringN[i * 3 + 1] = _n.y;
    this.ringN[i * 3 + 2] = _n.z;
    const px = this.pts[i * 3];
    const py = this.pts[i * 3 + 1];
    const pz = this.pts[i * 3 + 2];
    const cr = this.cols[i * 3];
    const cg = this.cols[i * 3 + 1];
    const cb = this.cols[i * 3 + 2];
    const s = this.sides;
    for (let k = 0; k < s; k++) {
      const a = (k / s) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nx = _n.x * ca + _b.x * sa;
      const ny = _n.y * ca + _b.y * sa;
      const nz = _n.z * ca + _b.z * sa;
      const v = i * s + k;
      this.positions[v * 3] = px + nx * radius;
      this.positions[v * 3 + 1] = py + ny * radius;
      this.positions[v * 3 + 2] = pz + nz * radius;
      this.normals[v * 3] = nx;
      this.normals[v * 3 + 1] = ny;
      this.normals[v * 3 + 2] = nz;
      this.colors[v * 3] = cr;
      this.colors[v * 3 + 1] = cg;
      this.colors[v * 3 + 2] = cb;
      this.uvs[v * 2] = this.length;
      this.uvs[v * 2 + 1] = k / s;
      this.aux[v] = radius;
    }
  }

  /** number of vertices / indices in use (for batching) */
  get usedVertices() {
    return this.count * this.sides;
  }
  get usedIndices() {
    return Math.max(0, this.count - 1) * this.sides * 6;
  }

  /** index data for batching (works before and after compact()) */
  get indexArray() {
    return this._idx || this.geometry.index.array;
  }

  /**
   * Once a stroke lives inside a batch its own GPU buffers are dead weight:
   * keep only the used CPU ranges (for undo rebuilds and saving).
   */
  compact() {
    if (!this.geometry) return;
    const nv = this.usedVertices;
    const ni = this.usedIndices;
    this._idx = this.geometry.index.array.slice(0, ni);
    this.positions = this.positions.slice(0, nv * 3);
    this.normals = this.normals.slice(0, nv * 3);
    this.colors = this.colors.slice(0, nv * 3);
    this.uvs = this.uvs.slice(0, nv * 2);
    this.aux = this.aux.slice(0, nv);
    this.pts = this.pts.slice(0, this.count * 3);
    this.radii = this.radii.slice(0, this.count);
    this.cols = this.cols.slice(0, this.count * 3);
    this.ringN = null;
    this.geometry.dispose();
    this.geometry = null;
    this.posAttr = this.nrmAttr = this.colAttr = this.uvAttr = this.auxAttr = null;
  }

  /** compact serialisation for saving */
  serialize() {
    const n = this.count;
    const cols = Array.from(this.cols.subarray(0, n * 3), (v) => Math.round(v * 255));
    let uniform = true;
    for (let i = 3; i < cols.length && uniform; i += 3) {
      if (cols[i] !== cols[0] || cols[i + 1] !== cols[1] || cols[i + 2] !== cols[2]) uniform = false;
    }
    return {
      n,
      p: Array.from(this.pts.subarray(0, n * 3), (v) => Math.round(v * 1000) / 1000),
      r: Array.from(this.radii.subarray(0, n), (v) => Math.round(v * 10000) / 10000),
      c: uniform ? cols.slice(0, 3) : cols,
    };
  }

  dispose() {
    if (this.geometry) this.geometry.dispose();
    this.geometry = null;
  }
}
