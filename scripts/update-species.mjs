// Builds what the battle screen shows of every species in Showdown's data, into a small JSON file
// bundled with the app (src/app/core/dex/species.json):
// { "garchomp": ["Garchomp", ["Dragon", "Ground"], [108, 130, 95, 80, 85, 102], ["Sand Veil", "Rough Skin"]], … },
// with the name, the types, the base stats (HP/Atk/Def/SpA/SpD/Spe) and the abilities it can have.
//
//   npm run update:species
//
// The spectator's Pokémon panel shows those. The Champions data (update-champions-data.mjs) only has
// the species that format allows, and Random Battle and other formats use many more. Every species of
// the main games is kept, old and new Megas too: no Gigantamax, CAP, Let's Go or custom ones, and no
// cosmetic formes (the app looks those up by their base species). Downloaded files are only read as data.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, entries, stringField } from './showdown-data.mjs';

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/dex/species.json');
/** Species from past games (Megas, the ones SV dropped) and the new Champions Megas. */
const KEPT = ['Past', 'Future'];
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** `types:["Dragon","Ground"]` → ["Dragon", "Ground"]. */
function stringList(body, field) {
  const list = new RegExp(`[{,]${field}:\\[([^\\]]*)\\]`).exec(body)?.[1];
  return list ? [...list.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)) : [];
}

/** `baseStats:{hp:108,…}` → [108, …] in HP/Atk/Def/SpA/SpD/Spe order. */
function baseStats(body) {
  const table = /[{,]baseStats:\{([^}]*)\}/.exec(body)?.[1] ?? '';
  return STATS.map((stat) => Number(new RegExp(`(?:^|,)${stat}:(\\d+)`).exec(table)?.[1] ?? NaN));
}

/** `abilities:{"0":"Sand Veil",H:"Rough Skin"}` → ["Sand Veil", "Rough Skin"], in slot order. */
function abilities(body) {
  const table = /[{,]abilities:\{([^}]*)\}/.exec(body)?.[1] ?? '';
  return [...table.matchAll(/"((?:[^"\\]|\\.)*)"(?=,|$)/g)].map((m) => JSON.parse(`"${m[1]}"`));
}

const source = await download('pokedex.js');
const byId = {};
for (const [id, body] of entries(source)) {
  const nonstandard = stringField(body, 'isNonstandard');
  const forme = stringField(body, 'forme') ?? '';
  if ((nonstandard && !KEPT.includes(nonstandard)) || forme.includes('Gmax')) continue;
  // Cosmetic formes (Burmy-Sandy, Vivillon-…) only name themselves: they take their base species' data.
  if (!body.includes('baseStats:')) continue;
  const name = stringField(body, 'name');
  const stats = baseStats(body);
  if (!name || stats.some(Number.isNaN)) throw new Error(`pokedex.js: unexpected entry ${id}`);
  byId[id] = [name, stringList(body, 'types'), stats, abilities(body)];
}
if (byId.garchomp?.[1].join() !== 'Dragon,Ground' || byId.garchomp[3].join() !== 'Sand Veil,Rough Skin') {
  throw new Error(`pokedex.js: unexpected format (garchomp: ${JSON.stringify(byId.garchomp)})`);
}
const json = JSON.stringify(byId);
writeFileSync(OUTPUT, `${json}\n`);
console.log(`${Object.keys(byId).length} species → ${OUTPUT} (${Math.round(json.length / 1024)} KB)`);
