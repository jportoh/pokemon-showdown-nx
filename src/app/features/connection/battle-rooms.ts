import { Service, inject, signal } from '@angular/core';
import { RenderScheduler } from '@core/runtime/render-scheduler';
import { Observable, Subject } from 'rxjs';
import { ShowdownConnection } from './showdown-connection';

/** How long a new room may go without anything to show before it opens anyway (as "Joining battle…"). */
const READY_TIMEOUT_MS = 10000;

/**
 * Battle rooms the server puts us in (a challenge we accepted, a ladder match) or that we join to watch. The first frames (`|init|battle`, the
 * players, the first request) arrive while the battle page is still loading, so each room's frames
 * are kept until the page attaches to it, then passed on as they come. A new room is announced once it
 * has something to show (team preview, the start, a request): opened sooner, the page stood empty.
 */
@Service()
export class BattleRooms {
  private readonly connection = inject(ShowdownConnection);
  private readonly render = inject(RenderScheduler);
  private readonly startedSubject = new Subject<string>();
  /** Frames waiting for a listener, per room. */
  private readonly buffers = new Map<string, string[]>();
  private readonly listeners = new Map<string, (frame: string) => void>();
  /** New rooms with nothing to show yet, each with the timer that announces it anyway. */
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly joiningSignal = signal(false);

  /** Emits a room's ID when a battle in it has something to show. */
  readonly started: Observable<string> = this.startedSubject.asObservable();
  /** The server has put us in a battle that has nothing to show yet. */
  readonly joining = this.joiningSignal.asReadonly();

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
        this.pending.set(roomId, setTimeout(() => this.announce(roomId), READY_TIMEOUT_MS));
        this.updateJoining();
      } else return;
      if (lines.some(isShowable)) this.announce(roomId);
    });
  }

  /** Hands over the room's frames so far, then each new one. */
  attach(roomId: string, listener: (frame: string) => void): void {
    const buffered = this.buffers.get(roomId) ?? [];
    this.buffers.delete(roomId);
    this.listeners.set(roomId, listener);
    buffered.forEach((frame) => listener(frame));
  }

  /** Joins a battle as a spectator: `attach()` first, so its frames come straight to the listener. */
  join(roomId: string): void {
    this.connection.send('', `/join ${roomId}`);
  }

  /** Stops listening and leaves the room. */
  leave(roomId: string): void {
    this.listeners.delete(roomId);
    this.buffers.delete(roomId);
    clearTimeout(this.pending.get(roomId));
    if (this.pending.delete(roomId)) this.updateJoining();
    this.connection.send('', `/leave ${roomId}`);
  }

  /** Sends a command to the room (`/choose move 1|3`, `/forfeit`). */
  send(roomId: string, text: string): void {
    this.connection.send(roomId, text);
  }

  /** A new room has something to show (or has waited long enough): the battle page may open it. */
  private announce(roomId: string): void {
    const timer = this.pending.get(roomId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pending.delete(roomId);
    this.updateJoining();
    this.startedSubject.next(roomId);
  }

  private updateJoining(): void {
    this.joiningSignal.set(this.pending.size > 0);
    this.render.request();
  }
}

/** A line that gives the battle page something to show: team preview, the start, a request, the end. */
function isShowable(line: string): boolean {
  return line === '|start' || line.startsWith('|teampreview') || line.startsWith('|request|{') || line.startsWith('|win|') || line === '|tie';
}
