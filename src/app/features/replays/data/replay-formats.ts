import { DEFAULT_TEAM_FORMAT, formatName } from '@shared/data/formats';

export interface ReplayFormat {
  /** Showdown's format ID, as the replay search takes it. */
  id: string;
  /** Its full name, as the server lists it. */
  name: string;
  /** Short, for the format buttons. */
  label: string;
}

/**
 * The formats whose replays can be watched: the teambuilder's VGC format (doubles) and Random Battle
 * (singles), to try the battle screen with one Pokémon a side.
 */
export const REPLAY_FORMATS: readonly ReplayFormat[] = [
  { id: DEFAULT_TEAM_FORMAT, name: formatName(DEFAULT_TEAM_FORMAT), label: 'VGC 2026 Reg M-C' },
  { id: 'gen9randombattle', name: '[Gen 9] Random Battle', label: 'Gen 9 Random Battle' },
];
