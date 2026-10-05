// Builds what differs in Gen 3 (Ruby/Sapphire/Emerald, for [Gen 3] Random Battle) from the moves and
// species the battle screen shows (moves.json, species.json), into src/app/core/dex/gen3.json:
//
//   { "moves": { "flamethrower": ["Fire", "S", 95, 100], … },
//     "species": { "clefairy": [["Normal"], [70, 45, 48, 60, 65, 35], ["Cute Charm"]], … } }
//
//   npm run update:gen3   (after update:moves and update:species)
//
// Showdown's client keeps each generation's changes in teambuilder-tables.js (overrideMoveData and
// overrideSpeciesData per gen), applied from Gen 8 down to the one played, as the client does. On top of
// that, before Gen 4 a move is physical or special by its TYPE; and there are no hidden abilities before
// Gen 5. Only Gen 3's moves (up to #354) and species (up to #386) are kept, and only what differs. The
// tables file (~15 MB) is JSON inside a JS string: it's only parsed as data, never run.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, entries, stringField } from './showdown-data.mjs';

const DEX = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/dex');
const OUTPUT = join(DEX, 'gen3.json');
const LAST_MOVE = 354;
const LAST_SPECIES = 386;
const OVERRIDE_GENS = ['gen8', 'gen7', 'gen6', 'gen5', 'gen4', 'gen3'];
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
/** Before Gen 4 these types' moves are special; every other type's are physical. */
const SPECIAL_TYPES = ['Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
const CATEGORIES = { Physical: 'P', Special: 'S', Status: 'T' };

/** `exports.BattleTeambuilderTable = JSON.parse('…')` → the table. */
function parseTables(source) {
  const start = source.indexOf("JSON.parse('");
  const end = source.indexOf("')", start);
  if (start < 0 || end < 0) throw new Error('teambuilder-tables.js: unexpected format');
  // The JSON as a single-quoted JS string: only \' and \\ are escaped for it.
  const json = source.slice(start + "JSON.parse('".length, end).replace(/\\(['\\])/g, '$1');
  return JSON.parse(json);
}

/** Every override of the gens down to Gen 3, merged per ID (later gens' fields replace earlier ones). */
function mergedOverrides(tables, key) {
  const merged = {};
  for (const gen of OVERRIDE_GENS) {
    for (const [id, fields] of Object.entries(tables[gen]?.[key] ?? {})) merged[id] = { ...merged[id], ...fields };
  }
  return merged;
}

const tables = parseTables(await download('teambuilder-tables.js'));
const moveOverrides = mergedOverrides(tables, 'overrideMoveData');
const speciesOverrides = mergedOverrides(tables, 'overrideSpeciesData');

// Moves: numbers from the client's moves.json, current values from the app's own moves.json.
const moveNums = await (await fetch('https://play.pokemonshowdown.com/data/moves.json')).json();
const currentMoves = JSON.parse(readFileSync(join(DEX, 'moves.json'), 'utf8'));
const moves = {};
for (const [id, [, type, category, basePower, accuracy]] of Object.entries(currentMoves)) {
  const num = moveNums[id]?.num ?? 0;
  if (num < 1 || num > LAST_MOVE) continue;
  const o = moveOverrides[id] ?? {};
  const gen3Type = o.type ?? type;
  const baseCategory = o.category ? CATEGORIES[o.category] : category;
  const gen3Category = baseCategory === 'T' ? 'T' : SPECIAL_TYPES.includes(gen3Type) ? 'S' : 'P';
  const gen3Power = o.basePower ?? basePower;
  const gen3Accuracy = o.accuracy === undefined ? accuracy : o.accuracy === true ? 0 : o.accuracy;
  const entry = [gen3Type, gen3Category, gen3Power, gen3Accuracy];
  if (entry.join() !== [type, category, basePower, accuracy].join()) moves[id] = entry;
}

// Species: numbers, slots and forms from pokedex.js; current values from the app's species.json.
const currentSpecies = JSON.parse(readFileSync(join(DEX, 'species.json'), 'utf8'));
const species = {};
for (const [id, body] of entries(await download('pokedex.js'))) {
  const num = Number(/[{,]num:(-?\d+)/.exec(body)?.[1] ?? 0);
  const current = currentSpecies[id];
  // Formes that came later (Megas, regional ones…) aren't in Gen 3; Deoxys' and Castform's are.
  if (num < 1 || num > LAST_SPECIES || !current) continue;
  const forme = stringField(body, 'forme') ?? '';
  if (forme && !/^(Attack|Defense|Speed|Sunny|Rainy|Snowy)$/.test(forme)) continue;
  const [, types, stats] = current;
  const o = speciesOverrides[id] ?? {};
  const slots = o.abilities ?? Object.fromEntries([...(/[{,]abilities:\{([^}]*)\}/.exec(body)?.[1] ?? '').matchAll(/"?(\w+)"?:"((?:[^"\\]|\\.)*)"/g)].map((m) => [m[1], JSON.parse(`"${m[2]}"`)]));
  const gen3Abilities = ['0', '1'].map((slot) => slots[slot]).filter(Boolean);
  const gen3Types = o.types ?? types;
  const gen3Stats = o.baseStats ? STATS.map((stat) => o.baseStats[stat]) : stats;
  const entry = [gen3Types, gen3Stats, gen3Abilities];
  if (JSON.stringify(entry) !== JSON.stringify(current.slice(1))) species[id] = entry;
}

// A few well-known Gen 3 values, so a change in Showdown's files doesn't go unnoticed.
const checks = [
  [moves.flamethrower?.join(), 'Fire,S,95,100'],
  [moves.crunch?.[1], 'S'],
  [moves.curse?.[0], '???'],
  [species.clefairy?.[0].join(), 'Normal'],
  [species.gengar?.[2].join(), 'Levitate'],
  [species.pikachu?.[1].join(), '35,55,30,50,40,90'],
];
for (const [actual, expected] of checks) if (actual !== expected) throw new Error(`gen3: expected ${expected}, got ${actual}`);

const json = JSON.stringify({ moves, species });
writeFileSync(OUTPUT, `${json}\n`);
console.log(`${Object.keys(moves).length} moves, ${Object.keys(species).length} species → ${OUTPUT} (${Math.round(json.length / 1024)} KB)`);
