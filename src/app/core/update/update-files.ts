import { isAssetPath, UPDATE_DIR } from '../../../../native/update/boot-state';

/**
 * The SD card side of the online updates (docs/updates.md): downloads streamed to files and checked
 * as they arrive, the asset pack unpacked into a folder, and clean-up. Only on the console (the
 * engine's Switch file API).
 */

/** The parts of the engine's Switch API the updater uses. */
export interface UpdateFiles {
  readFileSync(path: string): ArrayBuffer | null;
  writeFileSync(path: string, data: string | ArrayBuffer): void;
  writeFile?(path: string, data: ArrayBuffer): Promise<void>;
  appendFileSync(path: string, data: string): void;
  mkdirSync(path: string): void;
  renameSync(from: string, to: string): void;
  removeSync(path: string): void;
  statSync(path: string): { size: number; mode: number } | null;
  readDirSync(path: string): string[] | null;
  file(path: string): NxFile;
}

interface NxFile {
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
  readonly writable: WritableStream<Uint8Array>;
}

/** A release's asset list (scripts/build-nro.mjs, assetIndex), and the .nro's own (romfs:/assets.json). */
export interface AssetIndex {
  version: string;
  engine: string;
  assetsId: string;
  /** RomFS path → sha256. */
  files: Record<string, string>;
  /** The paths the release's pack carries. */
  packed: string[];
}

/** A release's asset pack, as update.json describes it. */
export interface PackInfo {
  file: string;
  size: number;
  blockSize: number;
  /** Each block's sha256, in order: the download is checked as it arrives. */
  blocks: string[];
}

const PACK_MAGIC = 'PSBPACK1';
const LOG_PATH = 'sdmc:/switch/pokemon-showdown-nx/native.log';

export function files(): UpdateFiles | null {
  const api = (globalThis as { Switch?: Partial<UpdateFiles> }).Switch;
  return typeof api?.renameSync === 'function' && typeof api.file === 'function' && typeof api.statSync === 'function' ? (api as UpdateFiles) : null;
}

export function log(line: string): void {
  try {
    files()?.appendFileSync(LOG_PATH, `[update] ${line}\n`);
  } catch {
    // Best effort.
  }
}

/** The .nro's own asset list, or null for a .nro built before asset packs (it has none). */
export function ownAssetIndex(api: UpdateFiles): AssetIndex | null {
  try {
    const raw = api.readFileSync('romfs:/assets.json');
    return raw ? (JSON.parse(new TextDecoder().decode(raw)) as AssetIndex) : null;
  } catch {
    return null;
  }
}

/**
 * Why a release can't run on this .nro, or null when it can: the same engine, and each asset its code
 * expects is in this RomFS (same hash) or in its pack. A .nro from before asset packs (no list) takes
 * only a release made for exactly its assets, with no pack.
 */
export function incompatibility(own: AssetIndex | null, ownAssetsId: string, target: AssetIndex, pack: PackInfo | undefined): string | null {
  if (!own) return target.assetsId === ownAssetsId && !pack ? null : 'this .nro has no asset list (older than asset packs)';
  if (own.engine !== target.engine) return 'another engine';
  if (target.packed.length > 0 && !pack) return 'its pack is missing';
  const packed = new Set(target.packed);
  for (const [name, hash] of Object.entries(target.files)) {
    if (own.files[name] !== hash && !packed.has(name)) return `${name} differs and isn't in its pack`;
  }
  return null;
}

