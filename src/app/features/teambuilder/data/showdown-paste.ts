import { toStatPoints } from '@features/teambuilder/data/game-rules';
import { MAX_MOVES, MAX_TEAM_SIZE, PokemonSet, StatId, StatSpread } from '@features/teambuilder/models/team';

// Showdown's team text format ("paste"), as produced by its teambuilder's Import/Export:
//
//   Nickname (Species) (F) @ Item
//   Ability: Some Ability
//   Shiny: Yes
//   EVs: 32 Atk / 2 SpD / 32 Spe
//   Jolly Nature
//   - Move One
//   - Move Two
//
// Sets are separated by blank lines. A backup with several teams starts each one with a header like
// `=== [gen9ou] Team Name ===`; only the first team is read.
//
// Teams are for [Gen 9 Champions], where "EVs" are stat points: Level, Tera Type and IVs lines are
// ignored, and EVs from other games are converted to stat points.

const STAT_LABELS: Record<StatId, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const STAT_BY_LABEL = new Map(Object.entries(STAT_LABELS).map(([id, label]) => [label.toLowerCase(), id as StatId]));
const STAT_ORDER = Object.keys(STAT_LABELS) as StatId[];

const DEFAULT_HAPPINESS = 255;

export interface ParsedPaste {
  sets: PokemonSet[];
  /** From a `=== [format] Name ===` header, if the paste has one. */
  name: string;
  format: string;
}

export function parseTeamPaste(text: string): ParsedPaste {
  const result: ParsedPaste = { sets: [], name: '', format: '' };
  let current: PokemonSet | null = null;

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      current = null;
      continue;
    }

    const header = /^===\s*(?:\[([^\]]*)\]\s*)?(.*?)\s*===$/.exec(line);
    if (header) {
      if (result.sets.length > 0) break;
      result.format = header[1]?.trim() ?? '';
      result.name = header[2]?.trim() ?? '';
      continue;
    }

    if (!current) {
      if (result.sets.length === MAX_TEAM_SIZE) break;
      current = parseFirstLine(line);
      result.sets.push(current);
      continue;
    }

    if (line.startsWith('-')) {
      const move = line.slice(1).trim();
      if (move && current.moves.length < MAX_MOVES) current.moves.push(move);
      continue;
    }

    const nature = /^(\w+)\s+Nature$/i.exec(line);
    if (nature) {
      current.nature = nature[1];
      continue;
    }

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    switch (key) {
      case 'ability':
        current.ability = value;
        break;
      case 'shiny':
        current.shiny = value.toLowerCase() === 'yes';
        break;
      case 'happiness':
        current.happiness = parseIntOr(value, DEFAULT_HAPPINESS);
        break;
      case 'evs':
        current.evs = toStatPoints(parseSpread(value));
        break;
    }
  }
  return result;
}

/** `Nickname (Species) (F) @ Item`, where every part but the species is optional. */
function parseFirstLine(line: string): PokemonSet {
  const at = line.lastIndexOf(' @ ');
  let left = (at === -1 ? line : line.slice(0, at)).trim();
  const item = at === -1 ? '' : line.slice(at + 3).trim();

  let gender: PokemonSet['gender'] = '';
  const genderMatch = /\s\((M|F)\)$/.exec(left);
  if (genderMatch) {
    gender = genderMatch[1] as 'M' | 'F';
    left = left.slice(0, genderMatch.index).trim();
  }

  let name = '';
  let species = left;
  const nicknamed = /^(.*\S)\s\(([^()]+)\)$/.exec(left);
  if (nicknamed) {
    name = nicknamed[1];
    species = nicknamed[2].trim();
  }

  return { name, species, item, ability: '', gender, shiny: false, evs: {}, nature: '', moves: [] };
}

/** `252 Atk / 4 SpD / 252 Spe` */
function parseSpread(value: string): StatSpread {
  const spread: StatSpread = {};
  for (const part of value.split('/')) {
    const match = /^\s*(\d+)\s+(\w+)\s*$/.exec(part);
    const stat = match && STAT_BY_LABEL.get(match[2].toLowerCase());
    if (match && stat) spread[stat] = Number(match[1]);
  }
  return spread;
}

function parseIntOr(value: string, fallback: number): number {
  const number = parseInt(value, 10);
  return Number.isNaN(number) ? fallback : number;
}

/** The team in Showdown's text format, ready to paste back into Showdown. */
export function exportTeamPaste(sets: readonly PokemonSet[]): string {
  return sets.map(exportSet).join('\n\n') + '\n';
}

function exportSet(set: PokemonSet): string {
  let first = set.name && set.name !== set.species ? `${set.name} (${set.species})` : set.species;
  if (set.gender) first += ` (${set.gender})`;
  if (set.item) first += ` @ ${set.item}`;

  const lines = [first];
  if (set.ability) lines.push(`Ability: ${set.ability}`);
  if (set.shiny) lines.push('Shiny: Yes');
  if (set.happiness !== undefined && set.happiness !== DEFAULT_HAPPINESS) lines.push(`Happiness: ${set.happiness}`);
  const evs = formatSpread(set.evs);
  if (evs) lines.push(`EVs: ${evs}`);
  if (set.nature) lines.push(`${set.nature} Nature`);
  for (const move of set.moves) lines.push(`- ${move}`);
  return lines.join('\n');
}

function formatSpread(spread: StatSpread): string {
  return STAT_ORDER.filter((stat) => (spread[stat] ?? 0) > 0)
    .map((stat) => `${spread[stat]} ${STAT_LABELS[stat]}`)
    .join(' / ');
}
