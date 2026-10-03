import { StatId, StatSpread } from '@features/teambuilder/models/team';

/** One Pokémon as Showdown's text format writes it, before it's checked against the dex. */
export interface PastedSet {
  name: string;
  species: string;
  item: string;
  ability: string;
  gender: 'M' | 'F' | '';
  shiny: boolean;
  happiness?: number;
  evs: StatSpread;
  nature: string;
  moves: string[];
}

const STATS: Record<string, StatId> = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe' };

/**
 * Showdown's export text (a PokePaste's too) as sets: blocks separated by blank lines, each opening
 * with `Nickname (Species) (M) @ Item`. Levels, IVs, Tera Types and the like are read past.
 */
export function parseShowdownPaste(text: string): PastedSet[] {
  const sets: PastedSet[] = [];
  let current: PastedSet | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('===')) {
      current = null;
      continue;
    }
    if (!current) {
      current = firstLine(line);
      sets.push(current);
      continue;
    }
    if (line.startsWith('-')) {
      // "- Hidden Power [Fire]" and slashed alternatives ("- Protect / Detect") keep the first.
      const move = line.slice(1).split('/')[0].trim();
      if (move) current.moves.push(move);
    } else if (line.startsWith('Ability:')) {
      current.ability = line.slice('Ability:'.length).trim();
    } else if (line.startsWith('EVs:')) {
      current.evs = spread(line.slice('EVs:'.length));
    } else if (line.startsWith('Shiny:')) {
      current.shiny = /yes/i.test(line);
    } else if (line.startsWith('Happiness:')) {
      const happiness = Number(line.slice('Happiness:'.length));
      if (Number.isFinite(happiness)) current.happiness = happiness;
    } else if (/^\w+ Nature$/.test(line)) {
      current.nature = line.slice(0, -' Nature'.length);
    }
  }
  return sets.filter((set) => set.species);
}

/** `Nickname (Species) (F) @ Item`, any part but the species optional. */
function firstLine(line: string): PastedSet {
  const at = line.lastIndexOf(' @ ');
  const item = at === -1 ? '' : line.slice(at + 3).trim();
  let rest = (at === -1 ? line : line.slice(0, at)).trim();
  let gender: PastedSet['gender'] = '';
  const genderMatch = /\s\((M|F)\)$/.exec(rest);
  if (genderMatch) {
    gender = genderMatch[1] as 'M' | 'F';
    rest = rest.slice(0, genderMatch.index).trim();
  }
  let name = '';
  let species = rest;
  const nicknamed = /^(.*\S)\s+\(([^()]+)\)$/.exec(rest);
  if (nicknamed) {
    name = nicknamed[1];
    species = nicknamed[2];
  }
  return { name, species: species.trim(), item, ability: '', gender, shiny: false, evs: {}, nature: '', moves: [] };
}

/** `252 Atk / 4 SpD / 252 Spe`. */
function spread(text: string): StatSpread {
  const result: StatSpread = {};
  for (const part of text.split('/')) {
    const match = /^\s*(\d+)\s+(\w+)\s*$/.exec(part);
    const stat = match ? STATS[match[2].toLowerCase()] : undefined;
    if (match && stat) result[stat] = Number(match[1]);
  }
  return result;
}
