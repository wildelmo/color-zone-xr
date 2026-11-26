/**
 * Cooperative time-slicing for heavy builds. Builders `await frames.step()`
 * between pieces of work; once the per-frame budget is used up they resume
 * after the next frame has rendered, so loading never drops headset frames.
 * (Works inside WebXR sessions, where window.requestAnimationFrame stops.)
 */
export class Frames {
  constructor(budgetMs = 6) {
    this.budget = budgetMs;
    this.waiters = [];
    this.sliceStart = performance.now();
  }

  /** called by the render loop after each frame */
  tick() {
    this.sliceStart = performance.now();
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }

  next() {
    return new Promise((r) => this.waiters.push(r));
  }

  async step() {
    if (performance.now() - this.sliceStart > this.budget) await this.next();
  }
}
