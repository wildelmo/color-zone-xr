import * as THREE from 'three';
import { createSky, SKY_RADIUS } from './sky.js';
import { createClouds } from './clouds.js';
import { createWater } from './water.js';
import { PALETTE, PALETTE_NAME } from './palette.js';
import { vrSupported, enterVR } from './vr-button.js';
import { createMotion } from './motion.js';
import { createLifecycle } from './lifecycle.js';
import { createExitGesture } from './exit-gesture.js';

const EYE_HEIGHT = 1.2; // seated, metres above the train floor

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// three.js defaults to maximum foveated rendering at the browser's reduced
// resolution, which turns smooth skies and soft clouds blocky outside the
// centre of view. This scene is cheap, so render it everywhere at full
// detail, a little above the headset's recommended resolution.
renderer.xr.setFoveation(0);
renderer.xr.setFramebufferScaleFactor(1.25);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky[0][1]);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, SKY_RADIUS * 1.5);
camera.position.set(0, EYE_HEIGHT, 0);
camera.rotation.order = 'YXZ';

const water = createWater();
const clouds = createClouds(renderer);
scene.add(createSky(), water, clouds.group);

const motion = createMotion();
function placeWorld(travelled) {
  clouds.update(travelled);
  water.material.uniforms.travelled.value = travelled;
}

const clock = new THREE.Clock();
let frames = 0;
function frame() {
  const dt = clock.getDelta();
  placeWorld(motion.step(dt));
  exitGesture.update(dt);
  renderer.render(scene, camera);
  if (++frames === 2) window.__ready = true;
}

const app = createLifecycle({ renderer, scene, frame });
app.onShutdown(clouds.dispose);
app.onResume(() => clock.getDelta()); // don't count the paused time as travel
const exitGesture = createExitGesture({ renderer, scene, onExit: app.quit });

// Desktop: drag to look around.
const look = { yaw: 0, pitch: 4 };
function applyLook() {
  look.pitch = Math.max(-80, Math.min(85, look.pitch));
  camera.rotation.set(THREE.MathUtils.degToRad(look.pitch), THREE.MathUtils.degToRad(-look.yaw), 0);
}
applyLook();
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const k = 0.15;
  look.yaw -= (e.clientX - drag.x) * k;
  look.pitch += (e.clientY - drag.y) * k;
  drag = { x: e.clientX, y: e.clientY };
  applyLook();
  if (app.state === 'paused') renderer.render(scene, camera);
});
renderer.domElement.addEventListener('pointerup', () => { drag = null; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (app.state === 'paused') renderer.render(scene, camera);
});

// Page controls: Enter VR and Quit, plus the panel shown while paused.
const $ = (id) => document.getElementById(id);
const startVR = () => enterVR(renderer).then(app.start).catch((e) => console.error('Could not start VR:', e));
vrSupported().then((ok) => {
  $('enter-vr').hidden = !ok;
  $('resume-vr').hidden = !ok;
});
$('enter-vr').addEventListener('click', startVR);
$('resume-vr').addEventListener('click', startVR);
$('resume-here').addEventListener('click', () => app.start());
$('quit').addEventListener('click', app.quit);
$('quit-paused').addEventListener('click', app.quit);
app.onChange((state) => {
  $('paused').hidden = state !== 'paused';
});
$('palette-name').textContent = PALETTE_NAME;

app.start();

// The previous app at this address installed a service worker; make sure it is gone.
navigator.serviceWorker?.getRegistrations().then((list) => list.forEach((r) => r.unregister())).catch(() => {});

// Hooks for tests and the screenshot tool.
window.__app = app;
window.__frames = () => frames;
// window.__view(yawDeg, pitchDeg, travelledMetres): stop the loop and render one still.
window.__view = (yaw, pitch, travelled = 0) => {
  renderer.setAnimationLoop(null);
  look.yaw = yaw;
  look.pitch = pitch;
  applyLook();
  motion.set(travelled);
  placeWorld(travelled);
  renderer.render(scene, camera);
};
