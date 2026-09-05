import * as THREE from 'three';
import { StampRenderer, makeMapTarget } from '../paint/StampRenderer.js';
import { WORLD } from '../config.js';

/**
 * Baked contact shadows: soft dark ellipses under trees, rocks and props,
 * rendered once into a top-down texture that the terrain shader samples.
 * Cheap grounding without real-time shadow maps.
 */
export class ShadowMap {
  constructor(renderer, sunDir) {
    this.renderer = renderer;
    this.size = WORLD.mapSize;
    this.half = this.size / 2;
    this.res = 512;
    this.mapRect = new THREE.Vector4(-this.half, -this.half, this.size, this.size);
    this.target = makeMapTarget(this.res, 'shadowMap');
    this.texture = this.target.texture;
    this.stamper = new StampRenderer(renderer, this.mapRect);
    // shadows lean away from the sun
    this.offset = new THREE.Vector2(-sunDir.x, -sunDir.z).normalize().multiplyScalar(0.35);
    this.cleared = false;
  }

  clear() {
    this.stamper.clear(this.target);
    this.cleared = true;
  }

  /** @param strength 0..1 darkness; radius in metres */
  add(x, z, radius, strength = 0.6, soft = 0.65) {
    this.stamper.stamp(x + this.offset.x * radius, z + this.offset.y * radius, radius, 0, 0, 0, strength, soft);
  }

  flush() {
    if (!this.cleared) this.clear();
    this.stamper.flush(this.target);
  }
}
