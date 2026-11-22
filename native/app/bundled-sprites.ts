// Showdown's images that every session loads (the item sheet, the trainer avatars) ship inside the
// .nro (scripts/build-nro.mjs) and are read from the RomFS instead of the network. On the console each
// https request costs a TLS handshake on the main thread, and at start they competed with the
// connection to Showdown (test x11: the item sheet and the unknown trainer took ~1.8 s).
//
// The app keeps asking for the same Showdown URLs (they're its cache keys): only fetch is redirected.
// Anything not bundled (custom avatars, sprites of new trainers) still goes to the network.

/** Showdown's sprites the build bundled, relative to SHOWDOWN_SPRITES (injected by esbuild). */
declare const __PSB_BUNDLED_SPRITES__: readonly string[];

const SHOWDOWN_SPRITES = 'https://play.pokemonshowdown.com/sprites/';
/** Where the build puts them in the RomFS (relative URLs resolve against romfs:/). */
const LOCAL_SPRITES = 'showdown/sprites/';

const bundled = new Set(typeof __PSB_BUNDLED_SPRITES__ === 'undefined' ? [] : __PSB_BUNDLED_SPRITES__);

/** The RomFS copy of a bundled Showdown sprite, or null. */
export function bundledSprite(url: string): string | null {
  if (!url.startsWith(SHOWDOWN_SPRITES)) return null;
  const path = decodeURIComponent(url.slice(SHOWDOWN_SPRITES.length).split(/[?#]/)[0]);
  return bundled.has(path) ? LOCAL_SPRITES + path : null;
}

const networkFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const local = typeof input === 'string' || input instanceof URL ? bundledSprite(String(input)) : null;
  return networkFetch(local ?? input, init);
};
