import { NgOptimizedImage } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CONSOLE_BUTTONS } from '@core/input/console-keys';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleSession } from '@features/battle/state/battle-session';

/** The header's tabs, in order: ZL/ZR step through them. Battle only shows while a battle is open. */
const TAB_PATHS = ['/', '/teambuilder'];
const BATTLE_PATH = '/battle';

@Component({
  imports: [NgOptimizedImage, RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-main-layout',
  host: { class: 'flex h-[720px] w-[1280px] flex-col' },
  templateUrl: './main-layout.html',
})
export class MainLayout {
  private readonly router = inject(Router);

  protected readonly legend = CONSOLE_BUTTONS.filter((item) => item.legend);
  protected readonly battleOpen = inject(BattleSession).active;
  private readonly tabPaths = computed(() => (this.battleOpen() ? [...TAB_PATHS, BATTLE_PATH] : TAB_PATHS));

  constructor() {
    inject(KeyboardNavigation).registerTabSwitcher((step) => this.switchTab(step));
  }

  private switchTab(step: 1 | -1): void {
    const path = this.router.url.split(/[?#]/)[0];
    const paths = this.tabPaths();
    // Pages that aren't tabs keep ZL/ZR from leaving them by accident.
    if (!paths.includes(path)) return;
    const current = paths.indexOf(path);
    const next = paths[(current + step + paths.length) % paths.length];
    void this.router.navigateByUrl(next);
  }
}
