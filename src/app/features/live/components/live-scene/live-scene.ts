import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { BattleMusic } from '@core/audio/battle-music';
import { Router } from '@angular/router';
import { AppSettings } from '@core/settings/app-settings';
import { BattleDetails, BattleDetailsState, FormatListRow, FormatListScreen } from '@core/gl/ui/format-list-screen';
import { ROLE_KEYS } from '@core/input/console-keys';
import { LivePeek } from '@features/live/state/live-peek';
import { BattleSummary } from '@shared/utils/battle-summary';
import { BattleSession } from '@features/battle/state/battle-session';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { LoginOverlay } from '@features/home/gl/login-overlay';
import { LiveBattle, LiveBattles } from '@features/live/state/live-battles';
import { PlayerRatings } from '@features/live/state/player-ratings';
import { PickerOption } from '@core/gl/ui/option-picker';
import { PLAYABLE_FORMATS } from '@shared/data/formats';
import { RowLookups } from '@shared/utils/row-lookups';

/** Battles whose players' ratings are downloaded at once (two requests each). */
const LOOKUPS_AT_ONCE = 2;

const FORMAT_OPTIONS: readonly PickerOption[] = PLAYABLE_FORMATS.map((format) => ({
  id: format.id,
  title: format.label,
  detail: format.detail,
  category: format.category,
}));

/**
 * Watch Live, drawn on the stage: the battles being played on Showdown in a format, the best rated
 * first; picking one opens it on the battle screen as a spectator. Needs the connection (made from
 * the home screen). See FormatListScreen for the page and its controls.
 */
