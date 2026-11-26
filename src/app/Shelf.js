import * as THREE from 'three';
import { GeoBag, lathe, beadRing } from '../../library/core/geometry.js';
import { MaterialKit } from '../../library/core/materials.js';
import { lettering, canvasTexture } from '../../library/core/textures.js';
import { mulberry32 } from '../../library/core/random.js';
import { CATALOG } from '../../library/index.js';
import { LAYOUT } from './Hall.js';

const SHELF_SCALE = 1 / 40;
const PEDESTAL_H = 1.0;

/**
 * An arc of pedestals behind the display table. Each holds the cheap "shelf"
 * build of an asset (or a dust-covered placeholder); pointing at one and
 * pulling the trigger brings the full-detail version to the table.
 */
export class Shelf {
  constructor() {
    this.kit = new MaterialKit();
    this.group = new THREE.Group();
    this.group.name = 'shelf';
    this.items = [];
    const kit = this.kit;
    const mats = {
      stone: kit.standard({ color: 0xe8dcc6, roughness: 0.4 }),
      gold: kit.gold({ roughness: 0.3 }),
      dark: kit.standard({ color: 0x2a140a, roughness: 0.35 }),
    };
    const cloth = kit.standard({ color: 0xc9bea9, roughness: 1 });
    this.ringMat = kit.track(new THREE.MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));

    const n = CATALOG.length;
    CATALOG.forEach((entry, i) => {
      const ang = THREE.MathUtils.degToRad(-56 + (112 * i) / (n - 1));
      const pos = new THREE.Vector3(Math.sin(ang) * LAYOUT.shelfR, 0, -Math.cos(ang) * LAYOUT.shelfR);
      const g = new THREE.Group();
      g.position.copy(pos);
      g.rotation.y = -ang;
      g.name = `pedestal:${entry.id}`;
      const b = new GeoBag();
      b.add(lathe([[0, 0], [0.3, 0], [0.3, 0.06], [0.26, 0.09], [0.24, 0.12], [0.18, 0.16], [0.16, 0.2], [0.15, PEDESTAL_H - 0.16], [0.18, PEDESTAL_H - 0.12], [0.26, PEDESTAL_H - 0.06], [0.28, PEDESTAL_H - 0.03], [0.28, PEDESTAL_H], [0, PEDESTAL_H]], 40), null, 'stone');
      b.add(beadRing(0.285, PEDESTAL_H - 0.015, 0.012, 64, 6), null, 'gold');
      b.add(beadRing(0.3, 0.06, 0.012, 64, 6), null, 'gold');
      b.add(beadRing(0.155, 0.22, 0.01, 32, 6), null, 'gold');
      b.add(beadRing(0.155, PEDESTAL_H - 0.18, 0.01, 32, 6), null, 'gold');
      g.add(b.build(mats, { name: 'pedestal' }));
      // brass plaque with the name
      const tex = kit.trackTexture(canvasTexture(lettering([entry.name, entry.comingSoon ? 'coming soon' : entry.tagline], { w: 512, h: 160, bg: '#1b1411', fg: entry.comingSoon ? '#b49a6a' : '#e8c070', sizes: [44, 28] })));
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.08), kit.standard({ map: tex, roughness: 0.4 }));
      plaque.position.set(0, 0.62, 0.162);
      plaque.rotation.x = -0.12;
      g.add(plaque);
      // hover ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.008, 6, 64).rotateX(Math.PI / 2), this.ringMat.clone());
      kit.track(ring.material);
      ring.position.y = PEDESTAL_H + 0.01;
      g.add(ring);
      // pick target
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.75, 12), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.y = PEDESTAL_H + 0.3;
      proxy.name = `proxy:shelf:${entry.id}`;
      g.add(proxy);
      const holder = new THREE.Group();
      holder.position.y = PEDESTAL_H;
      g.add(holder);
      if (entry.comingSoon) holder.add(drapedCloth(cloth, i, SHAPES[entry.id]));
      this.group.add(g);
      this.items.push({ entry, group: g, holder, proxy, ring, asset: null, hover: 0, onStage: false, top: new THREE.Vector3() });
    });
  }

  /** build the low-detail versions (time-sliced) */
  async populate(ctx) {
    for (const item of this.items) {
      if (item.entry.comingSoon) continue;
      const mod = await item.entry.load();
      item.module = mod;
      const asset = await mod.create(ctx, { lod: 'shelf' });
      asset.root.scale.setScalar(SHELF_SCALE);
      asset.root.traverse((o) => {
        if (o.isMesh) o.castShadow = false;
      });
      item.holder.add(asset.root);
      item.asset = asset;
    }
  }

  itemFor(object) {
    return this.items.find((it) => it.proxy === object) || null;
  }

  update(dt, hovered, cameraPos) {
    for (const it of this.items) {
      const target = it === hovered ? 1 : it.onStage ? 0.35 : 0;
      it.hover += (target - it.hover) * Math.min(1, dt * 8);
      it.ring.material.opacity = it.hover * 0.9;
      it.holder.position.y = PEDESTAL_H + it.hover * 0.03;
      if (it.asset) {
        it.asset.root.visible = !it.onStage;
        if (!it.onStage) {
          it.holder.rotation.y += dt * 0.15;
          it.asset.state.wind = 0.6; // previews never run down
          it.asset.update(dt, { cameraLocal: null, worldScale: SHELF_SCALE });
        }
      }
    }
  }
}

// rough silhouettes of what waits under each dust cloth: [width, height, squareness]
const SHAPES = {
  orrery: [0.14, 0.26, 0],
  city: [0.2, 0.12, 0.8],
  birdbox: [0.12, 0.12, 1],
  lighthouse: [0.08, 0.34, 0],
};

/** a dust cloth thrown over something: a sagging, folded drape */
function drapedCloth(material, seed, shape = [0.15, 0.2, 0]) {
  const [w, hgt, sq] = shape;
  const g = new THREE.SphereGeometry(0.2, 48, 28, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const p = g.attributes.position;
  const rnd = mulberry32(seed + 3);
  const bumps = Array.from({ length: 5 }, () => [rnd() * Math.PI * 2, 0.6 + rnd() * 0.8, rnd() * 0.04]);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const h = y / 0.2; // 1 at top, ~-0.37 at the hem
    // folds that deepen toward the hem
    const fold = Math.sin(a * 9 + seed) * 0.012 * (1 - h) + Math.sin(a * 5 + seed * 2) * 0.01 * (1 - h);
    let r = 1 + fold / 0.2;
    for (const [ba, bh, bs] of bumps) r += Math.exp(-((a - ba) ** 2) * 6) * Math.exp(-((h - bh) ** 2) * 4) * bs * 5;
    x *= r;
    z *= r;
    // flare and sit on the pedestal
    const flare = 1 + Math.max(0, 0.3 - h) * 0.55;
    // squarish things make boxy drapes
    const ax = Math.abs(Math.cos(a)), az = Math.abs(Math.sin(a));
    const box = 1 / Math.max(ax, az, 0.0001);
    const sqr = 1 + (Math.min(box, 1.41) - 1) * sq;
    const s = (w / 0.2) * flare * sqr;
    p.setXYZ(i, x * s, (y + 0.075) * (hgt / 0.2), z * s);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}
