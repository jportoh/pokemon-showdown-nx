import { StatId, StatSpread } from '@features/teambuilder/models/team';

export const STAT_IDS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_NAMES: Record<StatId, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

// [Gen 9 Champions] rules: no IVs, and stat points instead of EVs, up to 32 per stat and 66 in
// total. Every Pokémon is level 50 (the format's Adjust Level = 50).
export const MAX_STAT_POINTS = 32;
export const MAX_TOTAL_STAT_POINTS = 66;
export const MAX_NICKNAME_LENGTH = 18;

export interface Nature {
  name: string;
  plus?: StatId;
  minus?: StatId;
}

export const NATURES: readonly Nature[] = [
  { name: 'Adamant', plus: 'atk', minus: 'spa' },
  { name: 'Bashful' },
  { name: 'Bold', plus: 'def', minus: 'atk' },
  { name: 'Brave', plus: 'atk', minus: 'spe' },
  { name: 'Calm', plus: 'spd', minus: 'atk' },
  { name: 'Careful', plus: 'spd', minus: 'spa' },
  { name: 'Docile' },
  { name: 'Gentle', plus: 'spd', minus: 'def' },
  { name: 'Hardy' },
  { name: 'Hasty', plus: 'spe', minus: 'def' },
  { name: 'Impish', plus: 'def', minus: 'spa' },
  { name: 'Jolly', plus: 'spe', minus: 'spa' },
  { name: 'Lax', plus: 'def', minus: 'spd' },
  { name: 'Lonely', plus: 'atk', minus: 'def' },
  { name: 'Mild', plus: 'spa', minus: 'def' },
  { name: 'Modest', plus: 'spa', minus: 'atk' },
  { name: 'Naive', plus: 'spe', minus: 'spd' },
  { name: 'Naughty', plus: 'atk', minus: 'spd' },
  { name: 'Quiet', plus: 'spa', minus: 'spe' },
  { name: 'Quirky' },
  { name: 'Rash', plus: 'spa', minus: 'spd' },
  { name: 'Relaxed', plus: 'def', minus: 'spe' },
  { name: 'Sassy', plus: 'spd', minus: 'spe' },
  { name: 'Serious' },
  { name: 'Timid', plus: 'spe', minus: 'atk' },
];

/** "Adamant (+Atk, −SpA)"; neutral natures are just their name. */
export function natureLabel(nature: Nature): string {
  return nature.plus && nature.minus ? `${nature.name} (+${STAT_NAMES[nature.plus]}, −${STAT_NAMES[nature.minus]})` : nature.name;
}

/**
 * A stat at level 50 with Champions' formula (Showdown's champions mod): HP is base + points + 75,
 * other stats base + points + 20, then natures add or take 10% (rounded down).
 */
export function calcStat(stat: StatId, base: number, points: number, natureName: string): number {
  if (stat === 'hp') return base + points + 75;
  const nature = NATURES.find((n) => n.name === natureName);
  const value = base + points + 20;
  if (nature?.plus === stat) return Math.floor((value * 110) / 100);
  if (nature?.minus === stat) return Math.floor((value * 90) / 100);
  return value;
}

/**
 * Stat points kept within Champions' limits. Spreads from other games (EVs, up to 252) are converted
 * first, the way Champions counts them: the first point takes 4 EVs and each further one 8.
 */
export function toStatPoints(spread: StatSpread): StatSpread {
  const values = STAT_IDS.map((stat) => Math.max(0, Math.floor(spread[stat] ?? 0)));
  const total = values.reduce((sum, value) => sum + value, 0);
  const fromEvs = values.some((value) => value > MAX_STAT_POINTS) || total > MAX_TOTAL_STAT_POINTS;

  const result: StatSpread = {};
  let left = MAX_TOTAL_STAT_POINTS;
  STAT_IDS.forEach((stat, i) => {
    const points = fromEvs ? (values[i] >= 4 ? 1 + Math.floor((values[i] - 4) / 8) : 0) : values[i];
    const allowed = Math.min(points, MAX_STAT_POINTS, left);
    left -= allowed;
    if (allowed > 0) result[stat] = allowed;
  });
  return result;
}
