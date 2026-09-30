import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Router } from '@angular/router';
import { KeyboardNavigation, PageStep } from '@core/input/keyboard-navigation';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ReplaySummary } from '@features/battle/models/battle';
import { ReplayBattleConnection } from '@features/battle/replay/replay-battle-connection';
import { BattleStore } from '@features/battle/state/battle-store';
import { ReplayApi } from '@features/replays/data/replay-api';
import { ReplayGame } from '@features/replays/data/replay-game';
import { RowLookups } from '@shared/utils/row-lookups';
import { OptionPicker, PickerOption } from '@shared/components/option-picker';
import { RetroBox } from '@shared/components/retro-box';
import { PLAYABLE_FORMATS, PlayableFormat } from '@shared/data/formats';
import { RETRO_SECONDARY_BUTTON, RETRO_SHORTCUT_PILL } from '@shared/ui/retro-classes';

/** Rows shown at once, in fixed slots (as on Watch Live). */
const ROWS = 8;

/** Replay logs downloaded at once to rate the best-of-3 games shown (the list rates only a set's last one). */
const LOOKUPS_AT_ONCE = 2;

/** The format last picked, so coming back from a replay lists the same one. */
let lastFormat: PlayableFormat = PLAYABLE_FORMATS[0];

interface ReplayRow extends ReplaySummary {
  title: string;
  /** "5 min ago". */
  age: string;
}

/**
 * The latest public replays of a format, from Showdown's replay server. Laid out as Watch Live: a format
 * selector (opening the list of formats over the page, so any number of them fit), Refresh and the pager
 * on top, and the replays in a box below. Picking a replay plays it on the battle screen, watched from
 * the first player's side.
 *
 * The list is NOT a scroll box: on the console, a scroll box that first appears after load stays
 * blank (the battle log's test L1). It shows ROWS rows at a time in fixed slots, tracked by position
 * so no row ever moves or is re-created (moved absolute boxes left their text behind on Brewser). The
 * d-pad moves focus between them, and past the first or last one shown the list moves by a row (it
 * registers as a pager, see KeyboardNavigation); Previous/Next (L/R) and the mouse wheel move it too. ZR refreshes.
 */
