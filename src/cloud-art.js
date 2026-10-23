/**
 * Painted cloud artwork: cut-out PNGs in assets/clouds/, listed in
 * manifest.json by tools/prep_clouds.py. When there is artwork, the cloud
 * layers use it; otherwise they fall back to the procedurally painted clouds.
 * ?clouds=procedural forces the fallback, for comparison.
 */
import * as THREE from 'three';

const BASE = new URL('../assets/clouds/', import.meta.url);

/** Resolves to { tower: [...], hero: [...], bank: [...], small: [...] }, or null if there is no artwork. */
export async function loadCloudArt(renderer) {
  if (new URLSearchParams(location.search).get('clouds') === 'procedural') return null;
  let manifest;
  try {
    const res = await fetch(new URL('manifest.json', BASE), { cache: 'no-cache' });
    if (!res.ok) return null;
    manifest = await res.json();
  } catch {
    return null;
  }
  if (!manifest.clouds?.length) return null;

  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const art = { tower: [], hero: [], bank: [], small: [] };
  await Promise.all(manifest.clouds.map(async (c) => {
    try {
      const texture = await loader.loadAsync(new URL(c.file, BASE).href);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      art[c.kind]?.push({ texture, aspect: c.height / c.width, light: c.light === 'right' ? 1 : -1, file: c.file });
    } catch (e) {
      console.warn(`cloud art ${c.file} failed to load`, e);
    }
  }));
  const total = Object.values(art).reduce((n, list) => n + list.length, 0);
  return total ? art : null;
}

/** A painting for `kind`, falling back to the nearest kind that has artwork. */
const FALLBACK = { tower: ['tower', 'hero', 'small', 'bank'], hero: ['hero', 'tower', 'small', 'bank'], small: ['small', 'hero', 'tower', 'bank'], bank: ['bank', 'hero', 'tower', 'small'] };
export function pickArt(art, kind, index) {
  for (const k of FALLBACK[kind]) {
    const list = art[k];
    if (list.length) return list[index % list.length];
  }
  return null;
}
