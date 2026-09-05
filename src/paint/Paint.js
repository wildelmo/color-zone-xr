import * as THREE from 'three';
import { Stroke } from './Stroke.js';
import { StrokeMaterial } from './StrokeMaterial.js';
import { StampLayer } from './StampLayer.js';
import { PALETTE, BRUSHES, BRUSH_SIZE } from '../config.js';
import { clamp } from '../util/math.js';

/**
 * The painting itself: current colour/brush/size, the list of strokes
 * (with undo), stickers, and draw-call batching of finished strokes.
 */
export class Paint {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group();
    this.group.name = 'painting';
    const shared = app.world.uniforms;
    this.materials = {
      glow: new StrokeMaterial(shared),
      sparkle: new StrokeMaterial(shared, { sparkle: true }),
      cotton: new StrokeMaterial(shared, { cotton: true }),
    };
    this.stamps = new StampLayer(shared);
    this.group.add(this.stamps.group);

    this.palette = PALETTE.map((p) => new THREE.Color(p.hex));
    this.colorIndex = 6;
    this.color = this.palette[this.colorIndex].clone();
    this.brushIndex = 0;
    this.size = BRUSH_SIZE.default;

    this.history = []; // { kind:'tube', stroke, mesh, batch } | { kind:'stamp', shape, count }
    this.live = []; // tube entries not yet batched
    this.batches = [];
    this.strokeCount = 0;
    this.totalLength = 0;
  }

  get brush() {
    return BRUSHES[this.brushIndex];
  }
  get colorName() {
    return PALETTE[this.colorIndex].name;
  }

  setColorIndex(i) {
    const n = this.palette.length;
    this.colorIndex = ((i % n) + n) % n;
    this.color.copy(this.palette[this.colorIndex]);
    this.app.events.emit('color', this.colorIndex);
  }
  nextColor(d = 1) {
    this.setColorIndex(this.colorIndex + d);
  }
  setBrushIndex(i) {
    const n = BRUSHES.length;
    this.brushIndex = ((i % n) + n) % n;
    this.app.events.emit('brush', this.brush);
  }
  setBrush(id) {
    const i = BRUSHES.findIndex((b) => b.id === id);
    if (i >= 0) this.setBrushIndex(i);
  }
  nextBrush(d = 1) {
    this.setBrushIndex(this.brushIndex + d);
  }
  setSize(v) {
    this.size = clamp(v, BRUSH_SIZE.min, BRUSH_SIZE.max);
    this.app.events.emit('size', this.size);
  }
  get sizeT() {
    return (this.size - BRUSH_SIZE.min) / (BRUSH_SIZE.max - BRUSH_SIZE.min);
  }

  materialFor(brushId) {
    if (brushId === 'cotton') return this.materials.cotton;
    if (brushId === 'sparkle') return this.materials.sparkle;
    return this.materials.glow;
  }

  /** start a tube stroke; returns the Stroke */
  beginStroke(brushId) {
    const stroke = new Stroke({ sides: brushId === 'cotton' ? 10 : 8 });
    const mesh = new THREE.Mesh(stroke.geometry, this.materialFor(brushId));
    mesh.frustumCulled = true;
    mesh.name = 'stroke';
    this.group.add(mesh);
    const entry = { kind: 'tube', stroke, mesh, batch: null, brushId };
    this.history.push(entry);
    this.live.push(entry);
    this.strokeCount++;
    return entry;
  }

  endStroke(entry) {
    entry.stroke.end();
    this.totalLength += entry.stroke.length;
    if (entry.stroke.count < 2) {
      // a dot: keep it (tiny strokes are fine) but nothing else to do
    }
    this.app.events.emit('strokeend', entry);
    this._maybeBatch();
  }

  beginStamps(shape) {
    const entry = { kind: 'stamp', shape, count: 0 };
    this.history.push(entry);
    this.strokeCount++;
    return entry;
  }

  placeStamp(entry, position, quaternion, scale, color, time) {
    const i = this.stamps.place(entry.shape, position, quaternion, scale, color, time);
    if (i >= 0) entry.count++;
    return i >= 0;
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return false;
    if (entry.kind === 'stamp') {
      this.stamps.removeLast(entry.shape, entry.count);
    } else if (entry.batch) {
      const b = entry.batch;
      b.entries = b.entries.filter((e) => e !== entry);
      this._rebuildBatch(b);
      entry.stroke.dispose();
    } else {
      this.group.remove(entry.mesh);
      entry.stroke.dispose();
      const li = this.live.indexOf(entry);
      if (li >= 0) this.live.splice(li, 1);
    }
    this.app.events.emit('undo', entry);
    return true;
  }

  clearAll() {
    for (const e of this.live) {
      this.group.remove(e.mesh);
      e.stroke.dispose();
    }
    for (const b of this.batches) {
      this.group.remove(b.mesh);
      b.mesh.geometry.dispose();
      for (const e of b.entries) e.stroke.dispose();
    }
    this.live.length = 0;
    this.batches.length = 0;
    this.history.length = 0;
    this.stamps.clear();
    this.totalLength = 0;
    this.app.events.emit('clear');
  }

  /** merge older finished strokes into a few big meshes to keep draw calls low */
  _maybeBatch() {
    if (this.live.length < 24) return;
    const toBatch = this.live.splice(0, this.live.length - 4);
    const byMat = new Map();
    for (const e of toBatch) {
      const m = e.mesh.material;
      if (!byMat.has(m)) byMat.set(m, []);
      byMat.get(m).push(e);
    }
    for (const [material, entries] of byMat) {
      const batch = { material, entries, mesh: null };
      for (const e of entries) {
        this.group.remove(e.mesh);
        e.mesh = null;
        e.batch = batch;
        e.stroke.compact();
      }
      this._rebuildBatch(batch);
      this.batches.push(batch);
    }
  }

  _rebuildBatch(batch) {
    if (batch.mesh) {
      this.group.remove(batch.mesh);
      batch.mesh.geometry.dispose();
      batch.mesh = null;
    }
    if (batch.entries.length === 0) {
      const i = this.batches.indexOf(batch);
      if (i >= 0) this.batches.splice(i, 1);
      return;
    }
    let vCount = 0;
    let iCount = 0;
    for (const e of batch.entries) {
      vCount += e.stroke.usedVertices;
      iCount += e.stroke.usedIndices;
    }
    const pos = new Float32Array(vCount * 3);
    const nrm = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const aux = new Float32Array(vCount);
    const idx = new Uint32Array(iCount);
    let vo = 0;
    let io = 0;
    const bounds = new THREE.Box3();
    for (const e of batch.entries) {
      const s = e.stroke;
      const nv = s.usedVertices;
      const ni = s.usedIndices;
      pos.set(s.positions.subarray(0, nv * 3), vo * 3);
      nrm.set(s.normals.subarray(0, nv * 3), vo * 3);
      col.set(s.colors.subarray(0, nv * 3), vo * 3);
      uv.set(s.uvs.subarray(0, nv * 2), vo * 2);
      aux.set(s.aux.subarray(0, nv), vo);
      const srcIdx = s.indexArray;
      for (let k = 0; k < ni; k++) idx[io + k] = srcIdx[k] + vo;
      vo += nv;
      io += ni;
      bounds.union(s.bounds);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aux', new THREE.BufferAttribute(aux, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere();
    bounds.getBoundingSphere(geo.boundingSphere);
    geo.boundingSphere.radius += 0.2;
    batch.mesh = new THREE.Mesh(geo, batch.material);
    batch.mesh.name = 'stroke-batch';
    this.group.add(batch.mesh);
  }

  /** everything needed to restore this painting later */
  serialize() {
    const strokes = [];
    for (const e of this.history) {
      if (e.kind === 'tube') strokes.push({ b: e.brushId, s: e.stroke.serialize() });
    }
    return { v: 1, strokes, color: this.colorIndex, brush: this.brushIndex, size: this.size };
  }
}
