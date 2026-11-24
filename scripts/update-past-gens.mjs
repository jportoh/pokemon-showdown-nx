// Builds what differs in past generations (Gen 3: Ruby/Sapphire/Emerald, Gen 4: Diamond/Pearl/Platinum,
// for their Random Battles) from the moves and species the battle screen shows (moves.json,
// species.json), into one file per generation, src/app/core/dex/gen<N>.json:
//
//   { "moves": { "flamethrower": ["Fire", "S", 95, 100], … },
//     "species": { "clefairy": [["Normal"], [70, 45, 48, 60, 65, 35], ["Cute Charm"]], … } }
//
//   npm run update:past-gens   (after update:moves and update:species)
//
// Showdown's client keeps each generation's changes in teambuilder-tables.js (overrideMoveData and
// overrideSpeciesData per gen), applied from Gen 8 down to the one played, as the client does. On top of
// that, before Gen 4 a move is physical or special by its TYPE; and there are no hidden abilities before
// Gen 5. Only each generation's moves and species (by number) are kept, and only what differs. The
// tables file (~15 MB) is JSON inside a JS string: it's only parsed as data, never run.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, entries, stringField } from './showdown-data.mjs';

const DEX = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/dex');
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
/** Before Gen 4 these types' moves are special; every other type's are physical. */
const SPECIAL_TYPES = ['Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
const CATEGORIES = { Physical: 'P', Special: 'S', Status: 'T' };

/**
 * Each generation: its last move and species number, and its formes (later ones, Megas, regional
 * ones…, aren't in it). Arceus' plates came in Gen 4: all its formes are kept there.
 */
const GENS = [
  { gen: 3, lastMove: 354, lastSpecies: 386, formes: /^(Attack|Defense|Speed|Sunny|Rainy|Snowy)$/ },
  {
    gen: 4,
    lastMove: 467,
    lastSpecies: 493,
    formes: /^(Attack|Defense|Speed|Sunny|Rainy|Snowy|Sandy|Trash|Heat|Wash|Frost|Fan|Mow|Origin|Sky)$/,
    allFormes: ['Arceus'],
  },
];

/**
 * A few well-known values per generation, so a change in Showdown's files doesn't go unnoticed:
 * [what, expected].
 */
const CHECKS = {
  3: (moves, species) => [
    [moves.flamethrower?.join(), 'Fire,S,95,100'],
    [moves.crunch?.[1], 'S'],
    [moves.curse?.[0], '???'],
    [species.clefairy?.[0].join(), 'Normal'],
    [species.gengar?.[2].join(), 'Levitate'],
    [species.pikachu?.[1].join(), '35,55,30,50,40,90'],
  ],
  4: (moves, species) => [
    [moves.flamethrower?.join(), 'Fire,S,95,100'],
    // Gen 4 split the categories: Crunch is physical, as now (so not listed).
    [moves.crunch, undefined],
    [moves.curse?.[0], '???'],
    [species.clefairy?.[0].join(), 'Normal'],
    [species.gengar?.[2].join(), 'Levitate'],
    [species.rotomwash?.[0].join(), 'Electric,Ghost'],
  ],
};

/** `exports.BattleTeambuilderTable = JSON.parse('…')` → the table. */
function parseTables(source) {
  const start = source.indexOf("JSON.parse('");
  const end = source.indexOf("')", start);
  if (start < 0 || end < 0) throw new Error('teambuilder-tables.js: unexpected format');
  // The JSON as a single-quoted JS string: only \' and \\ are escaped for it.
  const json = source.slice(start + "JSON.parse('".length, end).replace(/\\(['\\])/g, '$1');
  return JSON.parse(json);
}

/** Every override of the gens down to `gen`, merged per ID (later gens' fields replace earlier ones). */
function mergedOverrides(tables, key, gen) {
  const merged = {};
  for (let g = 8; g >= gen; g--) {
    for (const [id, fields] of Object.entries(tables[`gen${g}`]?.[key] ?? {})) merged[id] = { ...merged[id], ...fields };
  }
  return merged;
}

const tables = parseTables(await download('teambuilder-tables.js'));
const moveNums = await (await fetch('https://play.pokemonshowdown.com/data/moves.json')).json();
const pokedex = entries(await download('pokedex.js'));
const currentMoves = JSON.parse(readFileSync(join(DEX, 'moves.json'), 'utf8'));
const currentSpecies = JSON.parse(readFileSync(join(DEX, 'species.json'), 'utf8'));

for (const { gen, lastMove, lastSpecies, formes, allFormes = [] } of GENS) {
  const moveOverrides = mergedOverrides(tables, 'overrideMoveData', gen);
  const speciesOverrides = mergedOverrides(tables, 'overrideSpeciesData', gen);

  // Moves: numbers from the client's moves.json, current values from the app's own moves.json.
  const moves = {};
  for (const [id, [, type, category, basePower, accuracy]] of Object.entries(currentMoves)) {
    const num = moveNums[id]?.num ?? 0;
    if (num < 1 || num > lastMove) continue;
    const o = moveOverrides[id] ?? {};
    const oldType = o.type ?? type;
    const baseCategory = o.category ? CATEGORIES[o.category] : category;
    const oldCategory = gen >= 4 || baseCategory === 'T' ? baseCategory : SPECIAL_TYPES.includes(oldType) ? 'S' : 'P';
    const oldPower = o.basePower ?? basePower;
    const oldAccuracy = o.accuracy === undefined ? accuracy : o.accuracy === true ? 0 : o.accuracy;
    const entry = [oldType, oldCategory, oldPower, oldAccuracy];
    if (entry.join() !== [type, category, basePower, accuracy].join()) moves[id] = entry;
  }

  // Species: numbers, slots and forms from pokedex.js; current values from the app's species.json.
  const species = {};
  for (const [id, body] of pokedex) {
    const num = Number(/[{,]num:(-?\d+)/.exec(body)?.[1] ?? 0);
    const current = currentSpecies[id];
    if (num < 1 || num > lastSpecies || !current) continue;
    const forme = stringField(body, 'forme') ?? '';
    if (forme && !formes.test(forme) && !allFormes.includes(stringField(body, 'baseSpecies') ?? '')) continue;
    const [, types, stats] = current;
    const o = speciesOverrides[id] ?? {};
    const slots = o.abilities ?? Object.fromEntries([...(/[{,]abilities:\{([^}]*)\}/.exec(body)?.[1] ?? '').matchAll(/"?(\w+)"?:"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], JSON.parse(`"${m[2]}"`)]));
    // No hidden abilities before Gen 5.
    const oldAbilities = ['0', '1'].map((slot) => slots[slot]).filter(Boolean);
    const oldTypes = o.types ?? types;
    const oldStats = o.baseStats ? STATS.map((stat) => o.baseStats[stat]) : stats;
    const entry = [oldTypes, oldStats, oldAbilities];
    if (JSON.stringify(entry) !== JSON.stringify(current.slice(1))) species[id] = entry;
  }

  for (const [actual, expected] of CHECKS[gen](moves, species)) if (actual !== expected) throw new Error(`gen${gen}: expected ${expected}, got ${actual}`);

  const output = join(DEX, `gen${gen}.json`);
  const json = JSON.stringify({ moves, species });
  writeFileSync(output, `${json}\n`);
  console.log(`Gen ${gen}: ${Object.keys(moves).length} moves, ${Object.keys(species).length} species → ${output} (${Math.round(json.length / 1024)} KB)`);
}
