import { Service } from '@angular/core';
import { Replay, ReplaySummary } from '@features/battle/models/battle';

/**
 * Showdown's replay server: anyone can list and download saved battles. It answers CORS requests
 * from any origin (checked 2026-09-26). On the console the host must be in the build's network
 * allow-list.
 */
export const REPLAY_SERVER = 'https://replay.pokemonshowdown.com';

@Service()
export class ReplayApi {
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
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The replay server answered ${response.status}.`);
  return (await response.json()) as T;
}
