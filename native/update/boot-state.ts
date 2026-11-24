// Shared by the loader (native/loader/main.ts) and the app (native/app/boot-confirm.ts): where an
// online update of the app's code lives on the SD card, and the record of which one to run.
//
//   sdmc:/switch/pokemon-showdown-nx/update/
//     app-<version>.mjs   the app's code bundle for that version (import() can't take a ?query, so
//                         the version goes in the name)
//     assets-<hash>/      the assets its pack brought, at their RomFS paths (docs/updates.md)
//     state.json          UpdateState: the bundle to run, its assets and how its starts went
//
// The updater (src/app/core/update) writes and checks the files, then state.json; the loader reads it.

export const UPDATE_DIR = 'sdmc:/switch/pokemon-showdown-nx/update/';
export const STATE_PATH = `${UPDATE_DIR}state.json`;
export const LOG_PATH = 'sdmc:/switch/pokemon-showdown-nx/native.log';

/**
 * Starts an update gets without confirming one: a start that didn't reach the app's first screen and
 * a few healthy seconds (it crashed, froze or the engine died) counts as failed. At this many the
 * loader stops trying it and runs the .nro's own code again.
 */
export const MAX_BOOT_ATTEMPTS = 2;

export interface UpdateState {
  /** The bundle's app version (semver, as in package.json). */
  version: string;
  /** Its file name inside UPDATE_DIR. */
  file: string;
  /**
   * The fingerprint (engine and assets) of the .nro the updater checked it against: every asset its
   * code expects is in that .nro's RomFS or in `assetsDir`. Another .nro (a newer one copied over)
   * doesn't run it.
   */
  assetsId: string;
  /** The folder in UPDATE_DIR with the assets its pack brought; `packed` lists their RomFS paths. */
  assetsDir?: string;
  packed?: string[];
  /** Starts tried since the last confirmed one. */
  bootAttempts: number;
  /** Set when the loader gave up on it: never tried again (a newer version replaces it). */
  failed?: string;
}

/** What the loader tells the app about the code that runs (globalThis.psbBoot). */
export interface BootInfo {
  /** The running code's version. */
  version: string;
  /** Where it came from: the .nro itself, or an update on the SD card. */
  source: 'romfs' | 'update';
  /** The .nro's own version and assets fingerprint. */
  builtInVersion: string;
  assetsId: string;
  /** Set by the app bundle's first module: from then on a failed import can't fall back. */
  evaluating?: boolean;
  /** The app calls it once it has started well: the update's start counter goes back to 0. */
  confirm(): void;
}

interface NxFiles {
  readFileSync(path: string): ArrayBuffer | null;
  writeFileSync(path: string, data: string | ArrayBuffer): void;
  appendFileSync(path: string, data: string): void;
  mkdirSync(path: string): void;
  removeSync?(path: string): void;
  statSync?(path: string): { size: number } | null;
}

/** A RomFS-relative asset path a pack may carry: plain segments, no way out of its folder. */
export function isAssetPath(value: unknown): value is string {
  return typeof value === 'string' && /^[\w.@+-]+(\/[\w.@+-]+)*$/.test(value) && !value.split('/').some((part) => part === '.' || part === '..');
}

/** An asset's path as the app asks for it ('sprites/x.png', './sprites/x.png', 'romfs:/sprites/x.png'), or null for a URL. */
export function assetKey(input: unknown): string | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : null;
  if (raw === null) return null;
  const path = raw.split(/[?#]/)[0].replace(/^romfs:\//, '').replace(/^\.?\//, '');
  return /^[a-z][a-z0-9+.-]*:/i.test(path) ? null : decodeURIComponent(path);
}

export const nxFiles = (globalThis as unknown as { Switch?: NxFiles }).Switch;

export function readState(): UpdateState | null {
  try {
    const raw = nxFiles?.readFileSync(STATE_PATH);
    if (!raw) return null;
    const state = JSON.parse(new TextDecoder().decode(raw)) as Partial<UpdateState>;
    if (typeof state.version !== 'string' || typeof state.file !== 'string' || typeof state.assetsId !== 'string') return null;
    if (!/^app-[\w.+-]+\.mjs$/.test(state.file)) return null;
    if (state.assetsDir !== undefined && !/^assets-[0-9a-f]+$/.test(state.assetsDir)) return null;
    if (state.packed !== undefined && (!Array.isArray(state.packed) || !state.packed.every(isAssetPath))) return null;
    return { ...state, bootAttempts: Number(state.bootAttempts) || 0 } as UpdateState;
  } catch {
    return null;
  }
}

export function writeState(state: UpdateState): void {
  try {
    nxFiles?.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {
    // Best effort: a missing write only means one more or one less try.
  }
}

/** Compares two semver versions: negative when a is older than b. A pre-release (-x) is older. */
export function compareVersions(a: string, b: string): number {
  const [coreA, preA = ''] = a.split('+')[0].split(/-(.*)/s);
  const [coreB, preB = ''] = b.split('+')[0].split(/-(.*)/s);
  const partsA = coreA.split('.').map(Number);
  const partsB = coreB.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff;
  }
  if (preA === preB) return 0;
  if (!preA) return 1;
  if (!preB) return -1;
  return preA < preB ? -1 : 1;
}

export function bootLog(line: string): void {
  try {
    nxFiles?.appendFileSync(LOG_PATH, `[ loader] ${line}\n`);
  } catch {
    // Best effort.
  }
}
