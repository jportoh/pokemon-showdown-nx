export interface BattleFormat {
  /** Showdown format ID, as used in team headers and challenges. */
  id: string;
  /** Display name, as the server lists it. */
  name: string;
}

/**
 * Formats teams can be built for: the official VGC circuit format (doubles) and Battle Stadium
 * Singles. Both are Flat Rules on Showdown's champions mod, so the teambuilder's Reg M-C data and
 * rules (core/dex/champions-regmc.json, teambuilder/data/game-rules.ts) serve both. IDs checked
 * against the server's `|formats|` list (2026-09-30); regulations rotate.
 */
export const TEAM_FORMATS: readonly BattleFormat[] = [
  { id: 'gen9championsvgc2026regmc', name: '[Gen 9 Champions] VGC 2026 Reg M-C' },
  { id: 'gen9championsbssregmc', name: '[Gen 9 Champions] BSS Reg M-C' },
];

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
  /** The rules in short, for the Battle page's format card ("Bring 6, pick 4 · Level 50"). */
  rules: string;
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
 * single games and as best-of-3 sets, its Battle Stadium Singles format, the most played random formats
 * (IDs checked against the server's `|formats|`, 2026-09-30), and the ladder's randomized metas that
 * play with the usual mechanics: no 4-player battles, Shared Power, custom Pokémon or drafts (checked
 * 2026-11-24; their team preview picks come from the request's maxChosenTeamSize). The format picker
 * lists them by category, in this order.
 */
export const PLAYABLE_FORMATS: readonly PlayableFormat[] = [
  {
    id: DEFAULT_TEAM_FORMAT,
    name: TEAM_FORMATS[0].name,
    label: 'VGC 2026 Reg M-C',
    randomTeams: false,
    category: 'Doubles',
    detail: 'Doubles · one of your teams',
    rules: 'Bring 6, pick 4 · Level 50',
  },
  {
    id: BO3_TEAM_FORMAT,
    name: '[Gen 9 Champions] VGC 2026 Reg M-C (Bo3)',
    label: 'VGC 2026 Reg M-C (Bo3)',
    randomTeams: false,
    category: 'Doubles',
    detail: 'Best of 3 · open team sheets',
    rules: 'Bring 6, pick 4 · first to 2 wins',
    teamFormat: DEFAULT_TEAM_FORMAT,
  },
  {
    id: TEAM_FORMATS[1].id,
    name: TEAM_FORMATS[1].name,
    label: 'BSS Reg M-C',
    randomTeams: false,
    category: 'Singles',
    detail: 'Singles · bring 6, pick 3 · one of your teams',
    rules: 'Bring 6, pick 3 · Level 50',
  },
  {
    id: RANDOM_BATTLE_FORMAT,
    name: '[Gen 9] Random Battle',
    label: 'Gen 9 Random Battle',
    randomTeams: true,
    category: 'Random',
    detail: 'Singles · random teams',
    rules: 'Level-balanced random sets',
  },
  {
    id: 'gen9randomdoublesbattle',
    name: '[Gen 9] Random Doubles Battle',
    label: 'Gen 9 Random Doubles',
    randomTeams: true,
    category: 'Random',
    detail: 'Doubles · random teams',
    rules: 'Level-balanced random sets',
  },
  {
    id: 'gen9championsrandombattle',
    name: '[Gen 9 Champions] Random Battle',
    label: 'Champions Random Battle',
    randomTeams: true,
    category: 'Random',
    detail: 'Singles · random Champions teams',
    rules: 'Random Champions sets',
  },
  {
    id: 'gen9championsrandomdoublesbattle',
    name: '[Gen 9 Champions] Random Doubles Battle',
    label: 'Champions Random Doubles',
    randomTeams: true,
    category: 'Random',
    detail: 'Doubles · random Champions teams',
    rules: 'Random Champions sets',
  },
  {
    id: 'gen3randombattle',
    name: '[Gen 3] Random Battle',
    label: 'Gen 3 Random Battle',
    randomTeams: true,
    category: 'Random',
    detail: 'Singles · random Ruby/Sapphire teams',
    rules: 'Random Gen 3 sets',
  },
  {
    id: 'gen9randombattleblitz',
    name: '[Gen 9] Random Battle (Blitz)',
    label: 'Gen 9 Random Battle (Blitz)',
    randomTeams: true,
    category: 'Random',
    detail: 'Singles · random teams · fast timer',
    rules: 'Random Battle sets · short turn timer',
  },
  {
    id: 'gen9monotyperandombattle',
    name: '[Gen 9] Monotype Random Battle',
    label: 'Monotype Random Battle',
    randomTeams: true,
    category: 'Randomized Metas',
    detail: 'Singles · random teams of one type',
    rules: 'Every Pokémon shares a type',
  },
  {
    id: 'gen9babyrandombattle',
    name: '[Gen 9] Baby Random Battle',
    label: 'Baby Random Battle',
    randomTeams: true,
    category: 'Randomized Metas',
    detail: 'Singles · random teams of baby Pokémon',
    rules: 'Unevolved Pokémon only',
  },
  {
    id: 'gen9battlefactory',
    name: '[Gen 9] Battle Factory',
    label: 'Battle Factory',
    randomTeams: true,
    category: 'Randomized Metas',
    detail: 'Singles · competitive sets of a random tier',
    rules: 'Team preview · Smogon tier sets',
  },
  {
    id: 'gen91v1factory',
    name: '[Gen 9] 1v1 Factory',
    label: '1v1 Factory',
    randomTeams: true,
    category: 'Randomized Metas',
    detail: 'Singles · pick 1 · competitive sets',
    rules: 'Team preview · pick 1',
  },
  {
    id: 'gen9challengecup1v1',
    name: '[Gen 9] Challenge Cup 1v1',
    label: 'Challenge Cup 1v1',
    randomTeams: true,
    category: 'Randomized Metas',
    detail: 'Singles · pick 1 · any legal moves and item',
    rules: 'Team preview · pick 1',
  },
  {
    id: 'gen9challengecup2v2',
    name: '[Gen 9] Challenge Cup 2v2',
    label: 'Challenge Cup 2v2',
    randomTeams: true,
    category: 'Randomized Metas',
    detail: 'Doubles · pick 2 · any legal moves and item',
    rules: 'Team preview · pick 2',
  },
  {
    id: 'gen9hackmonscup',
    name: '[Gen 9] Hackmons Cup',
    label: 'Hackmons Cup',
    randomTeams: true,
    category: 'Randomized Metas',
    detail: 'Singles · any ability, moves and item',
    rules: 'Anything goes, level-balanced',
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
