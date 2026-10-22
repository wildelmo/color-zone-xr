/**
 * Deploy-time cache busting (run by the Pages workflow before upload).
 * Carried over from the previous project, where it fixed broken starts after updates.
 *
 * GitHub Pages serves files with a 10-minute cache lifetime, and browsers will
 * mix a fresh index.html with stale modules after an update. This rewrites
 * index.html's import map so every module URL carries the build's git hash
 * (?v=abc1234), making each deploy an entirely new set of URLs.
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
  } catch {
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

const imports = { three: `./vendor/three/three.module.min.js?v=${v}` };
for (const fp of [...walk(path.join(ROOT, 'vendor', 'three')), ...walk(path.join(ROOT, 'src'))]) {
  const r = rel(fp);
  imports[r] = `${r}?v=${v}`;
}

const indexPath = path.join(ROOT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const mapJson = JSON.stringify({ imports }, null, 2).replace(/^/gm, '    ');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${mapJson}\n  </script>`);
html = html.replace(/src="\.\/src\/main\.js(\?v=[^"]*)?"/, `src="./src/main.js?v=${v}"`);

if (CHECK) {
  console.log(html.match(/<script type="importmap">[\s\S]*?<\/script>/)[0]);
  console.log(`(check only) would stamp v=${v}`);
} else {
  fs.writeFileSync(indexPath, html);
  console.log(`stamped ${Object.keys(imports).length} module URLs with v=${v}`);
}
