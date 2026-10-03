import { Service, computed, inject, linkedSignal, signal } from '@angular/core';
import { AppSettings } from '@core/settings/app-settings';
import { newestFirst } from '@features/teambuilder/gl/team-grid-view';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { PLAYABLE_FORMATS } from '@shared/data/formats';

/** The format and team picked on the Battle page, kept while the app runs so a return finds them. */
@Service()
export class PlaySelection {
  private readonly teamStore = inject(TeamStore);
  private readonly settings = inject(AppSettings);

  /**
   * The format's ID: Settings' default until one is picked here, and again whenever that default
   * changes (only then: its source is the default alone, so other settings leave the pick alone).
   */
  readonly format = linkedSignal({ source: () => this.settings.settings().battleFormat, computation: (format) => format });
  /** The team's ID; null picks the first team that fits. */
  readonly teamId = signal<string | null>(null);

  /** The format picked, as the app offers it. */
  readonly playFormat = computed(() => PLAYABLE_FORMATS.find((f) => f.id === this.format()) ?? PLAYABLE_FORMATS[0]);

  /** The player's teams for the format, with at least one Pokémon, newest first (as the teambuilder shows them). */
  readonly teams = computed(() => {
    const format = this.playFormat();
    return newestFirst(this.teamStore.teams()).filter((team) => team.format === (format.teamFormat ?? format.id) && team.sets.length > 0);
  });

  /** The team picked, or the newest one that fits while none is (or the picked one is gone); none with random teams. */
  readonly team = computed(() => {
    if (this.playFormat().randomTeams) return null;
    const teams = this.teams();
    return teams.find((team) => team.id === this.teamId()) ?? teams[0] ?? null;
  });
}
