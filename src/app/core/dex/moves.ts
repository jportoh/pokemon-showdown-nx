import { toId } from '@shared/utils/to-id';
import data from './moves.json';

// What the battle screen shows of every move, generated from Showdown's data by `npm run update:moves`:
// moves of any format (Random Battle uses many the Champions data doesn't have).

export interface MoveInfo {
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  /** 0 when it never misses. */
  accuracy: number;
}

const CATEGORIES = { P: 'Physical', S: 'Special', T: 'Status' } as const;

const MOVES = data as unknown as Readonly<Record<string, readonly [string, string, keyof typeof CATEGORIES, number, number]>>;

/** A move's name, type, category, power and accuracy by its name or ID; undefined when unknown. */
export function moveInfo(move: string): MoveInfo | undefined {
  const entry = MOVES[toId(move)];
  if (!entry) return undefined;
  const [name, type, category, basePower, accuracy] = entry;
  return { name, type, category: CATEGORIES[category], basePower, accuracy };
}

/** A move's type by its name or ID ("Flamethrower" → "Fire"); '' when unknown. */
export function moveType(move: string): string {
  return MOVES[toId(move)]?.[1] ?? '';
}
