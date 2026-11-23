import { Replay } from '@features/battle/models/battle';
import { swapSidesInLine } from '@features/battle/live/side-swap';
import { BattleDetails, BattleDetailsState, FormatListRow } from '@core/gl/ui/format-list-screen';
import { ReplayGame } from '@features/replays/data/replay-game';
import { BattleSummary } from '@shared/utils/battle-summary';
import { RowLookup } from '@shared/utils/row-lookups';
import { toId } from '@shared/utils/to-id';

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

/** A rating worth a look from here up (its chip is amber). */
export const HIGH_RATING = 1500;

/** A row's rating chip: the list's rating, else the log's (best-of-3 games), "…" while it's read. */
export function ratingChip(rating: number | null | undefined, game: RowLookup<ReplayGame> | undefined): FormatListRow['rating'] {
  if (rating) return { text: `★ ${rating}`, high: rating >= HIGH_RATING };
  if (game === 'loading') return { text: '★ …', high: false };
  if (!game || game === 'failed') return undefined;
  if (!game.rated) return { text: 'Unrated', high: false };
  if (game.ratings.length === 0) return { text: 'Rated', high: false };
  const average = Math.round(game.ratings.reduce((sum, value) => sum + value, 0) / game.ratings.length);
  return { text: `${game.game ? `G${game.game} · ` : ''}★ ${average}`, high: average >= HIGH_RATING };
}

/**
 * A replay's details for the list's panel: its players and their ratings as it started, both teams,
 * and how it ended (from `userId`'s side when given: Won or Lost; else who won).
 */
export function replayDetails(lookup: RowLookup<BattleSummary> | undefined, players: readonly string[], format: string, userId = ''): BattleDetailsState | null {
  if (lookup === undefined) return null;
  if (lookup === 'loading') return { kind: 'loading' };
  if (lookup === 'failed') return { kind: 'error', text: "Couldn't read this replay." };
  const summary = lookup;
  const rating = (value: number | null) => (value ? { text: `★ ${value}`, high: value >= HIGH_RATING } : { text: 'Unrated', high: false });
  const turns = summary.turn === 1 ? '1 turn' : `${summary.turn} turns`;
  let status: BattleDetails['status'];
  if (summary.end === null) status = { chip: { text: 'Unfinished', tone: 'neutral' }, text: `Saved on turn ${summary.turn}` };
  else if (summary.end === 'tie') status = { chip: { text: 'Tie', tone: 'neutral' }, text: turns };
  else if (userId) {
    const won = toId(summary.end.winner) === userId;
    status = { chip: { text: won ? 'Won' : 'Lost', tone: won ? 'good' : 'bad' }, text: `in ${turns}` };
  } else status = { chip: { text: 'Winner', tone: 'good' }, text: `${summary.end.winner} · ${turns}` };
  return {
    kind: 'ready',
    details: {
      players: [summary.players[0] || players[0] || 'Player 1', summary.players[1] || players[1] || 'Player 2'],
      ratings: [rating(summary.ratings[0]), rating(summary.ratings[1])],
      teams: summary.teams,
      format,
      status,
    },
  };
}
