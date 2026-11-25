// What the update gate's screen says in each step (native/loader/gate.ts), kept apart so the gate's
// browser preview (scripts/gate-preview.mjs) shows exactly the same screens.

import { RELEASES_PAGE } from '../update/update-config';
import type { UpdateProgress } from '../update/updater';
import type { GateView } from './gate-screen';

const mib = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

export function progressView(step: UpdateProgress): GateView {
  switch (step.kind) {
    case 'checking':
      return { status: 'Checking for updates…', progress: 'busy' };
    case 'downloading':
      return {
        status: `Downloading version ${step.version}`,
        detail: `${mib(step.received)} of ${mib(step.total)}`,
        progress: step.total > 0 ? step.received / step.total : 0,
      };
    case 'downloading-nro':
      return {
        status: `Downloading version ${step.version}`,
        detail: `The new app · ${mib(step.received)} of ${mib(step.total)} · about a minute`,
        progress: step.total > 0 ? step.received / step.total : 0,
      };
    case 'installing':
      return { status: `Installing version ${step.version}…`, detail: 'Almost there', progress: 1 };
  }
}

export const startingView = (version: string): GateView => ({ status: `Starting version ${version}…`, detail: 'Ready', progress: 1 });

/** This .nro is out of date: a newer one is on the SD card. Only closing. */
export const openTheNewOneView = (version: string): GateView => ({
  status: `Version ${version} is ready`,
  detail: `This version is out of date. Close it, then open Pokémon Showdown ${version}\nonce from the Homebrew Menu (hold R while opening a game).\nFrom then on, the HOME menu icon opens the new version.`,
  actions: { a: 'Close' },
});

export const installingNroView = (version: string, fraction: number): GateView => ({
  status: `Installing version ${version}`,
  detail: 'Putting it where the HOME menu icon opens it',
  progress: fraction,
});

export const installFailedView = (reason: string): GateView => ({
  status: "Couldn't install the new version",
  detail: `${reason}\nThe HOME menu icon still opens the old one.`,
  actions: { a: 'Try again', b: 'Skip for now' },
});

export const checkFailedView = (reason: string): GateView => ({
  status: "Couldn't check for updates",
  detail: `${reason}\nCheck the console's internet connection.\nOffline, the app won't connect to Showdown.`,
  actions: { a: 'Try again', b: 'Play offline' },
});

export const needsNroView = (version: string): GateView => ({
  status: `Version ${version} needs a new .nro`,
  detail: `Download pokemon-showdown-v${version}.nro from ${RELEASES_PAGE}\nand copy it to sdmc:/switch/ in place of this one.`,
  actions: { a: 'Check again', b: 'Play offline' },
});

export const startFailedView = (version: string, reason: string, current: string): GateView => ({
  status: `Version ${version} didn't start`,
  detail: `It failed to start on this console (${reason}).\nDownload it again, or play offline with version ${current}.`,
  actions: { a: 'Download again', b: 'Play offline' },
});
