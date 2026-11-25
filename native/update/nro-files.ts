// A new .nro, online (docs/updates.md, "A new .nro"). The app can't replace the .nro it runs from
// (test u4), and a HOME menu forwarder always opens the same path (test u8: argv[0] is the
// forwarder's .nro, sdmc:/switch/pokemon-showdown.nro), so a new .nro goes:
//
//  1. The old .nro's gate downloads it next to itself, as sdmc:/switch/pokemon-showdown-v<x.y.z>.nro,
//     notes in nro.json which path the forwarder opens (its own), and from then on only says to
//     open the new one once from the Homebrew Menu.
//  2. The new .nro, opened from that versioned name, renames the old one to <path>.old and copies
//     itself to the forwarder's path (~20 s for 128 MiB, test u8).
//  3. Opened from the forwarder again, once it started well, it removes its versioned copy, the
//     .old and any older versioned .nro.

import { compareVersions, SD_DIR } from './boot-state';
import { log, removeQuietly, sha256, type UpdateFiles } from './update-files';

export const SWITCH_DIR = 'sdmc:/switch/';
export const NRO_STATE_PATH = `${SD_DIR}nro.json`;
/** A release's .nro, named after its version (as CI publishes it). */
const VERSIONED = /^pokemon-showdown-v(\d+\.\d+\.\d+(?:-[\w.]+)?)\.nro$/;
const BLOCK = 4 * 1024 * 1024;

/** What the .nro handover knows (nro.json). */
export interface NroState {
  /** The path the HOME menu forwarder opens: the .nro to replace (never a versioned one). */
  stable?: string;
  /** A newer .nro downloaded next to it, waiting to be opened from the Homebrew Menu. */
  downloaded?: { version: string; path: string };
  /** The version copied over `stable` (its leftovers go once it starts well from there). */
  installed?: string;
}

export function readNroState(api: UpdateFiles): NroState {
  try {
    const raw = api.readFileSync(NRO_STATE_PATH);
    const value = raw ? (JSON.parse(new TextDecoder().decode(raw)) as NroState) : {};
    return typeof value === 'object' && value !== null ? value : {};
  } catch {
    return {};
  }
}

export function writeNroState(api: UpdateFiles, state: NroState): void {
  try {
    api.writeFileSync(NRO_STATE_PATH, JSON.stringify(state));
  } catch {
    // Best effort.
  }
}

/** The running .nro's path (Switch.argv[0]: the forwarder's .nro when opened from the HOME menu). */
export function ownNroPath(): string | null {
  const argv = (globalThis as { Switch?: { argv?: readonly string[] } }).Switch?.argv ?? [];
  return argv.find((arg) => /\.nro$/i.test(arg)) ?? null;
}

/** The version in a versioned .nro's name ('…/pokemon-showdown-v0.7.0.nro' → '0.7.0'), or null. */
export function versionOfName(path: string): string | null {
  return VERSIONED.exec(path.slice(path.lastIndexOf('/') + 1))?.[1] ?? null;
}

export function versionedNroPath(version: string): string {
  return `${SWITCH_DIR}pokemon-showdown-v${version}.nro`;
}

/** The versioned .nro files in sdmc:/switch/ (complete ones: a download is a .part until checked). */
export function versionedNros(api: UpdateFiles): { version: string; path: string }[] {
  try {
    return (api.readDirSync(SWITCH_DIR) ?? [])
      .map((name) => ({ version: versionOfName(name), path: `${SWITCH_DIR}${name}` }))
      .filter((entry): entry is { version: string; path: string } => entry.version !== null);
  } catch {
    return [];
  }
}

/** The newest versioned .nro newer than `version` on the SD card, or null. */
export function newerNro(api: UpdateFiles, version: string): { version: string; path: string } | null {
  let newest: { version: string; path: string } | null = null;
  for (const entry of versionedNros(api)) {
    if (compareVersions(entry.version, version) > 0 && (!newest || compareVersions(entry.version, newest.version) > 0)) newest = entry;
  }
  return newest;
}

/**
 * Copies `from` to `to` in 4 MiB blocks (never all in memory), hashing each, reads the copy back to
 * check it, then puts it in place: `to` must not be the running .nro (it can't be removed).
 */
export async function copyChecked(api: UpdateFiles, from: string, to: string, progress: (done: number, total: number) => void): Promise<void> {
  const size = api.statSync(from)?.size ?? 0;
  if (!size) throw new Error(`${from} not found`);
  const part = `${to}.part`;
  removeQuietly(api, part);
  const source = api.file(from);
  const writer = api.file(part).writable.getWriter();
  const digests: string[] = [];
  try {
    for (let at = 0; at < size; at += BLOCK) {
      const bytes = new Uint8Array(await source.slice(at, Math.min(size, at + BLOCK)).arrayBuffer());
      digests.push(await sha256(bytes));
      await writer.write(bytes);
      progress(at + bytes.byteLength, size * 2);
    }
  } finally {
    await writer.close().catch(() => undefined);
  }
  const copy = api.file(part);
  for (let at = 0, i = 0; at < size; at += BLOCK, i++) {
    const bytes = await copy.slice(at, Math.min(size, at + BLOCK)).arrayBuffer();
    if ((await sha256(bytes)) !== digests[i]) {
      removeQuietly(api, part);
      throw new Error(`the copy's block ${i} differs`);
    }
    progress(size + Math.min(size, at + BLOCK), size * 2);
  }
  removeQuietly(api, to);
  api.renameSync(part, to);
}

/**
 * The new .nro, running from its versioned name: puts itself where the forwarder opens. The old .nro
 * becomes <stable>.old (removed once this one starts well from there).
 */
export async function installOverStable(api: UpdateFiles, own: string, stable: string, version: string, progress: (done: number, total: number) => void): Promise<void> {
  const old = `${stable}.old`;
  if (api.statSync(stable)) {
    removeQuietly(api, old);
    api.renameSync(stable, old);
  }
  try {
    await copyChecked(api, own, stable, progress);
  } catch (error) {
    // Put the old one back: the forwarder keeps opening something that works.
    if (!api.statSync(stable) && api.statSync(old)) api.renameSync(old, stable);
    throw error;
  }
  writeNroState(api, { stable, installed: version });
  log(`.nro ${version} copied over ${stable}`);
}

/**
 * Once the .nro started well from the forwarder's path: removes what the handover left (its versioned
 * copy, the old .nro, older versioned .nro files). Never the running one.
 */
export function cleanUpNros(api: UpdateFiles, version: string): void {
  const own = ownNroPath();
  if (!own) return;
  // Opened from a versioned name (no forwarder, or the handover's first start): only older ones go.
  const fromStable = !versionOfName(own);
  const removed: string[] = [];
  for (const entry of versionedNros(api)) {
    const order = compareVersions(entry.version, version);
    if (entry.path === own || order > 0 || (order === 0 && !fromStable)) continue;
    removeQuietly(api, entry.path);
    removed.push(entry.path);
  }
  const old = `${own}.old`;
  if (fromStable && api.statSync(old)) {
    removeQuietly(api, old);
    removed.push(old);
  }
  if (removed.length) log(`.nro ${version} started well from ${own}: removed ${removed.join(', ')}`);
  if (!fromStable) return;
  const state = readNroState(api);
  const pending = state.downloaded && compareVersions(state.downloaded.version, version) > 0 ? state.downloaded : undefined;
  if (state.installed || state.downloaded !== pending || state.stable !== own) writeNroState(api, { stable: own, ...(pending ? { downloaded: pending } : {}) });
}
