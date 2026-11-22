import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { LOBBY_ROOM_ID, splitLine } from '@features/connection/showdown-protocol';
import { toId } from '@shared/utils/to-id';

/** How often the counts are asked for again while someone watches them. */
const REFRESH_MS = 60_000;

export interface ServerCounts {
  users: number;
  battles: number;
}

/** A public chat room as `/cmd rooms` lists it: how many are in it and what it's about. */
export interface ServerRoom {
  users: number;
  desc: string;
}

/**
 * The key a room is found by in `ServerStats.rooms`: its title without accents, as an ID
 * ("Español" is `espanol`; the server's own IDs drop the letter instead, so they can't be used).
 */
export function roomKey(title: string): string {
  return toId(title.normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

/**
 * How many players are on Showdown and how many battles are being played, from `/cmd rooms`,
 * answered with `|queryresponse|rooms|{"chat":[…],"userCount":14857,"battleCount":2344}` (checked
 * live on sim3, 2026-09-30), and each public chat room's users and description from its `chat` list
 * (`{"title":"Lobby","desc":"…","userCount":412,…}`). Only asked for while watched (`watch()`), on
 * connecting and then every minute; forgotten when the connection is closed.
 */
@Service()
export class ServerStats {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);
  private readonly countsSignal = signal<ServerCounts | null>(null);
  private readonly roomsSignal = signal<ReadonlyMap<string, ServerRoom>>(new Map());
  private watchers = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly counts = this.countsSignal.asReadonly();
  /** The public chat rooms, by `roomKey` of their title (empty until the first answer). */
  readonly rooms = this.roomsSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      // Global messages come without a room, which the parser files under the lobby.
      if (frame.roomId !== LOBBY_ROOM_ID) return;
      for (const line of frame.lines) {
        const [type, query, json] = splitLine(line, 2);
        if (type === 'queryresponse' && query === 'rooms') this.onRooms(json ?? '');
      }
    });
    this.connection.opened.subscribe(() => {
      if (this.watchers > 0) this.refresh();
    });
    this.connection.ended.subscribe(() => {
      this.countsSignal.set(null);
      this.roomsSignal.set(new Map());
      this.render.request();
    });
  }

  /** Keeps the counts fresh until the returned function is called. */
  watch(): () => void {
    this.watchers++;
    if (this.watchers === 1) {
      this.refresh();
      this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.watchers--;
      if (this.watchers === 0 && this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  private refresh(): void {
    if (this.connection.state().status !== 'connected') return;
    this.connection.send('', '/cmd rooms');
  }

  private onRooms(json: string): void {
    let data: { userCount?: unknown; battleCount?: unknown; chat?: unknown } | null;
    try {
      data = JSON.parse(json) as { userCount?: unknown; battleCount?: unknown; chat?: unknown } | null;
    } catch {
      return;
    }
    if (Array.isArray(data?.chat)) this.roomsSignal.set(parseRooms(data.chat as unknown[]));
    const users = data?.userCount;
    const battles = data?.battleCount;
    if (typeof users === 'number' && typeof battles === 'number') this.countsSignal.set({ users, battles });
    this.render.request();
  }
}

/** The `chat` list's rooms with a title and a count; their descriptions as plain text. */
function parseRooms(list: readonly unknown[]): Map<string, ServerRoom> {
  const rooms = new Map<string, ServerRoom>();
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { title, desc, userCount } = entry as { title?: unknown; desc?: unknown; userCount?: unknown };
    if (typeof title !== 'string' || typeof userCount !== 'number') continue;
    const text = typeof desc === 'string' ? desc.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
    rooms.set(roomKey(title), { users: userCount, desc: text });
  }
  return rooms;
}
