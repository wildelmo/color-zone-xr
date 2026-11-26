/**
 * Builds the GitHub Pages site into _site/ (run by the deploy workflow).
 *
 * Every deploy puts the app's code under its own folder, v/<commit>/, and
 * index.html points there. Pages serves files with a 10-minute cache, and a
 * browser would otherwise mix a fresh index.html with stale modules (or a
 * stale SDF worker) after an update; with per-deploy paths every URL is new,
 * including modules loaded by workers and dynamic imports.
 *
 *   node tools/build-pages.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');
let sha = process.env.GITHUB_SHA || '';
if (!sha) {
  try {
    sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    sha = String(Date.now());
  }
}
const v = `v/${sha.slice(0, 10)}`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, v), { recursive: true });
for (const dir of ['src', 'library', 'vendor', 'dev']) {
  fs.cpSync(path.join(ROOT, dir), path.join(OUT, v, dir), { recursive: true });
}
for (const f of ['sw.js', 'LICENSE']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const before = html;
html = html.replaceAll('"./vendor/', `"./${v}/vendor/`).replace('src="./src/main.js"', `src="./${v}/src/main.js"`);
if (html === before || !html.includes(`./${v}/src/main.js`)) throw new Error('index.html paths not found; update build-pages.mjs');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`built _site with code under ${v}/`);
