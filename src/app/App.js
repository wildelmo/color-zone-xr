import * as THREE from 'three';
import { HandState } from '../input/HandState.js';
import { XRInput } from '../input/XRInput.js';
import { Interaction } from '../input/Interaction.js';
import { DesktopControls } from '../input/DesktopControls.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { Button3D, ControlPanel, InfoCard, Label } from '../ui/Panel.js';
import { createEnvironment } from './environment.js';
import { Hall, LAYOUT } from './Hall.js';
import { Shelf } from './Shelf.js';
import { Stage } from './Stage.js';
import { Frames } from './Frames.js';

/**
 * The Curio Cabinet viewer: a WebXR gallery where one asset at a time is
 * loaded at full detail onto the display table, while the rest wait on the
 * shelf as cheap previews.
 */
export class App {
  constructor(canvas) {
    this.params = new URLSearchParams(location.search);
    this.canvas = canvas;
    this.started = false;
    this.paused = false; // test hook: hold the last frame (screenshots on slow software GL)
    this.mode = 'attract'; // attract | desktop | xr
    this.frame = 0;
    this.stats = { drawCalls: 0, triangles: 0, fps: 0 };

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.xr.setFoveation(0.6);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e0907);
    scene.environment = createEnvironment(renderer);
    scene.environmentIntensity = 0.85;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.02, 60);
    this.camera.position.set(0.55, 1.45, 0.55);
    this.rig = new THREE.Group();
    this.rig.name = 'rig';
    this.rig.add(this.camera);
    scene.add(this.rig);

    this.frames = new Frames();
    this.audio = new AudioEngine();
    this.hall = new Hall();
    scene.add(this.hall.group);
    this.shelf = new Shelf();
    scene.add(this.shelf.group);
    this.stage = new Stage(this);
    scene.add(this.stage.holder, this.stage.ring, this.stage.bodyProxy);

    // in-world controls
    const buttons = [
      new Button3D({ id: 'wind', label: 'Wind', glyph: '↻', onPress: () => this.stage.asset?.wind?.(0.3) }),
      new Button3D({ id: 'life', label: 'Life size', glyph: '⤢', onPress: () => this.toggleLife() }),
      new Button3D({ id: 'reset', label: 'Reset', glyph: '⌂', onPress: () => this.stage.reset() }),
      new Button3D({ id: 'shelf', label: 'Put away', glyph: '✕', onPress: () => this.stage.unload() }),
      new Button3D({ id: 'exit', label: 'Exit', glyph: '⏻', onPress: () => this.exit() }),
    ];
    this.panel = new ControlPanel(buttons);
    this.panelHome = new THREE.Vector3(0, LAYOUT.table.y - 0.02, LAYOUT.table.z + LAYOUT.tableR + 0.07);
    this.panel.group.position.copy(this.panelHome);
    this.panel.group.rotation.x = -0.75;
    scene.add(this.panel.group);
    this.card = new InfoCard();
    this.card.mesh.position.set(0.72, 1.22, -0.78);
    this.card.mesh.rotation.y = -0.6;
    scene.add(this.card.mesh);
    this.hoverLabel = new Label({ width: 0.6 });
    scene.add(this.hoverLabel.mesh);

    // input
    this.hands = { left: new HandState('left'), right: new HandState('right') };
    this.xrInput = new XRInput(renderer, this.rig, this.hands);
    this.interaction = new Interaction(this);
    this.interaction.attach(this.rig);
    this.desktop = new DesktopControls(this, this.camera, canvas);
    this.desktop.orbit.target.copy(LAYOUT.table).add(new THREE.Vector3(0, 0.18, 0));

    renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
    renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());
    window.addEventListener('resize', () => this.onResize());

    this._last = performance.now();
    this._fpsT = 0;
    this._fpsN = 0;
    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._u = new THREE.Vector3();
    renderer.setAnimationLoop((t, frame) => this.tick(t, frame));
  }

  async boot() {
    const ctx = { step: () => this.frames.step(), progress: () => {} };
    this.onStatus?.('Dusting the shelves…');
    await this.shelf.populate(ctx);
    await this.prepare(this.shelf.group);
    this.onStatus?.('Ready');
    this.onBooted?.();
    // bring out the first real curio
    const first = this.shelf.items.find((i) => !i.entry.comingSoon);
    const want = this.shelf.items.find((i) => i.entry.id === this.params.get('asset')) || first;
    if (want && !this.params.has('empty')) this.stage.load(want);
  }

  /** upload textures and compile shaders before something becomes visible */
  async prepare(object) {
    const textures = new Set();
    object.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) for (const v of Object.values(m)) if (v && v.isTexture) textures.add(v);
    });
    for (const t of textures) {
      this.renderer.initTexture(t);
      await this.frames.step();
    }
    const wasVisible = object.visible;
    object.visible = true;
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(object, this.camera, this.scene);
      else this.renderer.compile(object, this.camera, this.scene);
    } catch (e) {
      console.warn('precompile failed', e);
    }
    object.visible = wasVisible;
  }

  start(mode) {
    this.audio.resume();
    this.started = true;
    this.mode = mode;
    if (mode === 'desktop') {
      this.desktop.enable(true);
      this.camera.position.set(0.1, 1.32, 0.12);
      this.desktop.orbit.target.copy(LAYOUT.table).add(new THREE.Vector3(0, 0.18, 0));
    }
    if (this.stage.pendingShow) this.stage.startShow();
  }

  async enterVR() {
    if (!navigator.xr) return false;
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
      await this.renderer.xr.setSession(session);
      return true;
    } catch (e) {
      console.warn('XR failed', e);
      return false;
    }
  }

  onSessionStart() {
    this.desktop.enable(false);
    this.mode = 'xr';
    this.started = true;
    this.cameraBackup = { p: this.camera.position.clone(), q: this.camera.quaternion.clone() };
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.placeRig(new THREE.Vector3(0, 0, 0), 0);
    // the headset's floor origin can be anywhere in your room: once it
    // reports where your head is, move the gallery so you stand at the table
    this.pendingRecenter = { target: new THREE.Vector3(0, 0, 0), yaw: 0, frames: 3 };
    const space = this.renderer.xr.getReferenceSpace();
    space?.addEventListener?.('reset', () => {
      const life = this.stage.mode === 'life';
      this.pendingRecenter = { target: new THREE.Vector3(0, 0, life ? 7.4 : 0), yaw: 0, frames: 2 };
    });
    if (this.stage.pendingShow) this.stage.startShow();
    this.onModeChange?.('xr');
  }

  /**
   * Put the viewer's head at `target` (floor x/z) facing `yaw` (0 = toward
   * the table, -z), whatever the headset thinks its origin is.
   */
  recenter(target, yaw = 0) {
    // head = midpoint of the two eyes, in rig space (three's combined XR camera
    // sits a little behind the eyes so its frustum covers both)
    this.rig.updateMatrixWorld(true);
    const eyes = this.renderer.xr.getCamera().cameras || [];
    const head = this.camera.position.clone();
    if (eyes.length) {
      head.set(0, 0, 0);
      for (const e of eyes) head.add(new THREE.Vector3().setFromMatrixPosition(e.matrixWorld));
      this.rig.worldToLocal(head.divideScalar(eyes.length));
    }
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const headYaw = Math.atan2(-fwd.x, -fwd.z);
    const rot = yaw - headYaw;
    this.rig.rotation.set(0, rot, 0);
    const off = new THREE.Vector3(head.x, 0, head.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.rig.position.set(target.x - off.x, 0, target.z - off.z);
    this.rig.updateMatrixWorld(true);
  }

  /** leave for real: end the VR session, silence the audio, stop rendering */
  exit() {
    if (this.closed) return;
    this.closed = true;
    const session = this.renderer.xr.getSession();
    const shutdown = () => {
      this.renderer.setAnimationLoop(null);
      this.desktop.enable(false);
      try {
        this.audio.ctx?.close();
      } catch (e) {}
      this.audio.ready = false;
      this.onExit?.();
    };
    if (session) {
      this.afterSessionEnd = shutdown;
      session.end().catch(shutdown);
    } else shutdown();
  }

  onSessionEnd() {
    if (this.afterSessionEnd) {
      const f = this.afterSessionEnd;
      this.afterSessionEnd = null;
      this.mode = 'closed';
      f();
      return;
    }
    this.mode = 'desktop';
    this.placeRig(new THREE.Vector3(0, 0, 0), 0);
    if (this.cameraBackup) {
      this.camera.position.copy(this.cameraBackup.p);
      this.camera.quaternion.copy(this.cameraBackup.q);
    }
    this.desktop.enable(true);
    this.onModeChange?.('desktop');
  }

  placeRig(pos, yaw) {
    if (this.mode === 'xr' && this.renderer.xr.isPresenting) {
      this.recenter(pos, yaw);
      return;
    }
    this.rig.position.copy(pos);
    this.rig.rotation.set(0, yaw, 0);
    if (this.mode !== 'xr') {
      // desktop: move the orbit camera instead
      if (this.stage.mode === 'life') {
        this.camera.position.set(pos.x, 1.6, pos.z);
        this.desktop.focus(new THREE.Vector3(0, 2.3, 0), null, false);
        this.desktop.orbit.maxDistance = 14;
      } else {
        this.desktop.orbit.maxDistance = 7;
        this.desktop.focus(LAYOUT.table.clone().add(new THREE.Vector3(0, 0.18, 0)), 0.9);
      }
      this.rig.position.set(0, 0, 0);
    }
  }

  toggleLife() {
    if (!this.stage.asset) return;
    this.stage.setLife(this.stage.mode !== 'life');
  }

  haptic(strength, ms) {
    for (const h of Object.values(this.hands)) if (h.connected) h.pulse(strength, ms);
  }

  onResize() {
    if (this.renderer.xr.isPresenting) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  tick() {
    const now = performance.now();
    const dt = Math.min((now - this._last) / 1000, 0.1);
    this._last = now;
    if (this.paused) return;
    this.frame++;
    const xr = this.renderer.xr.isPresenting;

    let shelfHover = null;
    if (xr && this.pendingRecenter && --this.pendingRecenter.frames <= 0) {
      this.recenter(this.pendingRecenter.target, this.pendingRecenter.yaw);
      this.pendingRecenter = null;
    }
    if (xr) {
      this.xrInput.update(dt);
      shelfHover = this.interaction.update(dt, this.hands, this.rig, this.camera);
    } else {
      if (this.mode === 'attract') {
        const t = performance.now() / 1000;
        const c = LAYOUT.table;
        const a = 0.5 + Math.sin(t * 0.1) * 0.9;
        this.camera.position.set(c.x + Math.sin(a) * 1.05, 1.22, c.z + Math.cos(a) * 1.05);
        this.camera.lookAt(c.x, c.y + 0.2, c.z);
      }
      this.desktop.update(dt);
      shelfHover = this.desktop.shelfHover;
    }

    // life-size: keep the control panel near the viewer
    if (this.stage.mode === 'life') {
      const head = this.camera.getWorldPosition(this._v);
      const fwd = this.camera.getWorldDirection(this._f);
      fwd.y = 0;
      fwd.normalize();
      const want = head.clone().addScaledVector(fwd, 0.45);
      want.y = head.y - 0.55;
      this.panel.group.position.lerp(want, Math.min(1, dt * 3));
      this.panel.group.rotation.set(-0.75, Math.atan2(fwd.x, fwd.z) + Math.PI, 0, 'YXZ');
      this.card.mesh.visible = false;
    } else {
      this.panel.group.position.lerp(this.panelHome, Math.min(1, dt * 4));
      this.panel.group.rotation.set(-0.75, 0, 0);
      this.card.mesh.visible = true;
    }
    this.panel.group.visible = xr;
    this.panel.buttons.find((b) => b.id === 'life').setActive(this.stage.mode === 'life');
    this.panel.update(dt);

    this.stage.update(dt, this.camera);
    this.shelf.update(dt, shelfHover, this.camera.position);

    // hover label over a pedestal
    if (shelfHover && this.stage.mode !== 'life') {
      const it = shelfHover;
      this.hoverLabel.set(it.entry.name, it.entry.comingSoon ? 'coming soon' : it.onStage ? 'on the table' : 'pull the trigger to bring it to the table');
      it.group.getWorldPosition(this._v);
      this.hoverLabel.mesh.position.copy(this._v).add(new THREE.Vector3(0, 1.48, 0));
      this.hoverLabel.mesh.lookAt(this.camera.getWorldPosition(this._f));
      this.hoverLabel.mesh.visible = true;
    } else this.hoverLabel.mesh.visible = false;

    // light + sound follow the hero
    const wb = this.stage.worldBounds(this._v);
    this.hall.fitShadow(wb.center, wb.radius);
    if (this.audio.ready) {
      const cam = xr ? this.renderer.xr.getCamera() : this.camera;
      cam.getWorldPosition(this._f);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
      this.audio.setPositions(wb.center, this._f, fwd, up);
    }

    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.stats.drawCalls = info.calls;
    this.stats.triangles = info.triangles;
    this._fpsN++;
    this._fpsT += dt;
    if (this._fpsT > 1) {
      this.stats.fps = Math.round(this._fpsN / this._fpsT);
      this._fpsN = 0;
      this._fpsT = 0;
    }
    // let time-sliced builds continue between frames
    this.frames.tick();
  }
}
