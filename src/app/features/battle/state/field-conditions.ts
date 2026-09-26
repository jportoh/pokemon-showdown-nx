import { BattleFieldState, FieldCondition } from '@features/battle/models/battle';

// What Showdown doesn't send: how long each condition lasts. The client counts the turns itself, as
// Showdown's own client does. An item can make some last 3 turns more; that's only known when the
// condition is still up after its usual length, so the count then carries on to the longer one.

interface ConditionInfo {
  name: string;
  duration?: number;
  extendable?: boolean;
  /** The chip's colour (white text on it). */
  color: string;
}

const WEATHER: Record<string, ConditionInfo> = {
  SunnyDay: { name: 'Sun', duration: 5, extendable: true, color: '#b45309' },
  RainDance: { name: 'Rain', duration: 5, extendable: true, color: '#1d4ed8' },
  Sandstorm: { name: 'Sandstorm', duration: 5, extendable: true, color: '#92400e' },
  Snowscape: { name: 'Snow', duration: 5, extendable: true, color: '#0e7490' },
  Snow: { name: 'Snow', duration: 5, extendable: true, color: '#0e7490' },
  Hail: { name: 'Hail', duration: 5, extendable: true, color: '#0e7490' },
  DesolateLand: { name: 'Harsh sun', color: '#9a3412' },
  PrimordialSea: { name: 'Heavy rain', color: '#1e3a8a' },
  DeltaStream: { name: 'Strong winds', color: '#115e59' },
};

/** Terrains, rooms and side conditions, by the name after "move: ". */
const CONDITIONS: Record<string, ConditionInfo> = {
  'Grassy Terrain': { name: 'Grassy Terrain', duration: 5, extendable: true, color: '#15803d' },
  'Psychic Terrain': { name: 'Psychic Terrain', duration: 5, extendable: true, color: '#a21caf' },
  'Electric Terrain': { name: 'Electric Terrain', duration: 5, extendable: true, color: '#a16207' },
  'Misty Terrain': { name: 'Misty Terrain', duration: 5, extendable: true, color: '#be185d' },
  'Trick Room': { name: 'Trick Room', duration: 5, color: '#6b21a8' },
  Gravity: { name: 'Gravity', duration: 5, color: '#4338ca' },
  'Magic Room': { name: 'Magic Room', duration: 5, color: '#6b21a8' },
  'Wonder Room': { name: 'Wonder Room', duration: 5, color: '#6b21a8' },
  Tailwind: { name: 'Tailwind', duration: 4, color: '#0f766e' },
  Reflect: { name: 'Reflect', duration: 5, extendable: true, color: '#1e40af' },
  'Light Screen': { name: 'Light Screen', duration: 5, extendable: true, color: '#1e40af' },
  'Aurora Veil': { name: 'Aurora Veil', duration: 5, extendable: true, color: '#0e7490' },
  Safeguard: { name: 'Safeguard', duration: 5, color: '#7e22ce' },
  Mist: { name: 'Mist', duration: 5, color: '#475569' },
  'Stealth Rock': { name: 'Stealth Rock', color: '#57534e' },
  Spikes: { name: 'Spikes', color: '#57534e' },
  'Toxic Spikes': { name: 'Toxic Spikes', color: '#6b21a8' },
  'Sticky Web': { name: 'Sticky Web', color: '#57534e' },
};

const DEFAULT_COLOR = '#374151';

export const emptyField = (): BattleFieldState => ({ weather: null, terrain: null, rooms: [], sides: { p1: [], p2: [] } });

export function weatherCondition(id: string, start: number): FieldCondition {
  const info = WEATHER[id];
  return { id, name: info?.name ?? id, start, duration: info?.duration, extendable: info?.extendable, layers: 1 };
}

/** A terrain, room or side condition, from its name without "move: ". */
export function namedCondition(id: string, start: number): FieldCondition {
  const info = CONDITIONS[id];
  return { id, name: info?.name ?? id, start, duration: info?.duration, extendable: info?.extendable, layers: 1 };
}

export function isTerrain(id: string): boolean {
  return id.endsWith(' Terrain');
}

export function conditionColor(condition: FieldCondition): string {
  return (WEATHER[condition.id] ?? CONDITIONS[condition.id])?.color ?? DEFAULT_COLOR;
}

/** Turns left, counting the current one; null for conditions that stay until removed. */
export function turnsLeft(condition: FieldCondition, turn: number): number | null {
  if (!condition.duration) return null;
  // Before turn 1 (leads' abilities) the count is as of turn 1.
  let left = condition.start + condition.duration - Math.max(1, turn);
  // Still up after its usual length: an item made it last longer.
  if (left <= 0 && condition.extendable) left += 3;
  return Math.max(1, left);
}

/**
 * Turns left out of the condition's length (3 more once an item has made it last longer), for the
 * turn counters; null for conditions that stay until removed.
 */
export function conditionTurns(condition: FieldCondition, turn: number): { left: number; total: number } | null {
  const left = turnsLeft(condition, turn);
  if (left === null || !condition.duration) return null;
  const extended = !!condition.extendable && condition.start + condition.duration - Math.max(1, turn) <= 0;
  return { left, total: condition.duration + (extended ? 3 : 0) };
}
