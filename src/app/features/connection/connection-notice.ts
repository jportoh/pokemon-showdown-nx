import { ConnectionState, ConnectionTrouble } from './connection.model';
import { SLOW_ATTEMPT_MS } from './showdown-config';
import { LoginState } from './showdown-login';

/** Why Showdown can't be reached, in a sentence for the player. */
const WHY: Record<ConnectionTrouble, string> = {
  'no-network': 'Your console has no internet connection.',
  unreachable: "Can't reach Showdown. Checking why…",
  'showdown-down': "Showdown doesn't answer: the internet or Showdown itself may be down.",
  'server-only': "Showdown's battle server doesn't answer (its website does): it may be busy, or holding this connection back for a while.",
};

/** The same, short (a button's chip). */
const SHORT: Record<ConnectionTrouble, string> = {
  'no-network': 'No internet',
  unreachable: "Can't reach Showdown",
  'showdown-down': 'Showdown not answering',
  'server-only': 'Battle server busy',
};

/**
 * What to tell the player while the connection they had is being got back, or the first one keeps
 * failing: why it's down and when the next try is ("Trying again in 4 s…"), then that their name is
 * being claimed again. Null while all is well, or while nothing was connected (offline on purpose).
 * `now` is `Date.now()`, for the countdown; without it, none (text drawn with a scene's text cache
 * shouldn't change every second).
 */
export function connectionNotice(connection: ConnectionState, login: LoginState, now: number | null = null): string | null {
  if (connection.status === 'offline' || connection.status === 'error') return null;
  if (connection.status === 'connected') return login.reclaiming ? 'Reconnected. Getting your name back…' : null;
  const why = connection.trouble ? WHY[connection.trouble] : 'Connection lost.';
  return `${why} ${retryText(connection, now)}`;
}

/** "Trying again…", "Trying again in 4 s…" (with `now`), or "Trying (attempt 3)…" while one is under way. */
function retryText(connection: ConnectionState, now: number | null): string {
  if (connection.status === 'connecting') return connection.attempt > 1 ? `Trying again (attempt ${connection.attempt})…` : 'Trying again…';
  if (connection.retryAt === null || now === null) return 'Trying again…';
  const seconds = Math.max(1, Math.ceil((connection.retryAt - now) / 1000));
  return `Trying again in ${seconds} s…`;
}

/**
 * While the first connection is being made and nothing has gone wrong yet: "Connecting to
 * Showdown…", and once the attempt takes longer than it should, that Showdown is slow to answer.
 */
export function connectingText(connection: ConnectionState, now: number): string {
  const slow = connection.attemptSince !== null && now - connection.attemptSince > SLOW_ATTEMPT_MS;
  if (!slow) return 'Connecting to Showdown…';
  return connection.attempt > 1 ? `Showdown is slow to answer… (attempt ${connection.attempt})` : 'Showdown is slow to answer…';
}

/** A short line for a button's chip while attempts keep failing ("Battle server busy · A to try now"). */
export function troubleChip(connection: ConnectionState): string {
  return `${connection.trouble ? SHORT[connection.trouble] : 'No connection'} · A to try now`;
}
