// JSON persistence that never throws. On the console, each key is also a JSON file on the SD card,
// written through the engine's `Switch` file API (nx.js), so it survives anything that happens to
// localStorage. The file
// wins when reading; localStorage is the fallback, and the only storage in a regular browser.
// Storage can also be unavailable (private modes, restricted webviews), full, or hold data written
// by an older version.

/** The parts of the console's `Switch` global used here. */
interface SwitchFileApi {
  readFileSync(path: string): ArrayBuffer | string | null;
  writeFileSync(path: string, data: string): void;
  removeSync?(path: string): void;
}

/** A folder of our own, next to the .nro, so app updates never touch it. */
const DATA_DIR = 'sdmc:/switch/pokemon-showdown-nx/';
/**
 * Where the files were kept before (when the app was also built for the Brewser browser). A key read
 * that has no file yet in DATA_DIR is looked for there, and copied over once found.
 */
const LEGACY_DATA_DIR = 'sdmc:/switch/pokemon-showdown-brewser/';

export function readJson<T>(key: string, fallback: T): T {
  const files = switchFiles();
  if (files) {
    const text = readFile(files, key);
    if (text !== null) {
      try {
        return JSON.parse(text) as T;
      } catch {
        // A broken file (say, the console lost power mid-write) falls back to localStorage.
      }
    }
  }
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Returns false when the value couldn't be stored anywhere. */
export function writeJson(key: string, value: unknown): boolean {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    return false;
  }
  let saved = false;
  const files = switchFiles();
  if (files) {
    try {
      files.writeFileSync(filePath(key), text);
      saved = true;
    } catch {
      // No permission or no space: localStorage may still take it.
    }
  }
  try {
    localStorage.setItem(key, text);
    saved = true;
  } catch {
    // Unavailable or full.
  }
  return saved;
}

/**
 * Private values (a saved password) go ONLY to the app's file on the SD card, never to localStorage.
 * Without the console's file API (a regular browser) they can't be
 * kept at all.
 */
export function canStorePrivately(): boolean {
  return switchFiles() !== null;
}

export function readPrivateJson<T>(key: string, fallback: T): T {
  const files = switchFiles();
  const text = files ? readFile(files, key) : null;
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Returns false when the value couldn't be stored (no file API, no permission or no space). */
export function writePrivateJson(key: string, value: unknown): boolean {
  const files = switchFiles();
  if (!files) return false;
  try {
    files.writeFileSync(filePath(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Deletes a private value's file (or empties it, where files can't be deleted). */
export function removePrivate(key: string): void {
  const files = switchFiles();
  if (!files) return;
  for (const path of [filePath(key), filePath(key, LEGACY_DATA_DIR)]) {
    try {
      if (files.removeSync) files.removeSync(path);
      else files.writeFileSync(path, 'null');
    } catch {
      // Already gone, or not writable: nothing more to do.
    }
  }
}

function switchFiles(): SwitchFileApi | null {
  const api = (globalThis as { Switch?: Partial<SwitchFileApi> }).Switch;
  return typeof api?.readFileSync === 'function' && typeof api.writeFileSync === 'function' ? (api as SwitchFileApi) : null;
}

/** "psb.teams.v1" → "sdmc:/switch/pokemon-showdown-nx/psb.teams.v1.json" */
function filePath(key: string, dir = DATA_DIR): string {
  return `${dir}${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
}

/**
 * The key's file's text, or null when it doesn't exist or can't be read. A key with no file yet in
 * DATA_DIR is read from LEGACY_DATA_DIR and copied over (the old file is left as it was).
 */
function readFile(files: SwitchFileApi, key: string): string | null {
  const text = readPath(files, filePath(key));
  if (text !== null) return text;
  const legacy = readPath(files, filePath(key, LEGACY_DATA_DIR));
  if (legacy === null || legacy === 'null') return null;
  try {
    files.writeFileSync(filePath(key), legacy);
  } catch {
    // Not writable: it's read from the old folder again next time.
  }
  return legacy;
}

function readPath(files: SwitchFileApi, path: string): string | null {
  try {
    const contents = files.readFileSync(path);
    if (typeof contents === 'string') return contents;
    return contents ? new TextDecoder().decode(contents) : null;
  } catch {
    return null;
  }
}
