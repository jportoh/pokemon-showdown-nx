/**
 * Where the app is running, from the engine's user agent (fixed at load).
 *
 * - `brewser`: the Brewser console app, whose engine claims `Chrome/120 … Brewser/1.0`.
 * - `native`: the app's own Switch homebrew .nro on nx.js (`… nx.js/1.0.0-beta.6`), with no Brewser
 *   at all (see docs/native.md).
 * - `browser`: any other browser (the web version, development).
 */
export type Platform = 'brewser' | 'native' | 'browser';

function detect(): Platform {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Brewser/.test(agent)) return 'brewser';
  if (/\bnx\.js\//.test(agent)) return 'native';
  return 'browser';
}

export const PLATFORM: Platform = detect();

/** On a Switch (Brewser or native): the controller drives everything and text is typed on screen. */
export const ON_CONSOLE = PLATFORM !== 'browser';
