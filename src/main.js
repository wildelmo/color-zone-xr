import * as THREE from 'three';
import { createSky, SKY_RADIUS } from './sky.js';
import { createClouds } from './clouds.js';
import { createWater } from './water.js';
import { PALETTE, PALETTE_NAME } from './palette.js';
import { setupVRButton } from './vr-button.js';

const EYE_HEIGHT = 1.2; // seated, metres above the train floor

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky[0][1]);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, SKY_RADIUS * 1.5);
camera.position.set(0, EYE_HEIGHT, 0);
camera.rotation.order = 'YXZ';

scene.add(createSky(), createWater(), createClouds(renderer));

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
});
renderer.domElement.addEventListener('pointerup', () => { drag = null; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setupVRButton(renderer);

let frames = 0;
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  if (++frames === 2) window.__ready = true;
});

// Hook for the screenshot tool: window.__view(yawDeg, pitchDeg).
window.__view = (yaw, pitch) => {
  look.yaw = yaw;
  look.pitch = pitch;
  applyLook();
  renderer.render(scene, camera);
};
document.getElementById('palette-name').textContent = PALETTE_NAME;
