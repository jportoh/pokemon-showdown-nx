// What the oldest generations' battles don't have, for the screens that show a Pokémon.

/** Abilities came in Gen 3: before it, Showdown sends "No Ability". */
export function hasAbilities(gen: number): boolean {
  return gen >= 3;
}

/** Held items came in Gen 2. */
export function hasItems(gen: number): boolean {
  return gen >= 2;
}

export type StatKey = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

const STATS: readonly { id: StatKey; label: string }[] = [
  { id: 'hp', label: 'HP' },
  { id: 'atk', label: 'Atk' },
  { id: 'def', label: 'Def' },
  { id: 'spa', label: 'SpA' },
  { id: 'spd', label: 'SpD' },
  { id: 'spe', label: 'Spe' },
];

/** Gen 1 has one Special stat (Showdown keeps it as equal SpA and SpD): one row, by SpA. */
const GEN1_STATS = STATS.filter((stat) => stat.id !== 'spd').map((stat) => (stat.id === 'spa' ? { id: stat.id, label: 'Spc' } : stat));

/** The stats a generation's Pokémon have, in order, with their short labels. */
export function statRows(gen: number): readonly { id: StatKey; label: string }[] {
  return gen === 1 ? GEN1_STATS : STATS;
}
