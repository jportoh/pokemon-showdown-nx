/**
 * What the app tells the .nro's native log (native/app/native-log.ts, `sdmc:/switch/pokemon-showdown-nx/native.log`)
 * besides errors, to see what it was doing when the engine closed it without a word (bugs L86): the
 * screens it goes through, and the GPU textures it holds (count and bytes, with each [mem] line). The
 * native side leaves its logger in `globalThis.psbNativeLog` and reads `globalThis.psbGlTextures`; in
 * a browser there's no log and this costs nothing.
 */
export interface GlTextureStats {
  count: number;
  bytes: number;
}

const scope = globalThis as { psbNativeLog?: (line: string) => void; psbGlTextures?: GlTextureStats };

/** The textures alive (GlRenderer counts them), read by the native log's [mem] lines. */
export const glTextureStats: GlTextureStats = (scope.psbGlTextures ??= { count: 0, bytes: 0 });

/** A line in the native log, on the console only. */
export function nativeTrace(line: string): void {
  scope.psbNativeLog?.(line);
}
