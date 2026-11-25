import { compareVersions, isAssetPath, PACK_FILE, UPDATE_DIR, writeState, type UpdateState } from './boot-state';
import { ownNroPath, readNroState, SWITCH_DIR, versionOfName, writeNroState } from './nro-files';
import { CHANNEL_OVERRIDE_PATH, manifestUrl, siblingUrl, UPDATE_PUBLIC_KEY } from './update-config';
import {
  AssetIndex,
  downloadChecked,
  incompatibility,
  log,
  ownAssetIndex,
  PackInfo,
  readPackContents,
  readText,
  removeQuietly,
  sha256,
  UpdateFiles,
} from './update-files';

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
  /** The release's .nro (pokemon-showdown-v<version>.nro), for a .nro whose loader can't run this code. */
  nro?: PackInfo;
}

/** What the gate shows while the updater works. */
export type UpdateProgress =
  | { kind: 'checking' }
  | { kind: 'downloading'; version: string; received: number; total: number }
  | { kind: 'downloading-nro'; version: string; received: number; total: number }
  | { kind: 'installing'; version: string };

/** What the check found (a failure to check at all throws). */
export type UpdateResult =
  /** Nothing newer than the code this console has. */
  | { kind: 'up-to-date'; latest: string }
  /** Downloaded and recorded in state.json: the loader runs it now. */
  | { kind: 'installed'; version: string }
  /** The latest version can't run on this .nro (another engine or loader, assets its pack doesn't bring), and its .nro can't be downloaded. */
  | { kind: 'needs-nro'; version: string; reason: string }
  /** Its .nro is downloaded next to this one: the player opens it once from the Homebrew Menu. */
  | { kind: 'nro-downloaded'; version: string; path: string }
  /** The latest version is the one on the SD card, which didn't start well here. */
  | { kind: 'start-failed'; version: string; reason: string };

/** What the console has: the .nro's version and fingerprint, and the update on the SD card. */
export interface LocalCode {
  /** The newest version the loader would run (the .nro's or a working update's). */
  version: string;
  assetsId: string;
  state: UpdateState | null;
}

const MANIFEST_TIMEOUT_MS = 10000;
const BUNDLE_TIMEOUT_MS = 120000;
/** A pack streams at ~1.7 MiB/s (test u4): this allows ~150 MB. */
const PACK_TIMEOUT_MS = 30 * 60 * 1000;
/** An app bundle is ~2 MB; anything far bigger isn't one. */
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_PACK_BYTES = 512 * 1024 * 1024;
const MAX_NRO_BYTES = 1024 * 1024 * 1024;

/**
 * Online updates (docs/updates.md), run by the update gate before the app starts: reads the latest
 * release's manifest and checks its signature; for a newer version that can run on this .nro (the
 * same engine and loader, and each asset its code expects in this RomFS or in its pack), downloads
 * the pack (checked block by block, kept whole) and the code bundle, and records them in state.json.
 * `retryFailed`: the player asked to download again a version that didn't start well.
 */
export async function checkAndUpdate(api: UpdateFiles, local: LocalCode, retryFailed: boolean, progress: (step: UpdateProgress) => void): Promise<UpdateResult> {
  progress({ kind: 'checking' });
  const begun = performance.now();
  const override = readText(api, CHANNEL_OVERRIDE_PATH);
  const manifestAt = manifestUrl(override);
  if (override) log(`test channel: ${manifestAt}`);
  const [manifestBytes, signatureText] = await Promise.all([
    withTimeout(fetchBytes(manifestAt), MANIFEST_TIMEOUT_MS, 'version check'),
    withTimeout(fetchBytes(`${manifestAt}.sig`), MANIFEST_TIMEOUT_MS, 'version check').then((bytes) => new TextDecoder().decode(bytes).trim()),
  ]);
  if (!(await verifySignature(manifestBytes, signatureText))) throw new Error('the version file has no valid signature');
  const manifest = parseManifest(manifestBytes);
  log(`latest ${manifest.version} (this console has ${local.version}, ${(performance.now() - begun).toFixed(0)} ms)`);
  if (compareVersions(manifest.version, local.version) <= 0) return { kind: 'up-to-date', latest: manifest.version };

  const state = local.state;
  if (state?.version === manifest.version && state.assetsId === local.assetsId && state.failed && !retryFailed) {
    return { kind: 'start-failed', version: manifest.version, reason: state.failed };
  }

  // Can it run on this .nro? Its asset list says what its code expects.
  const indexBytes = await withTimeout(fetchBytes(siblingUrl(manifestAt, manifest.index.file)), MANIFEST_TIMEOUT_MS, 'asset list');
  if (indexBytes.byteLength !== manifest.index.size || (await sha256(indexBytes)) !== manifest.index.sha256) throw new Error("the asset list doesn't match its manifest");
  const target = parseIndex(indexBytes, manifest);
  const reason = incompatibility(ownAssetIndex(api), target, manifest.pack);
  if (reason) {
    log(`${manifest.version} needs a new .nro: ${reason}`);
    if (!manifest.nro) return { kind: 'needs-nro', version: manifest.version, reason };
    const path = await downloadNro(api, manifestAt, manifest, manifest.nro, progress);
    return { kind: 'nro-downloaded', version: manifest.version, path };
  }

  makeUpdateDir(api);
  const pack = manifest.pack;
  const total = (pack?.size ?? 0) + manifest.size;
  const report = (received: number) => progress({ kind: 'downloading', version: manifest.version, received, total });
  report(0);
  if (pack) {
    const packPath = `${UPDATE_DIR}${pack.file}`;
    // Named after its hash and renamed into place only once complete and checked: one already there is this one.
    if (api.statSync(packPath)?.size !== pack.size) {
      const partial = `${packPath}.part`;
      try {
        await withTimeout(downloadChecked(api, siblingUrl(manifestAt, pack.file), partial, pack, report), PACK_TIMEOUT_MS, 'asset pack');
        removeQuietly(api, packPath);
        api.renameSync(partial, packPath);
      } finally {
        removeQuietly(api, partial);
      }
      log(`${manifest.version}: asset pack ${pack.file} downloaded (${target.packed.length} files, ${(pack.size / 1048576).toFixed(1)} MiB)`);
    }
    const contents = await readPackContents(api, packPath);
    if (contents.size !== target.packed.length || !target.packed.every((path) => contents.has(path))) {
      removeQuietly(api, packPath);
      throw new Error("the pack's files aren't the ones its asset list names");
    }
  }
  const done = pack?.size ?? 0;
  const bundle = await withTimeout(
    fetchBytes(siblingUrl(manifestAt, manifest.file), (received) => report(done + received)),
    BUNDLE_TIMEOUT_MS,
    'code download',
  );
  if (bundle.byteLength !== manifest.size) throw new Error(`the code has ${bundle.byteLength} bytes, not ${manifest.size}`);
  if ((await sha256(bundle)) !== manifest.sha256) throw new Error("the code doesn't match its manifest");
  progress({ kind: 'installing', version: manifest.version });
  await install(api, manifest, bundle, local.assetsId, state);
  log(`${manifest.version} installed (${(total / 1048576).toFixed(1)} MiB, ${(performance.now() - begun).toFixed(0)} ms)`);
  return { kind: 'installed', version: manifest.version };
}

