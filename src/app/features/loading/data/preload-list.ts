import { ITEM_SHEET_URL } from '@core/dex/names';
import { ChampionsDex } from '@core/dex/champions-dex';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';
import { spriteUrl } from '@shared/utils/sprite-id';

/** What an image is, for the loading screen's figures: a back sprite may not exist (some new Megas). */
export type PreloadKind = 'image' | 'front' | 'back';

export interface PreloadAsset {
  url: string;
  kind: PreloadKind;
  /** Smoothed when scaled (as GlSprites.image), else sampled as pixels (sprites, the item sheet). */
  smooth: boolean;
}

/** The move categories' icons, bundled with the app. */
const CATEGORIES = ['physical', 'special', 'status'];

/**
 * Every image the app shows ahead of time, the shared ones first: the item sheet, the move
 * categories, the unknown trainer and the login box's Pikachu, then each Champions species' and
 * Mega's front sprite (team builder, team preview), then their back sprites (the battle field).
 * Random Battle's species aren't here: every species, front and back, would be too much to keep.
 */
export function preloadList(dex: ChampionsDex): PreloadAsset[] {
  const assets = new Map<string, PreloadAsset>();
  const add = (url: string, kind: PreloadKind, smooth = false) => {
    if (!assets.has(url)) assets.set(url, { url, kind, smooth });
  };
  add(ITEM_SHEET_URL, 'image');
  for (const category of CATEGORIES) add(`categories/${category}.png`, 'image', true);
  add(avatarUrl(''), 'image');
  add(spriteUrl('pikachu'), 'front');
  const sprites = [...dex.allSpecies.map((species) => species.sprite), ...dex.allMegas.map((mega) => mega.sprite)];
  for (const sprite of sprites) add(spriteUrl(sprite), 'front');
  for (const sprite of sprites) add(spriteUrl(sprite, true), 'back');
  return [...assets.values()];
}
