import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { BattleMusic } from '@core/audio/battle-music';
import { ActivatedRoute, Router } from '@angular/router';
import { FormatListRow, FormatListScreen } from '@core/gl/ui/format-list-screen';
import { PickerOption } from '@core/gl/ui/option-picker';
import { ReplaySummary } from '@features/battle/models/battle';
import { ReplayBattleConnection } from '@features/battle/replay/replay-battle-connection';
import { BattleStore } from '@features/battle/state/battle-store';
import { ShowdownLogin } from '@features/connection/showdown-login';
import { HomeMenu } from '@features/home/state/home-menu';
import { ReplayApi } from '@features/replays/data/replay-api';
import { ReplayGame } from '@features/replays/data/replay-game';
import { errorText, fromSecondPlayer, gameDetail, timeAgo } from '@features/replays/data/replay-rows';
import { PLAYABLE_FORMATS } from '@shared/data/formats';
import { RowLookup, RowLookups } from '@shared/utils/row-lookups';
import { toId } from '@shared/utils/to-id';

/** Replay logs downloaded at once to tell who won the battles shown. */
const LOOKUPS_AT_ONCE = 2;

/** The search without a format: the player's battles in every format. */
const ALL_FORMATS = '';

const FORMAT_OPTIONS: readonly PickerOption[] = [
  { id: ALL_FORMATS, title: 'All formats', detail: 'Every battle of yours, newest first.' },
  ...PLAYABLE_FORMATS.map((format) => ({ id: format.id, title: format.label, detail: format.detail, category: format.category })),
];

/** The format last picked, so coming back from a replay lists the same one. */
let lastFormat = ALL_FORMATS;

interface HistoryRow extends ReplaySummary {
  /** "vs Rival". */
  title: string;
  /** We were the second player: the replay is turned round to watch it from our side. */
  asP2: boolean;
  /** "5 min ago". */
  age: string;
}

/**
 * The battles the player has played, newest first: Showdown keeps no list of a player's battles, only
 * the replays saved of them, so this is the replay server's search by the player's name (our battles
 * are saved as they end, see ReplayAutoSave), in a format or all. For a registered name only: an
 * unregistered one may have been anyone's. Each row says who won (from the replay's log, looked up
 * for the rows shown). Picking one plays it on the battle screen, from our own side. Opened from the
 * Trainer Card (`?from=card`: B goes back to it) or from Settings (`?from=settings`).
 */
@Component({
  selector: 'app-history-scene',
  template: '',
})
export class HistoryScene {
  private readonly api = inject(ReplayApi);
  private readonly store = inject(BattleStore);
  private readonly router = inject(Router);
  private readonly login = inject(ShowdownLogin);
  private readonly menu = inject(HomeMenu);
  private readonly from = inject(ActivatedRoute).snapshot.queryParamMap.get('from') === 'settings' ? 'settings' : 'card';

  private readonly format = signal(lastFormat);
  /** Whose battles: the registered name we're logged in with, if any. */
  private readonly userId = computed(() => {
    const login = this.login.state();
    return login.status === 'named' && login.registered ? this.login.userId() : '';
  });
  /** Counts searches, so an answer for a format no longer picked is dropped. */
  private searchId = 0;
  private readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly searchError = signal('');
  private readonly replays = signal<readonly HistoryRow[]>([]);
  /** The replay being downloaded. */
  private readonly opening = signal<string | null>(null);
  /** The replay that couldn't be downloaded, and why. */
  private readonly failed = signal<{ id: string; text: string } | null>(null);
  /** The games' winners and ratings, as their logs tell them (by replay ID). */
  private readonly games = new RowLookups<ReplayGame>((id) => this.api.game(id), LOOKUPS_AT_ONCE, () => undefined);

  private readonly formatLabel = computed(() => FORMAT_OPTIONS.find((option) => option.id === this.format())?.title ?? this.format());

  private readonly message = computed(() => {
    if (!this.userId()) return 'Log in with a registered name to see the battles you have played.';
    switch (this.status()) {
      case 'loading':
        return 'Looking for your battles…';
      case 'error':
        return `Couldn't reach the replay server: ${this.searchError()}`;
      case 'ready':
        if (this.replays().length > 0) return null;
        return `No saved battles of yours${this.format() === ALL_FORMATS ? '' : ` in ${this.formatLabel()}`} yet. Your battles are saved as they end (Settings, Save my replays).`;
    }
  });

