import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation } from '@core/input/keyboard-navigation';
import { BattleSession } from '@features/battle/state/battle-session';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { LiveBattle, LiveBattles } from '@features/live/state/live-battles';
import { OptionPicker, PickerOption } from '@shared/components/option-picker';
import { RetroBox } from '@shared/components/retro-box';
import { PLAYABLE_FORMATS, RANDOM_BATTLE_FORMAT } from '@shared/data/formats';
import { RETRO_SECONDARY_BUTTON, RETRO_SHORTCUT_PILL } from '@shared/ui/retro-classes';
import { keepFocusOnShownRow } from '@shared/utils/row-focus';

/** Rows per page: the list never scrolls (scroll boxes are fragile on Brewser). */
const ROWS = 8;

/**
 * The Watch Live page: the battles being played on Showdown in a format, the best rated first, eight
 * at a time; picking one opens it on the battle screen as a spectator. Needs the connection (made from
 * the home screen). The format is one selector that opens the list of formats over the page (as on the
 * Battle page), so any number of them fit. L/R page through the list and ZR refreshes it. Fixed positions throughout; the rows are plain buttons in fixed slots.
 */
@Component({
  imports: [OptionPicker, RetroBox],
  selector: 'app-live-page',
  host: { class: 'bg-retro-bg relative block h-[644px] w-[1280px] text-retro-ink' },
  template: `
    <!-- The page's controls hide while the format list is open over them (only normal-flow wrappers toggle on Brewser). -->
    <div class="block" [class.hidden]="picking()">
      <button
        #formatButton
        type="button"
        data-autofocus
        [class]="secondaryClass"
        class="absolute top-[24px] left-[32px] h-12 w-[468px] p-0"
        [attr.aria-label]="'Format: ' + shownLabel() + '. Change'"
        (click)="picking.set(true)"
      >
        <!-- Placed boxes: Brewser leaves a button's element children at its top left. -->
        <span class="absolute top-[10px] left-[16px] block h-6 w-[72px] text-left text-base leading-6 font-normal text-retro-muted">Format</span>
        <span class="absolute top-[8px] left-[92px] block h-7 w-[320px] truncate text-left text-xl leading-7">{{ shownLabel() }}</span>
        <svg aria-hidden="true" viewBox="0 0 7 4" class="absolute top-[16px] left-[424px] h-3 w-[21px] fill-retro-accent-text"><path d="M0 0h7v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z" /></svg>
      </button>
      <!-- ZR, L and R press these, so the d-pad skips them (data-kb-skip); the button shows in a pill. -->
      <button type="button" data-kb-skip [class]="secondaryClass" class="absolute top-[24px] left-[516px] h-12 w-[160px] p-0 text-xl" [disabled]="!canRefresh()" (click)="refresh()">
        <span aria-hidden="true" [class]="pillClass">ZR</span>
        <span class="absolute top-0 left-[50px] block h-11 w-[96px] text-center leading-[44px]">Refresh</span>
      </button>
      <p class="absolute top-[34px] left-[692px] block h-7 w-[232px] text-lg text-retro-muted">{{ range() }}</p>
      <button type="button" data-kb-skip [class]="secondaryClass" class="absolute top-[24px] left-[940px] h-12 w-[150px] p-0 text-xl" [disabled]="page() === 0" (click)="movePage(-1)">
        <span aria-hidden="true" [class]="pillClass">L</span>
        <span class="absolute top-0 left-[48px] block h-11 w-[92px] text-center leading-[44px]">Previous</span>
      </button>
      <button type="button" data-kb-skip [class]="secondaryClass" class="absolute top-[24px] left-[1102px] h-12 w-[150px] p-0 text-xl" [disabled]="page() >= pageCount() - 1" (click)="movePage(1)">
        <span aria-hidden="true" [class]="pillClass">R</span>
        <span class="absolute top-0 left-[48px] block h-11 w-[92px] text-center leading-[44px]">Next</span>
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
    </div>

    @if (picking()) {
      <app-option-picker
        class="absolute top-[24px] left-[32px]"
        title="Pick a format"
        [options]="formatOptions"
        [selected]="shownFormat()"
        (picked)="pick($event)"
        (closed)="closePicker()"
      />
    }
  `,
})
export class LivePage {
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly session = inject(BattleSession);
  private readonly connection = inject(ShowdownConnection);
  protected readonly live = inject(LiveBattles);
  private readonly formatButton = viewChild.required<ElementRef<HTMLButtonElement>>('formatButton');

  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;
  protected readonly pillClass = RETRO_SHORTCUT_PILL;
  protected readonly formatOptions: readonly PickerOption[] = PLAYABLE_FORMATS.map((format) => ({
    id: format.id,
    title: format.label,
    detail: format.detail,
    category: format.category,
  }));

  /** The format shown. */
  protected readonly shownFormat = signal(this.live.format() ?? RANDOM_BATTLE_FORMAT);
  protected readonly shownLabel = computed(() => PLAYABLE_FORMATS.find((format) => format.id === this.shownFormat())?.label ?? this.shownFormat());
  /** The list of formats is open over the page. */
  protected readonly picking = signal(false);
  protected readonly connected = computed(() => this.connection.state().status === 'connected');
  protected readonly canRefresh = computed(() => this.connected() && !this.live.loading());

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

    // The console buttons, while the page shows (not over the format list): L/R page, ZR refreshes.
    const navigation = inject(KeyboardNavigation);
    const unregister = [
      navigation.registerButton('buttonL', () => !this.picking() && this.movePage(-1)),
      navigation.registerButton('buttonR', () => !this.picking() && this.movePage(1)),
      navigation.registerButton('buttonZR', () => {
        if (this.picking()) return false;
        if (this.canRefresh()) this.refresh();
        return true;
      }),
    ];
    inject(DestroyRef).onDestroy(() => unregister.forEach((fn) => fn()));
  }

  protected pick(format: string): void {
    this.shownFormat.set(format);
    this.closePicker();
  }

  /** Back to the page, with focus on the format selector. */
  protected closePicker(): void {
    this.picking.set(false);
    afterNextRender(() => this.formatButton().nativeElement.focus(), { injector: this.injector });
  }

  protected refresh(): void {
    this.live.load(this.shownFormat());
  }

  /** The previous or next page (Previous/Next, L/R); true once handled, even at the ends. */
  protected movePage(step: 1 | -1): true {
    const page = Math.max(0, Math.min(this.page() + step, this.pageCount() - 1));
    if (page !== this.page()) {
      this.page.set(page);
      afterNextRender(() => keepFocusOnShownRow(this.host.nativeElement), { injector: this.injector });
    }
    return true;
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
