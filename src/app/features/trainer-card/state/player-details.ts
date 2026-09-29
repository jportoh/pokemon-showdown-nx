import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { ShowdownConnection } from '@features/connection/showdown-connection';
import { LOBBY_ROOM_ID, splitLine } from '@features/connection/showdown-protocol';
import { toId } from '@shared/utils/to-id';

export interface PlayerDetailsState {
  /** The player asked about. */
  userId: string;
  status: 'idle' | 'loading' | 'loaded';
  /** Their name as the server writes it; empty until it answers. */
  name: string;
  /** Their avatar; empty when unknown (offline players have none). */
  avatar: string;
}

/**
 * Another player's name and avatar, from `/cmd userdetails <userid>`, answered with
 * `|queryresponse|userdetails|{"userid":"zarel","name":"Zarel","avatar":"zarel",…}` (no avatar when
 * they're offline). One player at a time: the Trainer Card shown for someone else.
 */
@Service()
export class PlayerDetails {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);
  private readonly stateSignal = signal<PlayerDetailsState>({ userId: '', status: 'idle', name: '', avatar: '' });

  readonly state = this.stateSignal.asReadonly();

  constructor() {
    this.connection.frames.subscribe((frame) => {
      // Global messages come without a room, which the parser files under the lobby.
      if (frame.roomId !== LOBBY_ROOM_ID) return;
      for (const line of frame.lines) {
        const [type, query, json] = splitLine(line, 2);
        if (type === 'queryresponse' && query === 'userdetails') this.onDetails(json ?? '');
      }
    });
  }

  load(name: string): void {
    const userId = toId(name);
    this.set({ userId, status: 'loading', name: '', avatar: '' });
    this.connection.send('', `/cmd userdetails ${userId}`);
  }

  private onDetails(json: string): void {
    const details = parseDetails(json);
    const state = this.stateSignal();
    if (!details || details.userid !== state.userId) return;
    this.set({
      userId: state.userId,
      status: 'loaded',
      name: typeof details.name === 'string' ? details.name : '',
      avatar: typeof details.avatar === 'string' || typeof details.avatar === 'number' ? String(details.avatar) : '',
    });
  }

  private set(state: PlayerDetailsState): void {
    this.stateSignal.set(state);
    this.render.request();
  }
}

interface UserDetails {
  userid?: unknown;
  name?: unknown;
  avatar?: unknown;
}

function parseDetails(json: string): UserDetails | null {
  try {
    const data: unknown = JSON.parse(json);
    return typeof data === 'object' && data !== null ? (data as UserDetails) : null;
  } catch {
    return null;
  }
}
