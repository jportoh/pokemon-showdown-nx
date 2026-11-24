import { readJson, writeJson } from '@core/persistence/device-storage';

/**
 * A whole number from 0 to `count - 1`. It comes from `crypto.getRandomValues` (the console's own
 * random source) where there is one: the engine's `Math.random` gave the same few guest names and
 * avatars too often from one start of the app to the next. `Math.random` is only the fallback.
 */
export function randomInt(count: number): number {
  if (count <= 1) return 0;
  try {
    const word = new Uint32Array(1);
    globalThis.crypto.getRandomValues(word);
    return word[0] % count;
  } catch {
    return Math.floor(Math.random() * count);
  }
}

/** Any item of a list. */
export function randomItem<T>(list: readonly T[]): T {
  return list[randomInt(list.length)];
}

/**
 * Any item of a list but the last `keep` picked with the same storage key, which are kept on the
 * device: what looks random to a player is mostly not seeing the same thing again soon.
 */
export function randomFreshItem(list: readonly string[], storageKey: string, keep: number): string {
  const stored = readJson<unknown>(storageKey, []);
  const recent = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [];
  const limit = Math.max(0, Math.min(keep, list.length - 1));
  const avoided = new Set(limit ? recent.slice(-limit) : []);
  const fresh = list.filter((item) => !avoided.has(item));
  const item = randomItem(fresh.length ? fresh : list);
  writeJson(storageKey, limit ? [...recent.filter((other) => other !== item), item].slice(-limit) : []);
  return item;
}
