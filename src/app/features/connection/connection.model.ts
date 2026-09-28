export interface ConnectionState {
  /**
   * `offline` until something connects, and again after `disconnect()`; `disconnected` when the
   * socket dropped on its own (a reconnection is scheduled).
   */
  status: 'offline' | 'disconnected' | 'connecting' | 'connected' | 'error';
  error: string | null;
  challstr: string | null;
}
