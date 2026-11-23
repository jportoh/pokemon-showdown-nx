import { ApplicationRef, Service, inject } from '@angular/core';

/**
 * Explicitly renders after state changes that arrive outside Angular events (WebSocket messages,
 * timers). Angular schedules those renders with `setTimeout(fn)` (no delay) raced against
 * `requestAnimationFrame`, and ignores further requests while one is pending. On the console
 * that render sometimes never came until a navigation forced one, leaving the view stale.
 * Calls are coalesced into one `ApplicationRef.tick()`, scheduled with an explicit delay.
 */
@Service()
export class RenderScheduler {
  private readonly appRef = inject(ApplicationRef);
  private timer: ReturnType<typeof setTimeout> | null = null;

  request(): void {
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.appRef.tick();
    }, 0);
  }
}
