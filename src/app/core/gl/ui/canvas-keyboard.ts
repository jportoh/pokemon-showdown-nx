import { Service, inject, signal } from '@angular/core';
import { CanvasFocus, focusInput } from '../canvas-ui';
import { GlStage, StageFrame } from '../gl-stage';
import { TextStyle, TextTextures } from '../gl-textures';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { PLATFORM } from '@core/runtime/platform';
import { GlTheme } from './gl-theme';
import { UiContext, button, label, pill } from './retro-kit';

/** What the keyboard is typing: a field's text, from its current value. */
export interface KeyboardEntry {
  /** The field's name, shown over the text. */
  label: string;
  value: string;
  maxLength: number;
  /** Stars instead of the text (passwords). */
  masked?: boolean;
  /** A line shown for the text typed so far (a search's matches); how A and B work otherwise. */
  hint?: (text: string) => string;
  /** The text when OK is pressed, null when cancelled. */
  done: (value: string | null) => void;
}

/** The character keys, row by row: each one's character and its character with Shift. */
const ROWS: readonly (readonly (readonly [string, string])[])[] = [
  [['1', '!'], ['2', '@'], ['3', '#'], ['4', '$'], ['5', '%'], ['6', '&'], ['7', '*'], ['8', '('], ['9', ')'], ['0', '=']],
  [['q', 'Q'], ['w', 'W'], ['e', 'E'], ['r', 'R'], ['t', 'T'], ['y', 'Y'], ['u', 'U'], ['i', 'I'], ['o', 'O'], ['p', 'P']],
  [['a', 'A'], ['s', 'S'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'H'], ['j', 'J'], ['k', 'K'], ['l', 'L'], ['-', '+']],
  [['z', 'Z'], ['x', 'X'], ['c', 'C'], ['v', 'V'], ['b', 'B'], ['n', 'N'], ['m', 'M'], ['_', '/'], ['.', ':'], [',', '?']],
];
const KEY_LEFT = 64;
const KEY_STEP_X = 116;
const KEY_TOP = 200;
const KEY_STEP_Y = 88;
const FIRST_KEY = 'key-1-0';
/** The keys' characters, and the bottom keys' names and buttons. */
const KEY_STYLE: TextStyle = { size: 30, bold: true };
const KEY_FIT = 88;
const BOTTOM_STYLE: TextStyle = { size: 24, bold: true };
const PILL_STYLE: TextStyle = { size: 14, bold: true };
const FOOTER = 'A types the key pointed at · B deletes (held, it keeps deleting), or cancels once empty · ZL cancels';
/** B cancels an empty entry only when pressed this long after the last B (longer than a held B's first repeat). */
const BACK_PAUSE_MS = 500;
const FOOTER_STYLE: TextStyle = { size: 20 };
const FOOTER_WIDTH = 1152;
/** Texts made per call of warm(), so the loading screen keeps its pace. */
const WARM_PER_FRAME = 12;

/** OK: + on the native .nro, as the console's own keyboard (Brewser keeps + for itself), else ZR. */
const OK_BUTTON = PLATFORM === 'native' ? 'buttonPlus' : 'buttonZR';

type BottomKey = 'shift' | 'space' | 'delete' | 'cancel' | 'ok';
const BOTTOM: readonly { id: BottomKey; text: string; button: string }[] = [
  { id: 'shift', text: 'Shift', button: 'L' },
  { id: 'space', text: 'Space', button: 'R' },
  { id: 'delete', text: 'Delete', button: 'B' },
  { id: 'cancel', text: 'Cancel', button: 'ZL' },
  { id: 'ok', text: 'OK', button: OK_BUTTON === 'buttonPlus' ? '+' : 'ZR' },
];

/**
 * The app's on-screen keyboard, drawn on the canvas over the whole stage (for the screens' text
 * fields): the field's name, the text, and the
 * keys, which the d-pad walks (round each row) and A types. B deletes (held, it repeats; pressed with nothing written, it cancels), L is
 * Shift, R a space, ZR OK (+ on the native .nro) and ZL Cancel; the mouse clicks keys, and a computer's keyboard types.
 * It never opens on its own (the console's own keyboard must not open either): a field opens it on A.
 */
