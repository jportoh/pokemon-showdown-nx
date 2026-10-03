import { Service, inject } from '@angular/core';
import { AppSettings } from '@core/settings/app-settings';
import { ShowdownConnection } from './showdown-connection';

/**
 * Saves the replay of each battle we play as it ends (Settings: Save my replays), the way Showdown's
 * own client does with its button: `/savereplay` in the battle's room. Showdown keeps no list of a
 * player's battles, only the replays saved of them, so these are what the battle history finds (by
 * the player's name). `silent`: the server doesn't answer with a popup. A battle of ours is one whose
 * room sent us a request (the server sends requests to the players only, never to spectators). The
 * replay is public unless the battle was invite-only (spectators off): the server saves those as
 * private, which the history can't list.
 */
@Service()
export class ReplayAutoSave {
  private readonly connection = inject(ShowdownConnection);
  private readonly settings = inject(AppSettings);
  /** Rooms of battles we play that haven't ended yet. */
  private readonly playing = new Set<string>();

  constructor() {
    this.connection.frames.subscribe(({ roomId, lines }) => {
      if (!roomId.startsWith('battle-')) return;
      for (const line of lines) {
        if (line.startsWith('|request|{')) this.playing.add(roomId);
        else if ((line.startsWith('|win|') || line === '|tie') && this.playing.delete(roomId)) this.ended(roomId);
        else if (line.startsWith('|deinit')) this.playing.delete(roomId);
      }
    });
  }

  private ended(roomId: string): void {
    if (this.settings.settings().saveReplays) this.connection.send(roomId, '/savereplay silent');
  }
}
