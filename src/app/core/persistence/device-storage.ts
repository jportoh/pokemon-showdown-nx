// JSON persistence that never throws. On the Brewser console, each key is also a JSON file on the
// SD card, written through the runtime's `Switch` file API (nx.js; needs the app's file system
// read/write permission): localStorage didn't survive a full reload of the engine there. The file
// wins when reading; localStorage is the fallback, and the only storage in a regular browser.
// Storage can also be unavailable (private modes, restricted webviews), full, or hold data written
// by an older version.

/** The parts of the console's `Switch` global used here. */
interface SwitchFileApi {
  readFileSync(path: string): ArrayBuffer | string | null;
  writeFileSync(path: string, data: string): void;
}

/** A folder of our own, outside Brewser's, so app updates never touch it. */
const DATA_DIR = 'sdmc:/switch/pokemon-showdown-brewser/';

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

function switchFiles(): SwitchFileApi | null {
  const api = (globalThis as { Switch?: Partial<SwitchFileApi> }).Switch;
  return typeof api?.readFileSync === 'function' && typeof api.writeFileSync === 'function' ? (api as SwitchFileApi) : null;
}

/** "psb.teams.v1" → "sdmc:/switch/pokemon-showdown-brewser/psb.teams.v1.json" */
function filePath(key: string): string {
  return `${DATA_DIR}${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
}

/** The file's text, or null when it doesn't exist or can't be read. */
function readFile(files: SwitchFileApi, key: string): string | null {
  try {
    const contents = files.readFileSync(filePath(key));
    if (typeof contents === 'string') return contents;
    return contents ? new TextDecoder().decode(contents) : null;
  } catch {
    return null;
  }
}
