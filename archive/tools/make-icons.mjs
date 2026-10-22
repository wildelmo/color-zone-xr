/** Render assets/icons/icon.svg to the PNG sizes the manifest needs (uses Playwright's Chromium). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './test/pw.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(ROOT, 'assets/icons/icon.svg'), 'utf8');
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 56], ['og-image.png', 1200, 0]]) {
  const page = await browser.newPage({ viewport: { width: size === 1200 ? 1200 : size, height: size === 1200 ? 630 : size }, deviceScaleFactor: 1 });
  const inner = size === 1200 ? 500 : size - pad * 2;
  await page.setContent(`<body style="margin:0;background:${pad ? '#5a75ff' : 'transparent'};display:grid;place-items:center;width:${size === 1200 ? 1200 : size}px;height:${size === 1200 ? 630 : size}px;${size === 1200 ? 'background:linear-gradient(135deg,#3a8dff,#a05cff 60%,#ff6ad5);' : ''}">
    <div style="display:flex;align-items:center;gap:60px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div>
      ${size === 1200 ? '<div style="font:900 96px system-ui,sans-serif;color:#fff;line-height:1;text-shadow:0 8px 30px rgba(0,0,0,.25)">Color Zone<br><span style="font-size:48px;letter-spacing:.3em">XR</span><div style="font:700 34px system-ui;margin-top:24px;opacity:.9">Paint the world back to life</div></div>' : ''}
    </div></body>`);
  await page.screenshot({ path: path.join(ROOT, 'assets/icons', name), omitBackground: !pad && size !== 1200 });
  await page.close();
  console.log('wrote', name);
}
await browser.close();
