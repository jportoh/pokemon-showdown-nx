import { Rgba, rgba } from '@core/gl/gl-renderer';
import { BOLT, DROP, EffectShape, FEATHER, FLAME, HEART, LEAF, ROCK, SHARD, SNOWFLAKE, SPARKLE } from '@features/battle/gl/effect-shapes';

/**
 * A kind of piece thrown out by an effect: flames rising, drops splashing, leaves fluttering… Sizes
 * and speeds are for a 240px Pokémon (scaled by the Pokémon's size) at normal speed.
 */
export interface Piece {
  /** A pixel shape; a soft round light without one. */
  shape?: EffectShape;
  colors: readonly Rgba[];
  /** Height in px at the start, and at the end of its life (the start's by default). */
  size: number;
  endSize?: number;
  /** px/s. */
  speed: number;
  /** Where it heads (radians, 0 = right, -π/2 = up); anywhere when left out. */
  direction?: number;
  /** How far either side of `direction` it may head (radians); π by default. */
  spread?: number;
  /** Down (px/s²); negative rises. */
  gravity?: number;
  /** Share of speed kept per second. */
  drag?: number;
  life: number;
  /** Turns as it flies (radians/s, either way). */
  spin?: number;
  /** Drifts side to side (px/s). */
  sway?: number;
  /** Points the way it flies (bolts, shards, drops) instead of a random turn. */
  aim?: boolean;
  /**
   * Adds its light to what's under it instead of covering it. Light washes out on the bright field,
   * so only white-hot sparks glow; the pieces are solid, outlined like the Gen 3 games' own.
   */
  glow?: boolean;
  /** Starts this far (px) from the point, at random. */
  scatter?: number;
}

/** What a type adds to a hit: the pieces it throws, and one flourish of its own. */
export interface TypeEffect {
  impact: readonly Piece[];
  /** Shed along a flying orb's path, and rising around a status move's user. */
  trail: Piece;
  flourish?: 'pow' | 'flash' | 'bubbles' | 'blot' | 'rings' | 'dust' | 'frost';
}

const UP = -Math.PI / 2;

const WHITE = rgba('#ffffff');
const FIRE = [rgba('#ff8a1e'), rgba('#ffd23c'), rgba('#ff4b1e')];
const WATER = [rgba('#5a90ff'), rgba('#9cc8ff'), WHITE];
const ELECTRIC = [rgba('#ffe23c'), rgba('#fff6a8')];
const GRASS = [rgba('#4fb83a'), rgba('#8fdc50'), rgba('#2f8a2a')];
const ICE = [rgba('#a8e8f0'), WHITE, rgba('#6cc8e0')];
const POISON = [rgba('#a050b4'), rgba('#c878d8'), rgba('#6a2a80')];
const GROUND = [rgba('#c8a060'), rgba('#9a7038')];
const FLYING = [WHITE, rgba('#d8d0ff')];
const PSYCHIC = [rgba('#ff70a8'), rgba('#ffb0d0')];
const BUG = [rgba('#b0c828'), rgba('#d8e868')];
const ROCKS = [rgba('#a08850'), rgba('#7a6440')];
const GHOST = [rgba('#8a60c0'), rgba('#5a3a90'), rgba('#c8a8ff')];
const DRAGON = [rgba('#7a48ff'), rgba('#48a0ff'), rgba('#c0a8ff')];
const DARK = [rgba('#3a2c3c'), rgba('#5a4458')];
const STEEL = [rgba('#d8d8e8'), WHITE, rgba('#a8a8c0')];
const FAIRY = [rgba('#ff9ec4'), rgba('#ffd0e4'), WHITE];
const NORMAL = [rgba('#f0f0d8'), WHITE];

const sparks = (colors: readonly Rgba[]): Piece => ({ colors, size: 14, endSize: 0, speed: 380, gravity: 300, drag: 0.05, life: 420, glow: true });
const rising = (piece: Omit<Piece, 'speed' | 'direction' | 'life'>, speed = 140, life = 640): Piece => ({ speed, direction: UP, spread: 0.4, life, scatter: 60, ...piece });

