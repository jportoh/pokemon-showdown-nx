import { AVATAR_ALIASES } from './avatar-aliases';

/** Showdown's client offers avatars 1 to 293 but these two (a duplicate Red and the unknown trainer). */
const LAST_AVATAR = 293;
const SKIPPED = new Set([162, 168]);

/**
 * The avatars the player can choose from, as Showdown's client offers them: the numbered ones, by
 * their sprite names (what `/avatar` is sent, since only the client knows the numbers).
 */
export const AVATAR_CHOICES: readonly string[] = Array.from({ length: LAST_AVATAR }, (_, i) => i + 1)
  .filter((number) => !SKIPPED.has(number))
  .map((number) => AVATAR_ALIASES[number]);