  private readonly rows = computed((): FormatListRow[] => {
    const opening = this.opening();
    const failed = this.failed();
    const games = this.games.results();
    const userId = this.userId();
    const allFormats = this.format() === ALL_FORMATS;
    return this.replays().map((row) => {
      const game = games.get(row.id);
      const detail =
        opening === row.id
          ? ['Loading the replay…']
          : failed?.id === row.id
            ? [failed.text]
            : [...(allFormats ? [formatName(row.format)] : []), ...ratingDetail(row, game), row.age];
      return { title: row.title, badge: resultBadge(game, userId), detail: detail.join(' · ') };
    });
  });

  private readonly screen = new FormatListScreen({
    page: { title: 'Battle history', icon: 'replays' },
    backTo: () => {
      if (this.from === 'settings') return '/settings';
      // Back on the menu with the Trainer Card open again.
      this.menu.openCard.set(true);
      return '/';
    },
    formats: FORMAT_OPTIONS,
    format: () => this.format(),
    formatLabel: () => this.formatLabel(),
    pickFormat: (id) => this.pickFormat(id),
    canRefresh: () => !!this.userId() && this.status() !== 'loading',
    refresh: () => void this.refresh(),
    message: () => this.message(),
    rows: () => this.rows(),
    detailX: 420,
    open: (index) => void this.open(this.replays()[index]),
    shown: (from, to) => this.games.show(this.replays().slice(from, to).map((row) => row.id)),
  });

  constructor() {
    // The battle opened from here plays its music sooner: its download starts while the list shows.
    inject(BattleMusic).prepareNext();
    inject(DestroyRef).onDestroy(() => this.games.stop());
    void this.refresh();
  }

  /** Lists another format's battles (the list empties while they load). */
  private pickFormat(id: string): void {
    if (id === this.format() || !FORMAT_OPTIONS.some((option) => option.id === id)) return;
    lastFormat = id;
    this.format.set(id);
    this.replays.set([]);
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const search = ++this.searchId;
    const userId = this.userId();
    if (!userId) return;
    this.status.set('loading');
    this.failed.set(null);
    // Logs that couldn't be read are tried again.
    this.games.retryFailed();
    try {
      const now = Date.now() / 1000;
      const replays = await this.api.search(this.format(), userId);
      if (search !== this.searchId) return;
      this.replays.set(replays.map((replay) => toRow(replay, userId, now)));
      this.status.set('ready');
      this.screen.resetList(replays.length > 0);
    } catch (error) {
      if (search !== this.searchId) return;
      this.searchError.set(errorText(error));
      this.status.set('error');
    }
  }

  private async open(summary: HistoryRow | undefined): Promise<void> {
    if (!summary || this.opening() !== null) return;
    this.opening.set(summary.id);
    this.failed.set(null);
    try {
      const replay = { ...summary, ...(await this.api.load(summary.id)), backTo: `/history?from=${this.from}` };
      this.store.start(new ReplayBattleConnection(summary.asP2 ? fromSecondPlayer(replay) : replay));
      await this.router.navigateByUrl('/battle');
    } catch (error) {
      this.failed.set({ id: summary.id, text: `Couldn't load it: ${errorText(error)}` });
    }
    this.opening.set(null);
  }
}

/**
 * The result's pill: "Won" green, "Lost" red, "Tie" or "Unfinished" (saved before the end) neutral,
 * once the log has told; "…" while it's read, none if it couldn't be.
 */
function resultBadge(game: RowLookup<ReplayGame> | undefined, userId: string): FormatListRow['badge'] {
  if (game === undefined || game === 'loading') return { text: '…', tone: 'neutral' };
  if (game === 'failed') return undefined;
  if (game.end === null) return { text: 'Unfinished', tone: 'neutral' };
  if (game.end === 'tie') return { text: 'Tie', tone: 'neutral' };
  return toId(game.end.winner) === userId ? { text: 'Won', tone: 'good' } : { text: 'Lost', tone: 'bad' };
}

/** The list's rating, else what the replay's log tells. */
function ratingDetail(row: HistoryRow, game: RowLookup<ReplayGame> | undefined): string[] {
  if (row.rating) return [`Rating ${row.rating}`];
  return game && game !== 'loading' && game !== 'failed' ? gameDetail(game) : [];
}

/** "[Gen 9] Random Battle" as the app labels it, else the server's name without brackets ("Gen 7 Random Battle"). */
function formatName(name: string): string {
  return PLAYABLE_FORMATS.find((format) => format.name === name)?.label ?? name.replace(/^\[([^\]]*)\]\s*/, '$1 ');
}

function toRow(replay: ReplaySummary, userId: string, now: number): HistoryRow {
  const asP2 = toId(replay.players[1] ?? '') === userId;
  const rival = (asP2 ? replay.players[0] : replay.players[1]) ?? '';
  return { ...replay, title: `vs ${rival}`, asP2, age: timeAgo(now - replay.uploadtime) };
}
