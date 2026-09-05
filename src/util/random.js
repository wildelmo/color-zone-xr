/**
 * Small deterministic PRNG (mulberry32) so a "world seed" always
 * rebuilds the same island, trees and flowers.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) {
    this.seed = seed;
    this.next = mulberry32(seed);
  }
  /** float in [0,1) */
  float() {
    return this.next();
  }
  /** float in [a,b) */
  range(a, b) {
    return a + (b - a) * this.next();
  }
  /** int in [a,b] inclusive */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  /** roughly gaussian in [-1,1] */
  gauss() {
    return (this.next() + this.next() + this.next()) / 1.5 - 1;
  }
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
