/**
 * Main Pokémon Showdown server's raw WebSocket endpoint (the one the official client uses via SockJS).
 * Must be allow-listed in the Brewser submission's network permissions.
 */
export const SHOWDOWN_WEBSOCKET_URL = 'wss://sim3.psim.us/showdown/websocket';

/** Reconnection backoff: 1 s, 2 s, 4 s… capped at 30 s. */
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 30_000;
