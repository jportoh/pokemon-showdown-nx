import { Directive, ElementRef, Renderer2, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  Router,
} from '@angular/router';

/**
 * Marks a scrolling region (overflow-y: auto). On the Brewser console, a page's scroll regions
 * stayed painted over the next page after navigating away. Angular removes the page from the DOM
 * before ngOnDestroy runs, so the region is reset and hidden as soon as a navigation starts, and
 * shown again if the navigation ends up keeping this page (cancelled, skipped or failed).
 */
@Directive({ selector: '[appScrollRegion]' })
export class ScrollRegion {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);

  constructor() {
    inject(Router)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          this.element.scrollTop = 0;
          this.renderer.setStyle(this.element, 'display', 'none');
        } else if (
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError ||
          event instanceof NavigationSkipped
        ) {
          this.renderer.removeStyle(this.element, 'display');
        }
      });
  }
}
