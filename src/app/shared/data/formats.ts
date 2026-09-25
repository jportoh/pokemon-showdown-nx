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

/** The display name of a format ID; unknown IDs (e.g. from an imported team) are shown as they are. */
export function formatName(id: string): string {
  return TEAM_FORMATS.find((format) => format.id === id)?.name ?? id;
}
