import { App } from './App.js';

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const btnVR = document.getElementById('btn-vr');
const btnDesktop = document.getElementById('btn-desktop');
const hint = document.getElementById('xr-hint');
const desktopHelp = document.getElementById('desktop-help');
const loading = document.getElementById('loading');

const params = new URLSearchParams(location.search);
let app;
try {
  app = new App({ canvas, seed: params.get('seed') || 'color-zone', params });
} catch (err) {
  console.error('Color Zone failed to start', err);
  if (window.__czxFail) window.__czxFail(err && err.message ? err.message : String(err));
  throw err;
}
window.__czx = app;
loading.classList.add('hidden');

function showOverlay(show) {
  overlay.classList.toggle('hidden', !show);
}

app.isVRSupported().then((ok) => {
  if (ok) {
    btnVR.disabled = false;
    hint.textContent = 'Headset found. Put it on and press Enter VR.';
  } else {
    btnVR.disabled = true;
    hint.innerHTML = navigator.xr
      ? 'No VR headset detected here. Open this page in the <b>Meta Quest Browser</b> to play in VR.'
      : 'Open this page in the <b>Meta Quest Browser</b> to play in VR — or explore on desktop below.';
  }
});

btnVR.addEventListener('click', async () => {
  btnVR.disabled = true;
  btnVR.textContent = 'Starting…';
  try {
    await app.enterVR();
    showOverlay(false);
  } catch (err) {
    console.error('Could not start VR session', err);
    hint.textContent = 'Could not start VR: ' + (err && err.message ? err.message : err);
    btnVR.disabled = false;
  } finally {
    btnVR.textContent = 'Enter VR';
  }
});

btnDesktop.addEventListener('click', () => {
  app.startDesktop();
  showOverlay(false);
});

app.events.on('modechange', (mode) => {
  desktopHelp.classList.toggle('hidden', mode !== 'desktop');
});

app.events.on('sessionend', () => {
  btnVR.disabled = false;
  showOverlay(true);
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && app.mode === 'desktop' && !document.pointerLockElement) {
    app.stopDesktop();
    showOverlay(true);
  }
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
