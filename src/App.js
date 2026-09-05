import * as THREE from 'three';
import { WORLD } from './config.js';
import { World } from './world/World.js';
import { HandState } from './input/HandState.js';
import { XRInput } from './input/XRInput.js';
import { DesktopInput } from './input/DesktopInput.js';
import { Emitter } from './util/events.js';
import { Rng, hashSeed } from './util/random.js';
import { Paint } from './paint/Paint.js';
import { Brush } from './paint/Brush.js';
import { Palette } from './paint/Palette.js';
import { Wand } from './paint/Wand.js';
import { Controls } from './input/Controls.js';
import { FX } from './fx/FX.js';
import { Bubbles } from './fx/Bubbles.js';
import { Splats } from './fx/Splats.js';
import { Audio } from './audio/Audio.js';
import { Buddy } from './creatures/Buddy.js';
import { Butterflies } from './creatures/Butterflies.js';
import { Milestones } from './systems/Milestones.js';
import { Toast } from './ui/Toast.js';
import { Menu } from './ui/Menu.js';
import { HelpSign } from './ui/HelpSign.js';
import { Locomotion } from './input/Locomotion.js';
import { HandVisual } from './input/HandVisual.js';
import { Intro } from './systems/Intro.js';
import { warmMaterials } from './util/Warmup.js';
import { SaveGame } from './systems/SaveGame.js';
import { Guide } from './systems/Guide.js';
import { Pond } from './play/Pond.js';
import { Riders } from './creatures/Riders.js';
import { Boops } from './play/Boops.js';

/**
 * Color Zone XR — application root. Owns the renderer, the player rig,
 * the world and every gameplay system, and runs the frame loop (which is
 * driven by the XR session while presenting).
 */
export class App {
  constructor({ canvas, seed = 'color-zone', params = new URLSearchParams() } = {}) {
    this.events = new Emitter();
    this.THREE = THREE; // handy for tests/debugging from the console
    this.seedName = seed;
    this.seed = hashSeed(String(seed));
    this.rng = new Rng(this.seed ^ 0x5eed);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFoveation(1);
    renderer.setClearColor(0xe6e1d6, 1);
    this.renderer = renderer;
    this.canvas = renderer.domElement;

    this.scene = new THREE.Scene();
    this.scene.name = 'colorZone';
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 700);
    this.camera.name = 'camera';
    this.rig = new THREE.Group();
    this.rig.name = 'playerRig';
    this.rig.add(this.camera);
    this.camera.position.set(0, WORLD.eyeHeight, 0);
    this.scene.add(this.rig);

    this.world = new World(renderer, this.seed);
    this.scene.add(this.world.group);
    this.world.paintSpawnZone();

    this.hands = { left: new HandState('left'), right: new HandState('right') };
    this.xrInput = new XRInput(renderer, this.rig, this.hands);
    this.xrInput.onConnect = (hs) => this.onHandConnected(hs);
    this.desktop = new DesktopInput(this);

    this.systems = []; // objects with update(dt, time)
    this.locomotionBusy = false;
    this.spreadEnergy = 0; // recent activity keeps colour spreading
    this.events.on('strokeend', () => this.bumpEnergy(0.3));
    this.events.on('bubblepop', (e) => {
      if (e && e.byHand) this.bumpEnergy(0.4); // only the player's own pops keep the magic going
    });
    this.events.on('splat', () => this.bumpEnergy(0.5));

    this.paint = new Paint(this);
    this.scene.add(this.paint.group);
    this.palette = new Palette(this);
    this.wands = [new Wand(this, this.hands.left), new Wand(this, this.hands.right)];
    this.brushes = [new Brush(this, this.hands.left), new Brush(this, this.hands.right)];
    this.controls = new Controls(this);
    this.fx = new FX(this);
    this.scene.add(this.fx.group);
    this.bubbles = this.addSystem(new Bubbles(this));
    this.scene.add(this.bubbles.mesh);
    this.splats = this.addSystem(new Splats(this));
    this.scene.add(this.splats.group);
    this.audio = new Audio(this);
    this.buddy = this.addSystem(new Buddy(this));
    this.scene.add(this.buddy.group);
    this.butterflies = this.addSystem(new Butterflies(this));
    this.scene.add(this.butterflies.mesh);
    this.milestones = this.addSystem(new Milestones(this));
    this.toast = this.addSystem(new Toast(this));
    this.scene.add(this.toast.group);
    this.menu = this.addSystem(new Menu(this));
    this.scene.add(this.menu.group);
    this.helpSign = this.addSystem(new HelpSign(this));
    this.scene.add(this.helpSign.group);
    this.locomotion = new Locomotion(this);
    this.scene.add(this.locomotion.group);
    this.handVisual = this.addSystem(new HandVisual(this));
    this.scene.add(this.handVisual.group);
    this.hintPulse = false;
    // ---- play layer: the things to do (each is a self-contained system) ----
    // (systems register themselves here; order = update order)
    this.boops = this.addSystem(new Boops(this)); // poke anything with the wand; paint balls hit things
    this.pond = this.addSystem(new Pond(this)); // the living pond: feed the fountain, koi, bubbles near you
    this.scene.add(this.pond.group);
    this.riders = this.addSystem(new Riders(this)); // little paint drops ride your long strokes
    this.scene.add(this.riders.group);
    this.guide = this.addSystem(new Guide(this)); // Dot leads you to the next thing (keep last: it looks at the other play systems)
    this.scene.add(this.guide.group);
    // ---- end play layer ----
    this.intro = this.addSystem(new Intro(this));
    // compile every on-demand shader during the loading frames (no first-use hitches)
    warmMaterials(this.scene, [
      ...Object.values(this.paint.materials),
      this.milestones.rainbow.material,
      this.menu.panel.material,
      this.locomotion.fade.material,
    ]);
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this.events.on('modechange', (mode) => {
      if (mode === 'xr' || mode === 'desktop') this.audio.startFountain(this.world.fountain.top);
    });
    this.saveGame = this.addSystem(new SaveGame(this));
    if (!params.has('fresh')) {
      try {
        this.restored = this.saveGame.load();
      } catch (err) {
        console.warn('could not restore save', err);
      }
    }
    this.time = 0;
    this._lastT = performance.now();
    this.frame = 0;
    this.mode = 'attract'; // attract | desktop | xr
    this.attractAngle = 0;
    this.session = null;
    this.stats = { drawCalls: 0, triangles: 0, fps: 0 };
    this._fpsAcc = 0;
    this._fpsN = 0;

