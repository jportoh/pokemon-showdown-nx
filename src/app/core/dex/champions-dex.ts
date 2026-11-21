import { Service } from '@angular/core';
import { spriteId } from '@shared/utils/sprite-id';
import { toId } from '@shared/utils/to-id';
import data from './champions-regmc.json';
import { cosmeticBase } from './species';

// The game data of [Gen 9 Champions] VGC 2026 Reg M-C, generated from Showdown's data by
// `npm run update:champions` and bundled with the app, so the console downloads nothing.

export type StatTable = Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>;

export interface DexMove {
  id: string;
  name: string;
  type: string;
  category: string;
  basePower: number;
  /** 0 when it never misses. */
  accuracy: number;
  pp: number;
  priority: number;
  /** Showdown's target type: 'normal', 'allAdjacentFoes', 'self'… */
  target: string;
  /** Showdown's short description. */
  desc: string;
}

export interface DexItem {
  id: string;
  name: string;
  desc: string;
}

export interface DexAbility {
  id: string;
  name: string;
  /** Showdown's short description. */
  desc: string;
}

export interface DexSpecies {
  id: string;
  name: string;
  /** Showdown sprite file name ("arcanine-hisui"). */
  sprite: string;
  types: readonly string[];
  /** In slot order: first, second, hidden, special. */
  abilities: readonly string[];
  baseStats: StatTable;
  /** 'N' for genderless, 'M'/'F' for single-gender species, '' when both are possible. */
  gender: 'M' | 'F' | 'N' | '';
  /** Every move it can learn in the format, sorted by name. */
  moves: readonly DexMove[];
}

/** A species holding its Mega Stone, as what it Mega Evolves into. */
export interface DexMega {
  id: string;
  /** "Garchomp-Mega", "Charizard-Mega-X". */
  name: string;
  /** Its sprite, or the base species' when Showdown has none for it yet. */
  sprite: string;
  /** The species' and the stone's IDs. */
  base: string;
  item: string;
  types: readonly string[];
  ability: string;
  baseStats: StatTable;
}

/** The generated file's shape: base stats in HP/Atk/Def/SpA/SpD/Spe order, moves as indexes (by name). */
interface ChampionsData {
  format: { id: string; name: string };
  generated: string;
  species: { id: string; name: string; sprite: string; types: string[]; abilities: string[]; baseStats: number[]; gender: string; moves: number[] }[];
  megas: { id: string; name: string; sprite: string; base: string; item: string; types: string[]; ability: string; baseStats: number[] }[];
  moves: DexMove[];
  items: DexItem[];
  popularItems: string[];
  abilities: DexAbility[];
}

const DATA = data as ChampionsData;

@Service()
export class ChampionsDex {
  readonly format = DATA.format;
  /** When the data was generated from Showdown's (YYYY-MM-DD). */
  readonly generated = DATA.generated;
  /** Every usable species, sorted by name. */
  readonly allSpecies: readonly DexSpecies[];
  /** Every legal item, popular ones first. */
  readonly allItems: readonly DexItem[] = DATA.items;

  /** Every Mega, sorted by name. */
  readonly allMegas: readonly DexMega[] = DATA.megas.map((mega) => ({ ...mega, baseStats: toStatTable(mega.baseStats) }));

  private readonly speciesById: ReadonlyMap<string, DexSpecies>;
  /** Cosmetic formes looked up so far (see species()). */
  private readonly cosmetic = new Map<string, DexSpecies>();
  private readonly megasById = new Map(this.allMegas.map((mega) => [mega.id, mega]));
  private readonly movesById = new Map(DATA.moves.map((move) => [move.id, move]));
  private readonly itemsById = new Map(DATA.items.map((item) => [item.id, item]));
  private readonly abilitiesById = new Map(DATA.abilities.map((ability) => [ability.id, ability]));

  /** Showdown's "Popular items", in its order. */
  readonly popularItems: readonly DexItem[] = DATA.popularItems.flatMap((id) => this.itemsById.get(id) ?? []);

  constructor() {
    this.allSpecies = DATA.species.map((species) => {
      return {
        ...species,
        gender: species.gender as DexSpecies['gender'],
        baseStats: toStatTable(species.baseStats),
        moves: species.moves.map((index) => DATA.moves[index]),
      };
    });
    this.speciesById = new Map(this.allSpecies.map((species) => [species.id, species]));
  }

  /**
   * Looks a species up by any spelling of its name ("Rotom-Wash", "rotom wash"). A cosmetic forme
   * the data doesn't list ("Vivillon-Marine", from a paste or a battle) is its base species with its
   * own sprite (GlSprites draws the base one if Showdown has none).
   */
  species(name: string): DexSpecies | undefined {
    const id = toId(name);
    const known = this.speciesById.get(id) ?? this.cosmetic.get(id);
    if (known) return known;
    const base = cosmeticBase(name);
    const species = base ? this.speciesById.get(toId(base)) : undefined;
    if (!species) return undefined;
    // Kept, so each lookup gives the same object.
    const forme = { ...species, sprite: spriteId(name) };
    this.cosmetic.set(id, forme);
    return forme;
  }

  megaById(id: string): DexMega | undefined {
    return this.megasById.get(toId(id));
  }

  /** The Mega a species becomes with the item it holds, if that item is its Mega Stone. */
  mega(species: string, item: string): DexMega | undefined {
    const speciesId = toId(species);
    const itemId = toId(item);
    return itemId ? this.allMegas.find((mega) => mega.base === speciesId && mega.item === itemId) : undefined;
  }

  move(id: string): DexMove | undefined {
    return this.movesById.get(toId(id));
  }

  item(id: string): DexItem | undefined {
    return this.itemsById.get(toId(id));
  }

  /** Any ability a usable species or Mega has, by ID or name. */
  ability(id: string): DexAbility | undefined {
    return this.abilitiesById.get(toId(id));
  }
}

function toStatTable([hp, atk, def, spa, spd, spe]: number[]): StatTable {
  return { hp, atk, def, spa, spd, spe };
}
