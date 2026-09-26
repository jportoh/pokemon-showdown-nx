// The type chart, for the mock battle's damage. Each attacking type lists the defending types it hits
// super effectively (2), not very effectively (½) or not at all (0); everything else is neutral.
const CHART: Record<string, { double: string[]; half: string[]; zero: string[] }> = {
  Normal: { double: [], half: ['Rock', 'Steel'], zero: ['Ghost'] },
  Fire: { double: ['Grass', 'Ice', 'Bug', 'Steel'], half: ['Fire', 'Water', 'Rock', 'Dragon'], zero: [] },
  Water: { double: ['Fire', 'Ground', 'Rock'], half: ['Water', 'Grass', 'Dragon'], zero: [] },
  Electric: { double: ['Water', 'Flying'], half: ['Electric', 'Grass', 'Dragon'], zero: ['Ground'] },
  Grass: { double: ['Water', 'Ground', 'Rock'], half: ['Fire', 'Grass', 'Poison', 'Flying', 'Bug', 'Dragon', 'Steel'], zero: [] },
  Ice: { double: ['Grass', 'Ground', 'Flying', 'Dragon'], half: ['Fire', 'Water', 'Ice', 'Steel'], zero: [] },
  Fighting: { double: ['Normal', 'Ice', 'Rock', 'Dark', 'Steel'], half: ['Poison', 'Flying', 'Psychic', 'Bug', 'Fairy'], zero: ['Ghost'] },
  Poison: { double: ['Grass', 'Fairy'], half: ['Poison', 'Ground', 'Rock', 'Ghost'], zero: ['Steel'] },
  Ground: { double: ['Fire', 'Electric', 'Poison', 'Rock', 'Steel'], half: ['Grass', 'Bug'], zero: ['Flying'] },
  Flying: { double: ['Grass', 'Fighting', 'Bug'], half: ['Electric', 'Rock', 'Steel'], zero: [] },
  Psychic: { double: ['Fighting', 'Poison'], half: ['Psychic', 'Steel'], zero: ['Dark'] },
  Bug: { double: ['Grass', 'Psychic', 'Dark'], half: ['Fire', 'Fighting', 'Poison', 'Flying', 'Ghost', 'Steel', 'Fairy'], zero: [] },
  Rock: { double: ['Fire', 'Ice', 'Flying', 'Bug'], half: ['Fighting', 'Ground', 'Steel'], zero: [] },
  Ghost: { double: ['Psychic', 'Ghost'], half: ['Dark'], zero: ['Normal'] },
  Dragon: { double: ['Dragon'], half: ['Steel'], zero: ['Fairy'] },
  Dark: { double: ['Psychic', 'Ghost'], half: ['Fighting', 'Dark', 'Fairy'], zero: [] },
  Steel: { double: ['Ice', 'Rock', 'Fairy'], half: ['Fire', 'Water', 'Electric', 'Steel'], zero: [] },
  Fairy: { double: ['Fighting', 'Dragon', 'Dark'], half: ['Fire', 'Poison', 'Steel'], zero: [] },
};

/** How effective a move of `type` is against a Pokémon with `defender` types: 0, ¼, ½, 1, 2 or 4. */
export function effectiveness(type: string, defender: readonly string[]): number {
  const row = CHART[type];
  if (!row) return 1;
  return defender.reduce((total, t) => {
    if (row.zero.includes(t)) return 0;
    if (row.double.includes(t)) return total * 2;
    if (row.half.includes(t)) return total / 2;
    return total;
  }, 1);
}
