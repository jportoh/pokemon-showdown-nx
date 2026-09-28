import { StatTable } from '@core/dex/champions-dex';
import { toId } from '@shared/utils/to-id';
import data from './species.json';

// What the spectator's Pokémon panel shows of every species, generated from Showdown's data by
// `npm run update:species`: species of any format (Random Battle uses many the Champions data doesn't have).

export interface SpeciesInfo {
  name: string;
  types: readonly string[];
  baseStats: StatTable;
  /** The abilities it can have, in slot order (first, second, hidden). */
  abilities: readonly string[];
}

const SPECIES = data as unknown as Readonly<Record<string, readonly [string, string[], number[], string[]]>>;

/**
 * A species' types, base stats and abilities by its name or ID; a cosmetic forme ("Vivillon-Pokeball")
 * gets its base species'. Undefined when unknown.
 */
export function speciesInfo(species: string): SpeciesInfo | undefined {
  const entry = SPECIES[toId(species)] ?? SPECIES[toId(species.split('-')[0])];
  if (!entry) return undefined;
  const [name, types, [hp, atk, def, spa, spd, spe], abilities] = entry;
  return { name, types, baseStats: { hp, atk, def, spa, spd, spe }, abilities };
}
