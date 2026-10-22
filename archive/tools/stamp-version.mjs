/**
 * Deploy-time cache busting (run by the Pages workflow before upload).
 *
 * GitHub Pages serves files with a 10-minute cache lifetime and browsers
 * happily mix a fresh index.html with stale modules, which breaks startup
 * after an update. This rewrites index.html's import map so every module
 * URL carries the build's git hash (?v=abc1234) and bumps the service
 * worker's cache version, so each deploy is an entirely new set of URLs.
 *
 *   node tools/stamp-version.mjs            # stamps in place (CI)
 *   node tools/stamp-version.mjs --check    # prints the map, changes nothing
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
let sha = process.env.GITHUB_SHA || '';
if (!sha) {
  try {
    sha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  } catch (e) {
    sha = String(Date.now());
  }
}
const v = sha.slice(0, 10);

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) walk(fp, out);
    else if (f.endsWith('.js')) out.push(fp);
  }
  return out;
}
const rel = (fp) => './' + path.relative(ROOT, fp).split(path.sep).join('/');

const imports = {
  three: `./vendor/three/three.module.min.js?v=${v}`,
  'three/addons/': './vendor/three/addons/',
};
for (const fp of walk(path.join(ROOT, 'vendor', 'three'))) {
  const r = rel(fp);
  imports[r] = `${r}?v=${v}`;
  if (r.startsWith('./vendor/three/addons/')) imports['three/addons/' + r.slice('./vendor/three/addons/'.length)] = `${r}?v=${v}`;
}
for (const fp of walk(path.join(ROOT, 'src'))) {
  const r = rel(fp);
  imports[r] = `${r}?v=${v}`;
}

const indexPath = path.join(ROOT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const mapJson = JSON.stringify({ imports }, null, 2).replace(/^/gm, '    ');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${mapJson}\n  </script>`);
html = html.replace(/src="\.\/src\/main\.js(\?v=[^"]*)?"/, `src="./src/main.js?v=${v}"`);
html = html.replace(/href="\.\/manifest\.webmanifest(\?v=[^"]*)?"/, `href="./manifest.webmanifest?v=${v}"`);
html = html.replace(/<meta name="build" content="[^"]*">\s*/, '');
html = html.replace('<meta name="theme-color"', `<meta name="build" content="${v}">\n  <meta name="theme-color"`);

const swPath = path.join(ROOT, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = 'czx-${v}';`);
sw = sw.replace(/'(\.\/(?:src|vendor)\/[^'?]+\.js)(?:\?v=[^']*)?'/g, `'$1?v=${v}'`);

if (CHECK) {
  console.log(JSON.stringify({ imports }, null, 2));
  console.log(`(check only) would stamp v=${v}`);
} else {
  fs.writeFileSync(indexPath, html);
  fs.writeFileSync(swPath, sw);
  console.log(`stamped ${Object.keys(imports).length} module URLs and sw cache with v=${v}`);
}
