
/**
 * Maps buttons and sticks to actions (colour/brush/size/undo/menu). Locomotion
 * (teleport, snap turn) lives in Locomotion.js so kids' comfort settings stay
 * in one place. Stick "flicks" are edge-triggered so one push = one step.
 */
export class Controls {
  constructor(app) {
    this.app = app;
    this.flick = { left: 0, right: 0 };
    this.sizeHoldT = 0;
    app.events.on('newworld', () => app.newWorld());
  }

  _flick(hand, key) {
    const x = hand.stick.x;
    const prev = this.flick[key];
    let out = 0;
    if (prev === 0 && Math.abs(x) > 0.6) {
      out = x > 0 ? 1 : -1;
      this.flick[key] = out;
    } else if (Math.abs(x) < 0.3) {
      this.flick[key] = 0;
    }
    return out;
  }

  update(dt) {
    const app = this.app;
    const paint = app.paint;
    const L = app.hands.left;
    const R = app.hands.right;

    // right stick up/down: brush size (continuous while held)
    if (R.connected && Math.abs(R.stick.y) > 0.25 && !app.locomotionBusy) {
      const k = Math.pow(1 - R.stick.y * 1.6 * dt, 1);
      paint.setSize(paint.size * k + -R.stick.y * dt * 0.01);
      this.sizeHoldT += dt;
    } else {
      this.sizeHoldT = 0;
    }
    // left stick left/right: cycle colour
    if (L.connected) {
      const f = this._flick(L, 'left');
      if (f !== 0) {
        paint.nextColor(f);
        L.pulse(0.4, 30);
        if (app.audio) app.audio.select(paint.colorIndex / paint.palette.length);
      }
    }
    // buttons
    if (R.connected) {
      if (R.primaryPressed) this.undo(R);
      if (R.secondaryPressed) this.nextBrush(R);
    }
    if (L.connected) {
      if (L.secondaryPressed) this.undo(L);
      if (L.primaryPressed) app.events.emit('menu');
    }
  }

  undo(hand) {
    const app = this.app;
    for (const b of app.brushes) if (b.painting) b.cancel();
    const pts = app.fx ? app.paint.lastStrokePoints(18) : [];
    if (app.paint.undo()) {
      // the stroke poofs into sparkles
      for (const p of pts) app.fx.burst(p, app.paint.color, 3, 0.5, 0.03);
      hand.pulse(0.5, 60);
      if (app.audio) app.audio.undo();
    }
  }

  nextBrush(hand, d = 1) {
    const app = this.app;
    app.paint.nextBrush(d);
    hand.pulse(0.5, 40);
    if (app.audio) app.audio.select(0.8);
    app.events.emit('toast', { text: app.paint.brush.name + ' brush', icon: app.paint.brush.icon });
  }

  /** desktop keyboard actions */
  onKey(code) {
    const app = this.app;
    const paint = app.paint;
    const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
    const di = digits.indexOf(code);
    if (di >= 0) {
      paint.setColorIndex(di);
      if (app.audio) app.audio.select(di / 12);
      return;
    }
    if (code === 'Tab') this.nextBrush(app.hands.right);
    if (code === 'KeyZ') this.undo(app.hands.right);
    if (code === 'KeyM') app.events.emit('menu');
    if (code === 'KeyX') app.events.emit('clearrequest');
    if (code === 'KeyR') app.events.emit('newworld');
  }
}
