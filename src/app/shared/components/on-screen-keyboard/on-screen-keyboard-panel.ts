import { Component, DestroyRef, ElementRef, afterRenderEffect, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BackAction } from '@shared/directives/back-action';
import { RETRO_PRIMARY_BUTTON, RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';
import { OnScreenKeyboard } from './on-screen-keyboard.service';

/** The character keys, row by row: each one's character and its character with Shift. */
const ROWS: readonly (readonly (readonly [string, string])[])[] = [
  [['1', '!'], ['2', '@'], ['3', '#'], ['4', '$'], ['5', '%'], ['6', '&'], ['7', '*'], ['8', '('], ['9', ')'], ['0', '=']],
  [['q', 'Q'], ['w', 'W'], ['e', 'E'], ['r', 'R'], ['t', 'T'], ['y', 'Y'], ['u', 'U'], ['i', 'I'], ['o', 'O'], ['p', 'P']],
  [['a', 'A'], ['s', 'S'], ['d', 'D'], ['f', 'F'], ['g', 'G'], ['h', 'H'], ['j', 'J'], ['k', 'K'], ['l', 'L'], ['-', '+']],
  [['z', 'Z'], ['x', 'X'], ['c', 'C'], ['v', 'V'], ['b', 'B'], ['n', 'N'], ['m', 'M'], ['_', '/'], ['.', ':'], [',', '?']],
];

/** The key grid: 10 columns of 104px keys, 12px apart, starting 64px from the stage's left edge. */
const KEY_LEFT = 64;
const KEY_STEP_X = 116;
const KEY_TOP = 200;
const KEY_STEP_Y = 88;

/** Past this many characters the text shows its end only (the box fits about 50). */
const SHOWN_CHARS = 46;

interface Key {
  id: string;
  normal: string;
  shifted: string;
  left: number;
  top: number;
}

const KEYS: readonly Key[] = ROWS.flatMap((row, rowIndex) =>
  row.map(([normal, shifted], column) => ({
    id: `${rowIndex}-${column}`,
    normal,
    shifted,
    left: KEY_LEFT + column * KEY_STEP_X,
    top: KEY_TOP + rowIndex * KEY_STEP_Y,
  })),
);

type BottomKeyId = 'shift' | 'space' | 'delete' | 'cancel' | 'ok';

/** The bottom row: five keys two columns wide, each with the controller button that does the same. */
const BOTTOM_ROW: readonly { id: BottomKeyId; label: string; button: string; left: number; width: number }[] = (
  [
    ['shift', 'Shift', 'L'],
    ['space', 'Space', 'R'],
    ['delete', 'Delete', 'B'],
    ['cancel', 'Cancel', 'ZL'],
    ['ok', 'OK', 'ZR'],
  ] as const
).map(([id, label, button], index) => ({ id, label, button, left: KEY_LEFT + index * 2 * KEY_STEP_X, width: 2 * KEY_STEP_X - 12 }));

/**
 * The app's on-screen keyboard (see OnScreenKeyboard), over the whole stage: the field's name, the
 * text, and the keys, which the d-pad walks and A types. B deletes (and cancels once the text is
 * empty), L is Shift, R a space, ZR OK and ZL Cancel. Touch presses the keys as well, and in a browser
 * the computer's keyboard types. Always mounted and hidden while closed: removing a view left its
 * text painted on the console. The character keys hold plain text, so Brewser centres their labels.
 */
@Component({
  imports: [BackAction],
  selector: 'app-on-screen-keyboard',
  host: { class: 'absolute top-0 left-0 z-50 block h-[720px] w-[1280px]', '[class.hidden]': '!entry()' },
  template: `
    <div
      #panel
      role="dialog"
      aria-modal="true"
      aria-labelledby="osk-label"
      class="absolute top-0 left-0 block h-[720px] w-[1280px] bg-retro-bg"
      (appBack)="deleteOrCancel()"
    >
      <p id="osk-label" class="absolute top-[32px] left-[64px] block h-10 w-[900px] text-3xl leading-10 font-bold text-retro-ink">
        {{ entry()?.label ?? '' }}
      </p>
      <p aria-hidden="true" class="absolute top-[36px] right-[64px] block h-8 text-2xl leading-8 text-retro-muted">
        {{ counter() }}
      </p>
      <div class="absolute top-[88px] left-[64px] block h-20 w-[1152px] rounded-md border-2 border-retro-outline bg-retro-input">
        <span
          class="absolute top-[18px] left-[16px] block h-10 w-[1100px] text-4xl leading-10 whitespace-nowrap text-retro-ink"
          [attr.aria-hidden]="entry()?.masked ? 'true' : null"
          >{{ shownText() }}</span
        >
      </div>

      @for (key of keys; track key.id) {
        <button
          type="button"
          [class]="keyClass"
          class="absolute h-[76px] w-[104px] text-3xl"
          [style.left.px]="key.left"
          [style.top.px]="key.top"
          [attr.data-osk-first]="key.id === '1-0' ? '' : null"
          (click)="type(shift() ? key.shifted : key.normal)"
        >
          {{ shift() ? key.shifted : key.normal }}
        </button>
      }

      <!--
        The bottom row, each with its controller button in a pill, as elsewhere in the app. Pill and
        label sit apart, the label in a block span with the inner height as leading: element content
        sat top-left on the console otherwise.
      -->
      @for (key of bottomRow; track key.id) {
        <button
          type="button"
          [class]="key.id === 'ok' ? okClass : keyClass"
          class="absolute top-[552px] h-[76px] text-2xl"
          [class.bg-retro-select]="key.id === 'shift' && shift()"
          [style.left.px]="key.left"
          [style.width.px]="key.width"
          [attr.aria-pressed]="key.id === 'shift' ? shift() : null"
          (click)="pressBottomKey(key.id)"
        >
          <span aria-hidden="true" class="absolute top-[18px] left-[12px] block h-9 w-12 rounded-sm bg-retro-select text-center text-xl leading-9 text-retro-ink">{{
            key.button
          }}</span>
          <span class="absolute top-0 left-[68px] block h-[72px] text-center leading-[72px]" [style.width.px]="key.width - 84">{{ key.label }}</span>
        </button>
      }

      <p aria-live="polite" class="absolute top-[656px] left-[64px] block h-8 w-[1152px] text-xl leading-8 whitespace-nowrap text-retro-muted">
        {{ footer() }}
      </p>
    </div>
  `,
})
export class OnScreenKeyboardPanel {
  private readonly keyboard = inject(OnScreenKeyboard);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  protected readonly keys = KEYS;
  protected readonly bottomRow = BOTTOM_ROW;
  protected readonly keyClass = RETRO_SECONDARY_BUTTON;
  protected readonly okClass = RETRO_PRIMARY_BUTTON;

  protected readonly entry = this.keyboard.entry;
  /** The text typed so far, starting from the field's value at each opening. */
  protected readonly text = linkedSignal(() => this.entry()?.value ?? '');
  protected readonly shift = signal(false);

  /** The field's hint for the text (a search's matches), or how A and B work. */
  protected readonly footer = computed(() => {
    const hint = this.entry()?.hint;
    return hint ? hint(this.text()) : 'A types the key pointed at · B deletes, and cancels once the text is empty';
  });

  protected readonly counter = computed(() => `${this.text().length}/${this.entry()?.maxLength ?? 0}`);
  /**
   * The text (stars for a password) with a caret, its end only when it's long. Never empty: a box
   * that starts empty and gets text later overlaps what's below it on the console.
   */
  protected readonly shownText = computed(() => {
    const text = this.text();
    const shown = this.entry()?.masked ? '*'.repeat(text.length) : text;
    return (shown.length > SHOWN_CHARS ? shown.slice(-SHOWN_CHARS) : shown) + '_';
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    let release: (() => void)[] = [];
    const releaseAll = () => {
      release.forEach((unregister) => unregister());
      release = [];
    };
    destroyRef.onDestroy(releaseAll);

    // While open: the shoulder buttons are the keyboard's, and the computer's keys type.
    effect(() => {
      const open = this.entry() !== null;
      untracked(() => {
        releaseAll();
        if (!open) return;
        this.shift.set(false);
        release = [
          this.navigation.registerButton('buttonL', () => (this.toggleShift(), true)),
          this.navigation.registerButton('buttonR', () => (this.type(' '), true)),
          this.navigation.registerButton('buttonZR', () => (this.accept(), true)),
          this.navigation.registerButton('buttonZL', () => (this.cancel(), true)),
          this.navigation.registerButton('buttonR3', () => true),
          this.navigation.registerTextInput((event) => this.onComputerKey(event)),
        ];
      });
    });

    // Once shown: the d-pad stays on the keys, starting from Q.
    afterRenderEffect(() => {
      if (this.keyboard.opened() === 0) return;
      untracked(() => {
        if (!this.entry()) return;
        const panel = this.panel().nativeElement;
        release.push(this.navigation.trapFocus(panel));
        const first = panel.querySelector<HTMLElement>('[data-osk-first]');
        if (first) this.navigation.focus(first);
      });
    });
  }

  protected pressBottomKey(id: BottomKeyId): void {
    switch (id) {
      case 'shift':
        return this.toggleShift();
      case 'space':
        return this.type(' ');
      case 'delete':
        return this.deleteLast();
      case 'cancel':
        return this.cancel();
      case 'ok':
        return this.accept();
    }
  }

  protected type(character: string): void {
    const entry = this.entry();
    if (!entry || this.text().length >= entry.maxLength) return;
    this.text.update((text) => text + character);
  }

  protected deleteLast(): void {
    this.text.update((text) => text.slice(0, -1));
  }

  /** B: deletes the last character, or cancels once there's none left. */
  protected deleteOrCancel(): void {
    if (this.text()) this.deleteLast();
    else this.cancel();
  }

  protected toggleShift(): void {
    this.shift.update((shift) => !shift);
  }

  protected accept(): void {
    this.finish(this.text());
  }

  protected cancel(): void {
    this.finish(null);
  }

  private finish(value: string | null): void {
    const entry = this.entry();
    if (!entry) return;
    // Focus first: what the field does with the value may move it on (to the next field, a button).
    this.navigation.focus(entry.returnTo);
    this.keyboard.close(value);
  }

  /** A computer's keyboard: characters type, Backspace deletes, Enter is OK. Arrows and Escape navigate. */
  private onComputerKey(event: KeyboardEvent): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key === 'Backspace') {
      this.deleteLast();
      return true;
    }
    if (event.key === 'Enter') {
      this.accept();
      return true;
    }
    if (event.key?.length !== 1) return false;
    this.type(event.key);
    return true;
  }
}
