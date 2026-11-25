// An online update's assets (docs/updates.md): the files its pack brought stay inside the pack, one
// file on the SD card (update/assets-<hash>.pack), and are read from it in place. Before the update's
// code runs, fetch() is wrapped so the app's relative URLs for those files ('sprites/champions-2.png')
// get their bytes out of the pack; every other asset still comes from the .nro's RomFS. The app's own
// fetch wrappers (bundled-showdown.ts) are installed after this one and call it, so the pack can
// replace a bundled Showdown file too.

import { assetKey, UPDATE_DIR, type UpdateState } from '../update/boot-state';
import { files, readPackContents } from '../update/update-files';

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  json: 'application/json',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  ttf: 'font/ttf',
  woff2: 'font/woff2',
  txt: 'text/plain',
};

function contentType(path: string): string {
  return TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

/** The update's pack is on the SD card (one stat: its files were checked when it was downloaded). */
export function packPresent(state: UpdateState): boolean {
  if (!state.pack) return true;
  try {
    return (files()?.statSync(`${UPDATE_DIR}${state.pack}`)?.size ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Sends the app's requests for the packed files to the pack. Returns how many files it serves. */
export async function servePack(state: UpdateState): Promise<number> {
  const api = files();
  if (!state.pack || !api) return 0;
  const path = `${UPDATE_DIR}${state.pack}`;
  const contents = await readPackContents(api, path);
  const pack = api.file(path);
  const original = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const key = assetKey(input);
    const entry = key === null ? undefined : contents.get(key);
    if (!entry || key === null) return original(input, init);
    return pack
      .slice(entry.start, entry.start + entry.size)
      .arrayBuffer()
      .then((bytes) => new Response(bytes, { status: 200, headers: { 'content-type': contentType(key) } }));
  };
  return contents.size;
}
