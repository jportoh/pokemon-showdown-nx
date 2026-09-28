import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { merge } from 'rxjs';
import { ShowdownConnection } from './showdown-connection';
import { LOBBY_ROOM_ID, splitLine } from './showdown-protocol';

/** How long a popup after searching is taken as the server's answer to it (a refusal). */
const ANSWER_WINDOW_MS = 5000;

/**
 * Searching Showdown's ladder for an opponent in a random format (no team to send): `/search
 * gen9randombattle` (after `/utm null`, which clears any team sent before) and `/cancelsearch`. The
 * server reports what we're searching with `|updatesearch|{"searching":["gen9randombattle"],…}`, and a
 * refusal ("You must choose a name…") as a popup. A match opens a battle room, which BattleRooms picks
 * up and App opens, as an accepted challenge.
 */
@Service()
export class ShowdownSearch {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);
  private readonly searchingSignal = signal<string | null>(null);
  private readonly errorSignal = signal<string | null>(null);
  /** When we last searched: a popup soon after is the server's refusal. */
  private searchedAt = 0;

  /** The format being searched, until a match is found or the search is cancelled. */
  readonly searching = this.searchingSignal.asReadonly();
  /** Why the last search was refused, until the next one. */
  readonly error = this.errorSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      // Global messages come without a room, which the parser files under the lobby.
      if (frame.roomId !== LOBBY_ROOM_ID) return;
      for (const line of frame.lines) {
        const [type, ...args] = splitLine(line, 1);
        if (type === 'updatesearch') this.onUpdateSearch(args[0] ?? '');
        else if (type === 'popup' && Date.now() - this.searchedAt < ANSWER_WINDOW_MS) this.onRefused(args.join('|'));
      }
    });
    // A search doesn't survive a new connection, or the end of one.
    merge(this.connection.opened, this.connection.ended).subscribe(() => this.set(null, null));
  }

  search(format: string): void {
    if (this.searchingSignal()) return;
    this.searchedAt = Date.now();
    this.connection.send('', '/utm null');
    this.connection.send('', `/search ${format}`);
    // Shown at once; the server's `updatesearch` confirms it (or a popup refuses it).
    this.set(format, null);
  }

  cancel(): void {
    if (!this.searchingSignal()) return;
    this.connection.send('', '/cancelsearch');
    this.set(null, null);
  }

  /** `{"searching":["gen9randombattle"],"games":{…}}`: what's being searched now (nothing once matched). */
  private onUpdateSearch(json: string): void {
    let searching: unknown;
    try {
      searching = (JSON.parse(json) as { searching?: unknown }).searching;
    } catch {
      return;
    }
    const formats = Array.isArray(searching) ? searching.filter((format): format is string => typeof format === 'string') : [];
    this.set(formats[0] ?? null, this.errorSignal());
  }

  /** A popup's "||" is a line break. */
  private onRefused(message: string): void {
    this.searchedAt = 0;
    this.set(null, message.replace(/\|\|/g, ' ').trim() || 'The server refused the search.');
  }

  private set(searching: string | null, error: string | null): void {
    this.searchingSignal.set(searching);
    this.errorSignal.set(error);
    this.render.request();
  }
}
