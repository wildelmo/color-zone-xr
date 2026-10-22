/**
 * Screenshots of the scene from several directions, for checking the look
 * without a headset.
 *
 *   npm run shot                       -> docs/screenshots/*.png
 *   npm run shot -- --palette=summer --out=some/dir
 *   npm run shot -- --frames=40 --travel=600   -> numbered frames looking ahead
 *                                                 while the train travels 600 m
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const OUT = path.resolve(ROOT, args.out || 'docs/screenshots');
const PALETTE = args.palette || '';
const VIEWS = [
  ['ahead', 0, 4],
  ['left', -70, 6],
  ['right', 70, 6],
  ['behind', 180, 4],
  ['up', 20, 50],
  ['down', 0, -25],
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url.endsWith('/') ? url + 'index.html' : url);
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.goto(`http://localhost:${port}/${PALETTE ? `?palette=${PALETTE}` : ''}`);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
await page.addStyleTag({ content: '#hud { display: none !important; }' });

fs.mkdirSync(OUT, { recursive: true });
const frames = Number(args.frames || 0);
for (let i = 0; i < frames; i++) {
  const travelled = (Number(args.travel || 600) * i) / frames;
  await page.evaluate(([y, p, t]) => window.__view(y, p, t), [Number(args.yaw || 0), Number(args.pitch || 6), travelled]);
  await page.screenshot({ path: path.join(OUT, `frame-${String(i).padStart(3, '0')}.png`) });
}
for (const [name, yaw, pitch] of frames ? [] : VIEWS) {
  await page.evaluate(([y, p]) => window.__view(y, p), [yaw, pitch]);
  const file = path.join(OUT, `${PALETTE || 'seaTrain'}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
server.close();
