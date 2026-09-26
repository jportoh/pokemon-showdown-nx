// Builds the type of every move in Showdown's data, into a small JSON file bundled with the app
// (src/app/core/dex/move-types.json): { "Fire": ["ember", "flamethrower", …], … }.
//
//   npm run update:move-types
//
// The battle screen colours a move by its type. The Champions data (update-champions-data.mjs) only
// has the moves that format allows, and other formats (Random Battle) use many more. Only the types
// are kept (~15 KB), not the whole moves.json (~480 KB). Downloaded files are only read as data.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOVES_URL = 'https://play.pokemonshowdown.com/data/moves.json';
const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/dex/move-types.json');

const response = await fetch(MOVES_URL);
if (!response.ok) throw new Error(`moves.json: HTTP ${response.status}`);
const moves = await response.json();

const byType = {};
for (const [id, move] of Object.entries(moves)) {
  // Max and G-Max moves, Z-moves and the CAP ones never show in the formats the app plays.
  if (!move.type || move.isMax || move.isZ || move.isNonstandard === 'CAP') continue;
  (byType[move.type] ??= []).push(id);
}
const sorted = Object.fromEntries(
  Object.keys(byType)
    .sort()
    .map((type) => [type, byType[type].sort()]),
);
writeFileSync(OUTPUT, `${JSON.stringify(sorted)}\n`);
const count = Object.values(sorted).reduce((sum, ids) => sum + ids.length, 0);
console.log(`${count} moves in ${Object.keys(sorted).length} types → ${OUTPUT}`);
