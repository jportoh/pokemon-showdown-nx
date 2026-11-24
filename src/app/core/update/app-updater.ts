import { Service, effect, inject, signal } from '@angular/core';
import { AssetPreload } from '@core/gl/asset-preload';
import { codeSource } from '@core/runtime/code-source';
import { compareVersions, isAssetPath, readState, UPDATE_DIR, writeState, type UpdateState } from '../../../../native/update/boot-state';
import { CHANNEL_OVERRIDE_PATH, manifestUrl, siblingUrl, UPDATE_PUBLIC_KEY } from './update-config';
import {
  AssetIndex,
  downloadChecked,
  files,
  incompatibility,
  log,
  ownAssetIndex,
  PackInfo,
  packDir,
  packInstalled,
  readText,
  removeQuietly,
  removeTree,
  sha256,
  unpack,
  UpdateFiles,
} from './update-files';

/** What the updater is doing, or found. */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'downloading'; version: string; received: number; total: number }
  /** On the SD card: the loader runs it from the next start. */
  | { kind: 'ready'; version: string }
  /** A newer version that needs a new .nro (another engine, or assets its pack doesn't bring). */
  | { kind: 'needs-nro'; version: string }
  | { kind: 'failed'; reason: string }
  /** The player went back to the .nro's code: from the next start. */
  | { kind: 'set-aside'; version: string };

/** A release's update.json (scripts/build-nro.mjs, writeUpdate). */
interface Manifest {
  version: string;
  file: string;
  size: number;
  sha256: string;
  engine: string;
  assetsId: string;
  index: { file: string; size: number; sha256: string };
  pack?: PackInfo;
}

/**
 * After the loading screen: on the entry screen the main thread is mostly idle, so the check's TLS
 * handshakes (~100 ms each on the console's main thread) don't hold back the loading.
 */
const AFTER_LOADING_MS = 1000;
const MANIFEST_TIMEOUT_MS = 20000;
const BUNDLE_TIMEOUT_MS = 120000;
/** A pack streams at ~1.7 MiB/s (test u4): this allows ~150 MB. */
const PACK_TIMEOUT_MS = 30 * 60 * 1000;
/** An app bundle is ~2 MB; anything far bigger isn't one. */
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_PACK_BYTES = 512 * 1024 * 1024;

/**
 * Online updates (docs/updates.md). Once per start, after the loading screen, in the background, it
 * reads the latest release's manifest and checks its signature. For a newer version that can run on
 * this .nro (the same engine, and each asset its code expects either in this RomFS or in its asset
 * pack), it downloads the pack (checked block by block, unpacked on the SD card) and the code bundle,
 * and leaves them for the loader to run at the next start. Only on the console (the .nro's loader
 * sets codeSource).
 */
@Service()
export class AppUpdater {
  private readonly preload = inject(AssetPreload);
  private readonly statusSignal = signal<UpdateStatus>({ kind: 'idle' });
  readonly status = this.statusSignal.asReadonly();
  private started = false;

  constructor() {
    if (!codeSource() || !files()) return;
    effect(() => {
      if (this.preload.finished() && !this.started) setTimeout(() => this.start(), AFTER_LOADING_MS);
    });
  }

