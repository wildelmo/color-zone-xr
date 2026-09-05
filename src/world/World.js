import * as THREE from 'three';
import { WORLD } from '../config.js';
import { Terrain } from './Terrain.js';
import { WorldMaterial } from './WorldMaterial.js';
import { Sky } from './Sky.js';
import { Flora } from './Flora.js';
import { Clouds } from './Clouds.js';
import { Pond } from './Pond.js';
import { ShadowMap } from './ShadowMap.js';
import { Fountain, buildLilyPads, Islets } from './Props.js';
import { PaintMap } from '../paint/PaintMap.js';
import { Rng } from '../util/random.js';
import { damp } from '../util/math.js';

/**
 * Owns the environment: terrain, sky, plants, clouds, pond, fountain,
 * islets, the baked shadow map and the PaintMap that colours everything.
 * Also drives the global "how alive is the world" state (worldColor) that
 * lighting, fog and the sky respond to.
 */
export class World {
  constructor(renderer, seed = 1) {
    this.renderer = renderer;
    this.seed = seed;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.rng = new Rng(seed);

    this.terrain = new Terrain(seed);
    this.paintMap = new PaintMap(renderer, this.terrain);
    const sunDir = new THREE.Vector3(...WORLD.sunDir).normalize();
    this.shadowMap = new ShadowMap(renderer, sunDir);

    const c = (hex) => new THREE.Color(hex);
    this.presets = {
      grey: { sun: c('#ffffff').multiplyScalar(0.6), sky: c('#c3c8d3').multiplyScalar(0.62), ground: c('#8b8e97').multiplyScalar(0.5), fog: c('#e6e1d6') },
      color: { sun: c('#fff0c8').multiplyScalar(0.95), sky: c('#a9d4ff').multiplyScalar(0.62), ground: c('#ffb9d2').multiplyScalar(0.42), fog: c('#ffd3ea') },
    };
    this.uniforms = {
      paintMap: { value: this.paintMap.texture },
      mapRect: { value: this.paintMap.mapRect },
      shadowMap: { value: this.shadowMap.texture },
      sunDir: { value: sunDir },
      sunColor: { value: this.presets.grey.sun.clone() },
      skyLight: { value: this.presets.grey.sky.clone() },
      groundLight: { value: this.presets.grey.ground.clone() },
      fogColor: { value: this.presets.grey.fog.clone() },
      fogRange: { value: new THREE.Vector2(40, 150) },
      time: { value: 0 },
      worldColor: { value: 0 },
      forceColor: { value: 0 },
      windStrength: { value: 1 },
      paperColor: { value: c('#f4efe4') },
      inkColor: { value: c('#4b4660') },
    };
    this.worldColor = 0;
    this.progress = 0;
    this.colorOverride = null;
    this.paintMap.textureUniform = this.uniforms.paintMap;

    this.sky = new Sky(this.uniforms);
    this.group.add(this.sky.mesh);

    this.buildIsland(seed);
  }

  buildIsland(seed) {
    if (this.island) {
      this.island.geometry.dispose();
      this.group.remove(this.island);
      this.flora.dispose();
      this.group.remove(this.clouds.mesh);
      this.clouds.mesh.geometry.dispose();
      this.group.remove(this.pond.mesh, this.fountain.group, this.lilies, this.islets.group);
      this.lilies.geometry.dispose();
    }
    this.seed = seed;
    const rng = new Rng(seed + 77);
    this.terrain = new Terrain(seed);
    this.paintMap.rebuildMask(this.terrain);
    const geo = this.terrain.buildGeometry();
    this.islandMaterial = this.islandMaterial || new WorldMaterial(this.uniforms, { groundNoise: true, name: 'island' });
    this.island = new THREE.Mesh(geo, this.islandMaterial);
    this.island.name = 'island';
    this.island.frustumCulled = false;
    this.group.add(this.island);

    this.flora = new Flora(this, seed);
    this.group.add(this.flora.group);
    this.clouds = new Clouds(this, seed);
    this.group.add(this.clouds.mesh);
    this.pond = new Pond(this);
    this.group.add(this.pond.mesh);
    this.fountain = new Fountain(this, rng);
    this.group.add(this.fountain.group);
    this.lilies = buildLilyPads(this, rng);
    this.group.add(this.lilies);
    this.islets = new Islets(this, seed);
    this.group.add(this.islets.group);

    // bake contact shadows under everything that stands on the ground
    this.shadowMap.clear();
    for (const s of [...this.flora.shadowStamps, ...this.fountain.shadowStamps, { x: -1.25, z: -2.6, r: 0.75, strength: 0.4 }]) {
      this.shadowMap.add(s.x, s.z, s.r, s.strength);
    }
    this.shadowMap.flush();
  }

  /** start fresh: wipe colour, hide blooms, paint the little spawn zone */
  reset(newSeed = null) {
    if (newSeed !== null && newSeed !== this.seed) {
      this.buildIsland(newSeed);
    } else {
      this.flora.resetBlooms();
    }
    this.paintMap.clear();
    this.worldColor = 0;
    this.uniforms.worldColor.value = 0;
    this.sky.setSmile(0);
    this.paintSpawnZone();
  }

  paintSpawnZone() {
    const c = new THREE.Color('#5fcf68');
    this.paintMap.stamp(0, 0, WORLD.spawnZoneRadius, c, 1, 0.5);
  }

  /** force the whole world to (natural) colour: 1 = title screen, null = normal play */
  setOverride(v) {
    this.colorOverride = v;
    this.uniforms.forceColor.value = v === null ? 0 : v;
  }

  heightAt(x, z) {
    return this.terrain.heightAt(x, z);
  }

  update(dt, time, spreadEnergy = 0) {
    const u = this.uniforms;
    u.time.value = time;
    this.paintMap.flush();
    this.paintMap.spread(dt, spreadEnergy, this.rng);
    this.progress = this.paintMap.computeProgress();
    // world colour eases toward painted fraction (with a head start so the first strokes feel big)
    let target = Math.min(1, Math.pow(this.progress, 0.6) * 1.05);
    let lambda = 1.2;
    if (this.colorOverride !== null) {
      target = Math.max(target, this.colorOverride);
      lambda = 5;
    }
    this.worldColor = damp(this.worldColor, target, lambda, dt);
    u.worldColor.value = this.worldColor;
    const t = this.worldColor;
    u.sunColor.value.copy(this.presets.grey.sun).lerp(this.presets.color.sun, t);
    u.skyLight.value.copy(this.presets.grey.sky).lerp(this.presets.color.sky, t);
    u.groundLight.value.copy(this.presets.grey.ground).lerp(this.presets.color.ground, t);
    u.fogColor.value.copy(this.presets.grey.fog).lerp(this.presets.color.fog, t);
    u.windStrength.value = 0.7 + 0.6 * t;
    this.islets.update(time);
    return this.flora.update(time, this.paintMap, this.rng);
  }
}
