import { Service, effect, inject, signal } from '@angular/core';
import { AssetPreload } from '@core/gl/asset-preload';
import { codeSource } from '@core/runtime/code-source';
import { compareVersions, readState, UPDATE_DIR, writeState, type UpdateState } from '../../../../native/update/boot-state';
import { CHANNEL_OVERRIDE_PATH, manifestUrl, siblingUrl, UPDATE_PUBLIC_KEY } from './update-config';

/** What the updater is doing, or found. */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'downloading'; version: string; received: number; total: number }
  /** On the SD card: the loader runs it from the next start. */
  | { kind: 'ready'; version: string }
  /** A newer version that needs a new .nro (other engine or assets). */
  | { kind: 'needs-nro'; version: string }
  | { kind: 'failed'; reason: string };

/** A release's update.json (scripts/build-nro.mjs, writeUpdate). */
interface Manifest {
  version: string;
  file: string;
  assetsId: string;
  size: number;
  sha256: string;
}

/**
 * After the loading screen: on the entry screen the main thread is mostly idle, so the check's TLS
 * handshakes (~100 ms each on the console's main thread) don't hold back the loading.
 */
const AFTER_LOADING_MS = 1000;
const MANIFEST_TIMEOUT_MS = 20000;
const BUNDLE_TIMEOUT_MS = 120000;
/** An app bundle is ~2 MB; anything far bigger isn't one. */
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const LOG_PATH = 'sdmc:/switch/pokemon-showdown-nx/native.log';

interface UpdateFiles {
  readFileSync(path: string): ArrayBuffer | null;
  writeFileSync(path: string, data: string | ArrayBuffer): void;
  writeFile?(path: string, data: ArrayBuffer): Promise<void>;
  appendFileSync(path: string, data: string): void;
  mkdirSync(path: string): void;
  renameSync(from: string, to: string): void;
  removeSync(path: string): void;
}

/**
 * Online updates of the app's code (docs/updates.md). Once per start, after the loading screen, in
 * the background, it reads the latest release's manifest, checks its signature, and when it is a
 * newer version built for this .nro's assets, downloads the code bundle, checks its hash and leaves
 * it on the SD card for the loader to run at the next start. Only on the console (the .nro's loader
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
    this.statusSignal.set({ kind: 'up-to-date' });
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
    if (manifest.assetsId !== running.assetsId) {
      log(`${manifest.version} needs a new .nro (assets ${manifest.assetsId}, this .nro ${running.assetsId})`);
      this.statusSignal.set({ kind: 'needs-nro', version: manifest.version });
      return;
    }
    const state = readState();
    if (state?.version === manifest.version) {
      if (state.failed) {
        log(`${manifest.version} not downloaded again: ${state.failed}`);
        this.statusSignal.set({ kind: 'up-to-date' });
      } else {
        this.statusSignal.set({ kind: 'ready', version: manifest.version });
      }
      return;
    }

    this.statusSignal.set({ kind: 'downloading', version: manifest.version, received: 0, total: manifest.size });
    const bundle = await withTimeout(
      fetchBytes(siblingUrl(manifestAt, manifest.file), (received) => this.statusSignal.set({ kind: 'downloading', version: manifest.version, received, total: manifest.size })),
      BUNDLE_TIMEOUT_MS,
      'bundle',
    );
    if (bundle.byteLength !== manifest.size) throw new Error(`the bundle has ${bundle.byteLength} bytes, not ${manifest.size}`);
    if ((await sha256(bundle)) !== manifest.sha256) throw new Error("the bundle doesn't match its manifest");
    await install(api, manifest, bundle, state);
    log(`${manifest.version} downloaded (${(bundle.byteLength / 1024).toFixed(0)} KiB, ${(performance.now() - begun).toFixed(0)} ms): runs from the next start`);
    this.statusSignal.set({ kind: 'ready', version: manifest.version });
  }
}

/**
 * Writes the bundle under a temporary name, renames it (a half-written file is never taken for a
 * bundle), then points state.json at it and removes the previous update's file. A bundle already
 * loaded in memory doesn't need its file any more.
 */
async function install(api: UpdateFiles, manifest: Manifest, bundle: ArrayBuffer, previous: UpdateState | null): Promise<void> {
  try {
    api.mkdirSync(UPDATE_DIR);
  } catch {
    // Already there.
  }
  const target = `${UPDATE_DIR}${manifest.file}`;
  const partial = `${target}.part`;
  if (api.writeFile) await api.writeFile(partial, bundle);
  else api.writeFileSync(partial, bundle);
  removeQuietly(api, target);
  api.renameSync(partial, target);
  writeState({ version: manifest.version, file: manifest.file, assetsId: manifest.assetsId, bootAttempts: 0 });
  if (previous && previous.file !== manifest.file) removeQuietly(api, `${UPDATE_DIR}${previous.file}`);
}

function parseManifest(bytes: ArrayBuffer): Manifest {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Manifest>;
  const valid =
    typeof value.version === 'string' &&
    /^\d+\.\d+\.\d+([-+][\w.-]+)?$/.test(value.version) &&
    typeof value.file === 'string' &&
    /^app-[\w.+-]+\.mjs$/.test(value.file) &&
    typeof value.assetsId === 'string' &&
    typeof value.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    typeof value.size === 'number' &&
    value.size > 0 &&
    value.size <= MAX_BUNDLE_BYTES;
  if (!valid) throw new Error('the manifest is not valid');
  return value as Manifest;
}

async function verifySignature(message: ArrayBuffer, signature: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', base64Bytes(UPDATE_PUBLIC_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64Bytes(signature), message);
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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

function files(): UpdateFiles | null {
  const api = (globalThis as { Switch?: Partial<UpdateFiles> }).Switch;
  return typeof api?.renameSync === 'function' && typeof api.writeFileSync === 'function' ? (api as UpdateFiles) : null;
}

function readText(api: UpdateFiles, path: string): string | null {
  try {
    const raw = api.readFileSync(path);
    return raw ? new TextDecoder().decode(raw).trim() : null;
  } catch {
    return null;
  }
}

function removeQuietly(api: UpdateFiles, path: string): void {
  try {
    api.removeSync(path);
  } catch {
    // Not there.
  }
}

function log(line: string): void {
  try {
    files()?.appendFileSync(LOG_PATH, `[update] ${line}\n`);
  } catch {
    // Best effort.
  }
}
