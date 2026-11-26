import * as THREE from 'three';
import { surfaceNets } from './surfaceNets.js';

/**
 * Runs SDF meshing jobs in a module worker (falls back to the main thread if
 * workers are unavailable) and converts the results to BufferGeometry.
 */
let worker = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./sdfWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result);
    };
    worker.onerror = (e) => {
      console.warn('sdf worker failed, meshing on the main thread', e.message || e);
      workerFailed = true;
      worker = null;
      for (const p of pending.values()) p.retry();
      pending.clear();
    };
  } catch (e) {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

async function inline(job) {
  const mod = await import(job.module);
  if (job.kind === 'details') return mod.details();
  const L = mod.layers[job.layer];
  return surfaceNets(L.sdf, L.bounds, job.cell, { color: L.color, attributes: L.attributes });
}

function run(job) {
  const w = getWorker();
  if (!w) return inline(job);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, retry: () => inline(job).then(resolve, reject) });
    w.postMessage({ id, ...job });
  });
}

/** mesh one layer of an SDF model module; resolves to a BufferGeometry */
export async function meshLayer(moduleUrl, layer, cell) {
  const r = await run({ module: moduleUrl, kind: 'mesh', layer, cell });
  return toGeometry(r);
}

/** run a model module's details() (ornament curves, anchor points) */
export function modelDetails(moduleUrl) {
  return run({ module: moduleUrl, kind: 'details' });
}

export function toGeometry(r) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
  if (r.colors) g.setAttribute('color', new THREE.BufferAttribute(r.colors, 3));
  for (const [k, a] of Object.entries(r.attributes || {})) g.setAttribute(k, new THREE.BufferAttribute(a, 1));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  g.computeBoundingSphere();
  return g;
}
