import { SlotKey } from '@features/battle/models/battle';

export const STAT_NAMES: Record<string, string> = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  accuracy: 'Accuracy',
  evasion: 'Evasion',
};

/**
 * Where each Pokémon stands: its platform's centre (x) and its feet (y), and where its status box
 * goes. The player's stand below the bottom edge, seen from behind and cut off as in Gen 3.
 */
export interface Stand {
  x: number;
  y: number;
  boxLeft: number;
  boxTop: number;
}

/**
 * A field layout: the sprites' size (a multiple of Showdown's 96px; Gen 3 doubled its own) and where
 * each Pokémon stands. Platforms, shields, labels and banners follow from them.
 */
export interface FieldLayout {
  spriteSize: number;
  stands: Record<SlotKey, Stand>;
}

/**
 * Doubles at 2.5x (3x doesn't fit: the opponent's two would overlap and run off the field). The
 * opponent's first slot is on the right, as it faces the player. Their status boxes top left, the
 * player's bottom right.
 */
export const DOUBLES: FieldLayout = {
  spriteSize: Math.round(96 * 2.5),
  stands: {
    p2a: { x: 850, y: 228, boxLeft: 20, boxTop: 30 },
    p2b: { x: 600, y: 228, boxLeft: 44, boxTop: 126 },
    p1a: { x: 150, y: 494, boxLeft: 600, boxTop: 310 },
    p1b: { x: 420, y: 494, boxLeft: 616, boxTop: 404 },
  },
};

/**
 * Singles at 3x, as the third-generation games lay them out: the opponent's Pokémon back right, the
 * player's front left, each status box on the other side of the field from its Pokémon. The
 * opponent stands a little lower than in doubles, so its bigger sprite isn't cut by the top edge.
 */
export const SINGLES: FieldLayout = {
  spriteSize: 96 * 3,
  stands: {
    p2a: { x: 720, y: 250, boxLeft: 40, boxTop: 60 },
    p1a: { x: 260, y: 494, boxLeft: 608, boxTop: 356 },
  },
};

/** The player's platforms are cut off by the bottom edge: this tall, from here. */
export const OWN_PLATFORM_HEIGHT = 96;
export const OWN_PLATFORM_TOP = 452;

/** The sprite box of a Pokémon standing there. */
export function spriteBox(stand: Stand, size: number): { left: number; top: number } {
  // Showdown's sprites have the feet about 10px (of 96) above the bottom of their box.
  const feetGap = Math.round((10 * size) / 96);
  return { left: stand.x - size / 2, top: stand.y + feetGap - size };
}

export const DEFAULT_SKY = '#d8ecc0';
export const DEFAULT_GROUND = { ground: '#b0d890', platform: '#90c070', edge: '#6a9a50' };

/** Terrains colour the ground and the platforms. */
export const TERRAIN_COLORS: Record<string, typeof DEFAULT_GROUND> = {
  'Grassy Terrain': { ground: '#7cc860', platform: '#58a838', edge: '#3c7a22' },
  'Psychic Terrain': { ground: '#d8a0d8', platform: '#c078c0', edge: '#8c4c8c' },
  'Electric Terrain': { ground: '#f0d860', platform: '#e0c040', edge: '#a88c20' },
  'Misty Terrain': { ground: '#f4c0dc', platform: '#e8a0c8', edge: '#b06890' },
};

/** A terrain tints the sky too, unless there's weather. */
export const TERRAIN_SKY: Record<string, string> = {
  'Grassy Terrain': '#d0f0b8',
  'Psychic Terrain': '#f0d8f0',
  'Electric Terrain': '#fbf4c8',
  'Misty Terrain': '#fbe4f0',
};

export const WEATHER_SKY: Record<string, string> = {
  SunnyDay: '#fbe6a8',
  DesolateLand: '#f8c888',
  RainDance: '#a8bccc',
  PrimordialSea: '#8ca0b4',
  Sandstorm: '#e2cc98',
  Snowscape: '#e6eef6',
  Snow: '#e6eef6',
  Hail: '#e6eef6',
  DeltaStream: '#c8dce0',
};
