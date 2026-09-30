import { Service } from '@angular/core';
import { fetchRatings, LadderRating } from '@features/trainer-card/state/ladder-ratings';
import { toId } from '@shared/utils/to-id';

/** How long a player's ratings are reused before asking again. */
const KEEP_MS = 10 * 60 * 1000;

/** Showdown's starting rating: a player with no games in a format is at it. */
const START_RATING = 1000;

/**
 * Players' current ladder ratings, from the login server (the Trainer Card's source), each player
 * downloaded once and kept for KEEP_MS whichever rows or pages show them. The console doesn't enforce
 * CORS; a regular browser can't read the answer (see LADDER_URL).
 */
@Service()
export class PlayerRatings {
  private readonly players = new Map<string, { at: number; ratings: Promise<LadderRating[]> }>();

  /** The player's rating in the format now (START_RATING if they haven't played it). */
  async rating(name: string, formatId: string): Promise<number> {
    const ratings = await this.ratingsOf(toId(name));
    return ratings.find((rating) => rating.formatId === formatId)?.elo ?? START_RATING;
  }

  private ratingsOf(userId: string): Promise<LadderRating[]> {
    const kept = this.players.get(userId);
    if (kept && Date.now() - kept.at < KEEP_MS) return kept.ratings;
    const ratings = fetchRatings(userId);
    ratings.catch(() => this.players.delete(userId));
    this.players.set(userId, { at: Date.now(), ratings });
    return ratings;
  }
}