  /**
   * The player wants the .nro's own code back: the update is set aside (never downloaded again; a
   * newer version still is) and the next start runs the .nro's code.
   */
  setAside(): void {
    const state = readState();
    if (!state || state.failed) return;
    writeState({ ...state, failed: 'set aside by the player' });
    log(`update ${state.version} set aside by the player`);
    this.statusSignal.set({ kind: 'set-aside', version: state.version });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    void this.check().catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      log(`check failed: ${reason}`);
      this.statusSignal.set({ kind: 'failed', reason });
    });
  }

  private async check(): Promise<void> {
    const running = codeSource();
    const api = files();
    if (!running || !api) return;
    this.statusSignal.set({ kind: 'checking' });
    const begun = performance.now();
    const override = readText(api, CHANNEL_OVERRIDE_PATH);
    const manifestAt = manifestUrl(override);
    if (override) log(`test channel: ${manifestAt}`);
    const [manifestBytes, signatureText] = await Promise.all([
      withTimeout(fetchBytes(manifestAt), MANIFEST_TIMEOUT_MS, 'manifest'),
      withTimeout(fetchBytes(`${manifestAt}.sig`), MANIFEST_TIMEOUT_MS, 'signature').then((bytes) => new TextDecoder().decode(bytes).trim()),
    ]);
    if (!(await verifySignature(manifestBytes, signatureText))) throw new Error('the manifest signature is not valid');
    const manifest = parseManifest(manifestBytes);
    log(`latest ${manifest.version} (running ${running.version}, ${(performance.now() - begun).toFixed(0)} ms)`);
    if (compareVersions(manifest.version, running.version) <= 0) {
      this.statusSignal.set({ kind: 'up-to-date' });
      return;
    }

    const state = readState();
    if (state?.version === manifest.version && state.assetsId === running.assetsId) {
      if (state.failed) log(`${manifest.version} not downloaded again: ${state.failed}`);
      this.statusSignal.set(state.failed ? { kind: 'up-to-date' } : { kind: 'ready', version: manifest.version });
      return;
    }

    // Can it run on this .nro? Its asset list says what its code expects.
    const indexBytes = await withTimeout(fetchBytes(siblingUrl(manifestAt, manifest.index.file)), MANIFEST_TIMEOUT_MS, 'asset list');
    if (indexBytes.byteLength !== manifest.index.size || (await sha256(indexBytes)) !== manifest.index.sha256) throw new Error("the asset list doesn't match its manifest");
    const target = parseIndex(indexBytes, manifest);
    const reason = incompatibility(ownAssetIndex(api), running.assetsId, target, manifest.pack);
    if (reason) {
      log(`${manifest.version} needs a new .nro: ${reason}`);
      this.statusSignal.set({ kind: 'needs-nro', version: manifest.version });
      return;
    }

    makeUpdateDir(api);
    const pack = manifest.pack;
    const total = (pack?.size ?? 0) + manifest.size;
    const progress = (received: number) => this.statusSignal.set({ kind: 'downloading', version: manifest.version, received, total });
    progress(0);
    if (pack && !packInstalled(api, pack, target.packed)) {
      const packPath = `${UPDATE_DIR}${pack.file}.part`;
      try {
        await withTimeout(downloadChecked(api, siblingUrl(manifestAt, pack.file), packPath, pack, progress), PACK_TIMEOUT_MS, 'asset pack');
        await unpack(api, packPath, packDir(pack), target.packed);
        log(`${manifest.version}: asset pack ${pack.file} unpacked (${target.packed.length} files, ${(pack.size / 1048576).toFixed(1)} MiB)`);
      } finally {
        removeQuietly(api, packPath);
      }
    }
    const done = pack?.size ?? 0;
    const bundle = await withTimeout(
      fetchBytes(siblingUrl(manifestAt, manifest.file), (received) => progress(done + received)),
      BUNDLE_TIMEOUT_MS,
      'bundle',
    );
    if (bundle.byteLength !== manifest.size) throw new Error(`the bundle has ${bundle.byteLength} bytes, not ${manifest.size}`);
    if ((await sha256(bundle)) !== manifest.sha256) throw new Error("the bundle doesn't match its manifest");
    await install(api, manifest, bundle, target, running.assetsId, state);
    log(`${manifest.version} downloaded (${((total) / 1048576).toFixed(1)} MiB, ${(performance.now() - begun).toFixed(0)} ms): runs from the next start`);
    this.statusSignal.set({ kind: 'ready', version: manifest.version });
  }
}

/**
 * Writes the bundle under a temporary name, renames it (a half-written file is never taken for a
 * bundle), then points state.json at it and its assets, and removes the previous update's files. The
 * running code and the assets it already read don't need theirs any more.
 */
