// The .nro's entry (RomFS main.js): makes sure the app is the latest version, then runs it. The app
// itself is app.mjs in the RomFS; an online update puts a newer bundle on the SD card (see
// native/update/boot-state.ts).
//
//  1. The update gate (gate.ts) checks the latest release and installs it if it's newer than the
//     code this console has, on its own screen. Without a way to make sure (no connection…), the
//     player can play offline.
//  2. The loader runs the newest code it has: the update on the SD card when
//     - the updater installed it for this .nro (same fingerprint): every asset its code expects is in
//       this RomFS or in its asset pack, which the loader then serves (asset-pack.ts),
//     - it is newer than the .nro's own code (a newer .nro makes older updates obsolete), and
//     - it hasn't failed to start MAX_BOOT_ATTEMPTS times in a row;
//     otherwise, or if its file can't be loaded, the RomFS copy.
//
// It imports nothing of the app: a broken update must never stop the .nro's own code from starting.

import { bootLog, compareVersions, MAX_BOOT_ATTEMPTS, nxFiles, readState, UPDATE_DIR, writeState, type BootInfo, type UpdateState } from '../update/boot-state';
import { cleanUpNros } from '../update/nro-files';
import { files } from '../update/update-files';
import { packPresent, servePack } from './asset-pack';
import { runGate, type GateOutcome } from './gate';

/** Injected by scripts/build-nro.mjs. */
declare const __PSB_VERSION__: string;
declare const __PSB_ASSETS_ID__: string;

const started = performance.now();

/** import() with a run-time specifier: the bundler leaves it to the engine (RomFS or SD card). */
const load = (specifier: string): Promise<unknown> => import(specifier);

function boot(source: BootInfo['source'], version: string, state: UpdateState | null, gate: GateOutcome): BootInfo {
  const info: BootInfo = {
    version,
    source,
    builtInVersion: __PSB_VERSION__,
    assetsId: __PSB_ASSETS_ID__,
    offline: gate.offline,
    offlineReason: gate.offlineReason,
    confirm: () => {
      // Started well: what a new .nro's handover left on the SD card can go (nro-files.ts).
      const api = files();
      if (api) cleanUpNros(api, __PSB_VERSION__);
      if (source !== 'update' || !state) return;
      const current = readState();
      if (!current || current.file !== state.file || current.bootAttempts === 0) return;
      writeState({ ...current, bootAttempts: 0 });
      bootLog(`update ${version} confirmed (started well)`);
    },
  };
  (globalThis as unknown as { psbBoot: BootInfo }).psbBoot = info;
  return info;
}

/** Why the update on the SD card can't run, or null when it can. */
function skipReason(state: UpdateState): string | null {
  if (state.failed) return `failed before (${state.failed})`;
  if (state.assetsId !== __PSB_ASSETS_ID__) return `built for other assets (${state.assetsId.slice(0, 8)}, this .nro ${__PSB_ASSETS_ID__.slice(0, 8)})`;
  if (compareVersions(state.version, __PSB_VERSION__) <= 0) return `not newer than the .nro's ${__PSB_VERSION__}`;
  if (state.bootAttempts >= MAX_BOOT_ATTEMPTS) return `${state.bootAttempts} starts without confirming`;
  if (!packPresent(state)) return `its pack ${state.pack} is missing`;
  return null;
}

/**
 * Removes an update that can never run here (an older version, other assets, a lost pack). One that
 * failed to start keeps its record (marked failed): the gate offers to download it again.
 */
function discard(state: UpdateState, reason: string): void {
  bootLog(`update ${state.version} not used: ${reason}`);
  if (state.failed) return;
  if (state.bootAttempts >= MAX_BOOT_ATTEMPTS) {
    writeState({ ...state, failed: 'it never started well' });
    return;
  }
  try {
    nxFiles?.removeSync?.(`${UPDATE_DIR}${state.file}`);
    if (state.pack) nxFiles?.removeSync?.(`${UPDATE_DIR}${state.pack}`);
    nxFiles?.removeSync?.(`${UPDATE_DIR}state.json`);
  } catch {
    // Best effort: it is skipped anyway.
  }
}

/** The update to run, or null for the .nro's own code (cleaning up one that can't run). */
function runnableUpdate(): UpdateState | null {
  const state = readState();
  if (!state) return null;
  const reason = skipReason(state);
  if (reason) {
    discard(state, reason);
    return null;
  }
  return state;
}

async function runRomfs(gate: GateOutcome): Promise<void> {
  boot('romfs', __PSB_VERSION__, null, gate);
  await load('./app.mjs');
  bootLog(`.nro code ${__PSB_VERSION__} loaded in ${(performance.now() - started).toFixed(0)} ms`);
}

async function main(): Promise<void> {
  const before = runnableUpdate();
  const gate = await runGate(
    { version: before?.version ?? __PSB_VERSION__, assetsId: __PSB_ASSETS_ID__, state: readState() },
    __PSB_VERSION__,
  );
  bootLog(`gate done in ${(performance.now() - started).toFixed(0)} ms${gate.offline ? ` (offline: ${gate.offlineReason})` : ''}`);
  // Closing (a newer .nro is on the SD card): nothing runs.
  if (gate.exit) return;

  // The gate may have installed a newer version.
  const state = runnableUpdate();
  if (!state) {
    await runRomfs(gate);
    return;
  }

  writeState({ ...state, bootAttempts: state.bootAttempts + 1 });
  try {
    const served = await servePack(state);
    if (served) bootLog(`serving ${served} assets from ${state.pack}`);
  } catch (error) {
    // The pack can't be read: its code would miss assets. The next gate downloads it again.
    const message = error instanceof Error ? error.message : String(error);
    bootLog(`update ${state.version}'s pack can't be read (${message}): running the .nro's code`);
    discard({ ...state, bootAttempts: 0 }, `unreadable pack (${message})`);
    await runRomfs(gate);
    return;
  }
  const info = boot('update', state.version, state, gate);
  const path = `${UPDATE_DIR}${state.file}`;
  bootLog(`running update ${state.version} (start ${state.bootAttempts + 1} of ${MAX_BOOT_ATTEMPTS}) over the .nro's ${__PSB_VERSION__}`);
  try {
    await load(path);
    bootLog(`update ${state.version} loaded in ${(performance.now() - started).toFixed(0)} ms`);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    writeState({ ...state, bootAttempts: state.bootAttempts + 1, failed: message.slice(0, 200) });
    bootLog(`update ${state.version} failed to load: ${message}`);
    if (info.evaluating) {
      // Part of it already ran (the platform shims, maybe Angular): running a second copy on top is
      // unsafe. The next start's gate offers to download it again or play offline.
      // Switch.exit() only closes the app after this turn of the event loop (test u2: the .nro code
      // had started loading by then), so nothing may run after it.
      bootLog('it had started running: closing');
      (globalThis as unknown as { Switch: { exit(): void } }).Switch.exit();
      return;
    }
    await runRomfs(gate);
  }
}

void main();
