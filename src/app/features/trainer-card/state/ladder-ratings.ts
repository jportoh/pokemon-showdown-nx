import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { LADDER_URL } from '@features/connection/showdown-config';

/** A player's standing in one format's ladder. */
export interface LadderRating {
  formatId: string;
  elo: number;
  /** Glicko X-Act Estimate: the chance, in %, of beating a random player of the ladder. */
  gxe: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface LadderRatingsState {
  /** The player they're for. */
  userId: string;
  status: 'idle' | 'loading' | 'loaded' | 'error';
  /** The best first. */
  ratings: readonly LadderRating[];
}

/** The fields of one entry of the login server's `ladderget` answer that are read here. */
interface LadderEntry {
  formatid?: unknown;
  elo?: unknown;
  gxe?: unknown;
  w?: unknown;
  l?: unknown;
  t?: unknown;
}

/**
 * A player's ratings on Showdown's ladders, from the login server's `ladderget`: JSON after a "]"
 * guard, one entry per format they've played. Loaded on demand (the Trainer Card); a newer load for
 * the same player keeps showing the previous ratings meanwhile.
 */
@Service()
export class LadderRatings {
  private readonly render = inject(RenderScheduler);
  private readonly stateSignal = signal<LadderRatingsState>({ userId: '', status: 'idle', ratings: [] });
  /** The latest load: an older one's answer is dropped. */
  private request = 0;

  readonly state = this.stateSignal.asReadonly();

  load(userId: string): void {
    const request = ++this.request;
    const previous = this.stateSignal();
    this.setState({ userId, status: 'loading', ratings: previous.userId === userId ? previous.ratings : [] });
    void fetchRatings(userId).then(
      (ratings) => {
        if (request === this.request) this.setState({ userId, status: 'loaded', ratings });
      },
      () => {
        if (request === this.request) this.setState({ ...this.stateSignal(), status: 'error' });
      },
    );
  }

  private setState(state: LadderRatingsState): void {
    this.stateSignal.set(state);
    this.render.request();
  }
}

/** A player's ratings on every ladder they've played, the best first. */
export async function fetchRatings(userId: string): Promise<LadderRating[]> {
  const response = await fetch(`${LADDER_URL}?user=${encodeURIComponent(userId)}`);
  if (!response.ok) throw new Error(`The login server answered ${response.status}.`);
  const data: unknown = JSON.parse((await response.text()).replace(/^\]/, ''));
  if (!Array.isArray(data)) throw new Error("The login server's answer wasn't understood.");
  return (data as LadderEntry[])
    .filter((entry) => typeof entry?.formatid === 'string')
    .map((entry) => ({
      formatId: entry.formatid as string,
      elo: Math.round(numberOr(entry.elo, 1000)),
      gxe: numberOr(entry.gxe, 0),
      wins: numberOr(entry.w, 0),
      losses: numberOr(entry.l, 0),
      ties: numberOr(entry.t, 0),
    }))
    .sort((a, b) => b.elo - a.elo);
}

/** Numbers may come as strings from the login server. */
function numberOr(value: unknown, fallback: number): number {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : fallback;
}