export const TYPE_EFFECTS: Readonly<Record<string, TypeEffect>> = {
  normal: { impact: [sparks(NORMAL)], trail: rising({ colors: NORMAL, size: 12, endSize: 4 }), flourish: 'pow' },
  fighting: {
    impact: [sparks([rgba('#ff5030'), rgba('#ffb040')])],
    trail: rising({ colors: [rgba('#ff5030'), rgba('#ffb040')], size: 12, endSize: 4 }),
    flourish: 'pow',
  },
  fire: {
    impact: [{ shape: FLAME, colors: FIRE, size: 34, endSize: 12, speed: 170, direction: UP, spread: 1.2, gravity: -220, drag: 0.3, life: 640, sway: 40, scatter: 40 }],
    trail: { shape: FLAME, colors: FIRE, size: 26, endSize: 8, speed: 60, direction: UP, spread: 0.6, gravity: -160, life: 380, sway: 30, scatter: 16 },
  },
  water: {
    impact: [{ shape: DROP, colors: WATER, size: 22, speed: 340, direction: UP, spread: 1.3, gravity: 1100, drag: 0.6, life: 620, aim: true }],
    trail: { shape: DROP, colors: WATER, size: 16, speed: 60, gravity: 500, life: 360, aim: true, scatter: 14 },
    flourish: 'bubbles',
  },
  electric: {
    impact: [
      { shape: BOLT, colors: ELECTRIC, size: 44, endSize: 24, speed: 260, drag: 0.05, life: 480, aim: true },
      { shape: BOLT, colors: ELECTRIC, size: 28, endSize: 16, speed: 120, drag: 0.1, life: 640, aim: true, scatter: 90 },
    ],
    trail: { shape: BOLT, colors: ELECTRIC, size: 22, endSize: 10, speed: 120, life: 200, aim: true, scatter: 20 },
    flourish: 'flash',
  },
  grass: {
    impact: [{ shape: LEAF, colors: GRASS, size: 24, speed: 280, gravity: 160, drag: 0.15, life: 860, spin: 7, sway: 60 }],
    trail: { shape: LEAF, colors: GRASS, size: 20, speed: 50, gravity: 80, life: 520, spin: 6, sway: 40, scatter: 18 },
  },
  ice: {
    impact: [
      { shape: SNOWFLAKE, colors: ICE, size: 26, endSize: 14, speed: 220, drag: 0.1, life: 700, spin: 4 },
      { shape: SHARD, colors: ICE, size: 28, endSize: 16, speed: 420, drag: 0.05, life: 380, aim: true },
    ],
    trail: { shape: SNOWFLAKE, colors: ICE, size: 18, endSize: 8, speed: 40, life: 420, spin: 4, scatter: 18 },
    flourish: 'frost',
  },
  poison: {
    impact: [{ shape: DROP, colors: POISON, size: 22, speed: 300, direction: UP, spread: 1.2, gravity: 900, drag: 0.5, life: 640, aim: true }],
    trail: { colors: POISON, size: 18, endSize: 6, speed: 40, gravity: 200, life: 400, scatter: 12 },
    flourish: 'bubbles',
  },
  ground: {
    impact: [{ shape: ROCK, colors: GROUND, size: 18, speed: 320, direction: UP, spread: 1.1, gravity: 1100, drag: 0.4, life: 640, spin: 8 }],
    trail: { colors: GROUND, size: 16, endSize: 30, speed: 40, life: 420, scatter: 16 },
    flourish: 'dust',
  },
  flying: {
    impact: [{ shape: FEATHER, colors: FLYING, size: 26, speed: 220, gravity: 70, drag: 0.15, life: 950, spin: 3, sway: 70 }],
    trail: { shape: FEATHER, colors: FLYING, size: 18, speed: 40, gravity: 40, life: 520, spin: 3, sway: 40, scatter: 16 },
  },
  psychic: {
    impact: [{ shape: SPARKLE, colors: PSYCHIC, size: 26, endSize: 10, speed: 220, drag: 0.1, life: 560, spin: 3 }],
    trail: rising({ shape: SPARKLE, colors: PSYCHIC, size: 18, endSize: 6, spin: 3 }, 60, 420),
    flourish: 'rings',
  },
  bug: {
    impact: [{ colors: BUG, size: 10, endSize: 4, speed: 420, drag: 0.03, life: 620, sway: 160, scatter: 30 }],
    trail: { colors: BUG, size: 9, endSize: 3, speed: 80, life: 360, sway: 120, scatter: 18 },
  },
  rock: {
    impact: [{ shape: ROCK, colors: ROCKS, size: 26, speed: 340, direction: UP, spread: 1.2, gravity: 1200, drag: 0.4, life: 720, spin: 7 }],
    trail: { shape: ROCK, colors: ROCKS, size: 16, speed: 30, gravity: 300, life: 380, spin: 5, scatter: 12 },
    flourish: 'dust',
  },
  ghost: {
    impact: [{ shape: FLAME, colors: GHOST, size: 34, endSize: 16, speed: 70, direction: UP, spread: 1.4, gravity: -90, drag: 0.4, life: 900, sway: 50, scatter: 70 }],
    trail: { shape: FLAME, colors: GHOST, size: 24, endSize: 8, speed: 40, direction: UP, spread: 0.6, gravity: -80, life: 460, sway: 30, scatter: 14 },
    flourish: 'blot',
  },
  dragon: {
    impact: [{ shape: FLAME, colors: DRAGON, size: 34, endSize: 12, speed: 260, gravity: -160, drag: 0.2, life: 640, sway: 40, scatter: 30 }],
    trail: { shape: FLAME, colors: DRAGON, size: 24, endSize: 8, speed: 60, direction: UP, spread: 0.6, gravity: -140, life: 400, sway: 30, scatter: 16 },
  },
  dark: {
    impact: [{ colors: DARK, size: 22, endSize: 6, speed: 300, drag: 0.08, life: 520 }],
    trail: { colors: DARK, size: 20, endSize: 6, speed: 40, life: 420, scatter: 14 },
    flourish: 'blot',
  },
  steel: {
    impact: [
      { shape: SPARKLE, colors: STEEL, size: 30, endSize: 8, speed: 240, drag: 0.1, life: 520, spin: 4 },
      { shape: SHARD, colors: STEEL, size: 24, endSize: 14, speed: 420, drag: 0.05, life: 360, aim: true },
    ],
    trail: { shape: SPARKLE, colors: STEEL, size: 18, endSize: 6, speed: 40, life: 380, spin: 4, scatter: 16 },
    flourish: 'flash',
  },
  fairy: {
    impact: [
      { shape: HEART, colors: FAIRY, size: 22, speed: 120, direction: UP, spread: 1.4, gravity: -60, drag: 0.4, life: 900, sway: 50, scatter: 50 },
      { shape: SPARKLE, colors: FAIRY, size: 24, endSize: 6, speed: 260, drag: 0.1, life: 520, spin: 4 },
    ],
    trail: { shape: SPARKLE, colors: FAIRY, size: 18, endSize: 6, speed: 40, life: 420, spin: 4, scatter: 16 },
  },
};

/** How many of each piece a hit throws (a light hit, half). */
export const IMPACT_PIECES = 9;

/** A type's effect; plain light for an unknown type. */
export function typeEffect(type: string): TypeEffect | null {
  return TYPE_EFFECTS[type.toLowerCase()] ?? null;
}

