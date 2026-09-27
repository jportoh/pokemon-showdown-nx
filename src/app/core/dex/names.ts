import { toId } from '@shared/utils/to-id';
import data from './names.json';

// Every item's and ability's name, generated from Showdown's data by `npm run update:names`: a
// battle's requests name them by ID, and Random Battle uses many the Champions data doesn't have.

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
