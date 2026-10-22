/** "Enter VR" button. Shown only when the browser supports immersive VR. */
export async function setupVRButton(renderer) {
  const button = document.getElementById('enter-vr');
  if (!navigator.xr || !(await navigator.xr.isSessionSupported('immersive-vr').catch(() => false))) return;
  button.hidden = false;

  let session = null;
  button.addEventListener('click', async () => {
    if (session) {
      await session.end();
      return;
    }
    session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    session.addEventListener('end', () => {
      session = null;
      button.textContent = 'Enter VR';
    });
    await renderer.xr.setSession(session);
    button.textContent = 'Exit VR';
  });
}
