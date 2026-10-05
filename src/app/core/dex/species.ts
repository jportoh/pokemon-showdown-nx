import { StatTable } from '@core/dex/champions-dex';
import { toId } from '@shared/utils/to-id';
import gen3 from './gen3.json';
import data from './species.json';

// What the spectator's Pokémon panel shows of every species, generated from Showdown's data by
// `npm run update:species`: species of any format (Random Battle uses many the Champions data doesn't have).
// What differs in Gen 3 comes from `npm run update:gen3`.

export interface SpeciesInfo {
  name: string;
  types: readonly string[];
  baseStats: StatTable;
  /** The abilities it can have, in slot order (first, second, hidden). */
  abilities: readonly string[];
}

const SPECIES = data as unknown as Readonly<Record<string, readonly [string, string[], number[], string[]]>>;
const GEN3_SPECIES = gen3.species as unknown as Readonly<Record<string, readonly [string[], number[], string[]]>>;

/**
 * A species' types, base stats and abilities by its name or ID, as in the generation played (Gen 3:
 * before the Fairy type, older stats, no hidden abilities); a cosmetic forme ("Vivillon-Pokeball")
 * gets its base species'. Undefined when unknown.
 */
export function speciesInfo(species: string, gen = 9): SpeciesInfo | undefined {
  const id = SPECIES[toId(species)] ? toId(species) : toId(species.split('-')[0]);
  const entry = SPECIES[id];
  if (!entry) return undefined;
  const [name, currentTypes, currentStats, currentAbilities] = entry;
  const [types, [hp, atk, def, spa, spd, spe], abilities] = (gen === 3 && GEN3_SPECIES[id]) || [currentTypes, currentStats, currentAbilities];
  return { name, types, baseStats: { hp, atk, def, spa, spd, spe }, abilities };
}
