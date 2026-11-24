// An online update's assets (docs/updates.md): the files its pack brought live on the SD card, in
// update/assets-<hash>/ at their RomFS paths. Before the update's code runs, fetch() is wrapped so
// the app's relative URLs for those files ('sprites/champions-2.png') read the SD card's copy; every
// other asset still comes from the .nro's RomFS. The app's own fetch wrappers (bundled-showdown.ts)
// are installed after this one and call it, so the pack can replace a bundled Showdown file too.

import { assetKey, nxFiles, UPDATE_DIR, type UpdateState } from '../update/boot-state';

/** The first of the update's packed files missing on the SD card, or null when they're all there. */
export function missingAsset(state: UpdateState): string | null {
  if (!state.packed?.length) return null;
  if (!state.assetsDir) return 'its assets folder';
  const stat = nxFiles?.statSync;
  if (!stat) return null;
  for (const path of state.packed) {
    try {
      if (!stat(`${UPDATE_DIR}${state.assetsDir}/${path}`)) return path;
    } catch {
      return path;
    }
  }
  return null;
}

/** Sends the app's requests for the packed files to their SD card copies. */
export function redirectAssets(state: UpdateState): void {
  if (!state.packed?.length || !state.assetsDir) return;
  const dir = `${UPDATE_DIR}${state.assetsDir}/`;
  const packed = new Set(state.packed);
  const original = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const key = assetKey(input);
    return original(key !== null && packed.has(key) ? `${dir}${key}` : input, init);
  };
}
