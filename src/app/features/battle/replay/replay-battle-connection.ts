import { BattleConnection, Replay } from '@features/battle/models/battle';

/**
 * Plays a saved battle from Showdown's replay server. Its log is the same protocol a spectator gets
 * during a live battle (just without `|request|`, which only the players see), so the store and the
 * field run on exactly the code a real battle will feed them. The store paces the playback, so the
 * whole log is handed over at once.
 */
export class ReplayBattleConnection implements BattleConnection {
  constructor(readonly replay: Replay) {}

  start(onMessage: (frame: string) => void): void {
    onMessage(this.replay.log);
  }

  choose(): void {
    // Nothing to choose while watching.
  }

  forfeit(): void {
    // Nothing to forfeit while watching.
  }

  stop(): void {
    // The log was handed over whole; the store drops whatever hasn't played.
  }
}
