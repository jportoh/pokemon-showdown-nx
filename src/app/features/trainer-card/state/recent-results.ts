import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ReplayApi } from '@features/replays/data/replay-api';
import { toId } from '@shared/utils/to-id';

/** How many of a player's latest battles the card shows. */
export const RECENT_COUNT = 8;

/** A battle's result for the player: won, lost, a tie, or not known (a log saved before the end). */
export type RecentResult = 'W' | 'L' | 'T' | '?';

export interface RecentResultsState {
  userId: string;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  /** The newest first. */
  results: readonly RecentResult[];
}

/**
 * A player's latest results for the Trainer Card, from their public replays (Showdown keeps no other
 * record): the replay server's search for their name, then each of the latest few logs' end. Only
 * battles saved as replays count (ours are, as they end, while Settings saves them).
 */
@Service()
export class RecentResults {
  private readonly api = inject(ReplayApi);
  private readonly render = inject(RenderScheduler);
  private readonly stateSignal = signal<RecentResultsState>({ userId: '', status: 'idle', results: [] });
  /** The latest load: an older one's answer is dropped. */
  private request = 0;

  readonly state = this.stateSignal.asReadonly();

  load(userId: string): void {
    const request = ++this.request;
    const previous = this.stateSignal();
    this.set({ userId, status: 'loading', results: previous.userId === userId ? previous.results : [] });
    void this.fetch(userId).then(
      (results) => request === this.request && this.set({ userId, status: 'loaded', results }),
      () => request === this.request && this.set({ ...this.stateSignal(), status: 'error' }),
    );
  }

  private async fetch(userId: string): Promise<RecentResult[]> {
    const replays = (await this.api.search('', userId)).slice(0, RECENT_COUNT);
    const games = await Promise.all(replays.map((replay) => this.api.game(replay.id).catch(() => null)));
    return games.map((game): RecentResult => {
      if (!game?.end) return '?';
      if (game.end === 'tie') return 'T';
      return toId(game.end.winner) === userId ? 'W' : 'L';
    });
  }

  private set(state: RecentResultsState): void {
    this.stateSignal.set(state);
    this.render.request();
  }
}
