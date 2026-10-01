import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { FormatListRow, FormatListScreen } from '@core/gl/ui/format-list-screen';
import { BattleSession } from '@features/battle/state/battle-session';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { LiveBattle, LiveBattles } from '@features/live/state/live-battles';
import { PlayerRatings } from '@features/live/state/player-ratings';
import { PickerOption } from '@shared/components/option-picker';
import { PLAYABLE_FORMATS, RANDOM_BATTLE_FORMAT } from '@shared/data/formats';
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
  host: { class: 'block' },
  template: '',
})
export class LiveScene {
  private readonly router = inject(Router);
  private readonly session = inject(BattleSession);
  private readonly connection = inject(ShowdownConnection);
  private readonly live = inject(LiveBattles);
  private readonly playerRatings = inject(PlayerRatings);
  /**
   * Best-of-3 battles' average rating, by room: the room list rates none of them (no `minElo`), so it's
   * the players' ratings in the format now.
   */
  private readonly averages = new RowLookups<number>((roomId) => this.averageOf(roomId), LOOKUPS_AT_ONCE, () => undefined);

  /** The format shown. */
  private readonly shownFormat = signal(this.live.format() ?? RANDOM_BATTLE_FORMAT);
  private readonly connected = computed(() => this.connection.state().status === 'connected');
  /** The list, once it's the shown format's. */
  private readonly battles = computed(() => (this.live.format() === this.shownFormat() ? this.live.battles() : []));

  private readonly message = computed(() => {
    if (!this.connected()) return 'Offline: connect from the menu to watch live battles.';
    if (this.live.loading()) return 'Looking for battles…';
    if (this.live.format() === this.shownFormat() && this.battles().length === 0) return 'No battles in this format right now. Try Refresh.';
    return null;
  });

  private readonly rows = computed((): FormatListRow[] => {
    const averages = this.averages.results();
    return this.battles().map((battle) => ({ title: `${battle.p1} vs ${battle.p2}`, detail: ratingText(battle, averages.get(battle.roomId)) }));
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
    open: (index) => this.watch(this.battles()[index]),
    shown: (from, to) => this.showRatings(from, to),
  });

  constructor() {
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

  /** Opens the battle on the battle screen, as a spectator. */
  private watch(battle: LiveBattle | undefined): void {
    if (!battle || this.session.active()) return;
    this.session.requestSpectate(battle.roomId);
    void this.router.navigateByUrl('/battle');
  }
}

function ratingText(battle: LiveBattle, average: number | 'loading' | 'failed' | undefined): string {
  if (battle.tournament) return 'Tournament';
  if (battle.rating !== null) return `Rating ${battle.rating}`;
  if (average === undefined) return 'Unrated';
  if (average === 'loading') return 'Rating…';
  return average === 'failed' ? 'Rating unknown' : `Avg rating ${average}`;
}
