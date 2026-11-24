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

/**
 * The base species' sprite for a forme's ("alcremie-rubyswirl" → "alcremie"), or null for a base
 * species: what's drawn when Showdown has no sprite for the forme (some cosmetic ones).
 */
export function baseSprite(sprite: string): string | null {
  const cut = sprite.indexOf('-');
  return cut > 0 ? sprite.slice(0, cut) : null;
}

const SPRITES_URL ='https://play.pokemonshowdown.com/sprites';

/**
 * A sprite's URL, from its file name (96x96 PNGs). Some sprites have no back view (the Megas new in Champions): those fall back to
 * the front one where they're drawn.
 */
export function spriteUrl(sprite: string, back = false, set: SpriteSet = 'gen5'): string {
  return `${SPRITES_URL}/${back ? `${set}-back` : set}/${sprite}.png`;
}

/**
 * Showdown's sprite sets: the Black/White ones (every species), Red/Blue's, Gold/Silver's,
 * Ruby/Sapphire's or Diamond/Pearl's (their generation's species only).
 */
export type SpriteSet = 'gen5' | 'gen1' | 'gen2' | 'gen3' | 'gen4';

/** The sprites a generation's battles show: Gens 1 to 4 their own, Black/White's for the rest. */
export function spriteSetOf(gen: number): SpriteSet {
  return gen >= 1 && gen <= 4 ? (`gen${gen}` as SpriteSet) : 'gen5';
}
