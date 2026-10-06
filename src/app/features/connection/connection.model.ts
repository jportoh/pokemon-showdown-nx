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
   * has no network, `unreachable` otherwise (no internet, or the server is down). Null while
   * connected, or before an attempt has failed enough to tell.
   */
  trouble: 'no-network' | 'unreachable' | null;
  /** When the next attempt starts (`Date.now()` terms), while one is scheduled. */
  retryAt: number | null;
}
