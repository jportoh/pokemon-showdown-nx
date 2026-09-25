import { Service, signal } from '@angular/core';
import { readJson, writeJson } from '@core/persistence/device-storage';
import { toStatPoints } from '@features/teambuilder/data/game-rules';
import { MAX_TEAM_SIZE, PokemonSet, Team } from '@features/teambuilder/models/team';
import { DEFAULT_TEAM_FORMAT, TEAM_FORMATS } from '@shared/data/formats';

/** Versioned so a future change of shape can migrate instead of misreading old data. */
const STORAGE_KEY = 'psb.teams.v1';

/** The user's teams, kept on the device (on the console, in a file on the SD card). */
@Service()
export class TeamStore {
  private readonly teamsSignal = signal<Team[]>(loadTeams());
  private readonly saveFailedSignal = signal(false);

  readonly teams = this.teamsSignal.asReadonly();
  /** True when the last change couldn't be saved (storage unavailable or full). */
  readonly saveFailed = this.saveFailedSignal.asReadonly();

  team(id: string | null): Team | undefined {
    return id === null ? undefined : this.teamsSignal().find((team) => team.id === id);
  }

  /** Adds a team and returns its id. */
  create(name: string, format: string, sets: PokemonSet[]): string {
    const team: Team = { id: createId(), name, format, sets };
    this.update((teams) => [...teams, team]);
    return team.id;
  }

  /**
   * Sets the Pokémon in slot `index`. An index at the end of the team adds it; slots stay contiguous
   * (a team never has gaps).
   */
  setPokemon(id: string, index: number, pokemon: PokemonSet): void {
    this.update((teams) =>
      teams.map((team) => {
        if (team.id !== id || index > team.sets.length || index >= MAX_TEAM_SIZE) return team;
        const sets = [...team.sets];
        sets[index] = pokemon;
        return { ...team, sets };
      }),
    );
  }

  removePokemon(id: string, index: number): void {
    this.update((teams) =>
      teams.map((team) => (team.id === id ? { ...team, sets: team.sets.filter((_, i) => i !== index) } : team)),
    );
  }

  /** A default name for a new team ("Untitled 3") that doesn't clash with existing ones. */
  nextUntitledName(): string {
    const names = new Set(this.teamsSignal().map((team) => team.name));
    let number = 1;
    while (names.has(`Untitled ${number}`)) number++;
    return `Untitled ${number}`;
  }

  rename(id: string, name: string): void {
    this.update((teams) => teams.map((team) => (team.id === id ? { ...team, name } : team)));
  }

  setFormat(id: string, format: string): void {
    this.update((teams) => teams.map((team) => (team.id === id ? { ...team, format } : team)));
  }

  remove(id: string): void {
    this.update((teams) => teams.filter((team) => team.id !== id));
  }

  private update(change: (teams: Team[]) => Team[]): void {
    const teams = change(this.teamsSignal());
    this.teamsSignal.set(teams);
    this.saveFailedSignal.set(!writeJson(STORAGE_KEY, teams));
  }
}

function loadTeams(): Team[] {
  const stored = readJson<unknown>(STORAGE_KEY, []);
  if (!Array.isArray(stored)) return [];
  // Keeps only entries with the expected shape, in case storage holds something unexpected, and
  // brings teams saved before the teambuilder became Champions-only within its rules.
  return stored
    .filter(
      (team): team is Team =>
        typeof team === 'object' && team !== null && typeof team.id === 'string' && typeof team.name === 'string' && Array.isArray(team.sets),
    )
    .map((team) => ({
      ...team,
      format: TEAM_FORMATS.some((format) => format.id === team.format) ? team.format : DEFAULT_TEAM_FORMAT,
      sets: team.sets.map(toChampionsSet),
    }));
}

/** Drops what Champions doesn't have (levels, IVs, Tera Types) and converts EVs to stat points. */
function toChampionsSet(set: PokemonSet): PokemonSet {
  const { name, species, item, ability, gender, shiny, happiness, nature, moves } = set;
  return { name, species, item, ability, gender, shiny, happiness, evs: toStatPoints(set.evs ?? {}), nature, moves };
}

// crypto.randomUUID isn't guaranteed on the Brewser console; uniqueness within one device is enough.
function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
