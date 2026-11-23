import { BattlefieldId } from '@shared/data/battlefields';
import { Backdrop } from './backdrop';
import { CAVE } from './cave';
import { COAST } from './coast';
import { FOREST } from './forest';
import { MEADOW } from './meadow';
import { ROOFTOP } from './rooftop';
import { RUINS } from './ruins';
import { STADIUM } from './stadium';

/** Every battlefield's backdrop, by its id (shared/data/battlefields lists them for Settings). */
export const BACKDROPS: Record<BattlefieldId, Backdrop> = {
  meadow: MEADOW,
  coast: COAST,
  forest: FOREST,
  cave: CAVE,
  rooftop: ROOFTOP,
  stadium: STADIUM,
  ruins: RUINS,
};
