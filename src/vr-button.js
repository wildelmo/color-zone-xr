/** Starting VR. Needs a user gesture (a click) on the page. */
export async function vrSupported() {
  return Boolean(navigator.xr) && navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
}

export async function enterVR(renderer) {
  if (renderer.xr.isPresenting) return;
  const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
  await renderer.xr.setSession(session);
}
