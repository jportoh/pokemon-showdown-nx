import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { ChallengeNotice } from '@features/home/components/challenge-notice/challenge-notice';
import { TrainerStatus } from '@features/home/components/trainer-status/trainer-status';
import { BackAction } from '@shared/directives/back-action';
import { PixelIcon, PixelIconName } from '@shared/components/pixel-icon';
import { filter, map } from 'rxjs';

/** What a page under this frame declares in its route's `data`. */
export interface PageInfo {
  title: string;
  icon: PixelIconName;
  /** Where B goes back to, when it isn't the home menu (a page opened from another page). */
  back?: string;
}

/**
 * The frame of the pages opened from the home menu: a 76px status bar with the page's title, the way
 * back (B, from anywhere in the page that doesn't use B itself) and the trainer's status, over the
 * 644px page. (Home and the battle take the whole stage, outside this frame.)
 */
@Component({
  imports: [BackAction, ChallengeNotice, PixelIcon, RouterOutlet, TrainerStatus],
  selector: 'app-main-layout',
  host: { class: 'block h-[720px] w-[1280px]' },
  templateUrl: './main-layout.html',
})
export class MainLayout {
  private readonly router = inject(Router);
  private readonly navigation = inject(KeyboardNavigation);

  protected readonly page = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => pageInfo(this.router.routerState.snapshot.root)),
    ),
    { initialValue: pageInfo(this.router.routerState.snapshot.root) },
  );

  protected readonly backLabel = computed(() => (this.page()?.back ? 'Back to the previous page' : 'Back to the menu'));

  /**
   * B goes back to the home menu, which puts focus back on the item that opened this page, or to the
   * page this one was opened from, which starts on its `data-autofocus` control.
   */
  protected back(): void {
    const back = this.page()?.back;
    if (back) this.navigation.focusPageAfterNavigation();
    void this.router.navigateByUrl(back ?? '/');
  }
}

/** The deepest route's page info. */
function pageInfo(route: ActivatedRouteSnapshot): PageInfo | null {
  let deepest = route;
  while (deepest.firstChild) deepest = deepest.firstChild;
  return (deepest.data['page'] as PageInfo | undefined) ?? null;
}
