/**
 * Frame rate and render quality for the VR session.
 *
 * - When a session starts it asks for 90 Hz (Quest runs WebXR at 72 Hz by
 *   default on most headsets), if the browser offers that rate.
 * - It watches the time between frames. If too many frames miss their frame
 *   time for a sustained window, it steps down a ladder, one rung at a time
 *   and never back up within a session: first back to 72 Hz (exactly where
 *   the browser default left things, so asking for 90 never leaves anyone
 *   worse off), then, if frames still miss at 72 Hz, stronger fixed foveation
 *   (0.6 -> 1.0). On a session already at 72 Hz the only rung is foveation.
 * - When 90 Hz did not hold, it remembers that (localStorage, 14 days) and
 *   later sessions skip the 90 Hz request instead of stuttering for the
 *   seconds it takes to find out again. A forced ?hz= ignores the record.
 * - URL overrides for trying things on a headset: ?hz=72|80|90|120 forces the
 *   rate (and turns off the rate rung), ?fov=0..1 fixes foveation (and turns
 *   off the foveation rung), ?scale=0.5..1.5 sets the render scale before the
 *   session starts. Without ?scale the render scale is left at three's 1.0.
 *
 * The fall-back is off when the page is driven by automation (Playwright, the
 * test emulators): software rendering at ~10 fps looks exactly like a headset
 * that cannot keep up. Tests drive the ladder with `feed(ms, n)` instead.
 * Under automation it also neither reads nor writes the 90 Hz record (unless
 * a storage is passed in), so tests cannot leak it between pages or runs.
 *
 * No three import and nothing browser-only at module level, so Node can run
 * it (tools/test/run.mjs). Its clock is the sum of the frame intervals it is
 * given, so every hold-off below is measured in frame time, and fed intervals
 * behave exactly like real ones.
 */

/** the fall-back rule; times in ms */
export const RULE = {
  window: 3000, // a verdict per 3 s of counted frames
  missFactor: 1.4, // a frame misses when its interval exceeds 1.4 x the frame time
  missShare: 0.2, // step down when more than a fifth of a window's frames miss
  startHold: 4000, // ignored after the session starts
  loadHold: 3000, // ignored while a curio loads and for this long after
  viewHold: 3000, // ignored while the hero tweens / after switching to or from the big view
  settle: 3000, // ignored after a step (and after the rate changes)
  gap: 250, // a longer interval is a gap (headset off, tab hidden), never a miss
  gapHold: 1000, // ignored after a gap, while paused or while the session is not visible
};
export const FOVEATION = { base: 0.6, low: 1.0 }; // base matches App.js's setFoveation(0.6)
export const RATES = { high: 90, low: 72 };
export const LADDER = ['start', 'rate', 'foveation'];
export const MEMORY = { key: 'curio-cabinet:quality', days: 14 }; // "this rate did not hold here": { rate, at }
const HZ = [72, 80, 90, 120];
const DAY = 24 * 3600 * 1000;

/** ?hz ?fov ?scale; anything missing, empty or out of range is null */
export function readOverrides(params) {
  const num = (k) => {
    const v = params && params.has(k) ? params.get(k) : '';
    return v === '' ? NaN : Number(v);
  };
  const hz = num('hz'), fov = num('fov'), scale = num('scale');
  return {
    hz: HZ.includes(hz) ? hz : null,
    fov: Number.isFinite(fov) && fov >= 0 && fov <= 1 ? fov : null,
    scale: Number.isFinite(scale) && scale >= 0.5 && scale <= 1.5 ? scale : null,
  };
}

/** Playwright sets navigator.webdriver; the two emulators install these globals */
function automated() {
  try {
    if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
    if (typeof window !== 'undefined' && (window.__xrEmu || window.__quest)) return true;
  } catch (e) {}
  return false;
}

