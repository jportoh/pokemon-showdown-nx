// Builds what the battle screen shows of every move in Showdown's data, into a small JSON file bundled
// with the app (src/app/core/dex/moves.json): { "flamethrower": ["Flamethrower", "Fire", "S", 90, 100], … },
// with the name, the type, the category (P physical, S special, T status), the base power and the
// accuracy (0 never misses).
//
//   npm run update:moves
//
// The move buttons show those, and the Pokémon card names a team member's moves (requests give IDs). The Champions data (update-champions-data.mjs) only has the moves that
// format allows, and other formats (Random Battle) use many more. Only those five fields are kept
// (~45 KB), not the whole moves.json (~480 KB). It also saves Showdown's category icons (Physical,
// Special, Status; 32x14) to public/categories, bundled like the item icons. Downloaded files are only
// read as data.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MOVES_URL = 'https://play.pokemonshowdown.com/data/moves.json';
const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/dex/moves.json');
const CATEGORIES = { Physical: 'P', Special: 'S', Status: 'T' };
const CATEGORY_ICONS_URL = 'https://play.pokemonshowdown.com/sprites/categories';
const CATEGORY_ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/categories');

const response = await fetch(MOVES_URL);
if (!response.ok) throw new Error(`moves.json: HTTP ${response.status}`);
const moves = await response.json();

const byId = {};
for (const id of Object.keys(moves).sort()) {
  const move = moves[id];
  // Max and G-Max moves, Z-moves and the CAP ones never show in the formats the app plays.
  if (!move.type || move.isMax || move.isZ || move.isNonstandard === 'CAP') continue;
  const category = CATEGORIES[move.category];
  if (!category) throw new Error(`moves.json: unknown category ${move.category} (${id})`);
  byId[id] = [move.name, move.type, category, move.basePower ?? 0, move.accuracy === true ? 0 : (move.accuracy ?? 0)];
}
writeFileSync(OUTPUT, `${JSON.stringify(byId)}\n`);
console.log(`${Object.keys(byId).length} moves → ${OUTPUT} (${Math.round(JSON.stringify(byId).length / 1024)} KB)`);

mkdirSync(CATEGORY_ICONS_DIR, { recursive: true });
for (const category of Object.keys(CATEGORIES)) {
  const icon = await fetch(`${CATEGORY_ICONS_URL}/${category}.png`);
  if (!icon.ok) throw new Error(`${category}.png: HTTP ${icon.status}`);
  writeFileSync(join(CATEGORY_ICONS_DIR, `${category.toLowerCase()}.png`), Buffer.from(await icon.arrayBuffer()));
}
console.log(`${Object.keys(CATEGORIES).length} category icons → ${CATEGORY_ICONS_DIR}`);
