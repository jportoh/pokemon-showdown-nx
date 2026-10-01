import { Service, signal } from '@angular/core';

/**
 * Whether the loading screen has made the app's images ahead (once per launch). Kept apart from the
 * screen itself so the home route's guard doesn't pull the Champions data into the main bundle.
 */
@Service()
export class AssetPreload {
  readonly finished = signal(false);
}