export class Quality {
  /**
   * @param app needs `params`, `renderer.xr`, and reads `paused` and `stage` per frame
   * @param opts.auto arm the automatic fall-back (default: not under automation)
   * @param opts.storage where the 90 Hz record lives (default: localStorage, none under automation)
   * @param opts.clock wall clock for the record's age (default Date.now)
   */
  constructor(app, { auto, storage, clock } = {}) {
    this.app = app;
    this.xr = app.renderer.xr;
    this.over = readOverrides(app.params);
    this.auto = auto ?? !automated();
    this.clock = clock || (() => Date.now());
    this.storage = storage;
    if (storage === undefined) {
      this.storage = null;
      try {
        if (this.auto && typeof localStorage !== 'undefined') this.storage = localStorage;
      } catch (e) {}
    }
    this.session = null;
    this.pending = null; // the last frame-rate request (tests can await it)
    this.base = this.over.fov ?? FOVEATION.base;
    this.state = {
      auto: this.auto, // the automatic fall-back is armed
      overrides: this.over,
      active: false,
      supported: null, // session.supportedFrameRates
      requested: null, // the rate last asked for
      remembered: false, // the 90 Hz request was skipped: it did not hold here recently
      rate: null, // session.frameRate as last reported
      foveation: this.base,
      scale: this.over.scale ?? 1,
      rung: 0, // index into LADDER
      step: LADDER[0],
      steps: [], // { step, at (ms of session frame time), missed (share), rate, failed? (rate request refused), stored? (record written) }
      frames: 0, // intervals seen this session
      misses: 0, // counted intervals over the miss limit
      ignored: 0, // intervals inside a hold-off
      gaps: 0, // intervals over RULE.gap
      windows: 0, // verdicts taken
    };
    if (this.over.scale !== null) this.xr.setFramebufferScaleFactor(this.over.scale);
    if (this.over.fov !== null) this.xr.setFoveation(this.over.fov);
    this.limit = 0;
    this.hidden = false;
    this.switching = false;
    this._reset();
    this._onRate = () => {
      this._readRate();
      this._hold(RULE.settle);
    };
    this._onVisibility = () => {
      const v = this.session?.visibilityState;
      this.hidden = v !== undefined && v !== 'visible';
      this._hold(RULE.gapHold);
    };
    this.xr.addEventListener?.('sessionstart', () => this.start(this.xr.getSession()));
    this.xr.addEventListener?.('sessionend', () => this.end());
  }

  _reset() {
    this.t = 0; // session frame time, ms
    this.holdUntil = RULE.startHold;
    this.winT = this.winN = this.winMiss = 0;
    this._last = null;
    this._mode = null;
    this.exhausted = false;
  }

  /** a new VR session: reset the ladder, ask for the rate */
  start(session) {
    if (!session) return;
    if (this.session) this.end();
    const s = this.state;
    this.session = session;
    this._reset();
    this.switching = false;
    this.pending = null;
    Object.assign(s, { active: true, requested: null, remembered: false, rung: 0, step: LADDER[0], steps: [], frames: 0, misses: 0, ignored: 0, gaps: 0, windows: 0 });
    const f = this.xr.getFoveation?.();
    if (this.over.fov === null && typeof f === 'number') this.base = f;
    s.foveation = this.base;
    try {
      session.addEventListener?.('frameratechange', this._onRate);
      session.addEventListener?.('visibilitychange', this._onVisibility);
      const v = session.visibilityState;
      this.hidden = v !== undefined && v !== 'visible';
      s.supported = session.supportedFrameRates ? Array.from(session.supportedFrameRates) : null;
    } catch (e) {
      s.supported = null;
    }
    this._readRate();
    const want = this.over.hz ?? RATES.high;
    const rec = this.over.hz === null ? this._recall() : null;
    if (rec) {
      s.remembered = true;
      const until = new Date(rec.at + MEMORY.days * DAY).toISOString().slice(0, 10);
      console.log(`[quality] ${rec.rate} Hz did not hold here recently: staying at ${s.rate ?? 'the default'} Hz until ${until} (?hz=${rec.rate} forces it)`);
    } else if (s.supported && s.supported.includes(want) && typeof session.updateTargetFrameRate === 'function') this._request(want);
    else if (this.over.hz !== null) console.warn(`[quality] ?hz=${want}: not offered here (${s.supported ? s.supported.join(', ') + ' Hz' : 'no frame-rate API'}), rate left alone`);
  }

  /** the session ended: put foveation back for the next one */
  end() {
    const session = this.session;
    if (!session) return;
    try {
      session.removeEventListener?.('frameratechange', this._onRate);
      session.removeEventListener?.('visibilitychange', this._onVisibility);
    } catch (e) {}
    if (this.state.foveation !== this.base) {
      this.xr.setFoveation(this.base);
      this.state.foveation = this.base;
    }
    this.session = null;
    this.switching = false;
    this.state.active = false;
  }

  /** once per rendered frame, with performance.now() (also while paused) */
  frame(now) {
    if (this.session === null) return;
    const last = this._last;
    this._last = now;
    if (last !== null) this.sample(now - last, this.auto);
  }

  /** test hook: feed `n` frame intervals of `ms` through the rule, fall-back armed */
  feed(ms, n = 1) {
    for (let i = 0; i < n; i++) this.sample(ms, true);
    return this.state;
  }