export async function sha256(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The folder a pack is unpacked into ('assets-<hash>.pack' → 'assets-<hash>'). */
export function packDir(pack: PackInfo): string {
  return pack.file.replace(/\.pack$/, '');
}

/** The pack's files are already unpacked on the SD card (the previous update had the same pack). */
export function packInstalled(api: UpdateFiles, pack: PackInfo, packed: readonly string[]): boolean {
  const dir = `${UPDATE_DIR}${packDir(pack)}/`;
  return packed.every((path) => api.statSync(`${dir}${path}`) !== null);
}

/**
 * Downloads `url` straight to `path` (never all in memory: a pack may be tens of MB), checking each
 * `blockSize` block against its sha256 as it arrives (test u4: 4 MiB blocks, ~1.7 MiB/s).
 */
export async function downloadChecked(api: UpdateFiles, url: string, path: string, pack: PackInfo, progress: (received: number) => void): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.split('/').pop()}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('the engine gave no download stream');
  const writer = api.file(path).writable.getWriter();
  let block = new Uint8Array(pack.blockSize);
  let filled = 0;
  let index = 0;
  let received = 0;
  const flush = async (): Promise<void> => {
    const data = block.subarray(0, filled);
    if ((await sha256(data)) !== pack.blocks[index]) throw new Error(`block ${index} of the pack doesn't match`);
    await writer.write(data);
    index++;
    filled = 0;
    block = new Uint8Array(pack.blockSize);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > pack.size) throw new Error('the pack is bigger than its manifest says');
      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(pack.blockSize - filled, value.byteLength - offset);
        block.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === pack.blockSize) await flush();
      }
      progress(received);
    }
    if (filled > 0) await flush();
  } finally {
    await writer.close().catch(() => undefined);
  }
  if (received !== pack.size || index !== pack.blocks.length) throw new Error(`the pack has ${received} bytes, not ${pack.size}`);
}

/**
 * Unpacks a checked pack into UPDATE_DIR/<dir>/ (files at their RomFS paths), writing into a .part
 * folder renamed at the end, so the loader never sees half of it. Its files must be the ones the
 * release's asset list says it packed.
 */
export async function unpack(api: UpdateFiles, packPath: string, dir: string, packed: readonly string[]): Promise<void> {
  const file = api.file(packPath);
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(head.subarray(0, 8)) !== PACK_MAGIC) throw new Error('not an asset pack');
  const headerLength = new DataView(head.buffer, head.byteOffset).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(await file.slice(12, 12 + headerLength).arrayBuffer())) as { files: { path: string; offset: number; size: number }[] };
  const start = 12 + headerLength;
  const expected = new Set(packed);
  if (header.files.length !== expected.size || !header.files.every((entry) => expected.has(entry.path) && isAssetPath(entry.path))) {
    throw new Error("the pack's files aren't the ones its asset list names");
  }
  const target = `${UPDATE_DIR}${dir}`;
  const partial = `${target}.part`;
  removeTree(api, partial);
  makeDirs(api, partial);
  for (const entry of header.files) {
    const bytes = await file.slice(start + entry.offset, start + entry.offset + entry.size).arrayBuffer();
    if (bytes.byteLength !== entry.size) throw new Error(`${entry.path} is cut short in the pack`);
    const path = `${partial}/${entry.path}`;
    makeDirs(api, path.slice(0, path.lastIndexOf('/')));
    if (api.writeFile) await api.writeFile(path, bytes);
    else api.writeFileSync(path, bytes);
  }
  removeTree(api, target);
  api.renameSync(partial, target);
}

/** Creates a folder and the ones above it inside UPDATE_DIR. */
function makeDirs(api: UpdateFiles, path: string): void {
  const inside = path.slice(UPDATE_DIR.length).split('/').filter(Boolean);
  let current = UPDATE_DIR.slice(0, -1);
  for (const part of [null, ...inside]) {
    if (part) current += `/${part}`;
    try {
      api.mkdirSync(current);
    } catch {
      // Already there.
    }
  }
}

/** Removes a file, or a folder with everything in it (nothing when it isn't there). */
export function removeTree(api: UpdateFiles, path: string): void {
  const stat = api.statSync(path);
  if (!stat) return;
  if ((stat.mode & 0o170000) === 0o040000) {
    for (const name of api.readDirSync(path) ?? []) removeTree(api, `${path}/${name}`);
  }
  try {
    api.removeSync(path);
  } catch {
    // Best effort: an orphan file only takes space.
  }
}

export function removeQuietly(api: UpdateFiles, path: string): void {
  try {
    api.removeSync(path);
  } catch {
    // Not there.
  }
}

export function readText(api: UpdateFiles, path: string): string | null {
  try {
    const raw = api.readFileSync(path);
    return raw ? new TextDecoder().decode(raw).trim() : null;
  } catch {
    return null;
  }
}
