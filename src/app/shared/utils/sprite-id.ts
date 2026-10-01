import { toId } from './to-id';

/** Species whose own name has a hyphen: it isn't a forme's. */
const HYPHENATED_SPECIES = ['Nidoran-F', 'Nidoran-M', 'Ho-Oh', 'Porygon-Z', 'Jangmo-o', 'Hakamo-o', 'Kommo-o', 'Wo-Chien', 'Chien-Pao', 'Ting-Lu', 'Chi-Yu'];

/**
 * Showdown's sprite file name for a species or forme as the battle log names it: "Garchomp" →
 * "garchomp", "Tauros-Paldea-Combat" → "tauros-paldeacombat", "Ho-Oh" → "hooh". For species outside
 * the bundled dex (Random Battle has every species).
 */
export function spriteId(species: string): string {
  const base = HYPHENATED_SPECIES.find((name) => species === name || species.startsWith(`${name}-`));
  const cut = base ? base.length : species.indexOf('-');
  if (cut <= 0 || cut >= species.length) return toId(species);
  return `${toId(species.slice(0, cut))}-${toId(species.slice(cut + 1))}`;
}

const SPRITES_URL = 'https://play.pokemonshowdown.com/sprites';

/**
 * A sprite's URL, from its file name (96x96 PNGs; play.pokemonshowdown.com is allow-listed in the
 * Brewser submission). Some sprites have no back view (the Megas new in Champions): those fall back to
 * the front one where they're drawn.
 */
export function spriteUrl(sprite: string, back = false): string {
  return `${SPRITES_URL}/${back ? 'gen5-back' : 'gen5'}/${sprite}.png`;
}
