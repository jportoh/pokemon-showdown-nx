/**
 * What each controller button and key does, so the whole app works with them alone (no mouse or touch).
 *
 * On the console the buttons reach the app through the Gamepad API (KeyboardNavigation polls it). In
 * the web version (development) keys stand for the Switch controls: the letters below, plus arrows,
 * Enter and Escape for computer keyboards.
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
  | 'buttonMinus'
  | 'buttonX'
  | 'buttonY'
  | 'first'
  | 'last';

/**
 * The shoulder buttons, R3 and L3 (the sticks pressed), X, Y, + and −, whose meaning depends on the
 * screen (see KeyboardNavigation.registerButton).
 */
export type PageButton = 'buttonL' | 'buttonR' | 'buttonZL' | 'buttonZR' | 'buttonR3' | 'buttonL3' | 'buttonPlus' | 'buttonMinus' | 'buttonX' | 'buttonY';

/**
 * Gamepad API button indices, numbered by position as in the standard mapping, which nx.js follows
 * (test x1): B=0 (bottom), A=1 (right), Y=2 (left), X=3 (top), L=4, R=5, ZL=6, ZR=7, −=8, +=9,
 * L3=10 and R3=11 (the sticks pressed), the d-pad 12–15. + doesn't exit (native/app/plus-button.ts):
 * leaving is the console's HOME button.
 */
export const GAMEPAD_BUTTONS: readonly (readonly [number, InputAction])[] = [
  [0, 'back'],
  [1, 'accept'],
  [2, 'buttonY'],
  [3, 'buttonX'],
  [4, 'buttonL'],
  [5, 'buttonR'],
  [6, 'prevTab'],
  [7, 'nextTab'],
  [8, 'buttonMinus'],
  [9, 'buttonPlus'],
  [10, 'buttonL3'],
  [11, 'buttonR3'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
];

// Keyed by `KeyboardEvent.key` (lower-cased), then `code`, then the legacy `keyCode`.
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
  x: 'buttonX',
  y: 'buttonY',
  '+': 'buttonPlus',
  '=': 'buttonPlus',
  '-': 'buttonMinus',
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
  KeyX: 'buttonX',
  KeyY: 'buttonY',
  Equal: 'buttonPlus',
  NumpadAdd: 'buttonPlus',
  Minus: 'buttonMinus',
  NumpadSubtract: 'buttonMinus',
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
  88: 'buttonX',
  89: 'buttonY',
  187: 'buttonPlus',
  107: 'buttonPlus',
  189: 'buttonMinus',
  109: 'buttonMinus',
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


/** A role a button has across the app, and the key the legends show for it. */
export interface RoleKey {
  readonly button: PageButton;
  readonly label: string;
}

/**
 * The buttons with one meaning across the app: Y searches, X is the focused thing's option
 * (favourite, edit the rival, the battle timer), + confirms or sends. Screens register a role's
 * button and draw its label.
 */
export const ROLE_KEYS = {
  /** An open list's search (R3 searches too). */
  search: { button: 'buttonY', label: 'Y' },
  /** The teambuilder grid's favourite team, so R only ever means "next" there. */
  favourite: { button: 'buttonX', label: 'X' },
  /** Calcs: edit the rival's set. */
  editRival: { button: 'buttonX', label: 'X' },
  /** A battle's menu (sound, look, timer, team sheets, the rival's card, forfeit). */
  battleMenu: { button: 'buttonPlus', label: '+' },
  /** A battle's Pokémon on the field, at a glance. */
  fieldView: { button: 'buttonY', label: 'Y' },
  /**
   * Team preview's picks, sent (Done): R, free there (in battle it Mega Evolves or Terastallizes),
   * so + opens the menu during team preview too.
   */
  previewDone: { button: 'buttonR', label: 'R' },
  /** A chat room's message, written (the on-screen keyboard, whose OK is + too). */
  chatWrite: { button: 'buttonPlus', label: '+' },
  /** The teambuilder editor's "none" (No item, No move), Stats' undo, the Calcs field's reset: the option of what's open. */
  clear: { button: 'buttonX', label: 'X' },
  /** The teambuilder editor's Remove (held), so ZL/ZR go through the team's Pokémon. */
  removePokemon: { button: 'buttonMinus', label: '-' },
  /** Calcs: who attacks, swapped. */
  calcsSwap: { button: 'buttonMinus', label: '-' },
  /** Watch Live: the focused battle's details (its teams and turn), in a box over the list. */
  battleDetails: { button: 'buttonX', label: 'X' },
  /** The Trainer Card's battle history (it has a button too). */
  cardHistory: { button: 'buttonX', label: 'X' },
  /** Calcs: the field (weather, terrain, screens…). */
  calcsField: { button: 'buttonPlus', label: '+' },
} as const satisfies Record<string, RoleKey>;

/**
 * A battle's shortcuts: X opens the party screen while choosing a move (Switch shows its chip), −
 * turns the timer on or off, L held shows the last turn's log over the field. The chat is written
 * from Battle info's log (A).
 */
export const BATTLE_SHORTCUTS = {
  party: { button: 'buttonX', label: 'X' },
  timer: { button: 'buttonMinus', label: '-' },
  log: { button: 'buttonL', label: 'L' },
} as const satisfies Record<string, RoleKey>;

/** The home menu's Settings, straight from anywhere on it (X, its chip on the button). On the Trainer Card, X is its history. */
export const HOME_SETTINGS_KEY: RoleKey = { button: 'buttonX', label: 'X' };
