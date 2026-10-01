/** How a Pokémon's box stands out while a move plays: its user, or one of its targets. */
export type HpBoxEmphasis = 'attacker' | 'target';

/** Green, then yellow under half, red under a fifth, as in the games. */
export function barColor(fraction: number): string {
  return fraction > 0.5 ? '#38c060' : fraction > 0.2 ? '#e0b020' : '#e04030';
}
