/** Resolve playwright from local node_modules or the global install. */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

export async function loadPlaywright() {
  let pw;
  try {
    pw = await import('playwright');
  } catch (e) {
    const root = execSync('npm root -g').toString().trim();
    const req = createRequire(import.meta.url);
    const pkg = req.resolve(path.join(root, 'playwright', 'package.json'));
    pw = await import(pathToFileURL(path.join(path.dirname(pkg), 'index.mjs')).href);
  }
  // if this playwright's own browser build isn't installed, fall back to a
  // preinstalled Chromium (e.g. a sandbox image) instead of failing
  const chromium = pw.chromium;
  const launch = chromium.launch.bind(chromium);
  const fallback = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  const wrapped = Object.create(chromium);
  wrapped.launch = async (opts = {}) => {
    try {
      return await launch(opts);
    } catch (e) {
      if (!opts.executablePath && fs.existsSync(fallback) && /Executable doesn't exist/.test(String(e.message))) {
        return launch({ ...opts, executablePath: fallback });
      }
      throw e;
    }
  };
  return { ...pw, chromium: wrapped };
}

export const launchArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
