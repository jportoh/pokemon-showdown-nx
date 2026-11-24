import { StatTable } from '@core/dex/champions-dex';
import { toId } from '@shared/utils/to-id';
import gen1 from './gen1.json';
import gen2 from './gen2.json';
import gen3 from './gen3.json';
import gen4 from './gen4.json';
import data from './species.json';

// What the spectator's Pokémon panel shows of every species, generated from Showdown's data by
// `npm run update:species`: species of any format (Random Battle uses many the Champions data doesn't have).
// What differs in Gens 1 to 4 comes from `npm run update:past-gens`.

export interface SpeciesInfo {
  name: string;
  types: readonly string[];
  baseStats: StatTable;
  /** The abilities it can have, in slot order (first, second, hidden). */
  abilities: readonly string[];
}

const SPECIES = data as unknown as Readonly<Record<string, readonly [string, string[], number[], string[]]>>;
type PastSpecies = Readonly<Record<string, readonly [string[], number[], string[]]>>;

/** What differs in past generations, by generation. */
const PAST_SPECIES: Readonly<Record<number, PastSpecies>> = Object.fromEntries([gen1, gen2, gen3, gen4].map((past, i) => [i + 1, past.species as unknown as PastSpecies]));

/**
 * The base species of a cosmetic forme ("Vivillon-Marine" → "Vivillon", "Alcremie-Ruby-Swirl" →
 * "Alcremie"): a forme with no data of its own. Null for anything else, a species or a forme that
 * plays differently (Rotom-Wash).
 */
export function cosmeticBase(species: string): string | null {
  const cut = species.indexOf('-');
  if (cut <= 0 || SPECIES[toId(species)]) return null;
  const base = species.slice(0, cut);
  return SPECIES[toId(base)] ? base : null;
}

/**
 * A species' types, base stats and abilities by its name or ID, as in the generation played (Gens 1
 * to 4: before the Fairy type, older stats, no hidden abilities; no abilities at all before Gen 3); a cosmetic forme ("Vivillon-Pokeball")
 * gets its base species'. Undefined when unknown.
 */
export function speciesInfo(species: string, gen = 9): SpeciesInfo | undefined {
  const id = SPECIES[toId(species)] ? toId(species) : toId(species.split('-')[0]);
  const entry = SPECIES[id];
  if (!entry) return undefined;
  const [name, currentTypes, currentStats, currentAbilities] = entry;
  const [types, [hp, atk, def, spa, spd, spe], abilities] = PAST_SPECIES[gen]?.[id] || [currentTypes, currentStats, currentAbilities];
  return { name, types, baseStats: { hp, atk, def, spa, spd, spe }, abilities };
}
