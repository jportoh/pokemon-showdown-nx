import { BattleConnection, SideId } from '@features/battle/models/battle';
import { BattleRooms } from '@features/connection/battle-rooms';
import { toId } from '@shared/utils/to-id';
import { swapSidesInLine } from './side-swap';

/**
 * A real battle on Showdown's server, in a room we were put in (a challenge we accepted). The store
 * gets the room's frames as they are, with the sides swapped when we're p2 (see side-swap), and our
 * choices go back as `/choose <choice>|<rqid>` so the server can tell a late choice from a current one.
 */
export class ShowdownBattleConnection implements BattleConnection {
  /** Our side as the server knows it; null until the first request or `|player|` line says. */
  private side: SideId | null = null;
  /** The latest request's ID, sent with each choice. */
  private rqid: number | null = null;
  /**
   * Frames held until our side is known: the challenger's `|player|` line can come before ours, and
   * passed on unswapped it would give our side their name and leave theirs with none.
   */
  private held: string[] = [];

  constructor(
    private readonly rooms: BattleRooms,
    readonly roomId: string,
    /** Our user ID, to find our side from the `|player|` lines. */
    private readonly userId: string,
  ) {}

  start(onMessage: (frame: string) => void): void {
    this.rooms.attach(this.roomId, (frame) => {
      for (const line of frame.split('\n')) this.learnFrom(line);
      if (!this.side) {
        this.held.push(frame);
        return;
      }
      const frames = [...this.held, frame];
      this.held = [];
      frames.forEach((f) => onMessage(this.translate(f)));
    });
  }

  choose(choice: string): void {
    this.rooms.send(this.roomId, this.rqid === null ? `/choose ${choice}` : `/choose ${choice}|${this.rqid}`);
  }

  /** Showdown's Cancel: the server answers with an error if the opponent has already chosen. */
  undo(): void {
    this.rooms.send(this.roomId, '/undo');
  }

  /** Either player can turn the timer on; off only drops our own request for it (the server decides). */
  setTimer(on: boolean): void {
    this.rooms.send(this.roomId, on ? '/timer on' : '/timer off');
  }

  forfeit(): void {
    this.rooms.send(this.roomId, '/forfeit');
  }

  stop(): void {
    this.rooms.leave(this.roomId);
  }

  private translate(frame: string): string {
    return this.side === 'p2' ? frame.split('\n').map(swapSidesInLine).join('\n') : frame;
  }

  /** Our side and the request's ID, from the lines as the server sent them. */
  private learnFrom(line: string): void {
    if (line.startsWith('|request|') && line.length > '|request|'.length) {
      const request = JSON.parse(line.slice('|request|'.length)) as { rqid?: number; side?: { id?: SideId } };
      if (typeof request.rqid === 'number') this.rqid = request.rqid;
      if (request.side?.id === 'p1' || request.side?.id === 'p2') this.side = request.side.id;
    } else if (!this.side && line.startsWith('|player|')) {
      const [, , side, name] = line.split('|');
      if ((side === 'p1' || side === 'p2') && name && toId(name) === this.userId) this.side = side;
    }
  }
}
