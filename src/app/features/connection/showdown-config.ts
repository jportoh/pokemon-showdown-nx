/**
 * Main Pokémon Showdown server's raw WebSocket endpoint (the one the official client uses via SockJS).
 * Must be allow-listed in the Brewser submission's network permissions.
 */
export const SHOWDOWN_WEBSOCKET_URL = 'wss://sim3.psim.us/showdown/websocket';

/** Reconnection backoff: 1 s, 2 s, 4 s… capped at 30 s. */
export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Showdown's login server: gives the assertion that claims a name on the server (see ShowdownLogin).
 * Same host as the sprites, already in the Brewser network allow-list.
 */
export const LOGIN_ASSERTION_URL = 'https://play.pokemonshowdown.com/api/getassertion';

/** Logs in to a registered name with its password (`name`, `pass`, `challstr`): same server as above. */
export const LOGIN_URL = 'https://play.pokemonshowdown.com/api/login';

/** Registers an unregistered name (`username`, `password`, `cpassword`, `captcha`, `challstr`): same server. */
export const REGISTER_URL = 'https://play.pokemonshowdown.com/api/register';

/**
 * A player's ladder ratings (`?user=<userid>`): same server. It sends no CORS headers, so a regular
 * browser can't read it; the console doesn't enforce CORS (see ShowdownLogin).
 */
export const LADDER_URL = 'https://play.pokemonshowdown.com/api/ladderget';

/** Trainer sprites (`<name>.png`, 80x80) and custom ones (`trainers-custom/<id>.png`). */
export const TRAINER_SPRITES_URL = 'https://play.pokemonshowdown.com/sprites/';
