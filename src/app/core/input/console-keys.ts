import { PLATFORM } from '@core/runtime/platform';

/**
 * What each controller button and key does, so the whole app works with them alone (no mouse or touch).
 *
 * On the console (test K1, 2026-09-25) the buttons reach the page through the Gamepad API: A, B,
 * ZL and ZR only there; the d-pad there and also as key events (both its arrow key and the letter the
 * build maps to it). X and Y belong to Brewser (restart, exit), and so did L and R in test K1; later
 * the user found L and R free, and screens use them for their own actions (in battle: L Mega Evolves,
 * R forfeits). The build's "button mappings" go the other way: they let a computer keyboard drive the Switch controls in the web
 * version, with these letters. Arrows, Enter and Escape also work, for computer keyboards.
 */
export type InputAction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'accept'
  | 'back'
  | 'prevTab'
  | 'nextTab'
  | 'buttonL'
  | 'buttonR'
  | 'buttonR3'
  | 'buttonL3'
  | 'buttonPlus'
  | 'buttonX'
  | 'buttonY'
  | 'first'
  | 'last';

/**
 * The shoulder buttons, R3 and L3 (the sticks pressed), whose meaning depends on the screen (see
 * KeyboardNavigation.registerButton).
 */
export type PageButton = 'buttonL' | 'buttonR' | 'buttonZL' | 'buttonZR' | 'buttonR3' | 'buttonL3' | 'buttonPlus' | 'buttonX' | 'buttonY';

/**
 * Gamepad API button indices as Brewser reports them (seen on device: A=0, B=1, ZL=6, ZR=7, d-pad
 * 12–15, the standard mapping's positions for those labels). L=4, R=5, L3=10 and R3=11 (the sticks
 * pressed) are the standard mapping's too. The native .nro's engine (nx.js) numbers the face buttons
 * by position instead, B=0 and A=1 (test x1), so there they swap.
 */
const ACCEPT_INDEX = PLATFORM === 'native' ? 1 : 0;
const BACK_INDEX = PLATFORM === 'native' ? 0 : 1;

export const GAMEPAD_BUTTONS: readonly (readonly [number, InputAction])[] = [
  [ACCEPT_INDEX, 'accept'],
  [BACK_INDEX, 'back'],
  [6, 'prevTab'],
  [7, 'nextTab'],
  [4, 'buttonL'],
  [5, 'buttonR'],
  [10, 'buttonL3'],
  [11, 'buttonR3'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
  // Only the native .nro has them: on Brewser, X, Y and + are the browser's own (restart, exit).
  // nx.js numbers them by position like A and B: Y=2, X=3, +=9 (test x1). + no longer exits there
  // (native/app/plus-button.ts): leaving is the console's HOME button.
  ...(PLATFORM === 'native'
    ? ([
        [2, 'buttonY'],
        [3, 'buttonX'],
        [9, 'buttonPlus'],
      ] as const)
    : []),
];

// Keyed by `KeyboardEvent.key` (lower-cased), then `code`, then the legacy `keyCode` (undefined on
// Brewser, where key and code are filled in).
const BY_KEY: Record<string, InputAction> = {
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  j: 'accept',
  k: 'back',
  q: 'buttonL',
  e: 'buttonR',
  r: 'buttonR3',
  f: 'buttonL3',
  z: 'prevTab',
  c: 'nextTab',
  ArrowUp: 'up',
  Up: 'up',
  ArrowDown: 'down',
  Down: 'down',
  ArrowLeft: 'left',
  Left: 'left',
  ArrowRight: 'right',
  Right: 'right',
  Enter: 'accept',
  NumpadEnter: 'accept',
  Escape: 'back',
  Esc: 'back',
  Home: 'first',
  End: 'last',
};

const BY_CODE: Record<string, InputAction> = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyJ: 'accept',
  KeyK: 'back',
  KeyQ: 'buttonL',
  KeyE: 'buttonR',
  KeyR: 'buttonR3',
  KeyF: 'buttonL3',
  KeyZ: 'prevTab',
  KeyC: 'nextTab',
};

const BY_KEY_CODE: Record<number, InputAction> = {
  87: 'up',
  83: 'down',
  65: 'left',
  68: 'right',
  74: 'accept',
  75: 'back',
  81: 'buttonL',
  69: 'buttonR',
  82: 'buttonR3',
  70: 'buttonL3',
  90: 'prevTab',
  67: 'nextTab',
  38: 'up',
  40: 'down',
  37: 'left',
  39: 'right',
  13: 'accept',
  27: 'back',
};

export function inputAction(event: KeyboardEvent): InputAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const key = event.key?.length === 1 ? event.key.toLowerCase() : event.key;
  return (key && BY_KEY[key]) || BY_CODE[event.code] || BY_KEY_CODE[event.keyCode] || null;
}

