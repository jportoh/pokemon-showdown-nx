import { SpriteSet, spriteUrl } from '@shared/utils/sprite-id';
import data from '@core/dex/sprite-sheets.json';

/** Where a sprite is in its sheet: sheet index, left, top, width, height. */
type Place = [number, number, number, number, number];

interface SheetsData {
  sheets: { url: string; width: number; height: number }[];
  front: Record<string, Place>;
  back: Record<string, Place>;
}

const DATA = data as unknown as SheetsData;

/** The bundled sheets' URLs (the loading screen loads them all). */
export const SPRITE_SHEET_URLS: readonly string[] = DATA.sheets.map((sheet) => sheet.url);

/** A sprite in a bundled sheet: the sheet to load, and the part of it to draw. */
export interface SheetSprite {
  url: string;
  width: number;
  height: number;
  uv: readonly [number, number, number, number];
}

/**
 * A Champions sprite in the sheets bundled with the app (scripts/update-sprite-sheets.mjs), or null
 * for one Showdown serves alone (Random Battle's species). A back sprite Showdown has none for (some
 * new Megas) is its front, as the field draws it.
 */
export function sheetSprite(sprite: string, back: boolean): SheetSprite | null {
  const place = (back ? DATA.back[sprite] : undefined) ?? DATA.front[sprite];
  if (!place) return null;
  const [index, x, y, width, height] = place;
  const sheet = DATA.sheets[index];
  return { url: sheet.url, width, height, uv: [x / sheet.width, y / sheet.height, (x + width) / sheet.width, (y + height) / sheet.height] };
}

/** The image to download for a sprite: its sheet, or Showdown's own file. */
export function spriteSource(sprite: string, back: boolean, set: SpriteSet = 'gen5'): string {
  if (set !== 'gen5') return spriteUrl(sprite, back, set);
  return sheetSprite(sprite, back)?.url ?? spriteUrl(sprite, back);
}
