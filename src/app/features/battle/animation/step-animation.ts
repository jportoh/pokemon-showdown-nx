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
  let cancel: (() => void) | null = null;
  const tick = () => {
    const progress = durationMs > 0 ? Math.min(1, (Date.now() - start) / durationMs) : 1;
    frame(progress);
    if (progress < 1) {
      cancel = nextFrame(tick);
    } else {
      cancel = null;
      done?.();
    }
  };
  tick();
  return () => {
    cancel?.();
    cancel = null;
  };
}

/** Calls `fn` on the next animation frame; returns a function that cancels it. */
export function nextFrame(fn: () => void): () => void {
  if (hasAnimationFrame) {
    const handle = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(fn, FALLBACK_FRAME_MS);
  return () => clearTimeout(handle);
}

/** Out and back: 0 → 1 at the middle → 0. */
export function outAndBack(progress: number): number {
  return progress < 0.5 ? progress * 2 : (1 - progress) * 2;
}
