export interface ConnectionState {
  /**
   * `offline` until something connects, and again after `disconnect()`; `disconnected` when the
   * socket dropped on its own, or never opened (a reconnection is scheduled).
   */
  status: 'offline' | 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  challstr: string | null;
  /**
   * Why Showdown can't be reached, once attempts keep failing: `no-network` when the device says it
   * has no network; `unreachable` while it's not yet known why; then, from asking Showdown's website
   * (ShowdownConnection's probe), `showdown-down` when it doesn't answer either (the internet or
   * Showdown is down) or `server-only` when it does (only the battle server doesn't: busy, or holding
   * this connection back for a while). Null while connected, or before an attempt has failed enough.
   */
  trouble: ConnectionTrouble | null;
  /** When the next attempt starts (`Date.now()` terms), while one is scheduled. */
  retryAt: number | null;
  /** The attempt under way or next, counting those in a row that didn't open (1 for the first). */
  attempt: number;
  /** When the attempt under way started (`Date.now()` terms), while connecting. */
  attemptSince: number | null;
}

export type ConnectionTrouble = 'no-network' | 'unreachable' | 'showdown-down' | 'server-only';

/** How one attempt to connect went, for the diagnostics (L3). */
export interface ConnectionAttempt {
  /** When it started (`Date.now()` terms). */
  at: number;
  /** `abandoned`: given up for a new one (Try now); `dropped`: it had opened, then went. */
  outcome: 'opening' | 'opened' | 'timeout' | 'closed' | 'abandoned' | 'dropped';
  /** How long it took to open, or to fail. */
  ms: number;
  /** The close code, when the engine gave one (1006: closed without a reason). */
  code?: number;
  /** The socket reported an error on the way. */
  error?: boolean;
}
