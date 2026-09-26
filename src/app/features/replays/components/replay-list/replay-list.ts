import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  signal,
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
import { REPLAY_FORMATS, ReplayFormat } from '@features/replays/data/replay-formats';

/** Rows shown at once: 64px each in the 579px under the bar. */
const VISIBLE_ROWS = 9;

/** The format last picked, so coming back from a replay lists the same one. */
let lastFormat: ReplayFormat = REPLAY_FORMATS[0];

interface ReplayRow extends ReplaySummary {
  title: string;
  detail: string;
}

/**
 * The latest public replays of a format, from Showdown's replay server: the teambuilder's VGC format
 * (doubles) or Random Battle (singles), picked with the buttons in the bar. Picking a replay plays it
 * on the battle screen, watched from the first player's side. Fixed 1280x644: a 64px bar and a 579px
 * list of plain block rows (Brewser layout rules).
 *
 * The list is NOT a scroll box: on the console, a scroll box that first appears after load stays
 * blank (the battle log's test L1), and this list never showed. It shows VISIBLE_ROWS rows at a time;
 * the d-pad moves focus between them, and past the first or last one shown the list moves by a row
 * (it registers as a pager, see KeyboardNavigation). The mouse wheel moves it too.
 */
@Component({
  selector: 'app-replay-list',
  host: { class: 'block h-[644px] w-[1280px] bg-card text-white' },
  template: `
    <div class="relative h-16 w-[1280px] border-b border-gray-600">
      <h2
        id="replay-list-title"
        class="absolute top-[8px] left-6 block h-7 text-xl leading-7 font-bold"
      >
        Replays
      </h2>
      <p class="absolute top-[36px] left-6 block h-5 w-[440px] overflow-hidden text-sm leading-5 whitespace-nowrap text-gray-300">
        {{ subtitle() }}
      </p>
      <div role="group" aria-label="Format">
        @for (option of formats; track option.id; let i = $index) {
          <button
            type="button"
            class="absolute top-[14px] h-9 w-[200px] rounded-md border text-base"
            [class]="option.id === format().id ? 'border-sky-300 bg-[#2c4a78] font-bold hover:bg-[#35598f]' : 'border-gray-400 bg-gray-700 hover:bg-gray-600'"
            [style.left.px]="480 + i * 212"
            [attr.aria-pressed]="option.id === format().id"
            (click)="pickFormat(option)"
          >
            {{ option.label }}
          </button>
        }
      </div>
      @if (replays().length > visibleRows) {
        <p class="absolute top-[20px] left-[916px] block h-6 w-[200px] text-right text-sm leading-6 text-gray-300">{{ range() }}</p>
      }
      <button
        type="button"
        class="absolute top-[14px] left-[1136px] h-9 w-[120px] rounded-md border border-gray-400 bg-gray-700 text-base hover:bg-gray-600 disabled:cursor-not-allowed disabled:text-gray-400"
        [disabled]="status() === 'loading'"
        (click)="refresh()"
      >
        Refresh
      </button>
    </div>
    <ul #list aria-labelledby="replay-list-title" class="block h-[579px] w-[1280px]">
      @for (replay of visibleReplays(); track replay.id) {
        <li>
          <button
            #replayButton
            type="button"
            class="block h-16 w-[1280px] border-b border-gray-700 p-[10px_24px] text-left hover:bg-tab-hover disabled:text-gray-400"
            [disabled]="opening() !== null"
            (click)="open(replay)"
          >
            <span
              class="block h-6 overflow-hidden text-base leading-6 font-bold whitespace-nowrap"
              >{{ replay.title }}</span
            >
            <span class="block h-5 text-sm leading-5 text-gray-300">{{
              opening() === replay.id ? 'Loading the replay…' : replay.detail
            }}</span>
          </button>
        </li>
      }
    </ul>
  `,
})
export class ReplayList {
  private readonly api = inject(ReplayApi);
  private readonly store = inject(BattleStore);
  private readonly router = inject(Router);
  private readonly renderScheduler = inject(RenderScheduler);
  private readonly navigation = inject(KeyboardNavigation);
  private readonly rows = viewChildren<ElementRef<HTMLButtonElement>>('replayButton');
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  protected readonly visibleRows = VISIBLE_ROWS;
  protected readonly formats = REPLAY_FORMATS;
  protected readonly format = signal(lastFormat);
  /** Counts searches, so an answer for a format no longer picked is dropped. */
  private searchId = 0;
  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly replays = signal<readonly ReplayRow[]>([]);
  /** The replay being downloaded. */
  protected readonly opening = signal<string | null>(null);
  protected readonly subtitle = signal('');

  /** The first row shown. */
  private readonly start = signal(0);
  protected readonly visibleReplays = computed(() => this.replays().slice(this.start(), this.start() + VISIBLE_ROWS));
  protected readonly range = computed(() => {
    const first = this.start() + 1;
    return `${first}–${first + this.visibleReplays().length - 1} of ${this.replays().length}`;
  });
  /** The row (by position among those shown) to focus once rendered: after a load or after moving the list. */
  private focusRow: number | null = null;

  constructor() {
    afterRenderEffect(() => {
      const row = this.focusRow === null ? undefined : this.rows()[this.focusRow]?.nativeElement;
      if (row) {
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
    void this.refresh();
  }

  /** Lists another format's replays (the list empties while they load). */
  protected pickFormat(format: ReplayFormat): void {
    if (format.id === this.format().id) return;
    lastFormat = format;
    this.format.set(format);
    this.replays.set([]);
    this.start.set(0);
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    const search = ++this.searchId;
    const format = this.format();
    this.status.set('loading');
    this.subtitle.set('Loading the latest replays…');
    this.renderScheduler.request();
    try {
      const now = Date.now() / 1000;
      const replays = await this.api.search(format.id);
      if (search !== this.searchId) return;
      this.replays.set(replays.map((replay) => toRow(replay, now)));
      this.start.set(0);
      this.status.set('ready');
      this.subtitle.set(
        replays.length > 0 ? `The latest ${replays.length} public replays` : `No public replays of ${format.label} yet`,
      );
      this.focusRow = 0;
    } catch (error) {
      if (search !== this.searchId) return;
      this.status.set('error');
      this.subtitle.set(`Couldn't reach the replay server: ${errorText(error)}`);
    }
    this.renderScheduler.request();
  }

  protected async open(summary: ReplaySummary): Promise<void> {
    this.opening.set(summary.id);
    this.renderScheduler.request();
    try {
      const replay = await this.api.load(summary.id);
      this.store.start(new ReplayBattleConnection({ ...summary, ...replay }));
      await this.router.navigateByUrl('/battle');
    } catch (error) {
      this.subtitle.set(`Couldn't load that replay: ${errorText(error)}`);
    }
    this.opening.set(null);
    this.renderScheduler.request();
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
        this.focusAfterMove(this.moveTo(this.replays().length - VISIBLE_ROWS), last);
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
    const clamped = Math.max(0, Math.min(start, this.replays().length - VISIBLE_ROWS));
    if (clamped === this.start()) return false;
    this.start.set(clamped);
    return true;
  }
}

function toRow(replay: ReplaySummary, now: number): ReplayRow {
  const [p1, p2] = replay.players;
  const details = [
    replay.rating ? `Rating ${replay.rating}` : 'Unrated',
    timeAgo(now - replay.uploadtime),
  ];
  return { ...replay, title: `${p1} vs ${p2}`, detail: details.join(' · ') };
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
