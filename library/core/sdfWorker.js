/**
 * Worker that meshes SDF model layers off the main thread so building a
 * detailed asset never stalls the headset's frame loop.
 *
 * message in : { id, module, kind: 'mesh' | 'details', layer?, cell? }
 * message out: { id, result } | { id, error }
 */
import { surfaceNets } from './surfaceNets.js';

const modules = new Map();
function load(url) {
  if (!modules.has(url)) modules.set(url, import(url));
  return modules.get(url);
}

self.onmessage = async (e) => {
  const { id, module, kind, layer, cell } = e.data;
  try {
    const mod = await load(module);
    if (kind === 'details') {
      self.postMessage({ id, result: mod.details() });
      return;
    }
    const L = mod.layers[layer];
    if (!L) throw new Error(`unknown layer ${layer}`);
    const r = surfaceNets(L.sdf, L.bounds, cell, { color: L.color, attributes: L.attributes });
    const transfer = [r.positions.buffer, r.normals.buffer, r.index.buffer];
    if (r.colors) transfer.push(r.colors.buffer);
    for (const a of Object.values(r.attributes)) transfer.push(a.buffer);
    self.postMessage({ id, result: r }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
