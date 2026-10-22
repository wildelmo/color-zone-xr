/**
 * Minimal WebXR emulator for automated tests (injected before page scripts).
 * Implements just enough of navigator.xr / XRSession / XRFrame / XRWebGLLayer
 * for three.js's WebXRManager + WebXRController, with two Meta Touch style
 * controllers (or tracked hands) that tests can pose and press.
 *
 * Control API: window.__xrEmu
 *   setHead(pos, quat) / setController(hand, pos, quat)
 *   setButton(hand, index, pressed, value?)  // 0 trigger, 1 squeeze, 3 stick, 4 A/X, 5 B/Y
 *   setAxes(hand, x, y)
 *   setHandTracking(hand, enabled, pinch)    // swap a controller for a tracked hand
 *   pulses (array of haptic pulses), frames, session
 */
(() => {
  const W = 1600;
  const H = 800;
  const IPD = 0.064;

  // --- tiny matrix helpers (column-major Float32Array(16)) ---
  function compose(p, q) {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const m = new Float32Array(16);
    m[0] = 1 - (yy + zz); m[1] = xy + wz; m[2] = xz - wy; m[3] = 0;
    m[4] = xy - wz; m[5] = 1 - (xx + zz); m[6] = yz + wx; m[7] = 0;
    m[8] = xz + wy; m[9] = yz - wx; m[10] = 1 - (xx + yy); m[11] = 0;
    m[12] = p[0]; m[13] = p[1]; m[14] = p[2]; m[15] = 1;
    return m;
  }
  function rigidInverse(m) {
    const r = new Float32Array(16);
    // transpose rotation
    r[0] = m[0]; r[1] = m[4]; r[2] = m[8];
    r[4] = m[1]; r[5] = m[5]; r[6] = m[9];
    r[8] = m[2]; r[9] = m[6]; r[10] = m[10];
    r[3] = r[7] = r[11] = 0; r[15] = 1;
    const tx = m[12], ty = m[13], tz = m[14];
    r[12] = -(r[0] * tx + r[4] * ty + r[8] * tz);
    r[13] = -(r[1] * tx + r[5] * ty + r[9] * tz);
    r[14] = -(r[2] * tx + r[6] * ty + r[10] * tz);
    return r;
  }
  function perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
    return m;
  }
  function quatMul(a, b) {
    const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  }
  function rotateVec(q, v) {
    const [qx, qy, qz, qw] = q; const [x, y, z] = v;
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
  }
  function transform(p, q) {
    const m = compose(p, q);
    return {
      position: { x: p[0], y: p[1], z: p[2], w: 1 },
      orientation: { x: q[0], y: q[1], z: q[2], w: q[3] },
      matrix: m,
      get inverse() { return { matrix: rigidInverse(m) }; },
    };
  }

  const JOINTS = ['wrist',
    'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
    'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
    'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
    'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
    'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'];

  const state = {
    head: { pos: [0, 1.6, 0], quat: [0, 0, 0, 1] },
    controllers: {
      left: { pos: [-0.25, 1.15, -0.35], quat: [0, 0, 0, 1], buttons: [], axes: [0, 0, 0, 0], connected: true, tracking: false, pinch: false, fist: false },
      right: { pos: [0.25, 1.15, -0.35], quat: [0, 0, 0, 1], buttons: [], axes: [0, 0, 0, 0], connected: true, tracking: false, pinch: false, fist: false },
    },
    session: null,
    frames: 0,
    pulses: [],
    renderState: { depthNear: 0.1, depthFar: 1000, baseLayer: null, layers: [] },
  };
  for (const c of Object.values(state.controllers)) {
    for (let i = 0; i < 7; i++) c.buttons.push({ pressed: false, touched: false, value: 0 });
  }

  class Space { constructor(kind, hand, joint) { this.kind = kind; this.hand = hand; this.jointName = joint; } }

  function makeGamepad(hand) {
    const c = state.controllers[hand];
    return {
      id: 'oculus-touch-v3', index: -1, connected: true, mapping: 'xr-standard', timestamp: 0,
      buttons: c.buttons, axes: c.axes,
      hapticActuators: [{ type: 'vibration', pulse: (value, duration) => { state.pulses.push({ hand, value, duration, t: performance.now() }); return Promise.resolve(true); } }],
    };
  }

  function makeInputSource(hand, tracking) {
    const src = {
      handedness: hand,
      targetRayMode: 'tracked-pointer',
      targetRaySpace: new Space('ray', hand),
      gripSpace: new Space('grip', hand),
      profiles: tracking ? ['generic-hand-select', 'generic-hand'] : ['oculus-touch-v3', 'oculus-touch', 'generic-trigger-squeeze-thumbstick'],
      gamepad: tracking ? null : makeGamepad(hand),
      hand: null,
    };
    if (tracking) {
      const map = new Map();
      for (const j of JOINTS) map.set(j, new Space('joint', hand, j));
      src.hand = map;
      src.hand.size = map.size;
    }
    return src;
  }

  class Session extends EventTarget {
    constructor(mode, init) {
      super();
      this.mode = mode;
      this.init = init;
      this.enabledFeatures = ['viewer', 'local', 'local-floor', ...(init && init.optionalFeatures && init.optionalFeatures.includes('hand-tracking') ? ['hand-tracking'] : [])];
      this.environmentBlendMode = 'opaque';
      this.visibilityState = 'visible';
      this.interactionMode = 'world-space';
      this.inputSources = [];
      this.supportedFrameRates = new Float32Array([72, 80, 90, 120]);
      this.frameRate = 72;
      this.ended = false;
      this._rafs = new Map();
      this._nextId = 1;
      this._announced = false;
      this._srcs = { left: null, right: null };
    }
    get renderState() { return state.renderState; }
    updateRenderState(s) { Object.assign(state.renderState, s); }
    updateTargetFrameRate(r) { this.frameRate = r; return Promise.resolve(); }
    requestReferenceSpace(type) {
      return Promise.resolve({ type, getOffsetReferenceSpace() { return this; }, addEventListener() {}, removeEventListener() {} });
    }
    requestAnimationFrame(cb) {
      const id = this._nextId++;
      const raf = requestAnimationFrame((t) => {
        this._rafs.delete(id);
        if (this.ended) return;
        this._syncInputSources();
        state.frames++;
        cb(t, new Frame(this));
      });
      this._rafs.set(id, raf);
      return id;
    }
    cancelAnimationFrame(id) {
      const raf = this._rafs.get(id);
      if (raf !== undefined) cancelAnimationFrame(raf);
      this._rafs.delete(id);
    }
    _syncInputSources() {
      const added = [];
      const removed = [];
      for (const hand of ['left', 'right']) {
        const c = state.controllers[hand];
        const cur = this._srcs[hand];
        const wantKind = c.connected ? (c.tracking ? 'hand' : 'controller') : null;
        const curKind = cur ? (cur.hand ? 'hand' : 'controller') : null;
        if (wantKind !== curKind) {
          if (cur) { removed.push(cur); this._srcs[hand] = null; }
          if (wantKind) { const s = makeInputSource(hand, c.tracking); this._srcs[hand] = s; added.push(s); }
        }
      }
      if (added.length || removed.length) {
        this.inputSources = ['left', 'right'].map((h) => this._srcs[h]).filter(Boolean);
        const ev = new Event('inputsourceschange');
        ev.added = added; ev.removed = removed; ev.session = this;
        this.dispatchEvent(ev);
      }
    }
    _fireSelect(hand, type) {
      const src = this._srcs[hand];
      if (!src) return;
      const ev = new Event(type);
      ev.inputSource = src; ev.frame = new Frame(this); ev.session = this;
      this.dispatchEvent(ev);
    }
    end() {
      if (this.ended) return Promise.resolve();
      this.ended = true;
      for (const raf of this._rafs.values()) cancelAnimationFrame(raf);
      this._rafs.clear();
      state.session = null;
      const ev = new Event('end');
      ev.session = this;
      setTimeout(() => this.dispatchEvent(ev), 0);
      return Promise.resolve();
    }
  }

  class Frame {
    constructor(session) { this.session = session; this.predictedDisplayTime = performance.now(); }
    getViewerPose() {
      const h = state.head;
      const aspect = (W / 2) / H;
      const near = state.renderState.depthNear, far = state.renderState.depthFar;
      const proj = perspective(Math.PI / 2 * 0.95, aspect, near, far);
      const views = ['left', 'right'].map((eye) => {
        const off = rotateVec(h.quat, [eye === 'left' ? -IPD / 2 : IPD / 2, 0, 0]);
        const p = [h.pos[0] + off[0], h.pos[1] + off[1], h.pos[2] + off[2]];
        return { eye, projectionMatrix: proj, transform: transform(p, h.quat), recommendedViewportScale: 1 };
      });
      return { transform: transform(h.pos, h.quat), views, emulatedPosition: false };
    }
    getPose(space) {
      const c = state.controllers[space.hand];
      if (!c || !c.connected) return null;
      if (space.kind === 'ray') return { transform: transform(c.pos, c.quat), emulatedPosition: false };
      // grip: slightly behind and rotated down like a held handle
      const gq = quatMul(c.quat, [Math.sin(-0.35), 0, 0, Math.cos(-0.35)]);
      return { transform: transform(c.pos, gq), emulatedPosition: false };
    }
    getJointPose(space) {
      const c = state.controllers[space.hand];
      if (!c || !c.connected || !c.tracking) return null;
      const name = space.jointName;
      const side = space.hand === 'left' ? -1 : 1;
      // crude procedural hand: fingers extend along -Z from the wrist, thumb sticks inward
      let local = [0, 0, 0];
      const fingerX = { index: 0.02, middle: 0.0, ring: -0.02, pinky: -0.04 };
      if (name === 'wrist') local = [0, 0, 0.05];
      else if (name.startsWith('thumb')) {
        const k = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'].indexOf(name) + 1;
        const pinch = c.pinch ? 1 : 0;
        local = [side * -(0.02 + k * 0.012) * (1 - pinch * 0.4) , -0.01 + pinch * 0.0, 0.03 - k * 0.022 - pinch * k * 0.008];
        if (name === 'thumb-tip' && c.pinch) local = [0.0, 0.0, -0.11];
      } else {
        const finger = name.split('-')[0];
        const parts = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
        const k = parts.findIndex((p) => name.endsWith(p)) + 1;
        local = [side * fingerX[finger] || 0, 0, 0.03 - k * 0.028];
        if (finger === 'index' && name.endsWith('tip')) local = c.pinch ? [0.0, 0.0, -0.11] : [side * 0.02, 0, -0.11];
        // a fist curls middle/ring/pinky back toward the palm
        if (c.fist && finger !== 'index' && k >= 3) local = [side * fingerX[finger] || 0, -0.02, 0.03 - 0.028 - (k - 2) * 0.004];
      }
      const wp = rotateVec(c.quat, local);
      const p = [c.pos[0] + wp[0], c.pos[1] + wp[1], c.pos[2] + wp[2]];
      return { transform: transform(p, c.quat), radius: 0.008, emulatedPosition: false };
    }
  }

  class XRWebGLLayerMock {
    constructor(session, gl, init) {
      this.session = session; this.context = gl; this.init = init;
      this.framebuffer = null;
      this.framebufferWidth = W; this.framebufferHeight = H;
      this.ignoreDepthValues = false;
      this.fixedFoveation = 0;
      this.antialias = !!(init && init.antialias);
    }
    getViewport(view) { return { x: view.eye === 'left' ? 0 : W / 2, y: 0, width: W / 2, height: H }; }
    static getNativeFramebufferScaleFactor() { return 1; }
  }

  const xr = new EventTarget();
  xr.isSessionSupported = (mode) => Promise.resolve(mode === 'immersive-vr');
  xr.requestSession = (mode, init) => {
    if (state.session) return Promise.reject(new DOMException('session active', 'InvalidStateError'));
    const s = new Session(mode, init || {});
    state.session = s;
    return Promise.resolve(s);
  };
  Object.defineProperty(navigator, 'xr', { value: xr, configurable: true });
  window.XRWebGLLayer = XRWebGLLayerMock;
  window.XRWebGLBinding = undefined;
  try {
    const proto = WebGL2RenderingContext.prototype;
    proto.makeXRCompatible = function () { return Promise.resolve(); };
    WebGLRenderingContext.prototype.makeXRCompatible = function () { return Promise.resolve(); };
  } catch (e) { /* ignore */ }

  window.__xrEmu = {
    state,
    W, H,
    setHead(pos, quat) { if (pos) state.head.pos = pos; if (quat) state.head.quat = quat; },
    setController(hand, pos, quat) { const c = state.controllers[hand]; if (pos) c.pos = pos; if (quat) c.quat = quat; },
    setButton(hand, index, pressed, value) {
      const c = state.controllers[hand];
      const b = c.buttons[index];
      const was = b.pressed;
      b.pressed = !!pressed; b.touched = !!pressed || b.touched; b.value = value !== undefined ? value : (pressed ? 1 : 0);
      if (state.session && was !== b.pressed) {
        if (index === 0) state.session._fireSelect(hand, pressed ? 'selectstart' : 'selectend');
        if (index === 1) state.session._fireSelect(hand, pressed ? 'squeezestart' : 'squeezeend');
        if (!pressed && index === 0) state.session._fireSelect(hand, 'select');
        if (!pressed && index === 1) state.session._fireSelect(hand, 'squeeze');
      }
    },
    setAxes(hand, x, y) { const c = state.controllers[hand]; c.axes[2] = x; c.axes[3] = y; },
    setConnected(hand, on) { state.controllers[hand].connected = !!on; },
    setHandTracking(hand, on, pinch) { const c = state.controllers[hand]; c.tracking = !!on; if (pinch !== undefined) c.pinch = !!pinch; },
    setPinch(hand, pinch) { state.controllers[hand].pinch = !!pinch; },
    setFist(hand, fist) { state.controllers[hand].fist = !!fist; },
    endSession() { if (state.session) state.session.end(); },
    /** animate a controller over duration ms: fn(t01) -> { pos, quat } ; resolves when done */
    animate(hand, duration, fn) {
      return new Promise((resolve) => {
        const t0 = performance.now();
        const step = () => {
          const t = Math.min(1, (performance.now() - t0) / duration);
          const r = fn(t) || {};
          const c = state.controllers[hand];
          if (r.pos) c.pos = r.pos;
          if (r.quat) c.quat = r.quat;
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        step();
      });
    },
    /** resolve after n rendered XR frames */
    waitFrames(n) {
      return new Promise((resolve) => {
        const target = state.frames + n;
        const check = () => (state.frames >= target ? resolve() : requestAnimationFrame(check));
        check();
      });
    },
    /** hold a button for n frames */
    async press(hand, index, frames = 3, value) {
      this.setButton(hand, index, true, value);
      await this.waitFrames(frames);
      this.setButton(hand, index, false, 0);
      await this.waitFrames(2);
    },
    /** quaternion from yaw/pitch (radians) for convenience */
    quatYawPitch(yaw, pitch) {
      const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
      // yaw about Y then pitch about X (local)
      return quatMul([0, sy, 0, cy], [sp, 0, 0, cp]);
    },
    get session() { return state.session; },
    get frames() { return state.frames; },
    get pulses() { return state.pulses; },
  };
})();
