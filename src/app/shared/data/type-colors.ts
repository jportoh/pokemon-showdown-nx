// Row backgrounds per Pokémon type, e.g. for the move list. Darkened versions of the usual type
// colours, so white names and gray-300 (#d1d5db) details on them keep at least 4.5:1 contrast
// (WCAG AA). Plain hex: Brewser renders oklch() with the wrong colours.
const TYPE_COLORS: Readonly<Record<string, string>> = {
  normal: '#5b5b58',
  fire: '#9a2e12',
  water: '#1f4e99',
  grass: '#2a5c1c',
  electric: '#735600',
  ice: '#1a5c66',
  fighting: '#7a1f1a',
  poison: '#6b2a73',
  ground: '#6b4f1a',
  flying: '#4a4a99',
  psychic: '#992f5c',
  bug: '#4a5716',
  rock: '#574a3a',
  ghost: '#4a3a6b',
  dragon: '#3d1f99',
  dark: '#2b1d14',
  steel: '#4a5460',
  fairy: '#8a3a73',
};

/** The row colour for a type name ("Fire"), or '' for an unknown one. */
export function typeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] ?? '';
}
