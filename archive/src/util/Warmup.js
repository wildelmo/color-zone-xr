import * as THREE from 'three';

/**
 * Shader programs compile the first time a material is drawn, which on a
 * headset shows up as a hitch the first time a kid tries a new brush or
 * opens the menu. Keep a microscopic, never-culled triangle for every
 * on-demand material in the scene so everything compiles during the
 * loading frames instead.
 */
export function warmMaterials(scene, materials) {
  const group = new THREE.Group();
  group.name = 'shaderWarmup';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.001, 0, 0, 0, 0.001, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute('aux', new THREE.Float32BufferAttribute([0.01, 0.01, 0.01], 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.01);
  for (const m of materials) {
    if (!m) continue;
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.position.set(0, -80, 0);
    mesh.renderOrder = -90;
    mesh.name = 'warm-' + (m.name || m.type);
    group.add(mesh);
  }
  scene.add(group);
  return group;
}
