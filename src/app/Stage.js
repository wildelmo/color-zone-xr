import * as THREE from 'three';
import { LAYOUT } from './Hall.js';

/**
 * The display table: owns the one full-detail ("hero") asset that is loaded
 * at a time. Loading builds it off-screen in time-sliced steps, uploads its
 * textures and compiles its shaders before it appears, then plays its
 * assembly. Unloading frees every byte of it before the next one loads.
 */
export class Stage {
  constructor(app) {
    this.app = app;
    this.holder = new THREE.Group();
    this.holder.name = 'stage-holder';
    this.asset = null;
    this.item = null;
    this.loading = null;
    this.mode = 'toy'; // 'toy' | 'life'
    this.tween = null;
    this.grabbed = false;
    this.ring = buildLoadingRing();
    this.ring.position.copy(LAYOUT.table).add(new THREE.Vector3(0, 0.005, 0));
    this.ring.visible = false;
    this.offsets = [];
    this.bodyProxy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.bodyProxy.name = 'proxy:hero';
    this._v = new THREE.Vector3();
    this._center = new THREE.Vector3();
  }

  get scale() {
    return this.asset ? this.asset.info.scale : 1 / 25;
  }

  /** hero bounding sphere in world space */
  worldBounds(target = new THREE.Vector3()) {
    if (!this.asset) return { center: target.copy(LAYOUT.table), radius: 0.3 };
    const b = this.asset.info.bounds;
    target.set(b.center[0], b.center[1], b.center[2]);
    this.asset.root.localToWorld(target);
    return { center: target, radius: b.radius * this.holder.scale.x };
  }

  toyPose() {
    return { position: LAYOUT.table.clone(), quaternion: new THREE.Quaternion(), scale: this.scale };
  }

  async load(item) {
    if (this.loading || (this.item === item && this.asset)) return;
    this.unload();
    this.item = item;
    const app = this.app;
    this.loading = { label: 'opening the crate', progress: 0 };
    this.ring.visible = true;
    app.onStatus?.(`Bringing out ${item.entry.name}…`);
    try {
      const mod = item.module || (await item.entry.load());
      item.module = mod;
      const ctx = {
        step: () => app.frames.step(),
        progress: (f, label) => {
          this.loading.progress = f;
          this.loading.label = label;
          app.onStatus?.(`${item.entry.name}: ${label}…`);
        },
      };
      const asset = await mod.create(ctx, { lod: 'hero' });
      this.loading.label = 'polishing';
      await app.prepare(asset.root);
      this.asset = asset;
      const pose = this.toyPose();
      this.holder.position.copy(pose.position);
      this.holder.quaternion.copy(pose.quaternion);
      this.holder.scale.setScalar(pose.scale);
      this.holder.add(asset.root);
      item.onStage = true;
      this.mode = 'toy';
      asset.events.on('sfx', (e) => app.audio.sfx(e.name, e));
      asset.events.on('note', (e) => app.audio.note(e.midi, e.velocity));
      asset.events.on('haptic', (e) => app.haptic(e.strength, e.ms));
      asset.events.on('assembled', () => app.onStatus?.(`${asset.info.name} is ready. Wind the key!`));
      app.onHeroLoaded?.(asset);
      if (app.started) this.startShow();
      else this.pendingShow = true;
    } catch (e) {
      console.error('failed to load', item.entry.id, e);
      app.onStatus?.(`Could not load ${item.entry.name}`);
      this.item = null;
    } finally {
      this.loading = null;
      this.ring.visible = false;
    }
  }

  /** play the assembly (deferred until the viewer has actually entered) */
  startShow() {
    this.pendingShow = false;
    if (!this.asset) return;
    if (this.app.params.has('instant')) {
      this.asset.skipAssembly?.();
      this.asset.wind?.(0.5);
    } else {
      this.asset.assemble?.();
      this.asset.events.on('assembled', () => this.asset?.wind?.(0.35));
    }
  }