@Component({
  selector: 'app-live-scene',
  template: '',
})
export class LiveScene {
  private readonly router = inject(Router);
  private readonly session = inject(BattleSession);
  private readonly connection = inject(ShowdownConnection);
  private readonly live = inject(LiveBattles);
  private readonly playerRatings = inject(PlayerRatings);
  private readonly livePeek = inject(LivePeek);
  /** The battles looked at for their details, by room. */
  private readonly peeks = signal<ReadonlyMap<string, { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready'; summary: BattleSummary }>>(new Map());
  /**
   * Best-of-3 battles' average rating, by room: the room list rates none of them (no `minElo`), so it's
   * the players' ratings in the format now.
   */
  private readonly averages = new RowLookups<number>((roomId) => this.averageOf(roomId), LOOKUPS_AT_ONCE, () => undefined);

  /** The format shown: the last one watched, else Settings' battle format. */
  private readonly shownFormat = signal(this.live.format() ?? inject(AppSettings).settings().battleFormat);
  private readonly connected = computed(() => this.connection.state().status === 'connected');
  /** The list, once it's the shown format's. */
  private readonly battles = computed(() => (this.live.format() === this.shownFormat() ? this.live.battles() : []));

  private readonly message = computed(() => {
    if (!this.connected()) return 'Offline: press ZR to log in (or connect as a guest) and watch live battles.';
    if (this.live.loading()) return 'Looking for battles…';
    if (this.live.format() === this.shownFormat() && this.battles().length === 0) return 'No battles in this format right now. Try Refresh.';
    return null;
  });

  private readonly rows = computed((): FormatListRow[] => {
    const averages = this.averages.results();
    return this.battles().map((battle) => ({
      title: `${battle.p1} vs ${battle.p2}`,
      players: [battle.p1, battle.p2] as const,
      rating: ratingChip(battle, averages.get(battle.roomId)),
      detail: '',
    }));
  });

  private readonly screen = new FormatListScreen({
    page: { title: 'Watch Live', icon: 'live' },
    backTo: '/',
    formats: FORMAT_OPTIONS,
    format: () => this.shownFormat(),
    formatLabel: () => PLAYABLE_FORMATS.find((format) => format.id === this.shownFormat())?.label ?? this.shownFormat(),
    pickFormat: (id) => this.shownFormat.set(id),
    canRefresh: () => this.connected() && !this.live.loading(),
    refresh: () => this.refresh(),
    message: () => this.message(),
    rows: () => this.rows(),
    detailX: 880,
    openLabel: 'Watch',
    open: (index) => this.watch(this.battles()[index]),
    details: {
      mode: 'popup',
      key: ROLE_KEYS.battleDetails,
      request: (index) => this.peek(this.battles()[index]),
      get: (index) => this.peekState(this.battles()[index]),
    },
    shown: (from, to) => this.showRatings(from, to),
    // Offline, ZR opens the menu's login box here.
    overlay: (focus) => new LoginOverlay(focus),
  });

  constructor() {
    // The battle opened from here plays its music sooner: its download starts while the list shows.
    inject(BattleMusic).prepareNext();
    // The shown format's list, whenever connected (on opening the page, or once the connection is back).
    effect(() => {
      const format = this.shownFormat();
      if (this.connected()) untracked(() => this.live.load(format));
    });
    // Each new list starts at its top.
    effect(() => {
      this.battles();
      untracked(() => this.screen.resetList());
    });
    inject(DestroyRef).onDestroy(() => this.averages.stop());
  }

  private refresh(): void {
    this.averages.retryFailed();
    this.live.load(this.shownFormat());
  }

  /** The best-of-3 battles shown without a rating get their players' average. */
  private showRatings(from: number, to: number): void {
    const rooms = this.shownFormat().endsWith('bo3')
      ? this.battles()
          .slice(from, to)
          .filter((battle) => battle.rating === null && !battle.tournament)
          .map((battle) => battle.roomId)
      : [];
    this.averages.show(rooms);
  }

  /** The average of the battle's players' ratings in the format now. */
  private async averageOf(roomId: string): Promise<number> {
    const battle = this.battles().find((shown) => shown.roomId === roomId);
    if (!battle) throw new Error('The battle is no longer listed.');
    const format = this.shownFormat();
    const ratings = await Promise.all([battle.p1, battle.p2].map((name) => this.playerRatings.rating(name, format)));
    return Math.round((ratings[0] + ratings[1]) / 2);
  }

  /** Looks at a battle for its details (its room joined and left at once); asked again each time. */
  private peek(battle: LiveBattle | undefined): void {
    if (!battle) return;
    const roomId = battle.roomId;
    this.peeks.update((peeks) => new Map(peeks).set(roomId, { kind: 'loading' }));
    this.livePeek.peek(roomId).then(
      (summary) => this.peeks.update((peeks) => new Map(peeks).set(roomId, { kind: 'ready', summary })),
      (error: unknown) => this.peeks.update((peeks) => new Map(peeks).set(roomId, { kind: 'error', text: error instanceof Error ? error.message : String(error) })),
    );
  }

  private peekState(battle: LiveBattle | undefined): BattleDetailsState | null {
    if (!battle) return null;
    const peek = this.peeks().get(battle.roomId);
    if (!peek || peek.kind !== 'ready') return peek ?? null;
    const { summary } = peek;
    const rating = (value: number | null) => (value ? { text: `★ ${value}`, high: value >= 1500 } : { text: 'Unrated', high: false });
    const label = PLAYABLE_FORMATS.find((format) => format.id === this.shownFormat())?.label ?? this.shownFormat();
    const status: BattleDetails['status'] =
      summary.end === null
        ? { chip: { text: 'LIVE', tone: 'live' }, text: summary.turn === 0 ? 'Team preview' : `Turn ${summary.turn}` }
        : { chip: { text: 'Over', tone: 'neutral' }, text: summary.end === 'tie' ? 'A tie' : `${summary.end.winner} won` };
    return {
      kind: 'ready',
      details: {
        players: [summary.players[0] || battle.p1, summary.players[1] || battle.p2],
        ratings: [rating(summary.ratings[0]), rating(summary.ratings[1])],
        teams: summary.teams,
        format: label,
        status,
      },
    };
  }

  /** Opens the battle on the battle screen, as a spectator. */
  private watch(battle: LiveBattle | undefined): void {
    if (!battle || this.session.active()) return;
    this.session.requestSpectate(battle.roomId);
    void this.router.navigateByUrl('/battle');
  }
}

/** The row's rating chip: the room list's, else the players' average (best-of-3), amber from 1500. */
function ratingChip(battle: LiveBattle, average: number | 'loading' | 'failed' | undefined): FormatListRow['rating'] {
  if (battle.tournament) return { text: 'Tournament', high: false };
  if (battle.rating !== null) return { text: `★ ${battle.rating}`, high: battle.rating >= 1500 };
  if (average === undefined) return { text: 'Unrated', high: false };
  if (average === 'loading') return { text: '★ …', high: false };
  return average === 'failed' ? { text: 'Rating ?', high: false } : { text: `Avg ★ ${average}`, high: average >= 1500 };
}
