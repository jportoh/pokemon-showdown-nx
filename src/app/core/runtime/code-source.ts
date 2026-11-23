/**
 * Which copy of the app's code is running on the .nro: its own (RomFS) or an online update from the
 * SD card. The .nro's loader (native/loader/main.ts) leaves it in `globalThis.psbBoot`; in a browser
 * there is none.
 */
export interface CodeSource {
  version: string;
  source: 'romfs' | 'update';
  builtInVersion: string;
  /** The fingerprint of the .nro's engine and assets: an update must match it. */
  assetsId: string;
}

export function codeSource(): CodeSource | null {
  const boot = (globalThis as { psbBoot?: CodeSource }).psbBoot;
  return boot ? { version: boot.version, source: boot.source, builtInVersion: boot.builtInVersion, assetsId: boot.assetsId } : null;
}

/** Tells the loader Angular has bootstrapped: with a few healthy seconds, the start is confirmed. */
export function markAppBooted(): void {
  (globalThis as { psbAppBooted?: boolean }).psbAppBooted = true;
}