    window.addEventListener('resize', () => this.onResize());
    renderer.setAnimationLoop((t, frame) => this.tick(t, frame));
  }

  onResize() {
    if (this.renderer.xr.isPresenting) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  bumpEnergy(v) {
    this.spreadEnergy = Math.min(1, this.spreadEnergy + v);
  }

  addSystem(sys) {
    this.systems.push(sys);
    return sys;
  }

  /** insert a system so it updates before another one (e.g. catch before splats) */
  addSystemBefore(sys, before) {
    const i = this.systems.indexOf(before);
    if (i < 0) this.systems.push(sys);
    else this.systems.splice(i, 0, sys);
    return sys;
  }

  onHandConnected(hs) {
    this.events.emit('handconnected', hs);
  }

  onDesktopKey(code, e) {
    this.controls.onKey(code, e);
  }

  /** desktop exploring (pointer-lock look, WASD) */
  startDesktop() {
    this.audio.resume();
    this.mode = 'desktop';
    this.desktop.enable();
    this.events.emit('modechange', this.mode);
  }

  stopDesktop() {
    this.desktop.disable();
    this.mode = 'attract';
    this.events.emit('modechange', this.mode);
  }

  async isVRSupported() {
    if (!navigator.xr || !navigator.xr.isSessionSupported) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-vr');
    } catch (e) {
      return false;
    }
  }

  async enterVR() {
    if (this.session) return;
    this.audio.resume();
    const init = {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers', 'high-refresh-rate'],
    };
    const session = await navigator.xr.requestSession('immersive-vr', init);
    this.session = session;
    session.addEventListener('end', () => this.onSessionEnded());
    this.desktop.disable();
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.set(0, 0, 0);
    await this.renderer.xr.setSession(session);
    // Quest 2/3 can run this at 90 Hz; ask nicely, fall back silently
    try {
      if (session.supportedFrameRates && session.updateTargetFrameRate) {
        const rates = Array.from(session.supportedFrameRates);
        const want = rates.includes(90) ? 90 : rates.includes(80) ? 80 : rates.includes(72) ? 72 : null;
        if (want) await session.updateTargetFrameRate(want);
      }
    } catch (e) {
      /* not fatal */
    }
    this.mode = 'xr';
    this.events.emit('modechange', this.mode);
    this.events.emit('sessionstart', session);
  }

  onSessionEnded() {
    this.session = null;
    this.mode = 'attract';
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.camera.position.set(0, WORLD.eyeHeight, 0);
    this.camera.rotation.set(0, 0, 0);
    this.onResize();
    this.events.emit('modechange', this.mode);
    this.events.emit('sessionend');
  }

  /** wipe the painting and the colour, keep the same island */
  clearPainting() {
    for (const b of this.brushes) b.cancel();
    this.paint.clearAll();
    this.splats.clearDecals();
    this.bubbles.popAll();
    this.world.reset();
    this.events.emit('reset');
    this.events.emit('toast', { text: 'All clean!' });
    if (this.audio) this.audio.undo();
  }

  /** a brand new island with a fresh seed */
  newWorld(seedName = null, { quiet = false } = {}) {
    for (const b of this.brushes) b.cancel();
    this.seedName = seedName || 'world-' + Math.floor(Math.random() * 1e9).toString(36);
    this.seed = hashSeed(String(this.seedName));
    this.paint.clearAll();
    this.splats.clearDecals();
    this.bubbles.popAll();
    this.world.reset(this.seed);
    this.helpSign.group.position.y = this.world.heightAt(this.helpSign.group.position.x, this.helpSign.group.position.z) - 0.02;
    this.rig.position.y = this.world.heightAt(this.rig.position.x, this.rig.position.z);
    if (this.mode === 'desktop') this.desktop.pos.y = this.rig.position.y;
    this.events.emit('reset');
    if (quiet) return;
    this.events.emit('toast', { text: 'A brand new world!', big: true });
    if (this.audio) this.audio.newWorld();
    if (this.fx) {
      const p = this.headPosition();
      p.y += 0.2;
      this.fx.burst(p, new THREE.Color('#ffffff'), 60, 2.5, 0.06);
    }
  }

  /**
   * The player's head position in world space. In XR three.js copies the
   * headset pose into this.camera (a child of the rig) at render time, so
   * the camera's world matrix includes teleports and snap turns.
   */
  headPosition(out = new THREE.Vector3()) {
    this.camera.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.camera.matrixWorld);
  }

  headQuaternion(out = new THREE.Quaternion()) {
    this.camera.updateWorldMatrix(true, false);
    return out.setFromRotationMatrix(this.camera.matrixWorld);
  }

  updateAttract(dt) {
    // slow orbit around the spawn meadow while the title screen is up
    this.attractAngle += dt * 0.06;
    const r = 6.5;
    const x = Math.sin(this.attractAngle) * r;
    const z = Math.cos(this.attractAngle) * r;
    this.rig.position.set(x, 0, z);
    this.rig.rotation.set(0, 0, 0);
    this.camera.position.set(0, WORLD.eyeHeight + 0.6 + Math.sin(this.attractAngle * 2.3) * 0.15, 0);
    this.camera.lookAt(0, 1.0, 0);
  }

  tick(t, frame) {
    // never let one bad frame kill the session: log, skip, keep rendering
    try {
      this._tick(t, frame);
    } catch (err) {
      this._errors = (this._errors || 0) + 1;
      if (this._errors <= 3) console.error('frame error', err);
    }
  }

  _tick(t, frame) {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this._lastT) / 1000));
    this._lastT = now;
    this.time += dt;
    this.frame++;
    this.dt = dt;
    this.xrFrame = frame;

    if (this.renderer.xr.isPresenting) {
      this.xrInput.update(dt);
    } else if (this.mode === 'desktop') {
      this.desktop.update(dt);
    } else {
      this.updateAttract(dt);
    }

    this.hands.left.uiBlocked = false;
    this.hands.right.uiBlocked = false;
    this.hands.left.grabBlocked = false;
    this.hands.right.grabBlocked = false;
    this.palette.update(dt, this.time);
    this.locomotion.update(dt);
    for (const s of this.systems) s.update(dt, this.time);
    for (const b of this.brushes) b.update(dt, this.time);
    this.controls.update(dt);
    for (const w of this.wands) w.update(dt, this.time);
    this.fx.update(dt, this.time);
    this.audio.update(dt);
    if (this.brushes.some((b) => b.painting)) this.spreadEnergy = Math.max(this.spreadEnergy, 0.7);
    this.spreadEnergy *= Math.exp(-dt / 9);
    const bloomed = this.world.update(dt, this.time, this.spreadEnergy);
    if (bloomed > 0) {
      this.events.emit('bloom', bloomed);
      // a sparkle and a chime where the first few plants of this frame popped up
      for (const [x, z, flower] of this.world.flora.bloomedNow) {
        this._v.set(x, this.world.heightAt(x, z) + 0.12, z);
        this.world.paintMap.colorAt(x, z, this._c);
        this.fx.burst(this._v, this._c, flower ? 6 : 3, 0.45, 0.022);
      }
      const b0 = this.world.flora.bloomedNow[0];
      if (b0) this.audio.bloom(this._v.set(b0[0], this.world.heightAt(b0[0], b0[1]) + 0.1, b0[1]));
    }
    // twinkles along the advancing colour front while the magic is spreading
    if (this.spreadEnergy > 0.15) {
      const tries = 1 + Math.floor(this.spreadEnergy * 5);
      for (let k = 0; k < tries; k++) {
        if (this.world.paintMap.randomFrontCell(this.rng, this._v, this._c)) {
          this.fx.sparkle(this._v, this._up.set(this.rng.gauss() * 0.05, 0.12 + this.rng.float() * 0.1, this.rng.gauss() * 0.05), this._c.lerp(new THREE.Color(1, 1, 1), 0.4), 0.7 + this.rng.float() * 0.5, 0.018);
        }
      }
    }
    // 3D audio listener follows the head
    this.headPosition(this._v);
    this.headQuaternion(this._q);
    this._fwd.set(0, 0, -1).applyQuaternion(this._q);
    this._up.set(0, 1, 0).applyQuaternion(this._q);
    this.audio.setListener(this._v, this._q, this._fwd, this._up);

    this.renderer.render(this.scene, this.camera);

    const info = this.renderer.info.render;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
    this._fpsAcc += dt;
    this._fpsN++;
    if (this._fpsAcc >= 1) {
      this.stats.fps = this._fpsN / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsN = 0;
    }
    this.events.emit('frame', dt);
  }
}
