// The .nro's entry (RomFS main.js): picks which copy of the app's code to run. The app itself is
// app.mjs in the RomFS; an online update puts a newer bundle on the SD card (see
// native/update/boot-state.ts). The loader runs the update when:
//
//  - it was built against this .nro's engine and assets (same fingerprint),
//  - it is newer than the .nro's own code (a newer .nro makes older updates obsolete), and
//  - it hasn't failed to start MAX_BOOT_ATTEMPTS times in a row.
//
// Otherwise, or if its file can't be loaded, it runs the RomFS copy. It stays small and imports
// nothing of the app: a broken update must never stop the .nro's own code from starting.

import {
  bootLog,
  compareVersions,
  MAX_BOOT_ATTEMPTS,
  nxFiles,
  readState,
  UPDATE_DIR,
  writeState,
  type BootInfo,
  type UpdateState,
} from '../update/boot-state';

/** Injected by scripts/build-nro.mjs. */
declare const __PSB_VERSION__: string;
declare const __PSB_ASSETS_ID__: string;

const started = performance.now();

/** import() with a run-time specifier: the bundler leaves it to the engine (RomFS or SD card). */
const load = (specifier: string): Promise<unknown> => import(specifier);

function boot(source: BootInfo['source'], version: string, state: UpdateState | null): BootInfo {
  const info: BootInfo = {
    version,
    source,
    builtInVersion: __PSB_VERSION__,
    assetsId: __PSB_ASSETS_ID__,
    confirm: () => {
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
  return null;
}

/** Removes an update that can never run here (an older version, other assets), keeping a failed one's record. */
function discard(state: UpdateState, reason: string): void {
  bootLog(`update ${state.version} not used: ${reason}`);
  if (state.failed) return;
  if (state.bootAttempts >= MAX_BOOT_ATTEMPTS) {
    writeState({ ...state, failed: 'never started well' });
    return;
  }
  try {
    nxFiles?.removeSync?.(`${UPDATE_DIR}${state.file}`);
    nxFiles?.removeSync?.(`${UPDATE_DIR}state.json`);
  } catch {
    // Best effort: it is skipped anyway.
  }
}

async function runRomfs(): Promise<void> {
  boot('romfs', __PSB_VERSION__, null);
  await load('./app.mjs');
  bootLog(`.nro code ${__PSB_VERSION__} loaded in ${(performance.now() - started).toFixed(0)} ms`);
}

async function main(): Promise<void> {
  const state = readState();
  const reason = state ? skipReason(state) : null;
  if (!state || reason) {
    if (state && reason) discard(state, reason);
    await runRomfs();
    return;
  }

  writeState({ ...state, bootAttempts: state.bootAttempts + 1 });
  const info = boot('update', state.version, state);
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
      // unsafe. The next start runs the .nro's code, since the update is marked as failed.
      // Switch.exit() only closes the app after this turn of the event loop (test u2: the .nro code
      // had started loading by then), so nothing may run after it.
      bootLog('it had started running: closing, the next start uses the .nro code');
      (globalThis as unknown as { Switch: { exit(): void } }).Switch.exit();
      return;
    }
    await runRomfs();
  }
}

void main();
