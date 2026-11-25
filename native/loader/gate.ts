// The update gate (docs/updates.md): before any of the app's code runs, the loader checks that this
// console has the latest version, and downloads and installs it if not, on its own screen
// (gate-screen.ts, its texts in gate-views.ts). The app always runs the latest version, with no
// restart: the loader then imports the newest code in the same start.
//
// A version that needs a new .nro (another engine or loader) downloads it next to this one
// (native/update/nro-files.ts): from then on this .nro only says to open the new one once from the
// Homebrew Menu, which then puts itself where the HOME menu forwarder opens.
//
// When it can't make sure (no connection, GitHub not answering, a version that didn't start here),
// the player chooses: try again, or play offline: the newest code this console has, without
// connecting to Showdown. Never once a newer .nro is on the SD card.

import { compareVersions } from '../update/boot-state';
import { installOverStable, newerNro, ownNroPath, readNroState, versionOfName } from '../update/nro-files';
import { files, log, type UpdateFiles } from '../update/update-files';
import { checkAndUpdate, type LocalCode, type UpdateProgress } from '../update/updater';
import { GateScreen, type GateView } from './gate-screen';
import {
  checkFailedView,
  installFailedView,
  installingNroView,
  needsNroView,
  openTheNewOneView,
  progressView,
  startFailedView,
  startingView,
} from './gate-views';

/** How the app starts: online (the latest version) or offline, and why; or not at all (closing). */
export interface GateOutcome {
  offline: boolean;
  offlineReason: string | null;
  /** The app is closing (Switch.exit): the loader runs nothing. */
  exit?: boolean;
}

const ONLINE: GateOutcome = { offline: false, offlineReason: null };
const EXIT: GateOutcome = { offline: true, offlineReason: 'closing', exit: true };

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The engine's memory, for the log (nx.js' Switch.memoryUsage, where it has one). */
function memory(): string {
  const usage = (globalThis as { Switch?: { memoryUsage?: () => Record<string, number | undefined> } }).Switch?.memoryUsage?.();
  if (!usage) return 'no memoryUsage';
  const mibOf = (bytes: number | undefined) => (bytes === undefined ? '?' : (bytes / 1048576).toFixed(1));
  return `heap ${mibOf(usage.usedHeapSize)} · external ${mibOf(usage.externalMemory)} · native ${mibOf(usage.nativeHeapUsed)} MiB`;
}

/** Every few seconds while a download runs, how far it got and the memory: a crash leaves where it was. */
function downloadLogger(): (step: UpdateProgress) => void {
  let at = 0;
  return (step) => {
    if (step.kind !== 'downloading' && step.kind !== 'downloading-nro') return;
    const now = performance.now();
    if (now - at < 5000 && step.received < step.total) return;
    at = now;
    log(`${step.kind} ${step.version}: ${mib(step.received)} of ${mib(step.total)} · ${memory()}`);
  };
}

/** Closes the app (it takes effect after this turn of the event loop: the loader runs nothing after). */
function exitApp(): void {
  (globalThis as unknown as { Switch: { exit(): void } }).Switch.exit();
}

/** This .nro is out of date: a newer one is on the SD card. Only closing (no playing offline either). */
async function openTheNewOne(screen: GateScreen | null, version: string): Promise<GateOutcome> {
  log(`.nro ${version} is on the SD card: this one only says to open it`);
  if (screen) await screen.choose(openTheNewOneView(version));
  exitApp();
  return EXIT;
}

/**
 * The new .nro opened from its versioned name: copies itself where the forwarder opens (the old
 * .nro becomes .old until this one starts well from there). A failure leaves the old one in place.
 */
async function installNro(api: UpdateFiles, screen: GateScreen | null, own: string, version: string): Promise<void> {
  const state = readNroState(api);
  const stable = state.stable;
  if (!stable || stable === own || state.installed === version || !api.statSync(stable)) return;
  for (;;) {
    try {
      await installOverStable(api, own, stable, version, (done, total) => screen?.show(installingNroView(version, done / total)));
      return;
    } catch (error) {
      log(`.nro ${version} couldn't go over ${stable}: ${describe(error)}`);
      const choice = screen ? await screen.choose(installFailedView(describe(error))) : 'b';
      if (choice === 'b') return;
    }
  }
}

/** `builtIn`: the .nro's own version, for the screen's footer and the .nro handover. */
export async function runGate(local: LocalCode, builtIn: string): Promise<GateOutcome> {
  const api = files();
  if (!api) return ONLINE;
  const footer = `Version ${local.version}${local.version !== builtIn ? ` · .nro ${builtIn}` : ''}`;
  let screen: GateScreen | null = null;
  try {
    screen = new GateScreen(footer);
  } catch (error) {
    log(`gate screen unavailable: ${describe(error)}`);
  }
  // Without a screen nobody can choose: the safe choice is offline.
  const choose = (view: GateView): Promise<'a' | 'b'> => (screen ? screen.choose(view) : Promise.resolve('b'));
  const offline = (reason: string): GateOutcome => {
    log(`starting offline: ${reason}`);
    return { offline: true, offlineReason: reason };
  };

  try {
    // A newer .nro already on the SD card: this one is out of date, whatever the network says.
    const newer = newerNro(api, local.version);
    if (newer) return await openTheNewOne(screen, newer.version);
    // Opened from its versioned name (the Homebrew Menu, once): where the forwarder opens, first.
    const own = ownNroPath();
    if (own && versionOfName(own) === builtIn) await installNro(api, screen, own, builtIn);

    let retryFailed = false;
    for (;;) {
      let result;
      try {
        const logDownload = downloadLogger();
        result = await checkAndUpdate(api, local, retryFailed, (step) => {
          logDownload(step);
          screen?.show(progressView(step));
        });
      } catch (error) {
        const reason = describe(error);
        log(`check failed: ${reason}`);
        if ((await choose(checkFailedView(reason))) === 'a') continue;
        return offline("couldn't check for updates");
      }
      switch (result.kind) {
        case 'up-to-date':
          // The release may be older than this console's code (a test build): nothing to say.
          if (compareVersions(result.latest, local.version) < 0) log(`running ${local.version}, newer than the latest release ${result.latest}`);
          return ONLINE;
        case 'installed':
          screen?.show(startingView(result.version));
          return ONLINE;
        case 'nro-downloaded':
          return await openTheNewOne(screen, result.version);
        case 'needs-nro':
          if ((await choose(needsNroView(result.version))) === 'a') continue;
          return offline(`version ${result.version} needs a new .nro`);
        case 'start-failed':
          if ((await choose(startFailedView(result.version, result.reason, local.version))) === 'b') return offline(`version ${result.version} didn't start`);
          retryFailed = true;
          continue;
      }
    }
  } finally {
    screen?.close();
  }
}