@Component({
  imports: [OptionPicker, RetroBox],
  selector: 'app-replay-list',
  host: { class: 'bg-retro-bg relative block h-[644px] w-[1280px] text-retro-ink' },
  template: `
    <!-- The page's controls hide while the format list is open over them (only normal-flow wrappers toggle on Brewser). -->
    <div class="block" [class.hidden]="picking()">
      <button
        #formatButton
        data-autofocus
        type="button"
        [class]="secondaryClass"
        class="absolute top-[24px] left-[32px] h-12 w-[468px] p-0"
        [attr.aria-label]="'Format: ' + format().label + '. Change'"
        (click)="picking.set(true)"
      >
        <!-- Placed boxes: Brewser leaves a button's element children at its top left. -->
        <span class="absolute top-[10px] left-[16px] block h-6 w-[72px] text-left text-base leading-6 font-normal text-retro-muted">Format</span>
        <span class="absolute top-[8px] left-[92px] block h-7 w-[320px] truncate text-left text-xl leading-7">{{ format().label }}</span>
        <svg aria-hidden="true" viewBox="0 0 7 4" class="absolute top-[16px] left-[424px] h-3 w-[21px] fill-retro-accent-text"><path d="M0 0h7v1h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1v-1h-1z" /></svg>
      </button>
      <!-- ZR, L and R press these, so the d-pad skips them (data-kb-skip); the button shows in a pill. -->
      <button type="button" data-kb-skip [class]="secondaryClass" class="absolute top-[24px] left-[516px] h-12 w-[160px] p-0 text-xl" [disabled]="status() === 'loading'" (click)="refresh()">
        <span aria-hidden="true" [class]="pillClass">ZR</span>
        <span class="absolute top-0 left-[50px] block h-11 w-[96px] text-center leading-[44px]">Refresh</span>
      </button>
      <p class="absolute top-[34px] left-[692px] block h-7 w-[232px] text-lg text-retro-muted">{{ range() }}</p>
      <button type="button" data-kb-skip [class]="secondaryClass" class="absolute top-[24px] left-[940px] h-12 w-[150px] p-0 text-xl" [disabled]="start() === 0" (click)="movePage(-1)">
        <span aria-hidden="true" [class]="pillClass">L</span>
        <span class="absolute top-0 left-[48px] block h-11 w-[92px] text-center leading-[44px]">Previous</span>
      </button>
      <button type="button" data-kb-skip [class]="secondaryClass" class="absolute top-[24px] left-[1102px] h-12 w-[150px] p-0 text-xl" [disabled]="start() + rowCount >= replays().length" (click)="movePage(1)">
        <span aria-hidden="true" [class]="pillClass">R</span>
        <span class="absolute top-0 left-[48px] block h-11 w-[92px] text-center leading-[44px]">Next</span>
      </button>

      <app-retro-box class="absolute top-[92px] left-[32px]" [width]="1220" [height]="528">
        <!-- Always mounted, shown with display (see Watch Live). The rows hide while it shows. -->
        <p role="status" class="absolute top-[24px] left-[24px] block h-7 w-[1160px] text-xl" [style.display]="message() ? 'block' : 'none'">{{ message() }}</p>
        <ul #list aria-label="Replays" class="block">
          @for (row of slots(); track $index; let i = $index) {
            <li class="block">
              <button
                #replayButton
                type="button"
                class="absolute left-[12px] h-14 w-[1184px] cursor-pointer rounded-lg border-2 border-retro-rim bg-retro-button text-left text-retro-ink hover:bg-retro-select"
                [style.top.px]="12 + i * 62"
                [style.display]="row ? 'block' : 'none'"
                [disabled]="!row || opening() !== null"
                [attr.aria-label]="row ? 'Watch the replay of ' + row.title + ', ' + rowDetail(row) : null"
                (click)="row && open(row)"
              >
                <span class="absolute top-[12px] left-[20px] block h-7 w-[740px] overflow-hidden text-xl font-bold whitespace-nowrap">{{ row ? row.title : '' }}</span>
                <span class="absolute top-[14px] left-[780px] block h-6 w-[380px] overflow-hidden text-lg whitespace-nowrap text-retro-muted">{{ row ? rowDetail(row) : '' }}</span>
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
        [selected]="format().id"
        (picked)="pickFormat($event)"
        (closed)="closePicker()"
      />
    }
  `,
})
export class ReplayList {
  private readonly api = inject(ReplayApi);
  private readonly store = inject(BattleStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly renderScheduler = inject(RenderScheduler);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly rows = viewChildren<ElementRef<HTMLButtonElement>>('replayButton');
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly formatButton = viewChild.required<ElementRef<HTMLButtonElement>>('formatButton');

  protected readonly rowCount = ROWS;
  protected readonly secondaryClass = RETRO_SECONDARY_BUTTON;
  protected readonly pillClass = RETRO_SHORTCUT_PILL;
  protected readonly formatOptions: readonly PickerOption[] = PLAYABLE_FORMATS.map((format) => ({
    id: format.id,
    title: format.label,
    detail: format.detail,
    category: format.category,
  }));

  protected readonly format = signal(lastFormat);
  /** The list of formats is open over the page. */
  protected readonly picking = signal(false);
  /** Counts searches, so an answer for a format no longer picked is dropped. */
  private searchId = 0;
  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly searchError = signal('');
  protected readonly replays = signal<readonly ReplayRow[]>([]);
  /** The replay being downloaded. */
  protected readonly opening = signal<string | null>(null);
  /** The replay that couldn't be downloaded, and why. */
  private readonly failed = signal<{ id: string; text: string } | null>(null);
  /** Best-of-3 games the list doesn't rate, as their logs tell them (by replay ID). */
  private readonly games = new RowLookups<ReplayGame>((id) => this.api.game(id), LOOKUPS_AT_ONCE, () => this.renderScheduler.request());

  /** The first row shown. */
  protected readonly start = signal(0);
  private readonly visibleReplays = computed(() => this.replays().slice(this.start(), this.start() + ROWS));
  /** Always ROWS slots (null: empty), all empty while the message shows. */
  protected readonly slots = computed<readonly (ReplayRow | null)[]>(() => {
    const shown = this.message() ? [] : this.visibleReplays();
    return Array.from({ length: ROWS }, (_, i) => shown[i] ?? null);
  });
  protected readonly range = computed(() => {
    const total = this.replays().length;
    if (total === 0) return '';
    const first = this.start() + 1;
    return `${first}–${first + this.visibleReplays().length - 1} of ${total}`;
  });

  protected readonly message = computed(() => {
    switch (this.status()) {
      case 'loading':
        return 'Loading the latest replays…';
      case 'error':
        return `Couldn't reach the replay server: ${this.searchError()}`;
      case 'ready':
        return this.replays().length === 0 ? `No public replays of ${this.format().label} yet. Try Refresh.` : null;
    }
  });

  /** The row (by position among those shown) to focus once rendered: after a load or after moving the list. */
  private focusRow: number | null = null;

  constructor() {
    afterRenderEffect(() => {
      // The slots are always the same elements: rerun when what they show changes.
      this.slots();
      const row = this.focusRow === null ? undefined : this.rows()[this.focusRow]?.nativeElement;
      if (row && !row.disabled) {
        this.focusRow = null;
        row.focus();
      }
    });

    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const list = this.list().nativeElement;
      const unregister = this.navigation.registerPager(list, (step, focused) => this.page(step, focused));
      // Browsers: the wheel moves the list as it would scroll it (focus stays where it is).
      const onWheel = (event: WheelEvent) => {
        if (event.deltaY === 0) return;
        event.preventDefault();
        if (this.moveTo(this.start() + (event.deltaY > 0 ? 1 : -1))) this.renderScheduler.request();
      };
      list.addEventListener('wheel', onWheel, { passive: false });
      destroyRef.onDestroy(() => {
        unregister();
        list.removeEventListener('wheel', onWheel);
      });
    });
    // The console buttons, while the page shows (not over the format list): L/R page, ZR refreshes.
    const unregisterButtons = [
      this.navigation.registerButton('buttonL', () => !this.picking() && this.movePage(-1)),
      this.navigation.registerButton('buttonR', () => !this.picking() && this.movePage(1)),
      this.navigation.registerButton('buttonZR', () => {
        if (this.picking()) return false;
        if (this.status() !== 'loading') void this.refresh();
        return true;
      }),
    ];
    destroyRef.onDestroy(() => unregisterButtons.forEach((fn) => fn()));
    // The best-of-3 games shown without a rating: their logs have the players' (see ReplayGame).
    effect(() => {
      const ids = this.format().id.endsWith('bo3') ? this.visibleReplays().filter((row) => !row.rating).map((row) => row.id) : [];
      untracked(() => this.games.show(ids));
    });
    destroyRef.onDestroy(() => this.games.stop());
    void this.refresh();
  }

  /** Lists another format's replays (the list empties while they load). */
  protected pickFormat(id: string): void {
    this.closePicker();
    const format = PLAYABLE_FORMATS.find((option) => option.id === id);
    if (!format || format.id === this.format().id) return;
    lastFormat = format;
    this.format.set(format);
    this.replays.set([]);
    this.start.set(0);
    void this.refresh();
  }

  /** Back to the page, with focus on the format selector. */
  protected closePicker(): void {
    this.picking.set(false);
    afterNextRender(() => this.formatButton().nativeElement.focus(), { injector: this.injector });
  }

  protected async refresh(): Promise<void> {
    const search = ++this.searchId;
    const format = this.format();
    this.status.set('loading');
    this.failed.set(null);
    // Logs that couldn't be read are tried again.
    this.games.retryFailed();
    this.renderScheduler.request();
    try {
      const now = Date.now() / 1000;
      const replays = await this.api.search(format.id);
      if (search !== this.searchId) return;
      this.replays.set(replays.map((replay) => toRow(replay, now)));
      this.start.set(0);
      this.status.set('ready');
      if (replays.length > 0) this.focusRow = 0;
    } catch (error) {
      if (search !== this.searchId) return;
      this.searchError.set(errorText(error));
      this.status.set('error');
    }
    this.renderScheduler.request();
  }

  protected async open(summary: ReplayRow): Promise<void> {
    this.opening.set(summary.id);
    this.failed.set(null);
    this.renderScheduler.request();
    try {
      const replay = await this.api.load(summary.id);
      this.store.start(new ReplayBattleConnection({ ...summary, ...replay }));
      await this.router.navigateByUrl('/battle');
    } catch (error) {
      this.failed.set({ id: summary.id, text: `Couldn't load it: ${errorText(error)}` });
    }
    this.opening.set(null);
    this.renderScheduler.request();
  }

  /** The line on a row's right: rating and age, or how opening it goes. */
  protected rowDetail(row: ReplayRow): string {
    if (this.opening() === row.id) return 'Loading the replay…';
    const failed = this.failed();
    if (failed?.id === row.id) return failed.text;
    return [...this.ratingDetail(row), row.age].join(' · ');
  }

  /** The list's rating, else what the replay's log tells (looked up for best-of-3 games only). */
  private ratingDetail(row: ReplayRow): string[] {
    if (row.rating) return [`Rating ${row.rating}`];
    const game = this.games.results().get(row.id);
    if (game === 'loading') return ['Rating…'];
    if (game === 'failed') return [];
    return game ? gameDetail(game) : ['Unrated'];
  }

  /** Previous/Next (L/R): the list moves by a whole page; true once handled, even at the ends. */
  protected movePage(step: 1 | -1): true {
    if (this.moveTo(this.start() + step * ROWS)) this.renderScheduler.request();
    return true;
  }

  /** Up past the first row shown, or down past the last one, moves the list by a row; Home/End jump to its ends. */
  private page(step: PageStep, focused: HTMLElement): boolean {
    const index = this.rows().findIndex((row) => row.nativeElement === focused);
    if (index === -1) return false;
    const last = this.visibleReplays().length - 1;
    switch (step) {
      case 'up':
        if (index !== 0 || !this.moveTo(this.start() - 1)) return false;
        this.focusAfterMove(true, 0);
        return true;
      case 'down':
        if (index !== last || !this.moveTo(this.start() + 1)) return false;
        this.focusAfterMove(true, last);
        return true;
      case 'first':
        this.focusAfterMove(this.moveTo(0), 0);
        return true;
      case 'last':
        this.focusAfterMove(this.moveTo(this.replays().length - ROWS), last);
        return true;
    }
  }

  /** Focuses a row shown: once rendered if the list moved, else now (nothing will render). */
  private focusAfterMove(moved: boolean, row: number): void {
    if (moved) this.focusRow = row;
    else this.rows()[row]?.nativeElement.focus();
  }

  /** Moves the list so `start` is its first row shown (clamped); false if it didn't move. */
  private moveTo(start: number): boolean {
    const clamped = Math.max(0, Math.min(start, this.replays().length - ROWS));
    if (clamped === this.start()) return false;
    this.start.set(clamped);
    return true;
  }
}

function toRow(replay: ReplaySummary, now: number): ReplayRow {
  const [p1, p2] = replay.players;
  return { ...replay, title: `${p1} vs ${p2}`, age: timeAgo(now - replay.uploadtime) };
}

/**
 * "Game 2 · Avg rating 1190": the game's number in its set, and the average of the players' ratings as
 * it started. In words: Brewser's font draws "~" as a raised accent.
 */
function gameDetail(game: ReplayGame): string[] {
  const rating = !game.rated
    ? 'Unrated'
    : game.ratings.length > 0
      ? `Avg rating ${Math.round(game.ratings.reduce((sum, value) => sum + value, 0) / game.ratings.length)}`
      : 'Rated';
  return game.game === null ? [rating] : [`Game ${game.game}`, rating];
}

/** "3 min ago", "2 h ago", "4 days ago". */
function timeAgo(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
