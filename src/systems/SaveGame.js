import * as THREE from 'three';

/**
 * Auto-saves the painting to localStorage a few seconds after each change,
 * and restores it on the next visit — kids expect their world to still be
 * there. The ground colour is rebuilt by re-stamping the restored strokes.
 */
const KEY = 'colorzone:save:v1';
const MAX_BYTES = 3.5 * 1024 * 1024;

export class SaveGame {
  constructor(app) {
    this.app = app;
    this.dirty = false;
    this.timer = 0;
    this.loading = false;
    this.enabled = typeof localStorage !== 'undefined';
    const mark = () => {
      if (!this.loading) {
        this.dirty = true;
        this.timer = 2.5;
      }
    };
    for (const ev of ['strokeend', 'undo', 'splat', 'milestone']) app.events.on(ev, mark);
    app.events.on('reset', () => {
      if (!this.loading) this.clear();
    });
  }

  clear() {
    if (!this.enabled) return;
    try {
      localStorage.removeItem(KEY);
    } catch (e) {
      /* ignore */
    }
    this.dirty = false;
  }

  hasSave() {
    if (!this.enabled) return false;
    try {
      return !!localStorage.getItem(KEY);
    } catch (e) {
      return false;
    }
  }

  snapshot() {
    const app = this.app;
    const paint = app.paint;
    const strokes = [];
    for (const e of paint.history) {
      if (e.kind === 'tube') strokes.push({ b: e.brushId, s: e.stroke.serialize() });
    }
    const stickers = {};
    for (const [kind, k] of Object.entries(paint.stamps.kinds)) {
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const c = new THREE.Color();
      const items = [];
      for (let i = 0; i < k.next; i++) {
        k.mesh.getMatrixAt(i, m);
        m.decompose(p, q, sc);
        k.mesh.getColorAt(i, c);
        items.push([+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.w.toFixed(3), +sc.x.toFixed(2), Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]);
      }
      stickers[kind] = items;
    }
    return {
      v: 1,
      seed: app.seedName,
      time: Date.now(),
      color: paint.colorIndex,
      brush: paint.brushIndex,
      size: paint.size,
      strokes,
      stickers,
      splats: app.splats.serialize(),
      milestones: Array.from(app.milestones.reached),
    };
  }

  save() {
    if (!this.enabled) return false;
    try {
      const data = this.snapshot();
      let json = JSON.stringify(data);
      while (json.length > MAX_BYTES && data.strokes.length > 0) {
        data.strokes.shift();
        json = JSON.stringify(data);
      }
      localStorage.setItem(KEY, json);
      this.dirty = false;
      return true;
    } catch (e) {
      console.warn('save failed', e);
      return false;
    }
  }

  load() {
    if (!this.enabled) return false;
    let data;
    try {
      const json = localStorage.getItem(KEY);
      if (!json) return false;
      data = JSON.parse(json);
    } catch (e) {
      return false;
    }
    if (!data || data.v !== 1) return false;
    const app = this.app;
    this.loading = true;
    try {
      if (data.seed && data.seed !== app.seedName) app.newWorld(data.seed, { quiet: true });
      const paint = app.paint;
      const map = app.world.paintMap;
      const c = new THREE.Color();
      const p = new THREE.Vector3();
      for (const st of data.strokes || []) {
        const s = st.s;
        const entry = paint.beginStroke(st.b);
        const single = s.c.length === 3;
        for (let i = 0; i < s.n; i++) {
          p.set(s.p[i * 3], s.p[i * 3 + 1], s.p[i * 3 + 2]);
          const ci = single ? 0 : i * 3;
          c.setRGB(s.c[ci] / 255, s.c[ci + 1] / 255, s.c[ci + 2] / 255);
          entry.stroke.addPoint(p, s.r[i], c);
          if (i % 5 === 0 && i < s.n - 2) map.stamp(p.x, p.z, 0.45 + s.r[i] * 6 + paint.sizeT * 0.6, c, 0.5, 0.85);
        }
        entry.stroke.ended = true; // caps were saved as points
        paint.endStroke(entry);
      }
      const q = new THREE.Quaternion();
      for (const [kind, items] of Object.entries(data.stickers || {})) {
        for (const it of items) {
          p.set(it[0], it[1], it[2]);
          q.set(it[3], it[4], it[5], it[6]);
          c.setRGB(it[8] / 255, it[9] / 255, it[10] / 255);
          const entry = paint.beginStamps(kind);
          paint.placeStamp(entry, p, q, it[7], c, app.time - 5);
        }
      }
      app.splats.restore(data.splats || []);
      if (typeof data.color === 'number') paint.setColorIndex(data.color);
      if (typeof data.brush === 'number') paint.setBrushIndex(data.brush);
      if (typeof data.size === 'number') paint.setSize(data.size);
      app.milestones.restore(data.milestones || []);
      app.world.worldColor = Math.min(1, Math.pow(map.computeProgress(), 0.6) * 1.05);
      app.world.uniforms.worldColor.value = app.world.worldColor;
    } finally {
      this.loading = false;
    }
    this.dirty = false;
    return true;
  }

  update(dt) {
    if (!this.dirty) return;
    this.timer -= dt;
    if (this.timer <= 0) this.save();
  }
}
