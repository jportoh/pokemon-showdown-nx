import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { LOBBY_ROOM_ID, splitLine } from '@features/connection/showdown-protocol';

/** A battle being played on Showdown right now. */
export interface LiveBattle {
  /** The battle's room ("battle-gen9randombattle-2345678"), which spectators join. */
  roomId: string;
  p1: string;
  p2: string;
  /** The lower of the two players' ratings in a rated battle; null when unrated. */
  rating: number | null;
  /** Part of a tournament. */
  tournament: boolean;
}

/**
 * The battles being played on Showdown in a format, from `/cmd roomlist <format>`, answered with
 * `|queryresponse|roomlist|{"rooms":{"battle-…":{"p1":"…","p2":"…","minElo":1234}}}` (the latest 100).
 * Listed by rating, the best first, then the unrated ones (the newest first).
 */
@Service()
export class LiveBattles {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);
  private readonly battlesSignal = signal<readonly LiveBattle[]>([]);
  private readonly loadingSignal = signal(false);
  /** The format asked for, whose answer is awaited (the answer doesn't say which format it's for). */
  private pendingFormat: string | null = null;
  private readonly formatSignal = signal<string | null>(null);

  readonly battles = this.battlesSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  /** The format the list is for. */
  readonly format = this.formatSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      // Global messages come without a room, which the parser files under the lobby.
      if (frame.roomId !== LOBBY_ROOM_ID) return;
      for (const line of frame.lines) {
        const [type, query, json] = splitLine(line, 2);
        if (type === 'queryresponse' && query === 'roomlist') this.onRoomList(json ?? '');
      }
    });
    this.connection.ended.subscribe(() => {
      this.pendingFormat = null;
      this.loadingSignal.set(false);
    });
  }

  /** Asks for the format's battles (connected only). */
  load(format: string): void {
    if (this.connection.state().status !== 'connected') return;
    this.pendingFormat = format;
    this.loadingSignal.set(true);
    this.render.request();
    this.connection.send('', `/cmd roomlist ${format}`);
  }

  private onRoomList(json: string): void {
    const format = this.pendingFormat;
    if (!format) return;
    this.pendingFormat = null;
    let rooms: Record<string, { p1?: string; p2?: string; minElo?: number | string }> = {};
    try {
      rooms = (JSON.parse(json) as { rooms?: typeof rooms } | null)?.rooms ?? {};
    } catch {
      rooms = {};
    }
    const battles = Object.entries(rooms)
      .filter(([, room]) => room.p1 && room.p2)
      .map(([roomId, room]) => ({
        roomId,
        p1: room.p1!,
        p2: room.p2!,
        rating: typeof room.minElo === 'number' ? room.minElo : null,
        tournament: room.minElo === 'tour',
      }));
    // Rated first, the best first; the rest keep the server's order (the newest first).
    battles.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    this.battlesSignal.set(battles);
    this.formatSignal.set(format);
    this.loadingSignal.set(false);
    this.render.request();
  }
}
