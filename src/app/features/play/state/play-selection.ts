import { Service, signal } from '@angular/core';
import { PLAYABLE_FORMATS } from '@shared/data/formats';

/** The format and team picked on the Battle page, kept while the app runs so a return finds them. */
@Service()
export class PlaySelection {
  /** The format's ID. */
  readonly format = signal(PLAYABLE_FORMATS[0].id);
  /** The team's ID; null picks the first team that fits. */
  readonly teamId = signal<string | null>(null);
}
