import * as THREE from 'three';

/**
 * A warm "cabinet of curiosities" environment map: a dark panelled room lit
 * by a few lamp-like panels, prefiltered with PMREM. This is what the gold,
 * brass, mirrors and lacquer reflect, so it sets the whole mood.
 */
export function createEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(20, 10, 20),
    new THREE.MeshBasicMaterial({ color: 0x2a1a12, side: THREE.BackSide }),
  );
  room.position.y = 4;
  scene.add(room);
  const lamp = (color, intensity, w, h, x, y, z, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    scene.add(m);
  };
  // big soft key from above-front, warm
  lamp('#ffe2b8', 7, 8, 5, 0, 8.9, 2, 0, Math.PI / 2);
  // window-like panels around the room
  lamp('#ffd7a0', 5, 3, 3.5, -9.9, 4, -2, Math.PI / 2);
  lamp('#fff1dc', 3.5, 2.5, 3, 9.9, 3.5, 3, -Math.PI / 2);
  lamp('#ffc890', 4, 4, 2, 0, 3, -9.9, 0);
  lamp('#ffe9cc', 2.5, 3, 2, 3, 2.5, 9.9, Math.PI);
  // a little colour: red velvet and green wallpaper bounce
  lamp('#a3282b', 1.2, 6, 3, -6, 1.5, 9.8, Math.PI);
  lamp('#2b6763', 0.9, 6, 3, 6, 1.6, -9.8, 0);
  // warm floor bounce
  lamp('#7a4524', 0.8, 18, 18, 0, -0.9, 0, 0, -Math.PI / 2);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return rt.texture;
}
