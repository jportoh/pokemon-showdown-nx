import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';

/** What the on-screen keyboard is typing: a field's text, from its current value. */
export interface TextEntry {
  /** The field's name, shown over the text. */
  label: string;
  value: string;
  maxLength: number;
  /** Stars instead of the text (passwords). */
  masked: boolean;
  /** A line shown for the text typed so far (a search's matches), or null. */
  hint: ((text: string) => string) | null;
  /** The control focus goes back to when the keyboard closes (the field). */
  returnTo: HTMLElement;
  /** The text when OK is pressed, null when cancelled. */
  done: (value: string | null) => void;
}

/**
 * Opens the app's own on-screen keyboard (OnScreenKeyboardPanel, over the whole stage) for a text
 * field. The console's own keyboard opens for real text inputs and only works by touch, so fields use
 * KeyboardField (a button) and type with this one, which the controller drives.
 */
@Service()
export class OnScreenKeyboard {
  private readonly render = inject(RenderScheduler);

  private readonly entrySignal = signal<TextEntry | null>(null);
  /** The entry being typed, or null while closed. */
  readonly entry = this.entrySignal.asReadonly();
  /** Counts the openings, so the panel focuses its first key once each one has rendered. */
  readonly opened = signal(0);

  open(entry: TextEntry): void {
    this.entrySignal.set(entry);
    this.opened.update((count) => count + 1);
    this.render.request();
  }

  /** Closes with the typed text (OK), or null (cancelled). */
  close(value: string | null): void {
    const entry = this.entrySignal();
    if (!entry) return;
    this.entrySignal.set(null);
    this.render.request();
    entry.done(value);
  }
}
