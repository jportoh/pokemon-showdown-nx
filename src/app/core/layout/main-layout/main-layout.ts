import { NgOptimizedImage } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CONSOLE_BUTTONS } from '@core/input/console-keys';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';

/** The header's tabs, in order: ZL/ZR step through them. (A battle takes the whole stage, outside this layout.) */
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
    // Pages that aren't tabs keep ZL/ZR from leaving them by accident.
    if (!TAB_PATHS.includes(path)) return;
    const current = TAB_PATHS.indexOf(path);
    const next = TAB_PATHS[(current + step + TAB_PATHS.length) % TAB_PATHS.length];
    void this.router.navigateByUrl(next);
  }
}
