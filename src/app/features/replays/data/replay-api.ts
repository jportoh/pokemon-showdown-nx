import { Service } from '@angular/core';
import { Replay, ReplaySummary } from '@features/battle/models/battle';
import { ReplayGame, parseReplayGame } from '@features/replays/data/replay-game';

/**
 * Showdown's replay server: anyone can list and download saved battles. It answers CORS requests
 * from any origin (checked 2026-09-26). On the console the host must be in the build's network
 * allow-list.
 */
export const REPLAY_SERVER = 'https://replay.pokemonshowdown.com';

@Service()
export class ReplayApi {
  /** Games already looked up (or being), by replay ID: a replay never changes once saved. */
  private readonly games = new Map<string, Promise<ReplayGame>>();

  /** The latest public replays of a format (about 50, newest first). */
  async search(formatId: string): Promise<ReplaySummary[]> {
    const replays = await getJson<ReplaySummary[]>(
      `${REPLAY_SERVER}/search.json?format=${encodeURIComponent(formatId)}`,
    );
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
