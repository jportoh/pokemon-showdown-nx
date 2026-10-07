import { SlotKey } from '@features/battle/models/battle';
import { EffectPoint, GlEffects } from '@features/battle/gl/gl-effects';
import { BattleSoundId } from '@core/audio/sfx';

/** How a sprite is drawn this frame: moved, faded, brightened. */
export interface Visual {
  dx: number;
  dy: number;
  alpha: number;
  /** 1 is its own colours; more adds its light again (a glow, Mega Evolution's flash). */
  bright: number;
}

/** A Pokémon on the field, as a move's animation sees it. */
export interface StageActor {
  slot: SlotKey;
  /** Its body's middle, where hits land. */
  at: EffectPoint;
  /** Over its head. */
  head: EffectPoint;
  /** Under its feet, on the ground. */
  feet: EffectPoint;
  /** Its sprite's size, and that over 240 (effects are drawn for a 240px Pokémon, then scaled). */
  size: number;
  k: number;
}

export interface StageTarget extends StageActor {
  /** The move's damage lands on it (read ahead in the log); a status move's target never "hits". */
  hit: boolean;
}

/** The lunges a move's user can make: a plain one, a faster rush, a hop in place, the whole body (slam). */
export type LungeStyle = 'lunge' | 'rush' | 'hop' | 'slam';

/**
 * What a move's own animation (signature-moves.ts) can use: the effects layer, who is where, and the
 * field's reactions (hits blinking with their sound, sprites moving, the field shaking).
 */
export interface MoveStage {
  readonly fx: GlEffects;
  readonly move: string;
  /** The move's type as used (Weather Ball's by the weather), for its colour. */
  readonly type: string;
  readonly user: StageActor;
  /** Who it's aimed at, the user left out. */
  readonly targets: readonly StageTarget[];
  /** Everyone on the user's side (the user too), and on the other side. */
  readonly allies: readonly StageActor[];
  readonly foes: readonly StageActor[];
  /** The target blinks (and shakes) with the hit's sound, if the move's damage lands on it. */
  hit(target: StageTarget, shake?: boolean): void;
  /** Moves a Pokémon's sprite for `ms` (at normal speed): `frame` sets its visual at each progress 0..1. */
  animate(slot: SlotKey, ms: number, frame: (visual: Visual, progress: number) => void): void;
  /** The user lunges at its targets; `contact` runs as it reaches them. */
  lunge(contact: () => void, style?: LungeStyle): void;
  /** A Pokémon lights up for a moment. */
  glow(slot: SlotKey): void;
  /** The whole field shakes. */
  shake(ms: number): void;
  /** Plays a battle sound (a clap…). */
  sound(id: BattleSoundId): void;
}
