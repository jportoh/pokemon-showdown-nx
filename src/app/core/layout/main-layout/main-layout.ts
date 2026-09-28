import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { ChallengeNotice } from '@features/home/components/challenge-notice/challenge-notice';
import { TrainerStatus } from '@features/home/components/trainer-status/trainer-status';
import { BackAction } from '@shared/directives/back-action';
import { PixelIcon, PixelIconName } from '@shared/components/pixel-icon';
import { filter, map } from 'rxjs';

/** What a page under this frame declares in its route's `data`. */
export interface PageInfo {
  title: string;
  icon: PixelIconName;
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

  protected readonly page = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => pageInfo(this.router.routerState.snapshot.root)),
    ),
    { initialValue: pageInfo(this.router.routerState.snapshot.root) },
  );

  /** B goes back to the home menu, which puts focus back on the item that opened this page. */
  protected home(): void {
    void this.router.navigateByUrl('/');
  }
}

/** The deepest route's page info. */
function pageInfo(route: ActivatedRouteSnapshot): PageInfo | null {
  let deepest = route;
  while (deepest.firstChild) deepest = deepest.firstChild;
  return (deepest.data['page'] as PageInfo | undefined) ?? null;
}
