/**
 * App lifecycle: run, pause, and a real quit.
 *
 * A web page cannot close its own browser tab, so Quit does the next best
 * thing, completely:
 *   1. ends the VR session
 *   2. stops the render loop
 *   3. runs every module's shutdown hook (audio contexts closed, timers cleared, ...)
 *   4. frees every GPU resource and destroys the WebGL context
 *   5. navigates the tab to a static "ride ended" page, which unloads all of
 *      the app's JavaScript: nothing keeps running, playing or holding memory.
 *
 * Leaving VR any other way (the headset's system menu, taking it off) pauses
 * instead of carrying on in the 2D browser: the loop stops and pause hooks run
 * (sound will suspend there), and a panel offers Back to VR or Quit.
 *
 * Rule for every module: anything that starts work outside the render loop
 * (an AudioContext, a timer, a worker, a listener on window) registers
 * onPause/onResume/onShutdown hooks here.
 */
export function createLifecycle({ renderer, scene, frame }) {
  const hooks = { pause: [], resume: [], shutdown: [] };
  let state = 'stopped'; // 'running' | 'paused' | 'stopped' | 'quitting'
  const listeners = new Set();

  const run = (list) => {
    for (const fn of list) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  };
  const setState = (s) => {
    state = s;
    for (const fn of listeners) fn(s);
  };

  function start() {
    if (state === 'running' || state === 'quitting') return;
    const wasPaused = state === 'paused';
    renderer.setAnimationLoop(frame);
    setState('running');
    if (wasPaused) run(hooks.resume);
  }

  function pause() {
    if (state !== 'running') return;
    renderer.setAnimationLoop(null);
    setState('paused');
    run(hooks.pause);
  }

  async function quit() {
    if (state === 'quitting') return;
    setState('quitting');
    const step = (s) => console.info(`[quit] ${s}`);
    const session = renderer.xr.getSession();
    if (session) {
      await session.end().catch(() => {});
      step('vr session ended');
    }
    renderer.setAnimationLoop(null);
    step('render loop stopped');
    run(hooks.shutdown);
    step(`${hooks.shutdown.length} shutdown hooks run`);
    disposeScene(scene);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    step('gpu resources freed, webgl context destroyed');
    // Works only if a script opened this tab; harmless otherwise.
    window.close();
    step('leaving for ended.html');
    location.replace(new URL('ended.html', location.href));
  }

  // Leaving VR by any route other than Quit pauses.
  renderer.xr.addEventListener('sessionend', () => {
    if (state !== 'quitting') pause();
  });
  // A hidden tab never keeps running in the background.
  let pausedByHiding = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'running' && !renderer.xr.isPresenting) {
      pausedByHiding = true;
      pause();
    } else if (!document.hidden && pausedByHiding) {
      pausedByHiding = false;
      start();
    }
  });
  // The page is going away regardless: release everything now.
  window.addEventListener('pagehide', () => {
    if (state === 'quitting') return;
    renderer.setAnimationLoop(null);
    run(hooks.shutdown);
  });

  return {
    start,
    pause,
    quit,
    get state() {
      return state;
    },
    onChange: (fn) => listeners.add(fn),
    onPause: (fn) => hooks.pause.push(fn),
    onResume: (fn) => hooks.resume.push(fn),
    onShutdown: (fn) => hooks.shutdown.push(fn),
  };
}

/** Free the GPU side of every geometry, material and texture in the scene. */
function disposeScene(scene) {
  const textures = new Set();
  scene.traverse((o) => {
    o.geometry?.dispose();
    const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of materials) {
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      for (const u of Object.values(m.uniforms ?? {})) if (u.value?.isTexture) textures.add(u.value);
      m.dispose();
    }
  });
  for (const t of textures) t.dispose();
}
