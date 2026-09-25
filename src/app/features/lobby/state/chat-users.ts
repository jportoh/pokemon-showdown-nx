import { toId } from '@shared/utils/to-id';
import { ChatUser } from '@features/lobby/models/chat';

// Display order of ranks in the user list, highest first, as in the official client.
const RANK_ORDER = '~&#★@%§☆*+^ !✖‽';

/**
 * Parses a user entry as the server sends it in `|users|`, `|J|`, `|L|` and `|N|`: the rank symbol,
 * the name, and an optional `@status` suffix where a leading `!` means away.
 * `'*Lobbot'` → Lobbot (rank *), `' mkaydo@!'` → mkaydo (away).
 */
export function parseUserEntry(entry: string): ChatUser {
  const rank = entry.charAt(0) || ' ';
  const rest = entry.slice(1);
  const at = rest.indexOf('@');
  const name = (at === -1 ? rest : rest.slice(0, at)).trim();
  const status = at === -1 ? '' : rest.slice(at + 1);
  return { id: toId(name), name, rank, away: status.startsWith('!') };
}

/** Sorts by rank (highest first), then alphabetically by ID. */
export function compareUsers(a: ChatUser, b: ChatUser): number {
  return rankIndex(a.rank) - rankIndex(b.rank) || a.id.localeCompare(b.id);
}

function rankIndex(rank: string): number {
  const index = RANK_ORDER.indexOf(rank);
  return index === -1 ? RANK_ORDER.indexOf(' ') : index;
}
