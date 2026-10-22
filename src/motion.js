/**
 * Module 4: the train's motion.
 * The train stays at the origin and the world slides past it along -x, so
 * the passenger's view out of the -z window scrolls from right to left.
 * Speed in metres per second can be set with ?speed=<m/s> (0 to stop).
 */
const requested = new URLSearchParams(globalThis.location?.search ?? '').get('speed');
export const SPEED = requested !== null && Number(requested) >= 0 ? Number(requested) : 14;

export function createMotion(speed = SPEED) {
  let travelled = 0;
  return {
    get travelled() {
      return travelled;
    },
    step(dt) {
      // Clamp long frames (tab in background, headset taken off) so nothing jumps.
      travelled += speed * Math.min(dt, 0.1);
      return travelled;
    },
    set(metres) {
      travelled = metres;
    },
  };
}
