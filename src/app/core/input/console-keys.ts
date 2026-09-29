/**
 * What each controller button and key does, so the whole app works with them alone (no mouse or touch).
 *
 * On the console (test K1, 2026-09-25) the buttons reach the page through the Gamepad API: A, B,
 * ZL and ZR only there; the d-pad there and also as key events (both its arrow key and the letter the
 * build maps to it). X and Y belong to Brewser (restart, exit), and so did L and R in test K1, which is
 * why ZL/ZR switch tabs; later the user found L and R free, and pages use them for their own actions
 * (in battle: L Mega Evolves, R forfeits). The build's
 * "button mappings" go the other way: they let a computer keyboard drive the Switch controls in the web
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
  | 'first'
  | 'last';

/**
 * The shoulder buttons and R3 (the right stick pressed), whose meaning depends on the page (see
 * KeyboardNavigation.registerButton). ZL and ZR switch the header's tabs unless the page uses them (the
 * battle, which has no header).
 */
export type PageButton = 'buttonL' | 'buttonR' | 'buttonZL' | 'buttonZR' | 'buttonR3';

/**
 * Each button and the key that stands for it on a computer keyboard (the build's button mappings, for
 * the web version). The header's legend shows the ones with a `legend`.
 */
export const CONSOLE_BUTTONS: readonly { button: string; key: string; action: string; legend?: string }[] = [
  { button: 'D-pad', key: 'W / A / S / D', action: 'Move focus; left/right change a list box option' },
  { button: 'A', key: 'J', action: 'Press the focused control; start typing in a text field', legend: 'Select' },
  { button: 'B', key: 'K', action: 'Back', legend: 'Back' },
  { button: 'ZL/ZR', key: 'Z / C', action: "The page's own actions (battle: open team sheet / battle log; teambuilder: Validate / Delete or Remove)" },
  { button: 'L / R', key: 'Q / E', action: "The page's own actions, shown next to them (battle: Mega Evolve / Forfeit; teambuilder: Details / Stats)" },
  { button: 'R3', key: 'R', action: "The right stick pressed: the page's own action (battle: battle timer)" },
];

/**
 * Gamepad API button indices as Brewser reports them (seen on device: A=0, B=1, ZL=6, ZR=7, d-pad
 * 12–15, the standard mapping's positions for those labels). L=4, R=5 and R3=11 (the right stick
 * pressed) are the standard mapping's too.
 */
export const GAMEPAD_BUTTONS: readonly (readonly [number, InputAction])[] = [
  [0, 'accept'],
  [1, 'back'],
  [6, 'prevTab'],
  [7, 'nextTab'],
  [4, 'buttonL'],
  [5, 'buttonR'],
  [11, 'buttonR3'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
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

/** A key that types a character (a letter button does too, while a text field is being edited). */
export function isTypingKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.key) return event.key.length === 1;
  return (event.keyCode >= 48 && event.keyCode <= 90) || event.keyCode === 32;
}

/** The Enter key itself (not the A button's letter), for text fields that act on Enter. */
export function isEnterKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === 'NumpadEnter' || event.keyCode === 13;
}
