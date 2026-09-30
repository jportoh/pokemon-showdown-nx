import { Directive, ElementRef, Renderer2, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  Router,
} from '@angular/router';
import { OnScreenKeyboard } from '@shared/components/on-screen-keyboard/on-screen-keyboard.service';

/**
 * Marks a scrolling region (overflow-y: auto). On the Brewser console, scroll regions are painted
 * over anything drawn above them: a page's regions stayed painted over the next page after navigating
 * away, and over the on-screen keyboard while it was open (the chat log showed through its keys).
 * So the region is hidden while either happens. Angular removes the page from the DOM before
 * ngOnDestroy runs, so it's reset and hidden as soon as a navigation starts, and shown again if the
 * navigation ends up keeping this page (cancelled, skipped or failed). Behind the keyboard it keeps
 * its scroll position.
 */
@Directive({ selector: '[appScrollRegion]' })
export class ScrollRegion {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);

  private navigating = false;
  private behindKeyboard = false;
  /** The scroll position when the keyboard opened, restored once it closes. */
  private savedScrollTop = 0;

  constructor() {
    inject(Router)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.element.scrollTop = 0;
          this.savedScrollTop = 0;
          this.navigating = true;
          this.update();
        } else if (
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError ||
          event instanceof NavigationSkipped
        ) {
          this.navigating = false;
          this.update();
        }
      });

    const keyboard = inject(OnScreenKeyboard);
    effect(() => {
      const open = keyboard.entry() !== null;
      if (open === this.behindKeyboard) return;
      if (open) this.savedScrollTop = this.element.scrollTop;
      this.behindKeyboard = open;
      this.update();
      if (!open && !this.navigating) this.element.scrollTop = this.savedScrollTop;
    });
  }

  private update(): void {
    if (this.navigating || this.behindKeyboard) this.renderer.setStyle(this.element, 'display', 'none');
    else this.renderer.removeStyle(this.element, 'display');
  }
}
