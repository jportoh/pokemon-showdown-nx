/** Time between frames where requestAnimationFrame is missing. */
const FALLBACK_FRAME_MS = 16;

const hasAnimationFrame = typeof requestAnimationFrame === 'function';

/**
 * Runs an animation by hand, one frame at a time: `frame` gets the progress (0 to 1) and sets inline
 * styles itself, touching the DOM directly rather than through Angular to keep each frame cheap.
 * On the console (probe N1, 2026-09-26) CSS transitions and @keyframes don't animate at all, while
 * requestAnimationFrame runs a steady 60 frames a second; setTimeout managed only 20–25 and stuttered.
 * Returns a function that stops it (without the last frame).
 */
export function stepAnimation(durationMs: number, frame: (progress: number) => void, done?: () => void): () => void {
  const start = Date.now();
  let handle: number | ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    handle = hasAnimationFrame ? requestAnimationFrame(tick) : setTimeout(tick, FALLBACK_FRAME_MS);
  };
  const tick = () => {
    const progress = durationMs > 0 ? Math.min(1, (Date.now() - start) / durationMs) : 1;
    frame(progress);
    if (progress < 1) {
      schedule();
    } else {
      handle = null;
      done?.();
    }
  };
  tick();
  return () => {
    if (handle === null) return;
    if (hasAnimationFrame) cancelAnimationFrame(handle as number);
    else clearTimeout(handle);
    handle = null;
  };
}

/** Out and back: 0 → 1 at the middle → 0. */
export function outAndBack(progress: number): number {
  return progress < 0.5 ? progress * 2 : (1 - progress) * 2;
}
