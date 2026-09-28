import { Component, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { BattleSession } from '@features/battle/state/battle-session';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { LiveBattle, LiveBattles } from '@features/live/state/live-battles';
import { RetroBox } from '@shared/components/retro-box';
import { PLAYABLE_FORMATS, RANDOM_BATTLE_FORMAT } from '@shared/data/formats';
import { RETRO_SECONDARY_BUTTON } from '@shared/ui/retro-classes';

/** Rows per page: the list never scrolls (scroll boxes are fragile on Brewser). */
const ROWS = 8;

/**
 * The Watch Live page: the battles being played on Showdown in a format, the best rated first, eight
 * at a time; picking one opens it on the battle screen as a spectator. Needs the connection (made from
 * the home screen). Fixed positions throughout; the rows are plain buttons in fixed slots.
 */
@Component({
  imports: [RetroBox],
  selector: 'app-live-page',
  host: { class: 'bg-retro-bg relative block h-[644px] w-[1280px] text-retro-ink' },
  template: `
    <div role="group" aria-label="Format">
      @for (format of formats; track format.id; let i = $index) {
        <button
          type="button"
          [class]="format.id === shownFormat() ? pickedClass : secondaryClass"
          class="absolute top-[24px] h-12 w-[280px] text-xl"
          [style.left.px]="32 + i * 292"
          [attr.aria-pressed]="format.id === shownFormat()"
          [attr.data-autofocus]="format.id === shownFormat() ? '' : null"
          (click)="pick(format.id)"
        >
          {{ format.label }}
        </button>
      }
    </div>
    <button type="button" [class]="secondaryClass" class="absolute top-[24px] left-[616px] h-12 w-[140px] text-xl" [disabled]="!connected() || live.loading()" (click)="refresh()">
      Refresh
    </button>
    <p class="absolute top-[34px] left-[772px] block h-7 w-[196px] text-lg text-retro-muted">{{ range() }}</p>
    <button type="button" [class]="secondaryClass" class="absolute top-[24px] left-[980px] h-12 w-[130px] text-xl" [disabled]="page() === 0" (click)="page.set(page() - 1)">
      Previous
    </button>
    <button type="button" [class]="secondaryClass" class="absolute top-[24px] left-[1122px] h-12 w-[130px] text-xl" [disabled]="page() >= pageCount() - 1" (click)="page.set(page() + 1)">
      Next
    </button>

    <app-retro-box class="absolute top-[92px] left-[32px]" [width]="1220" [height]="528">
      <!-- Always mounted, shown with display: an absolute box added or removed later left stale paint on
        Brewser. The rows hide while it shows, so it never lies over the old list during a refresh. -->
      <p role="status" class="absolute top-[24px] left-[24px] block h-7 w-[1160px] text-xl" [style.display]="message() ? 'block' : 'none'">{{ message() }}</p>
      <!-- ROWS fixed slots, tracked by position so no row ever moves or is re-created: on Brewser, moved
        absolute boxes left their text behind (overlapping) and new ones came out blank. Empty slots hide. -->
      <ul aria-label="Live battles" class="block">
        @for (row of rows(); track $index; let i = $index) {
          <li class="block">
            <button
              type="button"
              class="absolute left-[12px] h-14 w-[1184px] cursor-pointer rounded-lg border-2 border-retro-rim bg-retro-button text-left text-retro-ink hover:bg-retro-select"
              [style.top.px]="12 + i * 62"
              [style.display]="row ? 'block' : 'none'"
              [disabled]="!row"
              [attr.aria-label]="row ? 'Watch ' + row.p1 + ' versus ' + row.p2 + ', ' + ratingText(row) : null"
              (click)="row && watch(row)"
            >
              <span class="absolute top-[12px] left-[20px] block h-7 w-[860px] overflow-hidden text-xl font-bold whitespace-nowrap">{{ row ? row.p1 + ' vs ' + row.p2 : '' }}</span>
              <span class="absolute top-[14px] left-[900px] block h-6 w-[260px] text-lg text-retro-muted">{{ row ? ratingText(row) : '' }}</span>
            </button>
          </li>
        }
      </ul>
    </app-retro-box>
  `,
})
export class LivePage {
  private readonly router = inject(Router);
  private readonly session = inject(BattleSession);
  private readonly connection = inject(ShowdownConnection);
  protected readonly live = inject(LiveBattles);

  protected readonly formats = PLAYABLE_FORMATS;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;
  /** The format picked: highlighted with the accent border, as the menu's focused button. */
  protected readonly pickedClass = 'cursor-pointer rounded-md border-2 border-retro-accent-text bg-retro-select font-bold text-retro-ink';

  /** The format shown. */
  protected readonly shownFormat = signal(this.live.format() ?? RANDOM_BATTLE_FORMAT);
  protected readonly connected = computed(() => this.connection.state().status === 'connected');

  /** The list, once it's the shown format's. */
  private readonly battles = computed(() => (this.live.format() === this.shownFormat() ? this.live.battles() : []));
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.battles().length / ROWS)));
  /** Back to the first page with each new list. */
  protected readonly page = linkedSignal({ source: this.battles, computation: () => 0 });
  protected readonly shown = computed(() => this.battles().slice(this.page() * ROWS, (this.page() + 1) * ROWS));
  /** Always ROWS slots (null: empty), all empty while the message shows. */
  protected readonly rows = computed<readonly (LiveBattle | null)[]>(() => {
    const shown = this.message() ? [] : this.shown();
    return Array.from({ length: ROWS }, (_, i) => shown[i] ?? null);
  });

  protected readonly range = computed(() => {
    const total = this.battles().length;
    if (total === 0) return '';
    const first = this.page() * ROWS + 1;
    return `${first}–${Math.min(total, first + ROWS - 1)} of ${total}`;
  });

  protected readonly message = computed(() => {
    if (!this.connected()) return 'Offline: connect from the menu to watch live battles.';
    if (this.live.loading()) return 'Looking for battles…';
    if (this.live.format() === this.shownFormat() && this.battles().length === 0) return 'No battles in this format right now. Try Refresh.';
    return null;
  });

  constructor() {
    // The shown format's list, whenever connected (on opening the page, or once the connection is back).
    effect(() => {
      const format = this.shownFormat();
      if (this.connected()) untracked(() => this.live.load(format));
    });
  }

  protected pick(format: string): void {
    this.shownFormat.set(format);
  }

  protected refresh(): void {
    this.live.load(this.shownFormat());
  }

  protected ratingText(battle: LiveBattle): string {
    if (battle.tournament) return 'Tournament';
    return battle.rating === null ? 'Unrated' : `Rating ${battle.rating}`;
  }

  /** Opens the battle on the battle screen, as a spectator. */
  protected watch(battle: LiveBattle): void {
    if (this.session.active()) return;
    this.session.requestSpectate(battle.roomId);
    void this.router.navigateByUrl('/battle');
  }
}
