import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { Router } from '@angular/router';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ReplaySummary } from '@features/battle/models/battle';
import { ReplayBattleConnection } from '@features/battle/replay/replay-battle-connection';
import { BattleStore } from '@features/battle/state/battle-store';
import { ReplayApi } from '@features/replays/data/replay-api';
import { DEFAULT_TEAM_FORMAT, formatName } from '@shared/data/formats';
import { ScrollRegion } from '@shared/directives/scroll-region';

/** Long enough for Brewser to paint the hidden list before it is shown. */
const SHOW_LIST_DELAY_MS = 50;

interface ReplayRow extends ReplaySummary {
  title: string;
  detail: string;
}

/**
 * The latest public replays of the teambuilder's format, from Showdown's replay server. Picking one
 * plays it on the battle screen, watched from the first player's side. Fixed 1280x644: a 64px bar
 * and a 580px scrolling list of plain block rows (Brewser layout rules).
 */
@Component({
  selector: 'app-replay-list',
  imports: [ScrollRegion],
  host: { class: 'block h-[644px] w-[1280px] bg-card text-white' },
  template: `
    <div class="relative h-16 w-[1280px] border-b border-gray-600">
      <h2
        id="replay-list-title"
        class="absolute top-[8px] left-6 block h-7 text-xl leading-7 font-bold"
      >
        Replays
      </h2>
      <p class="absolute top-[36px] left-6 block h-5 w-[900px] text-sm leading-5 text-gray-300">
        {{ subtitle() }}
      </p>
      <button
        type="button"
        class="absolute top-[14px] left-[1136px] h-9 w-[120px] rounded-md border border-gray-400 bg-gray-700 text-base hover:bg-gray-600 disabled:cursor-not-allowed disabled:text-gray-400"
        [disabled]="status() === 'loading'"
        (click)="refresh()"
      >
        Refresh
      </button>
    </div>
    <div class="h-[579px] w-[1280px]" [style.display]="listShown() ? 'block' : 'none'">
      <ul
        appScrollRegion
        aria-labelledby="replay-list-title"
        class="h-[579px] w-[1280px] overflow-y-auto"
      >
        @for (replay of replays(); track replay.id) {
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
    </div>
  `,
})
export class ReplayList {
  private readonly api = inject(ReplayApi);
  private readonly store = inject(BattleStore);
  private readonly router = inject(Router);
  private readonly renderScheduler = inject(RenderScheduler);
  private readonly rows = viewChildren<ElementRef<HTMLButtonElement>>('replayButton');

  private readonly format = DEFAULT_TEAM_FORMAT;
  protected readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly replays = signal<readonly ReplayRow[]>([]);
  /** The replay being downloaded. */
  protected readonly opening = signal<string | null>(null);
  protected readonly subtitle = signal('');
  /**
   * On the console the list sometimes stayed blank when its rows arrived after it was drawn empty
   * (they could still be pressed), even when it was hidden and shown again in the same task. So it
   * stays hidden while it loads and is shown from a later task, once its rows are in the DOM: the
   * pattern that works for the chat's user list (filled while hidden, shown later).
   */
  protected readonly listShown = signal(false);
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  /** The list focuses its first row once per load. */
  private focusPending = false;

  constructor() {
    afterRenderEffect(() => {
      if (this.status() === 'loading' || this.replays().length === 0) return;
      if (this.listShown() || this.showTimer !== null) return;
      this.showTimer = setTimeout(() => {
        this.showTimer = null;
        this.listShown.set(true);
        this.renderScheduler.request();
      }, SHOW_LIST_DELAY_MS);
    });
    afterRenderEffect(() => {
      const first = this.rows()[0]?.nativeElement;
      if (first && this.listShown() && this.focusPending) {
        this.focusPending = false;
        first.focus();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.showTimer !== null) clearTimeout(this.showTimer);
    });
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    this.status.set('loading');
    this.listShown.set(false);
    if (this.showTimer !== null) clearTimeout(this.showTimer);
    this.showTimer = null;
    this.subtitle.set(`Loading the latest ${formatName(this.format)} replays…`);
    try {
      const now = Date.now() / 1000;
      const replays = await this.api.search(this.format);
      this.replays.set(replays.map((replay) => toRow(replay, now)));
      this.status.set('ready');
      this.subtitle.set(
        replays.length > 0
          ? `The latest ${replays.length} public ${formatName(this.format)} replays`
          : `No public ${formatName(this.format)} replays yet`,
      );
      this.focusPending = true;
    } catch (error) {
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
