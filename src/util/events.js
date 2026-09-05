/** tiny synchronous event bus */
export class Emitter {
  constructor() {
    this._l = new Map();
  }
  on(type, fn) {
    if (!this._l.has(type)) this._l.set(type, new Set());
    this._l.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const s = this._l.get(type);
    if (s) s.delete(fn);
  }
  emit(type, payload) {
    const s = this._l.get(type);
    if (!s) return;
    for (const fn of s) fn(payload);
  }
}
