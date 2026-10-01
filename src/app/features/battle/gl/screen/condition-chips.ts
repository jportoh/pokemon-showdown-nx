import { FieldCondition } from '@features/battle/models/battle';
import { conditionColor, conditionTurns } from '@features/battle/state/field-conditions';

/** Chips per group; past that, the last one becomes "+N". */
const MAX_CHIPS = 3;
const CHIP_WIDTH = 81;
const CHIP_GAP = 6;
const CHIP_LEFT = 8;
/** The pips' row inside a chip. */
const PIPS_WIDTH = 69;
const PIP_GAP = 2;
const MAX_PIP_WIDTH = 10;
/** Longer names get their short form ("Psychic" for Psychic Terrain) to fit a chip. */
const MAX_NAME_CHARS = 11;

export interface Pip {
  left: number;
  width: number;
  /** A turn still to come (or a layer). */
  on: boolean;
}

export interface Chip {
  name: string;
  color: string;
  left: number;
  /** Turns left out of its length, or its layers (Spikes); none for the ones that simply stay. */
  pips: Pip[];
}

/** Up to three chips; with more conditions, two and a "+N" chip for the rest. */
export function toChips(conditions: readonly FieldCondition[], turn: number): Chip[] {
  const fits = conditions.length <= MAX_CHIPS;
  const shown = fits ? conditions : conditions.slice(0, MAX_CHIPS - 1);
  const chips = shown.map((condition, i) => toChip(condition, turn, i));
  if (fits) return chips;
  const more = conditions.length - shown.length;
  return [
    ...chips,
    { name: `+${more}`, color: '#374151', left: chipLeft(shown.length), pips: [] },
  ];
}

function toChip(condition: FieldCondition, turn: number, index: number): Chip {
  const turns = conditionTurns(condition, turn);
  const pips = turns
    ? toPips(turns.total, turns.left)
    : condition.layers > 1
      ? toPips(condition.layers, condition.layers)
      : [];
  return {
    name: condition.name.length > MAX_NAME_CHARS ? shortName(condition.name) : condition.name,
    color: conditionColor(condition),
    left: chipLeft(index),
    pips,
  };
}

function chipLeft(index: number): number {
  return CHIP_LEFT + index * (CHIP_WIDTH + CHIP_GAP);
}

/** `count` pips centred in the chip, the first `on` of them lit. */
function toPips(count: number, on: number): Pip[] {
  const width = Math.min(MAX_PIP_WIDTH, Math.floor((PIPS_WIDTH - PIP_GAP * (count - 1)) / count));
  const rowWidth = width * count + PIP_GAP * (count - 1);
  const start = 6 + Math.floor((PIPS_WIDTH - rowWidth) / 2);
  return Array.from({ length: count }, (_, i) => ({ left: start + i * (width + PIP_GAP), width, on: i < on }));
}

function shortName(name: string): string {
  return name
    .replace(/ Terrain$/, '')
    .replace('Light Screen', 'Screen')
    .replace('Aurora Veil', 'Veil')
    .replace('Stealth Rock', 'Rocks')
    .replace('Toxic Spikes', 'T. Spikes')
    .replace('Strong winds', 'Winds');
}
