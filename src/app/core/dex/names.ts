import { toId } from '@shared/utils/to-id';
import data from './names.json';

// Every item's and ability's name (and each item's place in Showdown's icon sheet), generated from
// Showdown's data by `npm run update:names`: a battle's requests name them by ID, and Random Battle
// uses many the Champions data doesn't have.

const ITEMS: Readonly<Record<string, string>> = data.items;
const ABILITIES: Readonly<Record<string, string>> = data.abilities;

/** An item's name by its ID ("heavydutyboots" → "Heavy-Duty Boots"); '' for none, the ID when unknown. */
export function itemName(item: string): string {
  const id = toId(item);
  return ITEMS[id] ?? id;
}

/** An ability's name by its ID ("owntempo" → "Own Tempo"); '' for none, the ID when unknown. */
export function abilityName(ability: string): string {
  const id = toId(ability);
  return ABILITIES[id] ?? id;
}

const ITEM_SPRITES: Readonly<Record<string, number>> = data.itemSprites;

/** Showdown's item icon sheet: 24x24 cells, 16 a row (as its client draws them). */
export const ITEM_SHEET_URL = 'https://play.pokemonshowdown.com/sprites/itemicons-sheet.png';
export const ITEM_ICON_SIZE = 24;
const ITEM_SHEET_COLUMNS = 16;

/** Where an item's icon is in the sheet (px); null for no item, or one without an icon. */
export function itemIconCell(item: string): { x: number; y: number } | null {
  const spritenum = ITEM_SPRITES[toId(item)];
  if (!spritenum) return null;
  return { x: (spritenum % ITEM_SHEET_COLUMNS) * ITEM_ICON_SIZE, y: Math.floor(spritenum / ITEM_SHEET_COLUMNS) * ITEM_ICON_SIZE };
}

/** Every item with an icon, by ID. */
export function itemsWithIcons(): string[] {
  return Object.keys(ITEM_SPRITES);
}
