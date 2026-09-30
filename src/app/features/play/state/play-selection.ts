import { Service, inject, signal } from '@angular/core';
import { AppSettings } from '@core/settings/app-settings';

/** The format and team picked on the Battle page, kept while the app runs so a return finds them. */
@Service()
export class PlaySelection {
  /** The format's ID: Settings' default until one is picked. */
  readonly format = signal(inject(AppSettings).settings().battleFormat);
  /** The team's ID; null picks the first team that fits. */
  readonly teamId = signal<string | null>(null);
}
