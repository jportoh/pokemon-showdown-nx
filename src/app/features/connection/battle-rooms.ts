import { Service, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ShowdownConnection } from './showdown-connection';

/**
 * Battle rooms the server puts us in (a challenge we accepted). The first frames (`|init|battle`, the
 * players, the first request) arrive while the battle page is still loading, so each room's frames
 * are kept until the page attaches to it, then passed on as they come.
 */
@Service()
export class BattleRooms {
  private readonly connection = inject(ShowdownConnection);
  private readonly startedSubject = new Subject<string>();
  /** Frames waiting for a listener, per room. */
  private readonly buffers = new Map<string, string[]>();
  private readonly listeners = new Map<string, (frame: string) => void>();

  /** Emits a room's ID when a battle starts in it. */
  readonly started: Observable<string> = this.startedSubject.asObservable();

  constructor() {
    this.connection.frames.subscribe(({ roomId, lines }) => {
      if (!roomId.startsWith('battle-')) return;
      const frame = lines.join('\n');
      const listener = this.listeners.get(roomId);
      if (listener) {
        listener(frame);
        return;
      }
      const buffer = this.buffers.get(roomId);
      if (buffer) buffer.push(frame);
      else if (lines.includes('|init|battle')) {
        this.buffers.set(roomId, [frame]);
        this.startedSubject.next(roomId);
      }
    });
  }

  /** Hands over the room's frames so far, then each new one. */
  attach(roomId: string, listener: (frame: string) => void): void {
    const buffered = this.buffers.get(roomId) ?? [];
    this.buffers.delete(roomId);
    this.listeners.set(roomId, listener);
    buffered.forEach((frame) => listener(frame));
  }

  /** Stops listening and leaves the room. */
  leave(roomId: string): void {
    this.listeners.delete(roomId);
    this.buffers.delete(roomId);
    this.connection.send('', `/leave ${roomId}`);
  }

  /** Sends a command to the room (`/choose move 1|3`, `/forfeit`). */
  send(roomId: string, text: string): void {
    this.connection.send(roomId, text);
  }
}
