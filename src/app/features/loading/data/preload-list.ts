import { ITEM_SHEET_URL } from '@core/dex/names';
import { SPRITE_SHEET_URLS } from '@core/gl/sprite-sheets';
import { avatarUrl } from '@features/trainer-card/data/avatar-url';

export interface PreloadAsset {
  url: string;
  /** Smoothed when scaled (as GlSprites.image), else sampled as pixels (sprites, the item sheet). */
  smooth: boolean;
}

/** The move categories' icons, bundled with the app. */
const CATEGORIES = ['physical', 'special', 'status'];

/**
 * Every image the app shows ahead of time: the item sheet, the move categories, the unknown trainer,
 * and the sheets of every Champions species' and Mega's sprites, front and back (bundled: the console
 * takes ~100 ms per request, so 685 sprites one by one took 70 s, test p3). Random Battle's species
 * load when shown, from Showdown.
 */
export function preloadList(): PreloadAsset[] {
  return [
    { url: ITEM_SHEET_URL, smooth: false },
    ...CATEGORIES.map((category) => ({ url: `categories/${category}.png`, smooth: true })),
    { url: avatarUrl(''), smooth: false },
    ...SPRITE_SHEET_URLS.map((url) => ({ url, smooth: false })),
  ];
}
