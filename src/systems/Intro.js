import { easeInOutCubic } from '../util/math.js';

/**
 * The opening moment. On the title screen the island is shown in full
 * colour. When the player enters, Dot says hello, the colours drain away
 * (leaving only the little Colour Zone around your feet) and Dot asks you
 * to paint them back. Returning players just get a "welcome back".
 */
export class Intro {
  constructor(app) {
    this.app = app;
    this.started = false;
    this.done = false;
    this.t = 0;
    this.phase = 'attract';
    this.drainT = -1;
    this.drainDur = 2.6;
    this.drainFrom = 1;
    this.sawPaint = false;
    this.sawStroke = false;
    this.steps = [];
    app.world.setOverride(1);
    app.milestones.rainbow.show(true);
    app.events.on('modechange', (mode) => {
      if ((mode === 'xr' || mode === 'desktop') && !this.started) this.start();
    });
    app.events.on('paintstart', () => {
      if (this.started && !this.sawPaint) {
        this.sawPaint = true;
        if (this.phase === 'story') {
          app.buddy.say('Yes! Just like that!', 1.6);
          app.hintPulse = false;
        }
      }
    });
    app.events.on('strokeend', () => {
      if (this.started && !this.sawStroke) {
        this.sawStroke = true;
        if (this.phase === 'story') {
          this.steps.push({ at: this.t + 0.4, fn: () => app.buddy.say('Look! The ground is blooming!', 2.4) });
          this.steps.push({ at: this.t + 3.2, fn: () => app.buddy.say('Dip your wand in an orb for a new colour', 3) });
          this.steps.push({ at: this.t + 6.6, fn: () => this.finish() });
        }
      }
    });
  }

  start() {
    const app = this.app;
    this.started = true;
    this.t = 0;
    app.locomotion.fadeIn(1.1);
    app.buddy.summon();
    if (app.restored) {
      this.phase = 'welcome';
      this.drainDur = 1.6;
      this.steps = [
        { at: 0.6, fn: () => app.buddy.say('Welcome back! Your painting is still here', 2.8) },
        { at: 0.6, fn: () => this.beginDrain() },
        { at: 3.8, fn: () => this.finish() },
      ];
    } else {
      this.phase = 'story';
      this.steps = [
        { at: 0.5, fn: () => app.buddy.say("Hi! I'm Dot!", 2.0) },
        { at: 2.7, fn: () => app.buddy.say('Oh no! The colours are fading away!', 2.8) },
        { at: 2.9, fn: () => this.beginDrain() },
        { at: 5.9, fn: () => app.buddy.say('Pull the trigger and paint them back!', 3.4) },
        { at: 5.9, fn: () => (app.hintPulse = true) },
        { at: 12.0, fn: () => !this.sawPaint && app.buddy.say('Wave your wand and squeeze the trigger!', 3.4) },
        { at: 20.0, fn: () => !this.sawPaint && app.buddy.say('You can do it! Paint anywhere!', 3.0) },
      ];
    }
  }

  beginDrain() {
    this.drainT = 0;
    this.drainFrom = 1;
    this.app.milestones.rainbow.show(false);
    if (this.app.audio) this.app.audio.drain(this.drainDur);
    if (this.app.fx && this.phase === 'story') {
      const p = this.app.headPosition();
      p.y -= 0.2;
      this.app.fx.burst(p, this.app.paint.color, 30, 1.6, 0.05);
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.phase = 'done';
    this.app.hintPulse = false;
    this.app.world.setOverride(null);
    this.app.events.emit('introdone');
  }

  update(dt) {
    if (!this.started || this.done) return;
    this.t += dt;
    const due = this.steps.filter((s) => s.at <= this.t);
    if (due.length) {
      this.steps = this.steps.filter((s) => s.at > this.t);
      for (const s of due) s.fn();
    }
    if (this.drainT >= 0) {
      this.drainT += dt;
      const k = Math.min(1, this.drainT / this.drainDur);
      const v = this.drainFrom * (1 - easeInOutCubic(k));
      this.app.world.setOverride(v);
      if (k >= 1) {
        this.drainT = -1;
        this.app.world.setOverride(null);
      }
    }
    // story mode: if the player never paints, the intro still ends eventually
    if (this.phase === 'story' && this.t > 45) this.finish();
  }
}
