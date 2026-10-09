import { Service, computed, inject, linkedSignal, signal } from '@angular/core';
import { AppSettings } from '@core/settings/app-settings';
import { inGridOrder } from '@features/teambuilder/gl/team-grid-view';
import { Team } from '@features/teambuilder/models/team';
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
  /** The team's ID; null picks the format's favourite, or its first team. */
  readonly teamId = signal<string | null>(null);

  /** The format picked, as the app offers it. */
  readonly playFormat = computed(() => PLAYABLE_FORMATS.find((f) => f.id === this.format()) ?? PLAYABLE_FORMATS[0]);

  /** The player's teams for the format, with at least one Pokémon, in the teambuilder's order. */
  readonly teams = computed(() => {
    const format = this.playFormat();
    return inGridOrder(this.teamStore.teams()).filter((team) => team.format === (format.teamFormat ?? format.id) && team.sets.length > 0);
  });

  /** The team picked, or the format's favourite (else its first team) while none is; none with random teams. */
  readonly team = computed(() => (this.playFormat().randomTeams ? null : preferredTeam(this.teams(), this.teamId())));
}

/** Of a format's teams, the one picked if it's among them, else the favourite, else the first. */
export function preferredTeam(teams: readonly Team[], pickedId: string | null): Team | null {
  return teams.find((team) => team.id === pickedId) ?? teams.find((team) => team.favourite) ?? teams[0] ?? null;
}
