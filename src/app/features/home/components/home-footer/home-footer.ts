import { Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { ServerStats } from '@features/connection/server-stats';
import { ShowdownChallenges } from '@features/connection/showdown-challenges';
import { ChallengeNotice } from '@features/home/components/challenge-notice/challenge-notice';
import { groupDigits } from '@shared/utils/group-digits';

/**
 * The bar under the home menu, 1184x64: on the left, the controller's buttons on this screen (the
 * d-pad drawn as a cross, then A, ZR and L when it does something), and on the right how many players
 * and battles there are on Showdown while connected, or, while someone challenges us, the notice
 * saying so. ZR and L are also buttons for a click (the header only shows who we are); like the
 * console's, they aren't on the d-pad's path (data-kb-skip). Every part has a fixed place, with L
 * last so hiding it leaves no gap, and the counts anchored by their right edge (Brewser ignores
 * `text-align: right`); only texts change at runtime.
 */
@Component({
  selector: 'app-home-footer',
  imports: [ChallengeNotice],
  // No `relative` here: the parent places it with `absolute` (both set `position`, and `relative` wins).
  host: { class: 'block h-16 w-[1184px] text-xl text-retro-ink', role: 'group', 'aria-label': 'Controls and players online' },
  template: `
    <div aria-hidden="true" class="absolute top-0 left-0 block h-16 w-[1184px] rounded-2xl bg-retro-bar"></div>

    <span aria-hidden="true" class="absolute top-[27px] left-[30px] block h-[10px] w-7 rounded-sm bg-retro-select"></span>
    <span aria-hidden="true" class="absolute top-[18px] left-[39px] block h-7 w-[10px] rounded-sm bg-retro-select"></span>
    <span class="absolute top-[18px] left-[78px] block h-7 w-20 leading-7 whitespace-nowrap">Move</span>

    <span class="absolute top-[18px] left-[182px] block h-7 w-10 rounded-sm bg-retro-select text-center leading-7">A</span>
    <span class="absolute top-[18px] left-[236px] block h-7 w-20 leading-7 whitespace-nowrap">Select</span>

    <button type="button" data-kb-skip class="absolute top-[12px] left-[332px] block h-10 w-[188px] cursor-pointer rounded-md hover:bg-retro-select" [attr.aria-label]="zrLabel()" (click)="zr.emit()">
      <span aria-hidden="true" class="absolute top-[6px] left-[8px] block h-7 w-10 rounded-sm bg-retro-select text-center leading-7">ZR</span>
      <span aria-hidden="true" class="absolute top-[6px] left-[62px] block h-7 w-[120px] text-left leading-7 whitespace-nowrap">{{ zrLabel() }}</span>
    </button>

    <div class="block" [class.hidden]="!lLabel()">
      <button type="button" data-kb-skip class="absolute top-[12px] left-[530px] block h-10 w-[164px] cursor-pointer rounded-md hover:bg-retro-select" [attr.aria-label]="lLabel()" (click)="l.emit()">
        <span aria-hidden="true" class="absolute top-[6px] left-[8px] block h-7 w-10 rounded-sm bg-retro-select text-center leading-7">L</span>
        <span aria-hidden="true" class="absolute top-[6px] left-[62px] block h-7 w-[96px] text-left leading-7 whitespace-nowrap">{{ lLabel() }}</span>
      </button>
    </div>

    <div class="block" [class.hidden]="!countsText()">
      <span class="absolute top-[18px] right-[24px] block h-7 leading-7 whitespace-nowrap text-retro-muted">{{ countsText() }}</span>
    </div>
    <app-challenge-notice class="absolute top-[14px] left-[780px]" />
  `,
})
export class HomeFooter {
  private readonly stats = inject(ServerStats);
  private readonly challenges = inject(ShowdownChallenges);

  /** Offline: no counts. */
  readonly offline = input.required<boolean>();
  /** What ZR does now: Log in, Log out, Disconnect or Press again (to confirm). */
  readonly zrLabel = input.required<string>();
  /** What L does now (Card or Register), or nothing. */
  readonly lLabel = input<string | null>(null);

  /** ZR's button was clicked. */
  readonly zr = output();
  /** L's button was clicked. */
  readonly l = output();

  protected readonly countsText = computed(() => {
    const counts = this.stats.counts();
    if (this.offline() || !counts || this.challenges.incoming().length > 0) return '';
    return `${groupDigits(counts.users)} online · ${groupDigits(counts.battles)} battles`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(this.stats.watch());
  }
}
