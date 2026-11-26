import { App } from './app/App.js';

const $ = (id) => document.getElementById(id);
const app = new App($('scene'));
window.__cc = app; // handy for debugging and the automated tests

const status = $('status');
const hudStatus = $('hud-status');
let statusTimer = 0;
app.onStatus = (text) => {
  status.textContent = text;
  hudStatus.textContent = text;
  hudStatus.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => hudStatus.classList.remove('show'), 4500);
  app.card.set(app.stage.asset ? app.stage.asset.info : null, text.length < 60 ? text : '');
};
app.onHeroLoaded = (asset) => app.card.set(asset.info);
app.onHeroUnloaded = () => app.card.set(null);
// the HTML toolbar is for desktop only; hide it while the headset is on
app.onModeChange = (mode) => $('hud').classList.toggle('hidden', mode === 'xr');

// a real exit: the app has stopped (VR ended, audio closed, no rendering)
app.onExit = () => {
  $('overlay').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('closed').classList.remove('hidden');
};

function showHud() {
  $('overlay').classList.add('hidden');
  $('hud').classList.remove('hidden');
}

$('btn-desktop').addEventListener('click', () => {
  app.start('desktop');
  showHud();
});

const vrBtn = $('btn-vr');
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (ok) {
      vrBtn.disabled = false;
      vrBtn.textContent = 'Enter VR';
      $('hud-vr').classList.remove('hidden');
    } else vrBtn.textContent = 'VR not available here';
  });
} else vrBtn.textContent = 'VR not available here';

async function goVR() {
  app.audio.resume();
  const ok = await app.enterVR();
  if (ok) $('overlay').classList.add('hidden');
}
vrBtn.addEventListener('click', goVR);
$('hud-vr').addEventListener('click', goVR);

// desktop HUD buttons
const windBtn = $('hud-wind');
const startWind = (e) => {
  e.preventDefault();
  app.desktop.setWinding(true);
};
const stopWind = () => app.desktop.setWinding(false);
windBtn.addEventListener('pointerdown', startWind);
windBtn.addEventListener('pointerup', stopWind);
windBtn.addEventListener('pointerleave', stopWind);
$('hud-life').addEventListener('click', () => app.toggleLife());
$('hud-exit').addEventListener('click', () => app.exit());
$('btn-reopen').addEventListener('click', () => location.reload());
$('hud-reset').addEventListener('click', () => app.stage.reset());
$('hud-mute').addEventListener('click', (e) => {
  app.audio.setMuted(!app.audio.muted);
  e.currentTarget.textContent = app.audio.muted ? '🔇' : '🔊';
});

// an earlier app on this address installed an offline service worker; make
// sure nothing stale keeps serving old files (see sw.js)
navigator.serviceWorker?.getRegistrations().then((list) => list.forEach((r) => r.unregister())).catch(() => {});

app.boot();
