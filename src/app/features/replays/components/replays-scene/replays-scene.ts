import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormatListRow, FormatListScreen } from '@core/gl/ui/format-list-screen';
import { ReplaySummary } from '@features/battle/models/battle';
import { ReplayBattleConnection } from '@features/battle/replay/replay-battle-connection';
import { BattleStore } from '@features/battle/state/battle-store';
import { ReplayApi } from '@features/replays/data/replay-api';
import { ReplayGame } from '@features/replays/data/replay-game';
import { PickerOption } from '@core/gl/ui/option-picker';
import { PLAYABLE_FORMATS, PlayableFormat } from '@shared/data/formats';
import { RowLookup, RowLookups } from '@shared/utils/row-lookups';

/** Replay logs downloaded at once to rate the best-of-3 games shown (the list rates only a set's last one). */
const LOOKUPS_AT_ONCE = 2;

const FORMAT_OPTIONS: readonly PickerOption[] = PLAYABLE_FORMATS.map((format) => ({
  id: format.id,
  title: format.label,
  detail: format.detail,
  category: format.category,
}));

/** The format last picked, so coming back from a replay lists the same one. */
let lastFormat: PlayableFormat = PLAYABLE_FORMATS[0];

interface ReplayRow extends ReplaySummary {
  title: string;
  /** "5 min ago". */
  age: string;
}

/**
 * The latest public replays of a format, from Showdown's replay server, drawn on the stage (opened
 * from Settings, where B goes back). Picking one plays it on the battle screen, watched from the
 * first player's side. See FormatListScreen for the page and its controls.
 */
@Component({
  selector: 'app-replays-scene',
  template: '',
})
export class ReplaysScene {
  private readonly api = inject(ReplayApi);
  private readonly store = inject(BattleStore);
  private readonly router = inject(Router);

  private readonly format = signal(lastFormat);
  /** Counts searches, so an answer for a format no longer picked is dropped. */
  private searchId = 0;
  private readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly searchError = signal('');
  private readonly replays = signal<readonly ReplayRow[]>([]);
  /** The replay being downloaded. */
  private readonly opening = signal<string | null>(null);
  /** The replay that couldn't be downloaded, and why. */
  private readonly failed = signal<{ id: string; text: string } | null>(null);
  /** Best-of-3 games the list doesn't rate, as their logs tell them (by replay ID). */
  private readonly games = new RowLookups<ReplayGame>((id) => this.api.game(id), LOOKUPS_AT_ONCE, () => undefined);

  private readonly message = computed(() => {
    switch (this.status()) {
      case 'loading':
        return 'Loading the latest replays…';
      case 'error':
        return `Couldn't reach the replay server: ${this.searchError()}`;
      case 'ready':
        return this.replays().length === 0 ? `No public replays of ${this.format().label} yet. Try Refresh.` : null;
    }
  });

  private readonly rows = computed((): FormatListRow[] => {
    const opening = this.opening();
    const failed = this.failed();
    const games = this.games.results();
    return this.replays().map((row) => ({
      title: row.title,
      detail:
        opening === row.id ? 'Loading the replay…' : failed?.id === row.id ? failed.text : [...ratingDetail(row, games.get(row.id)), row.age].join(' · '),
    }));
  });

  private readonly screen = new FormatListScreen({
    page: { title: 'Replays', icon: 'replays' },
    backTo: '/settings',
    formats: FORMAT_OPTIONS,
    format: () => this.format().id,
    formatLabel: () => this.format().label,
    pickFormat: (id) => this.pickFormat(id),
    canRefresh: () => this.status() !== 'loading',
    refresh: () => void this.refresh(),
    message: () => this.message(),
    rows: () => this.rows(),
    detailX: 760,
    open: (index) => void this.open(this.replays()[index]),
    shown: (from, to) => {
      const ids = this.format().id.endsWith('bo3') ? this.replays().slice(from, to).filter((row) => !row.rating).map((row) => row.id) : [];
      this.games.show(ids);
    },
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.games.stop());
    void this.refresh();
  }

  /** Lists another format's replays (the list empties while they load). */
  private pickFormat(id: string): void {
    const format = PLAYABLE_FORMATS.find((option) => option.id === id);
    if (!format || format.id === this.format().id) return;
    lastFormat = format;
    this.format.set(format);
    this.replays.set([]);
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const search = ++this.searchId;
    const format = this.format();
    this.status.set('loading');
    this.failed.set(null);
    // Logs that couldn't be read are tried again.
    this.games.retryFailed();
    try {
      const now = Date.now() / 1000;
      const replays = await this.api.search(format.id);
      if (search !== this.searchId) return;
      this.replays.set(replays.map((replay) => toRow(replay, now)));
      this.status.set('ready');
      this.screen.resetList(replays.length > 0);
    } catch (error) {
      if (search !== this.searchId) return;
      this.searchError.set(errorText(error));
      this.status.set('error');
    }
  }

  private async open(summary: ReplayRow | undefined): Promise<void> {
    if (!summary || this.opening() !== null) return;
    this.opening.set(summary.id);
    this.failed.set(null);
    try {
      const replay = await this.api.load(summary.id);
      this.store.start(new ReplayBattleConnection({ ...summary, ...replay }));
      await this.router.navigateByUrl('/battle');
    } catch (error) {
      this.failed.set({ id: summary.id, text: `Couldn't load it: ${errorText(error)}` });
    }
    this.opening.set(null);
  }
}

/** The list's rating, else what the replay's log tells (looked up for best-of-3 games only). */
function ratingDetail(row: ReplayRow, game: RowLookup<ReplayGame> | undefined): string[] {
  if (row.rating) return [`Rating ${row.rating}`];
  if (game === 'loading') return ['Rating…'];
  if (game === 'failed') return [];
  return game ? gameDetail(game) : ['Unrated'];
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
