import { ChampionsDex } from '@core/dex/champions-dex';
import { abilityName, itemName } from '@core/dex/names';

/** One Pokémon of an open team sheet: everything but its stats. */
export interface SheetPokemon {
  species: string;
  item: string;
  ability: string;
  moves: readonly string[];
  nature: string;
  /** 'M', 'F' or '' (genderless, or not given). */
  gender: string;
}

/**
 * Reads the packed team of `|showteam|` (Showdown's `Teams.pack`: sets joined by `]`, each
 * `NAME|SPECIES|ITEM|ABILITY|MOVES|NATURE|EVS|GENDER|…`). The sheet has no nicknames, so NAME is the
 * species and SPECIES is left empty; names come packed ("SitrusBerry", "FakeOut", "Intimidate") and
 * are looked up by ID.
 */
export function unpackTeamSheet(packed: string, dex: ChampionsDex): SheetPokemon[] {
  return packed
    .split(']')
    .filter((set) => set.length > 0)
    .map((set) => {
      const [name = '', species = '', item = '', ability = '', moves = '', nature = '', , gender = ''] = set.split('|');
      const entry = dex.species(species || name);
      const speciesName = entry?.name ?? (species || name);
      return {
        species: speciesName,
        item: dex.item(item)?.name ?? itemName(item),
        ability: dex.ability(ability)?.name ?? abilityName(ability),
        moves: moves
          .split(',')
          .filter(Boolean)
          .map((move) => dex.move(move)?.name ?? move),
        nature,
        gender: gender === 'M' || gender === 'F' ? gender : '',
      };
    });
}