  /** one frame interval; `decide` false only counts it */
  sample(ms, decide = true) {
    const s = this.state;
    const app = this.app;
    const st = app.stage;
    this.t += ms;
    s.frames++;
    if (ms > RULE.gap) {
      s.gaps++;
      this._hold(RULE.gapHold);
      return;
    }
    if (app.paused || this.hidden) this._hold(RULE.gapHold);
    if (st) {
      if (st.loading) this._hold(RULE.loadHold);
      if (st.mode !== this._mode) {
        if (this._mode !== null) this._hold(RULE.viewHold);
        this._mode = st.mode;
      }
      if (st.tween) this._hold(RULE.viewHold);
    }
    // (an unknown frame rate means a miss cannot be defined: never step then)
    if (this.switching || this.t < this.holdUntil || !this.limit) {
      s.ignored++;
      return;
    }
    const miss = ms > this.limit;
    if (miss) s.misses++;
    if (!decide || this.exhausted) return;
    this.winT += ms;
    this.winN++;
    if (miss) this.winMiss++;
    if (this.winT < RULE.window) return;
    s.windows++;
    const share = this.winMiss / this.winN;
    this.winT = this.winN = this.winMiss = 0;
    if (share > RULE.missShare) this._step(share);
  }

  _hold(ms) {
    if (this.t + ms > this.holdUntil) this.holdUntil = this.t + ms;
    this.winT = this.winN = this.winMiss = 0;
  }

  _canFoveate() {
    return this.over.fov === null && this.state.rung < 2 && this.state.foveation < FOVEATION.low;
  }

  _canDropRate() {
    const s = this.state;
    return (
      this.over.hz === null && s.rung < 1 && !!s.supported && s.supported.includes(RATES.low) &&
      s.rate > RATES.low && typeof this.session?.updateTargetFrameRate === 'function'
    );
  }

  /** one rung down the ladder */
  _step(share) {
    const s = this.state;
    const was = { rate: s.rate, limit: this.limit };
    let rung = 0, what = '';
    if (this._canDropRate()) {
      rung = 1;
      what = `frame rate ${s.rate} -> ${RATES.low} Hz`;
      this._request(RATES.low, s.rate);
    } else if (this._canFoveate()) {
      rung = 2;
      what = `foveation ${s.foveation} -> ${FOVEATION.low}`;
      this.xr.setFoveation(FOVEATION.low);
      s.foveation = FOVEATION.low;
    }
    if (rung) {
      s.rung = rung;
      s.step = LADDER[rung];
      s.steps.push({ step: LADDER[rung], at: Math.round(this.t), missed: Math.round(share * 100) / 100, rate: was.rate, failed: false, stored: false });
      console.log(`[quality] ${Math.round(share * 100)}% of frames over ${was.limit.toFixed(1)} ms for ${RULE.window / 1000} s at ${was.rate} Hz: ${what}`);
      this._hold(RULE.settle);
    }
    if (!this._canFoveate() && !this._canDropRate()) this.exhausted = true;
  }

  /** ask for a frame rate; never throws, never rejects. `from`: a step down from this rate */
  _request(rate, from = null) {
    const session = this.session;
    this.state.requested = rate;
    this.switching = true;
    let p;
    try {
      p = Promise.resolve(session.updateTargetFrameRate(rate));
    } catch (e) {
      p = Promise.reject(e);
    }
    this.pending = p.then(
      () => {
        if (this.session !== session) return;
        this.switching = false;
        this._readRate();
        this._hold(RULE.settle);
        if (from) this.state.steps[this.state.steps.length - 1].stored = this._remember(from);
      },
      (e) => {
        if (this.session !== session) return;
        this.switching = false;
        this._readRate();
        if (from) this.state.steps[this.state.steps.length - 1].failed = true;
        console.warn(`[quality] could not set ${rate} Hz: ${e?.message || e}`);
      },
    );
  }

  /** a record younger than MEMORY.days, or null (an expired or bad one is removed) */
  _recall() {
    let raw = null;
    try {
      raw = this.storage?.getItem(MEMORY.key) ?? null;
    } catch (e) {}
    if (!raw) return null;
    try {
      const rec = JSON.parse(raw);
      const age = this.clock() - rec?.at;
      if (Number.isFinite(rec?.rate) && age >= 0 && age < MEMORY.days * DAY) return rec;
    } catch (e) {}
    try {
      this.storage.removeItem(MEMORY.key);
    } catch (e) {}
    return null;
  }

  /** note that `rate` did not hold here; true if it was stored */
  _remember(rate) {
    try {
      if (!this.storage) return false;
      this.storage.setItem(MEMORY.key, JSON.stringify({ rate, at: this.clock() }));
      return true;
    } catch (e) {
      return false;
    }
  }

  _readRate() {
    let r;
    try {
      r = this.session?.frameRate;
    } catch (e) {}
    this.state.rate = Number.isFinite(r) && r > 0 ? r : null;
    this.limit = this.state.rate ? (1000 / this.state.rate) * RULE.missFactor : 0;
  }
}
