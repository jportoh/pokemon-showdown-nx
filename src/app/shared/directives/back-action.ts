import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';

/**
 * `(appBack)="…"`: what B (Escape) does while focus is inside this element. The nearest one around
 * the focused control wins, so a view can go back one step (close a list) inside a page that goes
 * back further (close the editor).
 */
@Directive({ selector: '[appBack]' })
export class BackAction {
  readonly appBack = output<void>();

  constructor() {
    const unregister = inject(KeyboardNavigation).registerBack(inject(ElementRef).nativeElement, () => this.appBack.emit());
    inject(DestroyRef).onDestroy(unregister);
  }
}
