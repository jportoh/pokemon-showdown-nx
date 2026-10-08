import { BattleConnection } from '@features/battle/models/battle';
import { BattleRooms } from '@features/connection/battle-rooms';

/**
 * A battle on Showdown's server watched as a spectator: the room is joined (after attaching, so its
 * frames come straight here) and its frames passed on as they are, p1 at the bottom as in replays.
 * The first frame is the battle so far (`|init|battle` and the whole log). Nothing to choose, forfeit
 * or time; leaving the screen leaves the room.
 */
export class SpectateBattleConnection implements BattleConnection {
  readonly spectating = true;

  constructor(
    private readonly rooms: BattleRooms,
    readonly roomId: string,
  ) {}

  start(onMessage: (frame: string) => void): void {
    this.rooms.attach(this.roomId, onMessage);
    this.rooms.join(this.roomId);
  }

  choose(): void {}

  forfeit(): void {}

  /** Spectators can talk in the battle's chat too (when the server lets them: guests can't). */
  say(text: string): void {
    this.rooms.send(this.roomId, text);
  }

  stop(): void {
    this.rooms.leave(this.roomId);
  }
}
