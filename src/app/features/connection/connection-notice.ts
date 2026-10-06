import { ConnectionState } from './connection.model';
import { LoginState } from './showdown-login';

/**
 * What to tell the player while the connection they had is being got back: why it's down and when
 * the next try is ("Reconnecting in 4 s…"), then that their name is being claimed again. Null while
 * all is well, or while nothing was connected (offline on purpose). `now` is `Date.now()`, for the
 * countdown; without it, none (text drawn with a scene's text cache shouldn't change every second).
 */
export function connectionNotice(connection: ConnectionState, login: LoginState, now: number | null = null): string | null {
  if (connection.status === 'offline' || connection.status === 'error') return null;
  if (connection.status === 'connected') return login.reclaiming ? 'Reconnected. Getting your name back…' : null;
  const why =
    connection.trouble === 'no-network'
      ? 'No network connection.'
      : connection.trouble === 'unreachable'
        ? "Can't reach Showdown."
        : 'Connection lost.';
  if (connection.status === 'connecting' || connection.retryAt === null || now === null) return `${why} Reconnecting…`;
  const seconds = Math.max(1, Math.ceil((connection.retryAt - now) / 1000));
  return `${why} Reconnecting in ${seconds} s…`;
}
