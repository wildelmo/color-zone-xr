/**
 * Tests that leaving the ride really stops everything, in an emulated Quest.
 *
 *   npm test
 *
 *   1. leaving VR from the system (session ends) pauses: the loop stops
 *   2. Back to VR resumes
 *   3. tapping B briefly does not quit
 *   4. holding B quits: session ends, loop stops, GPU freed, page unloads to ended.html
 *   5. the Quit button on the page does the same on desktop
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
const BASE = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage({ xr }) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  if (xr) await page.addInitScript({ path: path.join(ROOT, 'tools/test/xr-emulator.js') });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  return { page, logs };
}
const framesAdvance = async (page) => {
  const a = await page.evaluate(() => window.__frames());
  await sleep(600);
  const b = await page.evaluate(() => window.__frames());
  return b > a;
};
const quitSteps = (logs) => logs.filter((l) => l.startsWith('[quit]'));

// --- VR flow ---
{
  const { page, logs } = await openPage({ xr: true });
  await page.click('#enter-vr');
  await page.waitForFunction(() => window.__xrEmu.frames > 10);
  check(await page.evaluate(() => window.__app.state === 'running'), 'enters VR and runs');

  await page.evaluate(() => window.__xrEmu.endSession());
  await page.waitForFunction(() => window.__app.state === 'paused');
  check(!(await framesAdvance(page)), 'leaving VR from the system pauses: render loop stopped');
  check(await page.isVisible('#paused'), 'paused panel is shown');

  await page.click('#resume-vr');
  await page.waitForFunction(() => window.__app.state === 'running' && window.__xrEmu.session);
  check(await framesAdvance(page), 'Back to VR resumes rendering');

  // Time-based: software rendering in tests is slow, so frame counts don't mean seconds.
  await page.evaluate(() => window.__xrEmu.setButton('right', 5, true));
  await sleep(500);
  await page.evaluate(() => window.__xrEmu.setButton('right', 5, false));
  await sleep(1500);
  check(await page.evaluate(() => window.__app.state === 'running'), 'a short tap on B does not quit');

  const nav = page.waitForURL(/ended\.html$/, { timeout: 15000 });
  await page.evaluate(() => window.__xrEmu.setButton('right', 5, true));
  await nav.catch(() => {});
  check(page.url().endsWith('ended.html'), 'holding B quits to ended.html');
  const steps = quitSteps(logs);
  check(steps.includes('[quit] vr session ended'), 'quit ended the VR session');
  check(steps.includes('[quit] render loop stopped'), 'quit stopped the render loop');
  check(steps.includes('[quit] gpu resources freed, webgl context destroyed'), 'quit freed the GPU and destroyed the WebGL context');
  check(await page.evaluate(() => document.scripts.length === 0 && !document.querySelector('canvas')), 'ended page runs no scripts and has no canvas');
  const errors = logs.filter((l) => l.startsWith('pageerror'));
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`);
  await page.close();
}

// --- Desktop Quit button ---
{
  const { page, logs } = await openPage({ xr: false });
  const nav = page.waitForURL(/ended\.html$/, { timeout: 15000 });
  await page.click('#quit');
  await nav.catch(() => {});
  check(page.url().endsWith('ended.html'), 'desktop Quit button leaves for ended.html');
  check(quitSteps(logs).includes('[quit] gpu resources freed, webgl context destroyed'), 'desktop Quit freed the GPU');
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
