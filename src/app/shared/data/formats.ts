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

/** A format battles can be played (on Showdown's ladder) and watched in. */
export interface PlayableFormat extends BattleFormat {
  /** Short, for buttons and the format picker. */
  label: string;
  /** Teams are handed out at random: no team of the player's is needed. */
  randomTeams: boolean;
  /** The heading it's listed under in the format picker, as Showdown groups its formats. */
  category: string;
  /** One line under its name: how it's played. */
  detail: string;
  /** The teams it's played with, when they're another format's (a best-of-3 uses its format's teams). */
  teamFormat?: string;
}

export const RANDOM_BATTLE_FORMAT = 'gen9randombattle';

/**
 * The VGC format as a best-of-3 set with Open Team Sheets forced on: each game starts showing both
 * teams' sets (everything but stats). The ID is checked against the server's `|formats|` (2026-09-28).
 */
export const BO3_TEAM_FORMAT = 'gen9championsvgc2026regmcbo3';

/**
 * The formats the Battle page and the replay list offer: the teambuilder's VGC format (doubles), as
 * single games and as best-of-3 sets, and the most played random formats (IDs checked against the
 * server's `|formats|`, 2026-09-30). The format picker lists them by category, in this order.
 */
export const PLAYABLE_FORMATS: readonly PlayableFormat[] = [
  {
    id: DEFAULT_TEAM_FORMAT,
    name: TEAM_FORMATS[0].name,
    label: 'VGC 2026 Reg M-C',
    randomTeams: false,
    category: 'Doubles',
    detail: 'Doubles · one of your teams',
  },
  {
    id: BO3_TEAM_FORMAT,
    name: '[Gen 9 Champions] VGC 2026 Reg M-C (Bo3)',
    label: 'VGC 2026 Reg M-C (Bo3)',
    randomTeams: false,
    category: 'Doubles',
    detail: 'Best of 3 · open team sheets',
    teamFormat: DEFAULT_TEAM_FORMAT,
  },
  {
    id: RANDOM_BATTLE_FORMAT,
    name: '[Gen 9] Random Battle',
    label: 'Gen 9 Random Battle',
    randomTeams: true,
    category: 'Random',
    detail: 'Singles · random teams',
  },
  {
    id: 'gen9randomdoublesbattle',
    name: '[Gen 9] Random Doubles Battle',
    label: 'Gen 9 Random Doubles',
    randomTeams: true,
    category: 'Random',
    detail: 'Doubles · random teams',
  },
  {
    id: 'gen9championsrandombattle',
    name: '[Gen 9 Champions] Random Battle',
    label: 'Champions Random Battle',
    randomTeams: true,
    category: 'Random',
    detail: 'Singles · random Champions teams',
  },
  {
    id: 'gen9championsrandomdoublesbattle',
    name: '[Gen 9 Champions] Random Doubles Battle',
    label: 'Champions Random Doubles',
    randomTeams: true,
    category: 'Random',
    detail: 'Doubles · random Champions teams',
  },
];

/** The display name of a format ID; unknown IDs (e.g. from an imported team) are shown as they are. */
export function formatName(id: string): string {
  return [...TEAM_FORMATS, ...PLAYABLE_FORMATS].find((format) => format.id === id)?.name ?? id;
}

/** A format's short label ("VGC 2026 Reg M-C (Bo3)"), or its full name when the app doesn't offer it. */
export function formatLabel(id: string): string {
  return PLAYABLE_FORMATS.find((format) => format.id === id)?.label ?? formatName(id);
}
