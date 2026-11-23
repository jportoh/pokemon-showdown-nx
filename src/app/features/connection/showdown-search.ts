import { Service, inject, signal } from '@angular/core';
import { BattleMusic } from '@core/audio/battle-music';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { AppSettings } from '@core/settings/app-settings';
import { merge } from 'rxjs';
import { SentTeams } from './sent-teams';
import { ShowdownConnection } from './showdown-connection';
import { LOBBY_ROOM_ID, spectatorsCommand, splitLine } from './showdown-protocol';

/** How long a popup after searching is taken as the server's answer to it (a refusal). */
const ANSWER_WINDOW_MS = 5000;
/** How long a cancellation waits for the server's word before it's taken as done. */
const CANCEL_WAIT_MS = 8000;

/**
 * Searching Showdown's ladder for an opponent: `/utm <packed team>` (or `/utm null` in a random
 * format, which clears any team sent before), then `/search <format>`, and `/cancelsearch`. The server
 * reports what we're searching with `|updatesearch|{"searching":["gen9randombattle"],…}`, and a refusal
 * ("You must choose a name…", a team that breaks the format's rules) as a popup. A match opens a battle
 * room, which BattleRooms picks up and App opens, as an accepted challenge.
 */
@Service()
export class ShowdownSearch {
  private readonly connection = inject(ShowdownConnection);
  /** The next battle's music downloads while the player waits for it. */
  private readonly music = inject(BattleMusic);
  private readonly render = inject(RenderScheduler);
  private readonly settings = inject(AppSettings);
  private readonly sentTeams = inject(SentTeams);
  private readonly searchingSignal = signal<string | null>(null);
  private readonly errorSignal = signal<string | null>(null);
  private readonly cancellingSignal = signal(false);
  /** When we last searched: a popup soon after is the server's refusal. */
  private searchedAt = 0;
  private cancelTimer: ReturnType<typeof setTimeout> | null = null;

  /** The format being searched, until a match is found or the server confirms the search is cancelled. */
  readonly searching = this.searchingSignal.asReadonly();
  /** Cancelling the search was asked for, and the server hasn't confirmed it yet. */
  readonly cancelling = this.cancellingSignal.asReadonly();
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

  /** Searches in a format (its ID) with a team in Showdown's packed format, or none (null) in random formats. */
  search(format: string, packedTeam: string | null = null): void {
    if (this.searchingSignal()) return;
    this.searchedAt = Date.now();
    this.connection.send('', spectatorsCommand(this.settings.settings().allowSpectators));
    this.connection.send('', `/utm ${packedTeam ?? 'null'}`);
    this.connection.send('', `/search ${format}`);
    this.sentTeams.remember(format, packedTeam);
    this.music.prepareNext();
    // Shown at once; the server's `updatesearch` confirms it (or a popup refuses it).
    this.set(format, null);
  }

  /**
   * Asks the server to stop searching. The search goes on (`cancelling`) until the server says it
   * has stopped: it may have found an opponent meanwhile, and then that battle opens as any other.
   */
  cancel(): void {
    if (!this.searchingSignal() || this.cancellingSignal()) return;
    this.connection.send('', '/cancelsearch');
    this.cancellingSignal.set(true);
    this.render.request();
    // No answer at all (the connection is in trouble): taken as stopped after a while.
    this.cancelTimer = setTimeout(() => {
      this.cancelTimer = null;
      if (this.cancellingSignal()) this.set(null, null);
    }, CANCEL_WAIT_MS);
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
    if (!searching) {
      this.cancellingSignal.set(false);
      if (this.cancelTimer !== null) clearTimeout(this.cancelTimer);
      this.cancelTimer = null;
    }
    this.searchingSignal.set(searching);
    this.errorSignal.set(error);
    this.render.request();
  }
}
