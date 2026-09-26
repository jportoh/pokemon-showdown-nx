export interface BattleFormat {
  /** Showdown format ID, as used in team headers and challenges. */
  id: string;
  /** Display name, as the server lists it. */
  name: string;
}

/**
 * Formats teams can be built for. For now only the official VGC circuit format: the teambuilder's
 * data and rules (core/dex/champions-regmc.json, teambuilder/data/game-rules.ts) are specific to it.
 * The ID is checked against the server's `|formats|` list (2026-09-25); VGC regulations rotate.
 */
export const TEAM_FORMATS: readonly BattleFormat[] = [{ id: 'gen9championsvgc2026regmc', name: '[Gen 9 Champions] VGC 2026 Reg M-C' }];

/** The format of new and imported teams. */
export const DEFAULT_TEAM_FORMAT = TEAM_FORMATS[0].id;

/** A format battles can be played (against the mock server for now) and watched in. */
export interface PlayableFormat extends BattleFormat {
  /** Short, for buttons and the format picker. */
  label: string;
  /** Teams are handed out at random: no team of the player's is needed. */
  randomTeams: boolean;
}

export const RANDOM_BATTLE_FORMAT = 'gen9randombattle';

/**
 * The formats the Battle Finder and the replay list offer: the teambuilder's VGC format (doubles) and
 * Random Battle (singles).
 */
export const PLAYABLE_FORMATS: readonly PlayableFormat[] = [
  { id: DEFAULT_TEAM_FORMAT, name: TEAM_FORMATS[0].name, label: 'VGC 2026 Reg M-C', randomTeams: false },
  { id: RANDOM_BATTLE_FORMAT, name: '[Gen 9] Random Battle', label: 'Gen 9 Random Battle', randomTeams: true },
];

/** The display name of a format ID; unknown IDs (e.g. from an imported team) are shown as they are. */
export function formatName(id: string): string {
  return [...TEAM_FORMATS, ...PLAYABLE_FORMATS].find((format) => format.id === id)?.name ?? id;
}
