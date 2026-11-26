import { BattlePokemon, BattleSide } from '@features/battle/models/battle';

/** One Pokémon of a side's team, as shown at team preview, with what's been seen of it in battle. */
export interface PreviewMember {
  /** The species as shown at team preview (or as seen, without a team preview). */
  species: string;
  /** The Pokémon once sent out: its HP, status, Mega sprite… */
  seen?: BattlePokemon;
  /** On the field right now. */
  active: boolean;
}

/**
 * The side's team as shown at team preview (at most six), each matched with the Pokémon seen in
 * battle (a forme or Mega counts as its preview species). Without a team preview, the Pokémon seen
 * so far.
 */
export function previewTeam(side: BattleSide): PreviewMember[] {
  const species = side.preview.length > 0 ? side.preview : side.pokemon.map((p) => p.species);
  const names = species.slice(0, 6);
  const direct = names.map((name) => side.pokemon.find((p) => p.species === name || p.species.startsWith(`${name}-`)));
  // A forme the preview names doesn't prefix ("Floette-Eternal" Mega Evolved into "Floette-Mega"):
  // the same base name, among the Pokémon no other member has claimed (Species Clause keeps it unique).
  const claimed = new Set(direct.filter((p) => !!p).map((p) => p.ident));
  return names.map((name, i) => {
    let seen = direct[i];
    if (!seen) {
      seen = side.pokemon.find((p) => !claimed.has(p.ident) && baseName(p.species) === baseName(name));
      if (seen) claimed.add(seen.ident);
    }
    const active = !!seen && side.active.some((p) => p?.ident === seen.ident);
    return { species: name, seen, active };
  });
}

/** "Floette" for "Floette-Eternal" and "Floette-Mega" (only used after exact names have matched, so "Ho-Oh" is safe). */
function baseName(species: string): string {
  return species.split('-')[0];
}