async function install(api: UpdateFiles, manifest: Manifest, bundle: ArrayBuffer, target: AssetIndex, assetsId: string, previous: UpdateState | null): Promise<void> {
  const path = `${UPDATE_DIR}${manifest.file}`;
  const partial = `${path}.part`;
  if (api.writeFile) await api.writeFile(partial, bundle);
  else api.writeFileSync(partial, bundle);
  removeQuietly(api, path);
  api.renameSync(partial, path);
  const assetsDir = manifest.pack ? packDir(manifest.pack) : undefined;
  writeState({ version: manifest.version, file: manifest.file, assetsId, bootAttempts: 0, ...(assetsDir ? { assetsDir, packed: target.packed } : {}) });
  if (previous && previous.file !== manifest.file) removeQuietly(api, `${UPDATE_DIR}${previous.file}`);
  if (previous?.assetsDir && previous.assetsDir !== assetsDir) removeTree(api, `${UPDATE_DIR}${previous.assetsDir}`);
}

function makeUpdateDir(api: UpdateFiles): void {
  try {
    api.mkdirSync(UPDATE_DIR);
  } catch {
    // Already there.
  }
}

const SHA = /^[0-9a-f]{64}$/;

function parseManifest(bytes: ArrayBuffer): Manifest {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Manifest>;
  const index = value.index;
  const pack = value.pack;
  const valid =
    typeof value.version === 'string' &&
    /^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(value.version) &&
    typeof value.file === 'string' &&
    /^app-[\w.+-]+\.mjs$/.test(value.file) &&
    typeof value.sha256 === 'string' &&
    SHA.test(value.sha256) &&
    typeof value.size === 'number' &&
    value.size > 0 &&
    value.size <= MAX_BUNDLE_BYTES &&
    typeof value.engine === 'string' &&
    typeof value.assetsId === 'string' &&
    typeof index?.file === 'string' &&
    /^assets-[\w.+-]+\.json$/.test(index.file) &&
    typeof index.size === 'number' &&
    index.size <= MAX_INDEX_BYTES &&
    typeof index.sha256 === 'string' &&
    SHA.test(index.sha256) &&
    (pack === undefined ||
      (typeof pack.file === 'string' &&
        /^assets-[0-9a-f]+\.pack$/.test(pack.file) &&
        typeof pack.size === 'number' &&
        pack.size > 0 &&
        pack.size <= MAX_PACK_BYTES &&
        typeof pack.blockSize === 'number' &&
        pack.blockSize >= 65536 &&
        Array.isArray(pack.blocks) &&
        pack.blocks.length === Math.ceil(pack.size / pack.blockSize) &&
        pack.blocks.every((block) => typeof block === 'string' && SHA.test(block))));
  if (!valid) throw new Error('the manifest is not valid');
  return value as Manifest;
}

function parseIndex(bytes: ArrayBuffer, manifest: Manifest): AssetIndex {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<AssetIndex>;
  const valid =
    value.engine === manifest.engine &&
    typeof value.files === 'object' &&
    value.files !== null &&
    Array.isArray(value.packed) &&
    value.packed.every((path) => isAssetPath(path) && typeof value.files?.[path] === 'string');
  if (!valid) throw new Error('the asset list is not valid');
  return value as AssetIndex;
}

async function verifySignature(message: ArrayBuffer, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', base64Bytes(UPDATE_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64Bytes(signature), message);
}

/** A URL's bytes, reporting progress as the chunks arrive when the engine streams the body. */
async function fetchBytes(url: string, progress?: (received: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.split('/').pop()}`);
  const reader = progress ? response.body?.getReader() : undefined;
  if (!reader || !progress) return response.arrayBuffer();
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    progress(received);
  }
  const joined = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined.buffer;
}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the ${what} took longer than ${ms / 1000} s`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