@Service()
export class CanvasKeyboard {
  private readonly stage = inject(GlStage);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly theme = inject(GlTheme);

  /** The entry being typed, or null while closed. */
  readonly entry = signal<KeyboardEntry | null>(null);
  private text = '';
  private shift = false;
  /** When B was last pressed (or repeated), so a held B doesn't cancel. */
  private lastBack = -1e9;
  private readonly focus = new CanvasFocus();
  private release: (() => void)[] = [];
  /** The keyboard's texts still to make ahead (see warm). */
  private toWarm: (() => void)[] | null = null;

  /**
   * Makes the keyboard's texts ahead, a few per call (the loading screen calls it each frame): the
   * first time it opens, its keys are all there at once instead of coming in over a few frames.
   * Returns true once done.
   */
  warm(text: TextTextures): boolean {
    this.toWarm ??= [
      ...ROWS.flat()
        .flat()
        .map((character) => () => text.get(text.fit(character, KEY_STYLE, KEY_FIT), KEY_STYLE)),
      ...BOTTOM.flatMap((key) => [() => text.get(key.text, BOTTOM_STYLE), () => (text.measure(key.button, PILL_STYLE), text.get(key.button, PILL_STYLE))]),
      () => text.get(text.fit(FOOTER, FOOTER_STYLE, FOOTER_WIDTH), FOOTER_STYLE),
    ];
    this.toWarm.splice(0, WARM_PER_FRAME).forEach((make) => make());
    return this.toWarm.length === 0;
  }

  open(entry: KeyboardEntry): void {
    this.close(null);
    this.entry.set(entry);
    this.text = entry.value;
    this.shift = false;
    this.focus.focus(FIRST_KEY);
    this.navigation.repeatBack = true;
    this.release = [
      () => (this.navigation.repeatBack = false),
      this.navigation.registerButton('buttonL', () => ((this.shift = !this.shift), true)),
      this.navigation.registerButton('buttonR', () => (this.type(' '), true)),
      this.navigation.registerButton(OK_BUTTON, () => (this.close(this.text), true)),
      this.navigation.registerButton('buttonZL', () => (this.close(null), true)),
      this.navigation.registerButton('buttonR3', () => true),
      this.navigation.registerTextInput((event) => this.onComputerKey(event)),
    ];
    this.stage.setOverlay({
      draw: (frame) => this.draw(frame),
      input: (action) => {
        // B deletes (held, it goes on deleting); pressed afresh with nothing written, it cancels. A held
        // B that has just emptied the text only stops there: its repeats come closer together than
        // BACK_PAUSE_MS, so only a new press after a pause closes.
        if (action === 'back') {
          const now = performance.now();
          const fresh = now - this.lastBack > BACK_PAUSE_MS;
          this.lastBack = now;
          if (this.text === '' && fresh) this.close(null);
          else this.text = this.text.slice(0, -1);
          return true;
        }
        if ((action === 'left' || action === 'right') && this.wrap(action)) return true;
        return focusInput(this.focus, action) ?? true;
      },
      click: (x, y) => this.focus.click(x, y),
      hover: (x, y) => this.focus.hover(x, y),
    });
  }

  /** Closes with the typed text (OK), or null (cancelled). */
  close(value: string | null): void {
    const entry = this.entry();
    if (!entry) return;
    this.release.forEach((fn) => fn());
    this.release = [];
    this.stage.setOverlay(null);
    this.entry.set(null);
    entry.done(value);
  }

  /** Right from a row's last key goes to its first one, left from its first key to its last. */
  private wrap(direction: 'left' | 'right'): boolean {
    const focused = this.focus.focused ?? '';
    const row = /^key-(\d+)-\d+$/.exec(focused)?.[1];
    const ids = focused.startsWith('bottom-')
      ? BOTTOM.map((key) => `bottom-${key.id}`)
      : row !== undefined
        ? ROWS[Number(row)].map((_, c) => `key-${row}-${c}`)
        : [];
    if (!ids.length || focused !== (direction === 'right' ? ids[ids.length - 1] : ids[0])) return false;
    this.focus.focus(direction === 'right' ? ids[0] : ids[ids.length - 1]);
    return true;
  }

