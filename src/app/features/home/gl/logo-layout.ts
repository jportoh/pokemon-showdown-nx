import { Texture } from '@core/gl/gl-renderer';
import { GlSprites } from '@core/gl/gl-sprites';
import { TextStyle } from '@core/gl/gl-textures';
import { ImagePriority } from '@core/gl/sprite-bitmaps';

/** Where a screen draws the logo (the gold "o!" and POKÉMON SHOWDOWN!), so the title's logo can fly there. */
export interface LogoPlace {
  markX: number;
  markY: number;
  /** The "o!"'s side, square. */
  markSize: number;
  /** POKÉMON's left edge; SHOWDOWN! follows it after `gap`. */
  textX: number;
  textCy: number;
  gap: number;
  style: TextStyle;
}

/** The logo top left, where the entry screen and the menu draw it (and the title's lands). */
export const HOME_LOGO: LogoPlace = { markX: 40, markY: 24, markSize: 48, textX: 100, textCy: 48, gap: 8, style: { size: 26, bold: true } };

/**
 * Pokémon Showdown's "o!" in gold, as the app icon has it (native/icon.jpg), bundled at the sizes it's
 * drawn at: textures aren't mipmapped, so a big one drawn small would shimmer.
 */
export const LOGO_MARKS = [
  { size: 48, url: 'logo/showdown-gold-48.png' },
  { size: 120, url: 'logo/showdown-gold-120.png' },
] as const;

/** The "o!" to draw `size` pixels wide: the smallest bundled one at least that big (else the biggest); null until decoded. */
export function logoMark(images: GlSprites, size: number): Texture | null {
  const mark = LOGO_MARKS.find((m) => m.size >= size - 0.5) ?? LOGO_MARKS[LOGO_MARKS.length - 1];
  return images.image(mark.url, ImagePriority.Screen);
}
