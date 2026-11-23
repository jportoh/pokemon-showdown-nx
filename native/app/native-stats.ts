// Timings of the native-only steps (text drawing, pixel reads, uploads), summed and written to the
// native log every few seconds with the engine's memory figures, to see
// memory growing before a crash.

import { fontFaceCount } from './bold-font';
import { nativeLog } from './native-log';
import { netStats } from './net-diagnostics';

export interface Timing {
  count: number;
  ms: number;
}

export const nativeStats = {
  measureText: { count: 0, ms: 0 },
  fillText: { count: 0, ms: 0 },
  readPixels: { count: 0, ms: 0 },
  premultiply: { count: 0, ms: 0 },
  upload: { count: 0, ms: 0 },
  pixels: 0,
} satisfies Record<string, Timing | number>;

export function timed<T>(timing: Timing, run: () => T): T {
  const started = performance.now();
  try {
    return run();
  } finally {
    timing.ms += performance.now() - started;
    timing.count++;
  }
}

interface MemoryUsage {
  usedHeapSize?: number;
  heapSizeLimit?: number;
  externalMemory?: number;
  nativeHeapUsed?: number;
  nativeHeapFree?: number;
}

const memoryUsage = (globalThis as unknown as { Switch?: { memoryUsage?: () => MemoryUsage } }).Switch?.memoryUsage;
const mib = (bytes: number | undefined) => (bytes === undefined ? '?' : (bytes / 1048576).toFixed(1));

function summary(): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(nativeStats)) {
    if (typeof value === 'number') continue;
    if (value.count) parts.push(`${name} ${value.count}× ${value.ms.toFixed(0)} ms (${(value.ms / value.count).toFixed(2)})`);
  }
  if (nativeStats.pixels) parts.push(`${(nativeStats.pixels / 1e6).toFixed(2)} Mpx`);
  return parts.join(' · ');
}

let last = '';
setInterval(() => {
  const text = summary();
  let memory = '';
  try {
    const usage = memoryUsage?.();
    if (usage) {
      memory = `lag max ${netStats.lagMs.toFixed(0)} ms · fetches max ${netStats.maxFetches} · fonts ${fontFaceCount()} · heap ${mib(usage.usedHeapSize)}/${mib(usage.heapSizeLimit)} MiB · external ${mib(usage.externalMemory)} · native ${mib(usage.nativeHeapUsed)} used ${mib(usage.nativeHeapFree)} free`;
    }
  } catch {
    memory = 'memoryUsage failed';
  }
  netStats.lagMs = 0;
  netStats.maxFetches = netStats.fetches;
  if (text === last) {
    nativeLog(`[mem] ${memory}`);
    return;
  }
  last = text;
  nativeLog(`[stats] ${text}`);
  nativeLog(`[mem] ${memory}`);
}, 5000);
