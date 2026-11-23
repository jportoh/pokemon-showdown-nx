import { Service } from '@angular/core';

/**
 * The last team (packed) sent to the server in each format, with a ladder search, a challenge or an
 * accepted challenge: the one a rematch from the battle's end plays again.
 */
@Service()
export class SentTeams {
  private readonly teams = new Map<string, string>();

  remember(format: string, packedTeam: string | null): void {
    if (packedTeam) this.teams.set(format, packedTeam);
  }

  /** The team last sent in `format` (its ID), if any. */
  get(format: string): string | null {
    return this.teams.get(format) ?? null;
  }
}
