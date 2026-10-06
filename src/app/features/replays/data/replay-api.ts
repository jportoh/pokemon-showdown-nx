import { Service } from '@angular/core';
import { Replay, ReplaySummary } from '@features/battle/models/battle';
import { ReplayGame, parseReplayGame } from '@features/replays/data/replay-game';

/**
 * Showdown's replay server: anyone can list and download saved battles. It answers CORS requests
 * from any origin (checked 2026-09-26). On the console the host must be in the build's network
 * allow-list.
 */
export const REPLAY_SERVER = 'https://replay.pokemonshowdown.com';
/** Games kept at once: a few pages of replays. */
const MAX_GAMES = 200;

@Service()
export class ReplayApi {
  /** Games already looked up (or being), by replay ID: a replay never changes once saved. */
  private readonly games = new Map<string, Promise<ReplayGame>>();

  /**
   * The latest public replays (about 50, newest first) of a format, or of a player (one of the two)
   * in a format or in any (an empty format).
   */
  async search(formatId: string, userId = ''): Promise<ReplaySummary[]> {
    const query = [userId && `user=${encodeURIComponent(userId)}`, formatId && `format=${encodeURIComponent(formatId)}`].filter(Boolean).join('&');
    const replays = await getJson<ReplaySummary[]>(`${REPLAY_SERVER}/search.json?${query}`);
    return Array.isArray(replays) ? replays : [];
  }

  async load(id: string): Promise<Replay> {
    const replay = await getJson<Replay>(`${REPLAY_SERVER}/${encodeURIComponent(id)}.json`);
    if (typeof replay?.log !== 'string') throw new Error('The replay has no battle log.');
    return replay;
  }

  /** A replay's game as its log tells it (a download of a few KB, once per replay; a failure is retried next time). */
  game(id: string): Promise<ReplayGame> {
    let game = this.games.get(id);
    if (!game) {
      game = this.load(id).then((replay) => parseReplayGame(replay.log));
      game.catch(() => this.games.delete(id));
      // The oldest looked up go first: a long session browsing replays doesn't keep them all.
      if (this.games.size >= MAX_GAMES) this.games.delete(this.games.keys().next().value!);
      this.games.set(id, game);
    }
    return game;
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The replay server answered ${response.status}.`);
  return (await response.json()) as T;
}
