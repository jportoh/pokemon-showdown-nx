// Showdown's files the app keeps asking for ship inside the .nro (scripts/build-nro.mjs) and are read
// from the RomFS instead of the network: the item sheet and the trainer avatars every session loads,
// and every Pokémon's cry. On the console each https request costs a TLS handshake on the main thread
// (~65 ms each): at start they competed with the connection to Showdown (test x11: the item sheet and
// the unknown trainer took ~1.8 s), and the teams' cries, fetched together when a battle starts, held
// the main thread ~0.6–0.7 s (9–11 handshakes, test x13).
//
// The app keeps asking for the same Showdown URLs (they're its cache keys): only fetch is redirected.
// Anything not bundled (custom avatars, sprites of new trainers) still goes to the network.

/** Showdown's files the build bundled, relative to SHOWDOWN (injected by esbuild). */
declare const __PSB_BUNDLED_SHOWDOWN__: readonly string[];

const SHOWDOWN = 'https://play.pokemonshowdown.com/';
/** Where the build puts them in the RomFS (relative URLs resolve against romfs:/). */
const LOCAL = 'showdown/';

const bundled = new Set(typeof __PSB_BUNDLED_SHOWDOWN__ === 'undefined' ? [] : __PSB_BUNDLED_SHOWDOWN__);

/** The RomFS copy of a bundled Showdown file, or null. */
export function bundledShowdownFile(url: string): string | null {
  if (!url.startsWith(SHOWDOWN)) return null;
  const path = decodeURIComponent(url.slice(SHOWDOWN.length).split(/[?#]/)[0]);
  return bundled.has(path) ? LOCAL + path : null;
}

const networkFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const local = typeof input === 'string' || input instanceof URL ? bundledShowdownFile(String(input)) : null;
  return networkFetch(local ?? input, init);
};