  unload() {
    if (!this.asset) return;
    if (this.mode === 'life') this.setLife(false, true);
    this.holder.remove(this.asset.root);
    this.asset.dispose();
    this.asset = null;
    if (this.item) this.item.onStage = false;
    this.item = null;
    this.app.onHeroUnloaded?.();
  }

  /** smooth move of the holder to a pose */
  tweenTo(pose, duration = 1, onDone = null) {
    this.tween = {
      t: 0,
      duration,
      from: { position: this.holder.position.clone(), quaternion: this.holder.quaternion.clone(), scale: this.holder.scale.x },
      to: pose,
      onDone,
    };
  }

  reset() {
    if (this.mode === 'life') return this.setLife(false);
    this.tweenTo(this.toyPose(), 0.9);
  }

  /** step inside: scale to life size around the viewer */
  setLife(on, instant = false) {
    const app = this.app;
    if (!this.asset) return;
    if (on && this.mode !== 'life') {
      this.mode = 'life';
      const b = this.asset.info;
      const deck = 1.52; // carousel deck height at life size
      app.hall.setFurnitureVisible(false);
      app.shelf.group.visible = false;
      app.placeRig(new THREE.Vector3(0, 0, 7.4), 0);
      this.tweenTo({ position: new THREE.Vector3(0, -deck + 0.04, 0), quaternion: new THREE.Quaternion(), scale: 1 }, instant ? 0 : 2.4);
      app.onStatus?.(`${b.name}, life size. Walk in with the left stick.`);
    } else if (!on && this.mode === 'life') {
      this.mode = 'toy';
      app.placeRig(new THREE.Vector3(0, 0, 0), 0);
      this.tweenTo(this.toyPose(), instant ? 0 : 1.6, () => {
        app.hall.setFurnitureVisible(true);
        app.shelf.group.visible = true;
      });
      app.hall.setFurnitureVisible(true);
      app.shelf.group.visible = true;
    }
  }

  update(dt, camera) {
    // tween
    if (this.tween && !this.grabbed) {
      const tw = this.tween;
      tw.t += dt;
      const k = tw.duration <= 0 ? 1 : Math.min(1, tw.t / tw.duration);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.holder.position.lerpVectors(tw.from.position, tw.to.position, e);
      this.holder.quaternion.slerpQuaternions(tw.from.quaternion, tw.to.quaternion, e);
      // scale interpolates geometrically so growing feels even
      this.holder.scale.setScalar(tw.from.scale * Math.pow(tw.to.scale / tw.from.scale, e));
      if (k >= 1) {
        this.tween = null;
        tw.onDone?.();
      }
    } else if (this.grabbed) this.tween = null;

    // loading ring
    if (this.ring.visible) {
      this.ring.rotation.y += dt * 1.5;
      const p = this.loading ? this.loading.progress : 0;
      this.ring.children.forEach((s, i) => {
        const on = i / this.ring.children.length < p + 0.05;
        s.material.color.set(0xffd38a).multiplyScalar(on ? 1.6 + Math.sin(performance.now() / 150 + i) * 0.4 : 0.25);
      });
    }

    if (!this.asset) return;
    this.holder.updateMatrixWorld(true);
    camera.getWorldPosition(this._v);
    this.asset.root.worldToLocal(this._v);
    this.asset.update(dt, { cameraLocal: this._v, worldScale: this.holder.scale.x });
    // keep the pick proxy on the hero
    const wb = this.worldBounds(this._center);
    this.bodyProxy.position.copy(wb.center);
    this.bodyProxy.scale.setScalar(wb.radius * 0.8);
    this.bodyProxy.updateMatrixWorld();
  }
}

function buildLoadingRing() {
  const g = new THREE.Group();
  g.name = 'loading-ring';
  const n = 28;
  const geo = new THREE.SphereGeometry(0.008, 8, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false }));
    m.position.set(Math.cos(a) * 0.2, 0.01, Math.sin(a) * 0.2);
    g.add(m);
  }
  return g;
}
