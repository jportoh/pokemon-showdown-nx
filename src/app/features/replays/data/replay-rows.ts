import { Replay } from '@features/battle/models/battle';
import { swapSidesInLine } from '@features/battle/live/side-swap';
import { ReplayGame } from '@features/replays/data/replay-game';

/**
 * "Game 2 · Avg rating 1190": the game's number in its set, and the average of the players' ratings as
 * it started. In words: Brewser's font draws "~" as a raised accent.
 */
export function gameDetail(game: ReplayGame): string[] {
  const rating = !game.rated
    ? 'Unrated'
    : game.ratings.length > 0
      ? `Avg rating ${Math.round(game.ratings.reduce((sum, value) => sum + value, 0) / game.ratings.length)}`
      : 'Rated';
  return game.game === null ? [rating] : [`Game ${game.game}`, rating];
}

/** "3 min ago", "2 h ago", "4 days ago". */
export function timeAgo(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The replay as the second player saw it: the sides swapped in every line (see side-swap), so the
 * battle screen, which watches from p1's side, shows that player's team at the bottom.
 */
export function fromSecondPlayer(replay: Replay): Replay {
  const [p1, p2] = replay.players;
  return { ...replay, players: [p2, p1], log: replay.log.split('\n').map(swapSidesInLine).join('\n') };
}
