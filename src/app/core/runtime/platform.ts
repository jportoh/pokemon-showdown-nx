/**
 * Where the app is running, from the engine's user agent (fixed at load).
 *
 * - `native`: the app's own Switch homebrew .nro on nx.js (`… nx.js/1.0.0-beta.6`), see docs/native.md.
 * - `browser`: any other browser (the web version, for development).
 */
export type Platform = 'native' | 'browser';

function detect(): Platform {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return /\bnx\.js\//.test(agent) ? 'native' : 'browser';
}

export const PLATFORM: Platform = detect();

/** On the Switch: the controller drives everything and text is typed on screen. */
export const ON_CONSOLE = PLATFORM === 'native';
