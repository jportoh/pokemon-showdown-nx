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
 * Where each Pokémon stands as the camera sees it at rest (field coordinates): its platform's centre (x)
 * and its feet (y), and where its status box goes (fixed, whatever the camera does). Its size and its
 * place while the camera moves come from BattleCamera (camera-tuning.ts).
 */
export interface Stand {
  x: number;
  y: number;
  boxLeft: number;
  boxTop: number;
}

export interface FieldLayout {
  stands: Record<SlotKey, Stand>;
}

/** The field: the stage between the top bar and the command bar (1280x566 from 0,44). */
export const FIELD_W = 1280;
export const FIELD_H = 566;
/** Where the field starts on the stage. */
export const FIELD_TOP = 44;
/** Where the ground meets the sky at rest. */
export const GROUND_Y = 238;

/** The command bar, always along the foot of the stage. */
export const BAR_TOP = FIELD_TOP + FIELD_H;
export const BAR_H = 720 - BAR_TOP;

/** Our status boxes' left edge: the right of the field stays theirs. */
export const OWN_BOX_LEFT = 916;

/** Doubles. The opponent's first slot is on the right, as it faces the player; their boxes top left, ours right above the bar. */
export const DOUBLES: FieldLayout = {
  stands: {
    p2a: { x: 1040, y: 274, boxLeft: 24, boxTop: 12 },
    p2b: { x: 790, y: 274, boxLeft: 44, boxTop: 110 },
    p1a: { x: 245, y: 544, boxLeft: OWN_BOX_LEFT, boxTop: 368 },
    p1b: { x: 600, y: 544, boxLeft: OWN_BOX_LEFT, boxTop: 466 },
  },
};

/** Singles, as the third-generation games lay them out: the opponent's Pokémon back right, the player's front left. */
export const SINGLES: FieldLayout = {
  stands: {
    p2a: { x: 900, y: 280, boxLeft: 24, boxTop: 12 },
    p1a: { x: 330, y: 544, boxLeft: OWN_BOX_LEFT, boxTop: 466 },
  },
};

/** The status boxes. */
export const BOX_W = 352;
export const BOX_H = 90;

/** Showdown's sprites have the feet about 10px (of 96) above the bottom of their box. */
export function feetGap(size: number): number {
  return Math.round((10 * size) / 96);
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
