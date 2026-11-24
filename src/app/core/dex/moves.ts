import { toId } from '@shared/utils/to-id';
import gen1 from './gen1.json';
import gen2 from './gen2.json';
import gen3 from './gen3.json';
import gen4 from './gen4.json';
import data from './moves.json';

// What the battle screen shows of every move, generated from Showdown's data by `npm run update:moves`:
// moves of any format (Random Battle uses many the Champions data doesn't have). What differs in Gens 1
// to 4 (power, accuracy, type, and before Gen 4 the category, which went by type then) comes from
// `npm run update:past-gens`.

export interface MoveInfo {
  name: string;
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  basePower: number;
  /** 0 when it never misses. */
  accuracy: number;
}

type Category = 'P' | 'S' | 'T';

const CATEGORIES = { P: 'Physical', S: 'Special', T: 'Status' } as const;

const MOVES = data as unknown as Readonly<Record<string, readonly [string, string, Category, number, number]>>;
type PastMoves = Readonly<Record<string, readonly [string, Category, number, number]>>;

/** What differs in past generations, by generation. */
const PAST_MOVES: Readonly<Record<number, PastMoves>> = Object.fromEntries([gen1, gen2, gen3, gen4].map((past, i) => [i + 1, past.moves as unknown as PastMoves]));

/**
 * A move's name, type, category, power and accuracy by its name or ID, as in the generation played;
 * undefined when unknown. Hidden Power by its name in a request ("Hidden Power Fire 70", before Gen 6)
 * gets that type and power.
 */
export function moveInfo(move: string, gen = 9): MoveInfo | undefined {
  const hiddenPower = /^(hiddenpower[a-z]+)(\d+)$/.exec(toId(move));
  const id = hiddenPower ? hiddenPower[1] : toId(move);
  const entry = MOVES[id];
  if (!entry) return undefined;
  const [name, currentType, currentCategory, currentPower, currentAccuracy] = entry;
  const [type, category, basePower, accuracy] = PAST_MOVES[gen]?.[id] || [currentType, currentCategory, currentPower, currentAccuracy];
  return { name, type, category: CATEGORIES[category], basePower: hiddenPower ? Number(hiddenPower[2]) : basePower, accuracy };
}

/** A move's type by its name or ID ("Flamethrower" → "Fire") in the generation played; '' when unknown. */
export function moveType(move: string, gen = 9): string {
  return moveInfo(move, gen)?.type ?? '';
}
