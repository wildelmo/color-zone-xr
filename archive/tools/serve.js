/**
 * Local dev server for Color Zone XR.
 *
 *   npm start            → http://localhost:8080  (desktop preview)
 *                          https://<your-LAN-ip>:8443 (Meta Quest browser)
 *
 * WebXR needs HTTPS on the headset. This server makes a throw-away
 * self-signed certificate with `openssl` if it is installed; accept the
 * browser warning once on the Quest. (GitHub Pages is the zero-setup path.)
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTTP_PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain',
};

function handler(req, res) {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url.endsWith('/')) url += 'index.html';
  const file = path.join(ROOT, path.normalize(url));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

function selfSignedCert() {
  const dir = path.join(os.tmpdir(), 'color-zone-xr-cert');
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    try {
      execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${key}" -out "${cert}" -days 365 -subj "/CN=color-zone-xr.local"`, { stdio: 'ignore' });
    } catch (e) {
      return null;
    }
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

http.createServer(handler).listen(HTTP_PORT, () => {
  console.log(`\n  Color Zone XR\n  desktop preview → http://localhost:${HTTP_PORT}`);
});
const tls = selfSignedCert();
if (tls) {
  https.createServer(tls, handler).listen(HTTPS_PORT, () => {
    for (const ip of lanAddresses()) console.log(`  Meta Quest       → https://${ip}:${HTTPS_PORT}  (accept the certificate warning once)`);
    console.log('');
  });
} else {
  console.log('  (openssl not found: no HTTPS server; use GitHub Pages or a tunnel like `npx localtunnel` for the headset)\n');
}
