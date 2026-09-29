// The types in the games' own order (the type chart's, the Pokédex's).
const TYPE_ORDER: readonly string[] = [
  'normal',
  'fire',
  'water',
  'grass',
  'electric',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
];

/** A type's place in the games' order ("Fire" → 1); unknown types go last. */
export function typeRank(type: string): number {
  const index = TYPE_ORDER.indexOf(type.toLowerCase());
  return index === -1 ? TYPE_ORDER.length : index;
}
