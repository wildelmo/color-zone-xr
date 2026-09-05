/** Resolve playwright from local node_modules or the global install. */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (e) {
    const root = execSync('npm root -g').toString().trim();
    const req = createRequire(import.meta.url);
    const pkg = req.resolve(path.join(root, 'playwright', 'package.json'));
    return await import(pathToFileURL(path.join(path.dirname(pkg), 'index.mjs')).href);
  }
}

export const launchArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
