import { isAssetPath, LOG_PATH } from './boot-state';

/**
 * The SD card side of the online updates (docs/updates.md): downloads streamed to files and checked
 * as they arrive, the asset pack's table of contents, and clean-up. Only on the console (the
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

/** Where each file is in a pack: its RomFS path → its bytes' offset in the pack file and size. */
export type PackContents = Map<string, { start: number; size: number }>;

const PACK_MAGIC = 'PSBPACK1';

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
 * Why a release can't run on this .nro, or null when it can: the same engine (and loader), and each
 * asset its code expects is in this RomFS (same hash) or in its pack.
 */
export function incompatibility(own: AssetIndex | null, target: AssetIndex, pack: PackInfo | undefined): string | null {
  if (!own) return 'this .nro has no asset list';
  if (own.engine !== target.engine) return 'another engine or loader';
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
  const block = new Uint8Array(pack.blockSize);
  let filled = 0;
  let index = 0;
  let received = 0;
  const flush = async (): Promise<void> => {
    const data = block.subarray(0, filled);
    if ((await sha256(data)) !== pack.blocks[index]) throw new Error(`block ${index} of the pack doesn't match`);
    // Written before the block is reused (the write is awaited): one buffer for the whole download.
    await writer.write(data);
    index++;
    filled = 0;
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
 * A pack's table of contents (scripts/build-nro.mjs, buildPack: PACK_MAGIC, the header's length as
 * u32 LE, the header as JSON, then the files): read once, so its files are served in place, never
 * unpacked (writing thousands of small files to the SD card took minutes, v0.5.1).
 */
export async function readPackContents(api: UpdateFiles, path: string): Promise<PackContents> {
  const file = api.file(path);
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.byteLength !== 12 || new TextDecoder().decode(head.subarray(0, 8)) !== PACK_MAGIC) throw new Error('not an asset pack');
  const headerLength = new DataView(head.buffer, head.byteOffset).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(await file.slice(12, 12 + headerLength).arrayBuffer())) as { files?: unknown };
  if (!Array.isArray(header.files)) throw new Error("the pack's header is not valid");
  const base = 12 + headerLength;
  const contents: PackContents = new Map();
  for (const entry of header.files as { path?: unknown; offset?: unknown; size?: unknown }[]) {
    if (!isAssetPath(entry.path) || typeof entry.offset !== 'number' || typeof entry.size !== 'number') throw new Error("the pack's header is not valid");
    contents.set(entry.path, { start: base + entry.offset, size: entry.size });
  }
  return contents;
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
