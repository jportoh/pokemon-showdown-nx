import { Service, inject } from '@angular/core';
import { BattleRooms } from '@features/connection/battle-rooms';
import { BattleSummary, summarizeBattle } from '@shared/utils/battle-summary';

/** How long a look waits for the room's history before giving up. */
const PEEK_TIMEOUT_MS = 8000;

/**
 * A quick look at a live battle for Watch Live's details: the room is joined as a spectator, its
 * history (`|init|battle` and the log so far, the server's first frame) is read for the players, both
 * teams and the turn, and the room is left at once. The frames are listened to before joining, so the
 * room never opens on the battle screen (BattleRooms announces rooms nobody listens to).
 */
@Service()
export class LivePeek {
  private readonly rooms = inject(BattleRooms);

  peek(roomId: string): Promise<BattleSummary> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      let done = false;
      const finish = (error: string | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.rooms.leave(roomId);
        if (error) reject(new Error(error));
        else resolve(summarizeBattle(lines));
      };
      this.rooms.attach(roomId, (frame) => {
        const frameLines = frame.split('\n');
        lines.push(...frameLines);
        if (frameLines.some((line) => line.startsWith('|noinit|'))) finish("This battle can't be watched (it's private, or over).");
        else if (frameLines.includes('|init|battle')) finish(null);
      });
      this.rooms.join(roomId);
      const timer = setTimeout(() => finish('The battle took too long to answer.'), PEEK_TIMEOUT_MS);
    });
  }
}
