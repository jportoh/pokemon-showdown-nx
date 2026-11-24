// Confirms to the loader that this start went well, once Angular has bootstrapped (src/main.ts sets
// psbAppBooted) and a few seconds passed with no uncaught error. An online update that never gets
// here is tried MAX_BOOT_ATTEMPTS times, then the loader goes back to the .nro's own code.

import type { BootInfo } from '../update/boot-state';
import { nativeLog } from './native-log';

const HEALTHY_MS = 6000;
const scope = globalThis as unknown as { psbBoot?: BootInfo; psbAppBooted?: boolean };
let uncaught = 0;

globalThis.addEventListener('error', () => uncaught++);
globalThis.addEventListener('unhandledrejection', () => uncaught++);

const boot = scope.psbBoot;
if (boot) {
  nativeLog(`[boot] code ${boot.version} from ${boot.source === 'update' ? 'an online update (SD card)' : 'the .nro'}`);
  const check = (): void => {
    if (!scope.psbAppBooted) {
      setTimeout(check, 1000);
      return;
    }
    if (uncaught > 0) {
      nativeLog(`[boot] not confirmed: ${uncaught} uncaught error(s) while starting`);
      return;
    }
    boot.confirm();
  };
  setTimeout(check, HEALTHY_MS);
}
