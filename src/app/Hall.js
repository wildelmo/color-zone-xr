import * as THREE from 'three';
import { GeoBag, lathe, mat, beadRing } from '../../library/core/geometry.js';
import { MaterialKit } from '../../library/core/materials.js';
import { BulbString } from '../../library/core/bulbs.js';
import { parquet, rug, wallpaper, panelWood, lightPool } from './hallTextures.js';

/** layout of the room (metres; the viewer starts at the origin facing -z) */
export const LAYOUT = {
  table: new THREE.Vector3(0, 0.84, -0.62),
  tableR: 0.42,
  hallR: 9,
  wallH: 8,
  shelfR: 2.45,
};

/**
 * The gallery: a round, dim, wood-panelled room with a rug, a velvet-topped
 * display table under a pendant lamp, and the lights that keep everything
 * warm. Built once; cheap (a dozen draw calls).
 */
export class Hall {
  constructor() {
    this.kit = new MaterialKit();
    this.group = new THREE.Group();
    this.group.name = 'hall';
    this.tableGroup = new THREE.Group();
    this.tableGroup.name = 'table';
    const kit = this.kit;
    const R = LAYOUT.hallR, H = LAYOUT.wallH;

    const floorMat = kit.standard({ map: kit.trackTexture(parquet()), roughness: 0.5, color: 0x9a8070 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2), floorMat);
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.group.add(floor);
    const rugMesh = new THREE.Mesh(new THREE.CircleGeometry(1.7, 96).rotateX(-Math.PI / 2), kit.standard({ map: kit.trackTexture(rug()), roughness: 0.95 }));
    rugMesh.position.set(0, 0.004, -0.6);
    rugMesh.receiveShadow = true;
    this.group.add(rugMesh);

    // walls: wainscot + wallpaper + gilt rails
    const walls = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H - 1.1, 96, 1, true), kit.standard({ map: kit.trackTexture(wallpaper()), roughness: 0.85, side: THREE.BackSide }));
    walls.position.y = 1.1 + (H - 1.1) / 2;
    this.group.add(walls);
    const wains = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 1.1, 96, 1, true), kit.standard({ map: kit.trackTexture(panelWood()), roughness: 0.45, side: THREE.BackSide }));
    wains.position.y = 0.55;
    this.group.add(wains);
    const trim = new GeoBag();
    trim.add(beadRing(R - 0.03, 1.1, 0.03, 96, 6), null, 'gold');
    trim.add(beadRing(R - 0.03, 2.6, 0.025, 96, 6), null, 'gold');
    trim.add(beadRing(R - 0.04, 0.08, 0.05, 96, 6), null, 'wood');
    const ceil = new THREE.CircleGeometry(R, 64).rotateX(Math.PI / 2);
    ceil.translate(0, H, 0);
    trim.add(ceil, null, 'ceil');
    this.group.add(trim.build({ gold: kit.gold({ roughness: 0.4 }), wood: kit.standard({ color: 0x2a140a, roughness: 0.5 }), ceil: kit.standard({ color: 0x0d0907, roughness: 1 }) }, { castShadow: false, name: 'trim' }));

    // light pools on the floor (fake spotlights)
    const poolMat = kit.track(new THREE.MeshBasicMaterial({ map: kit.trackTexture(lightPool()), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.poolMat = poolMat;
    const pool = (x, z, r) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2), poolMat);
      m.position.set(x, 0.01, z);
      m.renderOrder = 2;
      this.group.add(m);
    };
    pool(0, -0.62, 1.4);

    // brass wall sconces: glowing bulbs and a wash of light on the wallpaper
    const sconces = new GeoBag();
    this.sconceLights = new BulbString({ radius: 0.035, glow: 0.55 });
    const washMat = kit.track(new THREE.MeshBasicMaterial({ map: poolMat.map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, color: 0xffd9a0 }));
    for (let i = 0; i < 10; i++) {
      const a = ((i + 0.5) / 10) * Math.PI * 2;
      const r = R - 0.02;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const ry = -a - Math.PI / 2; // face the room centre
      const m = mat(x, 2.05, z, 0, ry);
      sconces.add(new THREE.CylinderGeometry(0.06, 0.08, 0.02, 16).rotateX(Math.PI / 2), m.clone().multiply(mat(0, 0, 0.01)), 'gold');
      sconces.add(new THREE.TorusGeometry(0.12, 0.012, 6, 16, Math.PI).rotateZ(Math.PI), m.clone().multiply(mat(0, 0.1, 0.12, Math.PI / 2)), 'gold');
      sconces.add(lathe([[0, 0], [0.03, 0], [0.05, 0.03], [0.06, 0.08], [0.0, 0.08]], 12), m.clone().multiply(mat(0, 0.06, 0.2)), 'gold');
      this.sconceLights.add(new THREE.Vector3(0, 0.18, 0.2).applyMatrix4(m), 0, i, 10);
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), washMat);
      wash.position.set(Math.cos(a) * (R - 0.05), 2.3, Math.sin(a) * (R - 0.05));
      wash.rotation.y = ry;
      wash.renderOrder = 2;
      this.group.add(wash);
    }
    this.group.add(sconces.build({ gold: kit.gold({ roughness: 0.3 }) }, { castShadow: false, name: 'sconces' }));
    this.group.add(this.sconceLights.build(kit));
    this.sconceLights.update(0, 0);

    // the display table
    const t = LAYOUT.table;
    const tb = new GeoBag();
    tb.add(new THREE.CylinderGeometry(LAYOUT.tableR, LAYOUT.tableR, 0.03, 64), mat(t.x, t.y - 0.015, t.z), 'velvet');
    tb.add(beadRing(LAYOUT.tableR + 0.005, t.y - 0.012, 0.016, 96, 8), mat(t.x, 0, t.z), 'gold');
    tb.add(lathe([[0, -0.07], [LAYOUT.tableR - 0.02, -0.07], [LAYOUT.tableR + 0.01, -0.05], [LAYOUT.tableR + 0.01, -0.03], [0, -0.03]], 64), mat(t.x, t.y, t.z), 'wood');
    tb.add(
      lathe([[0, 0], [0.26, 0], [0.27, 0.02], [0.2, 0.06], [0.12, 0.1], [0.07, 0.18], [0.055, 0.32], [0.075, 0.42], [0.05, 0.5], [0.045, 0.62], [0.07, 0.68], [0.1, 0.72], [0.1, t.y - 0.07], [0, t.y - 0.07]], 40),
      mat(t.x, 0, t.z),
      'wood',
    );
    tb.add(beadRing(0.05, 0.62, 0.012, 32, 6), mat(t.x, 0, t.z), 'gold');
    tb.add(beadRing(0.2, 0.06, 0.012, 48, 6), mat(t.x, 0, t.z), 'gold');
    const tableMesh = tb.build({ velvet: kit.standard({ color: 0x3e0a10, roughness: 0.95 }), gold: kit.gold({ roughness: 0.3 }), wood: kit.standard({ color: 0x3a1a0c, roughness: 0.35 }) }, { name: 'table' });
    this.tableGroup.add(tableMesh);
    // pendant lamp over the table
    const lampBag = new GeoBag();
    const lampY = 2.55;
    lampBag.add(new THREE.CylinderGeometry(0.006, 0.006, LAYOUT.wallH - lampY, 6), mat(t.x, lampY + (LAYOUT.wallH - lampY) / 2, t.z), 'gold');
    lampBag.add(lathe([[0.02, 0.2], [0.05, 0.19], [0.09, 0.12], [0.2, 0.02], [0.24, 0], [0.235, -0.01], [0.19, 0.01], [0.085, 0.1], [0.04, 0.17], [0.0, 0.18]], 40), mat(t.x, lampY - 0.2, t.z), 'gold');
    this.tableGroup.add(lampBag.build({ gold: kit.gold({ roughness: 0.25 }) }, { castShadow: false, name: 'lamp' }));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), kit.track(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe2b0').multiplyScalar(3), toneMapped: false })));
    bulb.position.set(t.x, lampY - 0.2, t.z);
    this.tableGroup.add(bulb);
    this.group.add(this.tableGroup);

    // lights
    this.hemi = new THREE.HemisphereLight(0xffe6c8, 0x3a1c10, 0.45);
    this.group.add(this.hemi);
    // a museum spotlight that follows the curio: it glows, the room stays dim
    this.key = new THREE.SpotLight(0xffe2bc, 5.5, 0, 0.5, 0.55, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0002;
    this.key.shadow.normalBias = 0.012;
    this.keyDir = new THREE.Vector3(0.3, 1, 0.5).normalize();
    this.group.add(this.key, this.key.target);
    this.fill = new THREE.DirectionalLight(0xc8d8ff, 0.25);
    this.fill.position.set(-3, 2, -2);
    this.group.add(this.fill);
    this.fitShadow(new THREE.Vector3(t.x, t.y + 0.2, t.z), 0.4);
  }

  /** aim the spotlight (and its shadow) at a bounding sphere */
  fitShadow(center, radius) {
    const r = Math.max(0.3, radius * 1.2);
    const dist = Math.max(1.6, r * 3.2);
    this.key.position.copy(center).addScaledVector(this.keyDir, dist);
    this.key.target.position.copy(center);
    this.key.angle = Math.min(1.2, Math.atan((r * 1.35) / dist));
    this.key.shadow.camera.near = Math.max(0.05, dist - r * 2);
    this.key.shadow.camera.far = dist + r * 2;
    this.key.target.updateMatrixWorld();
  }

  setFurnitureVisible(v) {
    this.tableGroup.visible = v;
  }

  /** hide the room itself (floor, walls, sconces) but keep the lights */
  setRoomVisible(v) {
    for (const c of this.group.children) if (!c.isLight && c !== this.key.target) c.visible = v;
    if (v) this.tableGroup.visible = true;
  }
}

