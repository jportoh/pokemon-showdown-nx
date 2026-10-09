export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

/** Stat points per stat; missing stats have 0. */
export type StatSpread = Partial<Record<StatId, number>>;

/**
 * One Pokémon of a [Gen 9 Champions] team, as in Showdown's text format. There are no IVs, Tera
 * Types or levels to choose (everything is level 50), and `evs` holds stat points (Showdown calls
 * them EVs in the champions mod).
 */
export interface PokemonSet {
  /** Nickname; empty when the Pokémon uses its species name. */
  name: string;
  species: string;
  item: string;
  ability: string;
  gender: 'M' | 'F' | '';
  shiny: boolean;
  /** Only when set explicitly (the default is 255). */
  happiness?: number;
  evs: StatSpread;
  nature: string;
  moves: string[];
}

export interface Team {
  id: string;
  name: string;
  /** Showdown format ID, such as "gen9championsvgc2026regmc". */
  format: string;
  sets: PokemonSet[];
  /** The format's favourite team: the Battle page picks it first. One per format at most. */
  favourite?: boolean;
}

export const MAX_TEAM_SIZE = 6;
export const MAX_MOVES = 4;