/**
 * Downloads the release's .nro to sdmc:/switch/pokemon-showdown-v<version>.nro (as .part, each block
 * checked, renamed when complete: the Homebrew Menu never lists half of one) and notes it in
 * nro.json with the path the forwarder opens (this .nro's, unless it's a versioned one itself).
 */
async function downloadNro(api: UpdateFiles, manifestAt: string, manifest: Manifest, nro: PackInfo, progress: (step: UpdateProgress) => void): Promise<string> {
  const path = `${SWITCH_DIR}${nro.file}`;
  if (api.statSync(path)?.size !== nro.size) {
    const partial = `${path}.part`;
    const begun = performance.now();
    const report = (received: number) => progress({ kind: 'downloading-nro', version: manifest.version, received, total: nro.size });
    report(0);
    try {
      await withTimeout(downloadChecked(api, siblingUrl(manifestAt, nro.file), partial, nro, report), PACK_TIMEOUT_MS, 'new .nro');
      removeQuietly(api, path);
      api.renameSync(partial, path);
    } finally {
      removeQuietly(api, partial);
    }
    log(`.nro ${manifest.version} downloaded to ${path} (${(nro.size / 1048576).toFixed(1)} MiB, ${(performance.now() - begun).toFixed(0)} ms)`);
  }
  const own = ownNroPath();
  const stable = own && !versionOfName(own) ? own : readNroState(api).stable;
  writeNroState(api, { ...(stable ? { stable } : {}), downloaded: { version: manifest.version, path } });
  return path;
}

/**
 * Writes the bundle under a temporary name, renames it (a half-written file is never taken for a
 * bundle), then points state.json at it and its pack, and removes the previous update's files.
 */
async function install(api: UpdateFiles, manifest: Manifest, bundle: ArrayBuffer, assetsId: string, previous: UpdateState | null): Promise<void> {
  const path = `${UPDATE_DIR}${manifest.file}`;
  const partial = `${path}.part`;
  if (api.writeFile) await api.writeFile(partial, bundle);
  else api.writeFileSync(partial, bundle);
  removeQuietly(api, path);
  api.renameSync(partial, path);
  const pack = manifest.pack?.file;
  writeState({ version: manifest.version, file: manifest.file, assetsId, bootAttempts: 0, ...(pack ? { pack } : {}) });
  if (previous && previous.file !== manifest.file) removeQuietly(api, `${UPDATE_DIR}${previous.file}`);
  if (previous?.pack && previous.pack !== pack) removeQuietly(api, `${UPDATE_DIR}${previous.pack}`);
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
        PACK_FILE.test(pack.file) &&
        typeof pack.size === 'number' &&
        pack.size > 0 &&
        pack.size <= MAX_PACK_BYTES &&
        typeof pack.blockSize === 'number' &&
        pack.blockSize >= 65536 &&
        Array.isArray(pack.blocks) &&
        pack.blocks.length === Math.ceil(pack.size / pack.blockSize) &&
        pack.blocks.every((block) => typeof block === 'string' && SHA.test(block)))) &&
    (value.nro === undefined || (value.nro.file === `pokemon-showdown-v${value.version}.nro` && validBlocks(value.nro, MAX_NRO_BYTES)));
  if (!valid) throw new Error('the version file is not valid');
  return value as Manifest;
}

function validBlocks(file: PackInfo, maxBytes: number): boolean {
  return (
    typeof file.size === 'number' &&
    file.size > 0 &&
    file.size <= maxBytes &&
    typeof file.blockSize === 'number' &&
    file.blockSize >= 65536 &&
    Array.isArray(file.blocks) &&
    file.blocks.length === Math.ceil(file.size / file.blockSize) &&
    file.blocks.every((block) => typeof block === 'string' && SHA.test(block))
  );
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