  private type(character: string): void {
    const entry = this.entry();
    if (entry && this.text.length < entry.maxLength) this.text += character;
  }

  private press(key: BottomKey): void {
    switch (key) {
      case 'shift':
        this.shift = !this.shift;
        return;
      case 'space':
        return this.type(' ');
      case 'delete':
        this.text = this.text.slice(0, -1);
        return;
      case 'cancel':
        return this.close(null);
      case 'ok':
        return this.close(this.text);
    }
  }

  /** A computer's keyboard: characters type, Backspace deletes, Enter is OK, Escape cancels. */
  private onComputerKey(event: KeyboardEvent): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key === 'Backspace') this.text = this.text.slice(0, -1);
    else if (event.key === 'Enter') this.close(this.text);
    else if (event.key === 'Escape') this.close(null);
    else if (event.key?.length === 1) this.type(event.key);
    else return false;
    return true;
  }

  private draw(frame: StageFrame): void {
    const entry = this.entry();
    if (!entry) return;
    // Over the whole stage, all at once: its texts aren't held back for the frame's budget (they're
    // made on the loading screen; one gone from the cache since comes back in this frame).
    const budget = frame.text.budgetMs;
    frame.text.budgetMs = Infinity;
    try {
      this.drawKeyboard(frame, entry);
    } finally {
      frame.text.budgetMs = budget;
    }
  }

  private drawKeyboard(frame: StageFrame, entry: KeyboardEntry): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer } = frame;
    this.focus.begin();
    renderer.rect(0, 0, 1280, 720, { fill: p.bg });
    label(ctx, entry.label, KEY_LEFT, 52, { size: 30, bold: true }, p.ink, { maxWidth: 900 });
    label(ctx, `${this.text.length}/${entry.maxLength}`, 1216, 52, { size: 24 }, p.muted, { align: 'right', fast: true });
    renderer.rect(KEY_LEFT, 88, 1152, 80, { fill: p.input, stroke: p.outline, radius: 6, border: 2 });
    const shown = (entry.masked ? '•'.repeat(this.text.length) : this.text) + '_';
    // Long text shows its end.
    const fitted = shown.length > 46 ? shown.slice(-46) : shown;
    label(ctx, fitted, KEY_LEFT + 16, 128, { size: 36 }, p.ink, { fast: true });

    ROWS.forEach((row, r) =>
      row.forEach(([normal, shifted], c) => {
        const character = this.shift ? shifted : normal;
        button(ctx, `key-${r}-${c}`, { x: KEY_LEFT + c * KEY_STEP_X, y: KEY_TOP + r * KEY_STEP_Y, w: KEY_FIT + 16, h: 76 }, character, { size: KEY_STYLE.size, accept: () => this.type(character) });
      }),
    );
    BOTTOM.forEach((key, i) => {
      const box = { x: KEY_LEFT + i * 2 * KEY_STEP_X, y: 552, w: 2 * KEY_STEP_X - 12, h: 76 };
      const focused = button(ctx, `bottom-${key.id}`, box, '', { primary: key.id === 'ok', accept: () => this.press(key.id) });
      if (key.id === 'shift' && this.shift) renderer.rect(box.x + 2, box.y + 2, box.w - 4, box.h - 4, { fill: p.select, radius: 5 });
      const width = pill(ctx, key.button, box.x + 12, box.y + box.h / 2, 36);
      label(ctx, key.text, box.x + 12 + width + (box.w - 24 - width) / 2, box.y + box.h / 2, BOTTOM_STYLE, key.id === 'ok' ? [1, 1, 1, 1] : p.ink, { align: 'center' });
      if (focused && key.id === 'shift' && this.shift) renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: [0.98, 0.8, 0.08, 1], radius: 6, border: 3 });
    });
    const footer = entry.hint ? entry.hint(this.text) : FOOTER;
    label(ctx, footer, KEY_LEFT, 672, FOOTER_STYLE, p.muted, { maxWidth: FOOTER_WIDTH });
    this.focus.end();
    renderer.end();
  }
}
