import { Component, ElementRef, computed, inject, input, model, output, viewChild } from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { RETRO_INPUT } from '@shared/ui/retro-classes';
import { OnScreenKeyboard } from './on-screen-keyboard/on-screen-keyboard.service';

/** The keyboard's limit when neither the field nor its form sets one. */
const DEFAULT_MAX_LENGTH = 64;
/** More stars than this wouldn't fit a field; the length stays hidden past it anyway. */
const MAX_STARS = 24;

/**
 * A text field typed with the app's on-screen keyboard (see OnScreenKeyboard): a button that looks
 * like a retro input, showing the text (stars when masked) or the placeholder. A or a touch opens the
 * keyboard. No real input, so the console's own keyboard, which only works by touch, never opens.
 * Binds `[(value)]` or a signal form's `[formField]` (whose maxLength the keyboard then keeps to).
 */
@Component({
  selector: 'app-keyboard-field',
  host: { class: 'block' },
  template: `
    <button
      #button
      type="button"
      [class]="fieldClass()"
      class="block cursor-text"
      [style.width.px]="width()"
      [style.height.px]="height()"
      [attr.aria-label]="spokenLabel()"
      [attr.aria-describedby]="describedBy()"
      aria-haspopup="dialog"
      (click)="edit()"
    >
      <!-- A block span with the button's inner height as leading: element content sits top-left otherwise on the console. -->
      <span
        class="block text-left whitespace-nowrap"
        [class.text-retro-muted]="!value()"
        [style.line-height.px]="height() - 4"
        >{{ shown() }}</span
      >
    </button>
  `,
})
export class KeyboardField implements FormValueControl<string> {
  private readonly keyboard = inject(OnScreenKeyboard);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');

  readonly value = model('');
  readonly maxLength = input<number | undefined>(undefined);
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly masked = input(false);
  readonly describedBy = input<string | null>(null);
  readonly width = input.required<number>();
  readonly height = input.required<number>();
  readonly textSize = input<'text-lg' | 'text-2xl'>('text-2xl');
  /** A line the keyboard shows for the text typed so far (a search's matches). */
  readonly hint = input<((text: string) => string) | null>(null);
  /**
   * Empties the field once OK hands over the text (a chat message, sent when accepted). Done here
   * because a parent clearing its bound value from `accepted` wouldn't reach the field: to change
   * detection the value goes from empty to empty.
   */
  readonly clearOnAccept = input(false);

  /** OK was pressed on the keyboard (after the value is set and focus is back on the field). */
  readonly accepted = output<string>();

  protected readonly fieldClass = computed(() => RETRO_INPUT.replace('text-base', this.textSize()));

  protected readonly shown = computed(() => {
    const value = this.value();
    if (!value) return this.placeholder();
    return this.masked() ? '*'.repeat(Math.min(value.length, MAX_STARS)) : value;
  });

  protected readonly spokenLabel = computed(() => {
    const value = this.value();
    if (!value) return `${this.label()}, empty`;
    return this.masked() ? `${this.label()}, ${value.length} characters` : `${this.label()}, ${value}`;
  });

  /** Moves focus to the field (not the keyboard: that opens with A). */
  focus(): void {
    this.navigation.focus(this.button().nativeElement);
  }

  /** Opens the keyboard on the field's text, as A on it does (a page's shortcut button calls it too). */
  edit(): void {
    this.keyboard.open({
      label: this.label(),
      value: this.value(),
      maxLength: this.maxLength() ?? DEFAULT_MAX_LENGTH,
      masked: this.masked(),
      hint: this.hint(),
      returnTo: this.button().nativeElement,
      done: (value) => {
        if (value === null) return;
        this.value.set(value);
        this.accepted.emit(value);
        if (this.clearOnAccept()) this.value.set('');
      },
    });
  }
}
