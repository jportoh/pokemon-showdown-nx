// The app bundle's very first module: tells the loader (native/loader/main.ts) that this copy has
// started running, so a failure from here on can't fall back to another copy in the same process.

import type { BootInfo } from '../update/boot-state';

const boot = (globalThis as unknown as { psbBoot?: BootInfo }).psbBoot;
if (boot) boot.evaluating = true;
