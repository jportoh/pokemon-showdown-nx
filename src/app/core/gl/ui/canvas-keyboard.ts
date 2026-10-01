import { Service, inject, signal } from '@angular/core';
import { CanvasFocus, focusInput } from '../canvas-ui';
import { GlStage, StageFrame } from '../gl-stage';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
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

type BottomKey = 'shift' | 'space' | 'delete' | 'cancel' | 'ok';
const BOTTOM: readonly { id: BottomKey; text: string; button: string }[] = [
  { id: 'shift', text: 'Shift', button: 'L' },
  { id: 'space', text: 'Space', button: 'R' },
  { id: 'delete', text: 'Delete', button: 'B' },
  { id: 'cancel', text: 'Cancel', button: 'ZL' },
  { id: 'ok', text: 'OK', button: 'ZR' },
];

/**
 * The app's on-screen keyboard, drawn on the canvas over the whole stage (for the screens' text
 * fields): the field's name, the text, and the
 * keys, which the d-pad walks and A types. B deletes (and cancels once the text is empty), L is
 * Shift, R a space, ZR OK and ZL Cancel; the mouse clicks keys, and a computer's keyboard types.
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
  private readonly focus = new CanvasFocus();
  private release: (() => void)[] = [];

  open(entry: KeyboardEntry): void {
    this.close(null);
    this.entry.set(entry);
    this.text = entry.value;
    this.shift = false;
    this.focus.focus(FIRST_KEY);
    this.release = [
      this.navigation.registerButton('buttonL', () => ((this.shift = !this.shift), true)),
      this.navigation.registerButton('buttonR', () => (this.type(' '), true)),
      this.navigation.registerButton('buttonZR', () => (this.close(this.text), true)),
      this.navigation.registerButton('buttonZL', () => (this.close(null), true)),
      this.navigation.registerButton('buttonR3', () => true),
      this.navigation.registerTextInput((event) => this.onComputerKey(event)),
    ];
    this.stage.setOverlay({
      draw: (frame) => this.draw(frame),
      input: (action) => {
        if (action === 'back') {
          if (this.text) this.text = this.text.slice(0, -1);
          else this.close(null);
          return true;
        }
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
        button(ctx, `key-${r}-${c}`, { x: KEY_LEFT + c * KEY_STEP_X, y: KEY_TOP + r * KEY_STEP_Y, w: 104, h: 76 }, character, { size: 30, accept: () => this.type(character) });
      }),
    );
    BOTTOM.forEach((key, i) => {
      const box = { x: KEY_LEFT + i * 2 * KEY_STEP_X, y: 552, w: 2 * KEY_STEP_X - 12, h: 76 };
      const focused = button(ctx, `bottom-${key.id}`, box, '', { primary: key.id === 'ok', accept: () => this.press(key.id) });
      if (key.id === 'shift' && this.shift) renderer.rect(box.x + 2, box.y + 2, box.w - 4, box.h - 4, { fill: p.select, radius: 5 });
      const width = pill(ctx, key.button, box.x + 12, box.y + box.h / 2, 36);
      label(ctx, key.text, box.x + 12 + width + (box.w - 24 - width) / 2, box.y + box.h / 2, { size: 24, bold: true }, key.id === 'ok' ? [1, 1, 1, 1] : p.ink, { align: 'center' });
      if (focused && key.id === 'shift' && this.shift) renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: [0.98, 0.8, 0.08, 1], radius: 6, border: 3 });
    });
    const footer = entry.hint ? entry.hint(this.text) : 'A types the key pointed at · B deletes, and cancels once the text is empty';
    label(ctx, footer, KEY_LEFT, 672, { size: 20 }, p.muted, { maxWidth: 1152 });
    this.focus.end();
    renderer.end();
  }
}
