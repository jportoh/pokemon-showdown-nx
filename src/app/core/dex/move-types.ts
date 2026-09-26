import { toId } from '@shared/utils/to-id';
import data from './move-types.json';

// Every move's type, generated from Showdown's data by `npm run update:move-types`: the battle
// screen colours moves of any format (Random Battle uses many the Champions data doesn't have).

const TYPES_BY_MOVE: ReadonlyMap<string, string> = new Map(
  Object.entries(data as Record<string, string[]>).flatMap(([type, ids]) => ids.map((id) => [id, type] as const)),
);

/** A move's type by its name or ID ("Flamethrower" → "Fire"); '' when unknown. */
export function moveType(move: string): string {
  return TYPES_BY_MOVE.get(toId(move)) ?? '';
}
