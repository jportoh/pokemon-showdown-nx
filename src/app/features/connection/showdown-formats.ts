import { Service, inject } from '@angular/core';
import { formatName } from '@shared/data/formats';
import { toId } from '@shared/utils/to-id';
import { ShowdownConnection } from './showdown-connection';
import { LOBBY_ROOM_ID, splitLine } from './showdown-protocol';

/**
 * The names of Showdown's formats, from the list the server sends on connecting:
 * `|formats|,1|S/V Singles|[Gen 9] Random Battle,f|[Gen 9] OU,e|…` (a `,N` entry opens a column,
 * the one after it is the section's name, and every other entry is a format's name and its flags).
 * Kept once received, so formats read anywhere (a player's ladder ratings) show their real names.
 * Created at start (App) so it doesn't miss the list.
 */
@Service()
export class ShowdownFormats {
  private readonly names = new Map<string, string>();

  constructor() {
    inject(ShowdownConnection).frames.subscribe((frame) => {
      if (frame.roomId !== LOBBY_ROOM_ID) return;
      for (const line of frame.lines) {
        const [type, list] = splitLine(line, 1);
        if (type === 'formats') this.onFormats(list ?? '');
      }
    });
  }

  /** "[Gen 9] OU" for "gen9ou"; the app's own names, or the ID itself, before the list arrives. */
  name(id: string): string {
    return this.names.get(id) ?? formatName(id);
  }

  private onFormats(list: string): void {
    const entries = list.split('|');
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.startsWith(',')) {
        // A new column: its section's name comes next.
        i++;
        continue;
      }
      const comma = entry.lastIndexOf(',');
      const name = comma === -1 ? entry : entry.slice(0, comma);
      if (name) this.names.set(toId(name), name);
    }
  }
}
