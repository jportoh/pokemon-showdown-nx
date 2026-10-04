// Builds the damage calculator's common sets for [Gen 9 Champions] VGC 2026 Reg M-C, into a JSON
// file bundled with the app (src/app/core/dex/calc-sets.json).
//
//   npm run update:calc-sets
//
// The sets come from the NCP VGC Damage Calculator (github.com/nerd-of-now/NCP-VGC-Damage-Calculator,
// MIT), whose author keeps hand-picked Champions sets in setdex_ncp-g10.js. Many of them leave the
// ability out, so the calc's default ability for each species comes from its pokedex.js (the `ab` of
// the species' last entry before the ZA-only tables, which is the one its Champions dex copies). Only
// species of our own data are kept. Downloaded files are only read as data, never run.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NCP_URL = 'https://nerd-of-now.github.io/NCP-VGC-Damage-Calculator/script_res';
const HERE = dirname(fileURLToPath(import.meta.url));
const DEX = join(HERE, '../src/app/core/dex/champions-regmc.json');
const OUTPUT = join(HERE, '../src/app/core/dex/calc-sets.json');
/** The setdex's stat names, as the app's. */
const STATS = { hp: 'hp', at: 'atk', df: 'def', sa: 'spa', sd: 'spd', sp: 'spe' };

async function download(file) {
  const response = await fetch(`${NCP_URL}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

const toId = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** `var SETDEX_GEN10 = {…};` is JSON once its comments and trailing commas go. */
function parseSetdex(source) {
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end < start) throw new Error('setdex_ncp-g10.js: unexpected format');
  const body = source
    .slice(start, end + 1)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(body);
}

/**
 * Each species' default ability: the `"ab"` of its last top-level entry (indented four spaces) before
 * the ZA tables, skipping Let's Go's (which has no abilities). Later tables extend the earlier ones.
 */
function defaultAbilities(source) {
  const lgpeStart = source.indexOf('var POKEDEX_LGPE');
  const lgpeEnd = source.indexOf('var POKEDEX_SS_NATDEX');
  const zaStart = source.indexOf('var POKEDEX_ZA = ');
  if (lgpeStart === -1 || lgpeEnd < lgpeStart || zaStart < lgpeEnd) throw new Error('pokedex.js: unexpected format');
  const text = source.slice(0, lgpeStart) + source.slice(lgpeEnd, zaStart);
  const abilities = new Map();
  for (const match of text.matchAll(/\n {4}"([^"]+)": \{/g)) {
    const ability = topLevelAbility(text, match.index + match[0].length - 1);
    if (ability) abilities.set(toId(match[1]), ability);
  }
  return abilities;
}

/** The `"ab"` of the object literal opening at `open` (on one line or many), not a nested object's. */
function topLevelAbility(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return '';
    else if (depth === 1 && text.startsWith('"ab":', i)) return /^"ab":\s*"([^"]+)"/.exec(text.slice(i))?.[1] ?? '';
  }
  throw new Error('pokedex.js: unclosed entry');
}

const dex = JSON.parse(readFileSync(DEX, 'utf8'));
const species = new Map(dex.species.map((s) => [toId(s.name), s]));
const [setdex, pokedex] = await Promise.all([download('setdex_ncp-g10.js'), download('pokedex.js')]);
const defaults = defaultAbilities(pokedex);

const abilities = {};
for (const s of dex.species) {
  const ability = defaults.get(toId(s.name));
  // Only what the species can have in the format: the calc's choice, else its first one.
  abilities[s.name] = ability && s.abilities.includes(ability) ? ability : s.abilities[0];
}

const sets = [];
const skipped = [];
for (const [name, named] of Object.entries(parseSetdex(setdex))) {
  const ours = species.get(toId(name));
  if (!ours) {
    skipped.push(name);
    continue;
  }
  for (const [title, set] of Object.entries(named)) {
    const evs = {};
    for (const [stat, points] of Object.entries(set.sps ?? {})) if (points) evs[STATS[stat]] = points;
    sets.push({
      species: ours.name,
      name: title,
      nature: set.nature ?? 'Serious',
      item: set.item ?? '',
      ability: set.ability || abilities[ours.name],
      evs,
      moves: (set.moves ?? []).filter(Boolean),
    });
  }
}

const output = { source: 'NCP VGC Damage Calculator (nerd-of-now), MIT', generated: new Date().toISOString().slice(0, 10), abilities, sets };
writeFileSync(OUTPUT, `${JSON.stringify(output)}\n`);
console.log(`${sets.length} sets for ${new Set(sets.map((s) => s.species)).size} species, default abilities for ${Object.keys(abilities).length}`);
if (skipped.length) console.log(`Not in our data (left out): ${skipped.join(', ')}`);
