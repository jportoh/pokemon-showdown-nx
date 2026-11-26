// The update gate's screen in a browser (scripts/gate-preview.mjs): the real GateScreen and its views,
// on a 1280x720 canvas standing in for the console's screen, one state per page:
// screen.html?view=<name>&appearance=light|dark&theme=<theme>. A stand-in `Switch` gives it the theme
// (as Settings' file would) and makes it thicken bold by hand, as on the console.

import type { GateView } from '../loader/gate-screen';
import {
  checkFailedView,
  installFailedView,
  installingNroView,
  needsNroView,
  openTheNewOneView,
  progressView,
  startFailedView,
  startingView,
} from '../loader/gate-views';

const MB = 1048576;

export const PREVIEW_VIEWS: Record<string, GateView> = {
  checking: progressView({ kind: 'checking' }),
  downloading: progressView({ kind: 'downloading', version: '0.6.1', received: 2.9 * MB, total: 6.6 * MB }),
  'downloading-nro': progressView({ kind: 'downloading-nro', version: '0.7.0', received: 52.9 * MB, total: 128.3 * MB }),
  installing: progressView({ kind: 'installing', version: '0.6.1' }),
  starting: startingView('0.6.1'),
  'nro-ready': openTheNewOneView('0.7.0'),
  'installing-nro': installingNroView('0.7.0', 0.4),
  'install-failed': installFailedView('Error: No space left on device'),
  'check-failed': checkFailedView('No address associated with hostname'),
  'needs-nro': needsNroView('0.7.0'),
  'start-failed': startFailedView('0.6.1', 'it never started well', '0.6.0'),
};

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const settings = JSON.stringify({ appearance: params.get('appearance') ?? 'light', theme: params.get('theme') ?? 'zafiro' });
  Object.defineProperty(globalThis, 'Switch', {
    configurable: true,
    value: { readFileSync: (path: string) => (path.endsWith('psb.settings.v1.json') ? new TextEncoder().encode(settings).buffer : null) },
  });
  const canvas = document.querySelector('canvas')!;
  Object.defineProperty(globalThis, 'screen', { configurable: true, value: canvas });
  // After the stand-ins: GateScreen reads them as it loads.
  const { GateScreen } = await import('../loader/gate-screen');
  const screen = new GateScreen('Version 0.6.0');
  const view = PREVIEW_VIEWS[params.get('view') ?? 'checking'] ?? PREVIEW_VIEWS['checking'];
  // The choice (the controller's A/B, or a tap on a button) shows in the tab's title.
  if (view.actions) void screen.choose(view).then((choice) => (document.title = `chose ${choice}`));
  else screen.show(view);
}

void main();
