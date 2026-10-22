/**
 * Quit from inside VR: hold B or Y on a Touch controller for 1.5 seconds.
 * A ring fills up in front of you while you hold; letting go cancels it.
 * The ring stays fixed in the world where it first appeared, which is
 * comfortable, rather than following your head.
 */
import * as THREE from 'three';

const HOLD_SECONDS = 1.5;
const BUTTON_B_Y = 5; // xr-standard gamepad mapping on Meta Touch controllers

export function createExitGesture({ renderer, scene, onExit }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }),
  );
  ring.name = 'exit-ring';
  ring.renderOrder = 1000;
  ring.visible = false;
  scene.add(ring);

  function draw(progress) {
    const c = 128;
    ctx.clearRect(0, 0, 256, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.arc(c, c, 112, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0b7cb9';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, 96, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#0b5f8f';
    ctx.textAlign = 'center';
    ctx.font = '600 44px system-ui, sans-serif';
    ctx.fillText('Exit', c, c + 8);
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillText('keep holding', c, c + 44);
    texture.needsUpdate = true;
  }

  const head = new THREE.Vector3();
  const forward = new THREE.Vector3();
  let held = 0;
  let fired = false;

  function update(dt) {
    const session = renderer.xr.getSession();
    let pressed = false;
    if (session) {
      for (const source of session.inputSources) {
        if (source.gamepad?.buttons[BUTTON_B_Y]?.pressed) pressed = true;
      }
    }
    if (!pressed) {
      held = 0;
      ring.visible = false;
      return;
    }
    if (held === 0) {
      const camera = renderer.xr.getCamera();
      camera.getWorldPosition(head);
      camera.getWorldDirection(forward);
      ring.position.copy(head).addScaledVector(forward, 0.6);
      ring.lookAt(head);
    }
    held += dt;
    ring.visible = true;
    draw(Math.min(held / HOLD_SECONDS, 1));
    if (held >= HOLD_SECONDS && !fired) {
      fired = true;
      onExit();
    }
  }

  return { update };
}
