import { Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { isEnterKey } from '@core/input/console-keys';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { RETRO_INPUT } from '@shared/ui/retro-classes';

/** How often the input's value is read: the console's keyboard may fill it without any event. */
const POLL_MS = 250;

/** More stars than this wouldn't fit the field; the length stays hidden past it anyway. */
const MAX_STARS = 24;

/**
 * A password field in the retro style that hides what's typed on every engine: Brewser draws a
 * `type="password"` input's text in the clear, so the input's own text is painted in its background
 * colour and stars drawn over it (plain "*": the console's font lacks some symbols) stand for its
 * characters. The value is read from the input itself (see LoginForm), polled while it's shown.
 * The input keeps the focus ring and opens the on-screen keyboard as any other.
 */
@Component({
  selector: 'app-password-field',
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block' },
  template: `
    <div class="block" [style.width.px]="width()" [style.height.px]="height()">
      <input
        #input
        type="password"
        [attr.autocomplete]="autocomplete()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-describedby]="describedBy()"
        [placeholder]="placeholder()"
        (input)="read()"
        (change)="read()"
        (keydown)="onKeydown($event)"
        [class]="inputClass"
        class="absolute top-0 left-0"
        [style.width.px]="width()"
        [style.height.px]="height()"
      />
      <span
        aria-hidden="true"
        class="pointer-events-none absolute left-[12px] block h-8 overflow-hidden text-2xl leading-8 whitespace-nowrap text-retro-ink"
        [style.top.px]="(height() - 32) / 2"
        [style.width.px]="width() - 24"
        >{{ stars() }}</span
      >
    </div>
  `,
})
export class PasswordField {
  private readonly render = inject(RenderScheduler);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  readonly ariaLabel = input.required<string>();
  readonly placeholder = input('');
  readonly autocomplete = input('current-password');
  readonly describedBy = input<string | null>(null);
  readonly width = input.required<number>();
  readonly height = input.required<number>();

  /** Enter in the field (the web's keyboard; the console's closes with a change instead). */
  readonly enter = output<void>();

  // The retro input, with its text in the field's own colour and the size the stars use.
  protected readonly inputClass = RETRO_INPUT.replace('text-retro-ink', 'text-retro-input').replace('text-base', 'text-2xl');

  private readonly length = signal(0);
  protected readonly stars = computed(() => '*'.repeat(Math.min(this.length(), MAX_STARS)));

  constructor() {
    const timer = setInterval(() => this.read(), POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** What's typed, as the input holds it now. */
  value(): string {
    return this.input().nativeElement.value;
  }

  clear(): void {
    this.input().nativeElement.value = '';
    this.read();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!isEnterKey(event)) return;
    event.preventDefault();
    this.enter.emit();
  }

  protected read(): void {
    const length = this.value().length;
    if (length === this.length()) return;
    this.length.set(length);
    this.render.request();
  }
}
