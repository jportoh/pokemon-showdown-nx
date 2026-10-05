import { Service, computed, inject } from '@angular/core';
import { ChampionsDex, DexSpecies } from '@core/dex/champions-dex';
import { STAT_IDS, STAT_NAMES } from '@features/teambuilder/data/game-rules';
import { PokemonSet, StatSpread } from '@features/teambuilder/models/team';
import { TeamStore } from '@features/teambuilder/state/team-store';
import { toId } from '@shared/utils/to-id';
import CALC_SETS from '@core/dex/calc-sets.json';

/** A set the rival can be: one of the format's common sets, one of your teams', or a generic spread. */
export interface RivalSet {
  /** Unique among a species' sets. */
  id: string;
  species: string;
  /** "Balanced Bulk Sitrus", "Rain Doubles", "Max HP & Defense" */
  title: string;
  source: 'common' | 'team' | 'preset';
  set: PokemonSet;
}

interface CommonSet {
  species: string;
  name: string;
  nature: string;
  item: string;
  ability: string;
  evs: StatSpread;
  moves: string[];
}

const DATA = CALC_SETS as { source: string; generated: string; abilities: Record<string, string>; sets: CommonSet[] };

/**
 * The sets a rival can have, by species: first the common ones (the NCP VGC Damage Calculator's
 * hand-picked Champions sets), then the Pokémon of your own teams, then generic spreads any species
 * can have (no moves: they only take hits). A species' default ability is the calc's choice.
 */
@Service()
export class RivalSets {
  private readonly dex = inject(ChampionsDex);
  private readonly store = inject(TeamStore);

  /** Where the common sets come from, for the picker. */
  readonly source = `${DATA.source}, ${DATA.generated}`;

  private readonly common = new Map<string, RivalSet[]>();

  /** Your teams' Pokémon by species, each named after its team. */
  private readonly fromTeams = computed(() => {
    const bySpecies = new Map<string, RivalSet[]>();
    for (const team of this.store.teams()) {
      team.sets.forEach((set, slot) => {
        if (!set.species) return;
        const id = toId(set.species);
        const list = bySpecies.get(id) ?? [];
        list.push({ id: `team-${team.id}-${slot}`, species: set.species, title: team.name, source: 'team', set });
        bySpecies.set(id, list);
      });
    }
    return bySpecies;
  });

  constructor() {
    DATA.sets.forEach((set, i) => {
      const id = toId(set.species);
      const list = this.common.get(id) ?? [];
      list.push({
        id: `common-${i}`,
        species: set.species,
        title: set.name,
        source: 'common',
        set: { name: '', species: set.species, item: set.item, ability: set.ability, gender: '', shiny: false, evs: set.evs, nature: set.nature, moves: set.moves },
      });
      this.common.set(id, list);
    });
  }

  /** Species with common sets. */
  hasCommon(species: string): boolean {
    return this.common.has(toId(species));
  }

  /** Species in one of your teams. */
  inTeams(species: string): boolean {
    return this.fromTeams().has(toId(species));
  }

  /** Every set of a species, in the order ◀▶ go through them. */
  setsFor(species: string): RivalSet[] {
    const id = toId(species);
    const dexSpecies = this.dex.species(species);
    return [...(this.common.get(id) ?? []), ...(this.fromTeams().get(id) ?? []), ...(dexSpecies ? this.presets(dexSpecies) : [])];
  }

  /** The species' first set: a common one if it has any. */
  firstSet(species: string): RivalSet | undefined {
    return this.setsFor(species)[0];
  }

  /** The calc's usual ability for a species (Incineroar: Intimidate). */
  defaultAbility(species: DexSpecies): string {
    return DATA.abilities[species.name] ?? species.abilities[0] ?? '';
  }

  /**
   * Generic spreads: none, and the bulky and offensive ones, with the nature that lowers the attack
   * it doesn't use (its lower base stat).
   */
  private presets(species: DexSpecies): RivalSet[] {
    const physical = species.baseStats.atk >= species.baseStats.spa;
    const bulkyDef = physical ? 'Impish' : 'Bold';
    const bulkySpd = physical ? 'Careful' : 'Calm';
    const spreads: [string, string, StatSpread][] = [
      ['No points', 'Serious', {}],
      ['Max HP & Defense', bulkyDef, { hp: 32, def: 32, spd: 2 }],
      ['Max HP & Sp. Def', bulkySpd, { hp: 32, spd: 32, def: 2 }],
      ['Max Attack & Speed', 'Adamant', { atk: 32, spe: 32, hp: 2 }],
      ['Max Sp. Atk & Speed', 'Modest', { spa: 32, spe: 32, hp: 2 }],
    ];
    const ability = this.defaultAbility(species);
    return spreads.map(([title, nature, evs]) => ({
      id: `preset-${toId(title)}`,
      species: species.name,
      title,
      source: 'preset',
      set: { name: '', species: species.name, item: '', ability, gender: '', shiny: false, evs, nature, moves: [] },
    }));
  }
}

/** "HP 32 / Def 14 / SpD 20", the points it has; '' for none. */
export function spreadText(set: PokemonSet): string {
  return STAT_IDS.filter((stat) => (set.evs[stat] ?? 0) > 0)
    .map((stat) => `${STAT_NAMES[stat]} ${set.evs[stat]}`)
    .join(' / ');
}
