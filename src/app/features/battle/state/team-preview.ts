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
  return species.slice(0, 6).map((name) => {
    const seen = side.pokemon.find((p) => p.species === name || p.species.startsWith(`${name}-`));
    const active = !!seen && side.active.some((p) => p?.ident === seen.ident);
    return { species: name, seen, active };
  });
}
