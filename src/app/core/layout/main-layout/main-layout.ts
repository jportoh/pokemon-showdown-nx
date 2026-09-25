import { NgOptimizedImage } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CONSOLE_BUTTONS } from '@core/input/console-keys';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';

/** The header's tabs, in order: L/R step through them. */
const TAB_PATHS = ['/', '/teambuilder'];

@Component({
  imports: [NgOptimizedImage, RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-main-layout',
  host: { class: 'flex h-[720px] w-[1280px] flex-col' },
  templateUrl: './main-layout.html',
})
export class MainLayout {
  private readonly router = inject(Router);

  protected readonly legend = CONSOLE_BUTTONS.filter((item) => item.legend);

  constructor() {
    inject(KeyboardNavigation).registerTabSwitcher((step) => this.switchTab(step));
  }

  private switchTab(step: 1 | -1): void {
    const path = this.router.url.split(/[?#]/)[0];
    const current = Math.max(0, TAB_PATHS.indexOf(path));
    const next = TAB_PATHS[(current + step + TAB_PATHS.length) % TAB_PATHS.length];
    void this.router.navigateByUrl(next);
  }
}
