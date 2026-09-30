/**
 * What a replay's log tells of its game that the replay list leaves out. The list only rates the
 * last game of a best-of-3 set (the set is what changes the ladder); every game's log still has the
 * players' ratings as it started (`|player|p1|name|avatar|1196`), `|rated|` on ladder games, and
 * "Game 2 of a best-of-3" in its heading.
 */
export interface ReplayGame {
  /** Its number in a best-of-3 set; null for a single game. */
  game: number | null;
  /** A ladder game (a challenge between two players isn't). */
  rated: boolean;
  /** The players' ratings as the game started (none in an unrated one). */
  ratings: number[];
}

export function parseReplayGame(log: string): ReplayGame {
  let game: number | null = null;
  let rated = false;
  const ratings = new Map<string, number>();
  for (const line of log.split('\n')) {
    if (line.startsWith('|player|')) {
      // |player|p1|NAME|AVATAR|RATING (the side's line is repeated, emptied, as the battle ends).
      const [, , side, , , rating] = line.split('|');
      const value = Number(rating);
      if (rating && Number.isFinite(value) && value > 0) ratings.set(side, value);
    } else if (line.startsWith('|rated|')) {
      // `|rated|Tournament battle` (with a message) doesn't change anyone's rating.
      rated = line === '|rated|';
    } else if (game === null && line.startsWith('|uhtml|bestof|')) {
      const match = /Game (\d+)/.exec(line.replace(/<[^>]*>/g, ''));
      if (match) game = Number(match[1]);
    } else if (line.startsWith('|turn|')) {
      break;
    }
  }
  return { game, rated, ratings: [...ratings.values()] };
}
