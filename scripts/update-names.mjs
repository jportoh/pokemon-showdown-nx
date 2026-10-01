// Builds the names of every item and ability in Showdown's data, into a small JSON file bundled with
// the app (src/app/core/dex/names.json): { "items": { "leftovers": "Leftovers", … }, "abilities": { … },
// "itemSprites": { "leftovers": 242, … } }.
//
//   npm run update:names
//
// A battle's requests name our Pokémon's items and abilities by ID ("heavydutyboots"). The Champions
// data (update-champions-data.mjs) only has what that format allows, and Random Battle uses many
// more. Only the names are kept, not the whole items.js and abilities.js, and each item's place in
// Showdown's icon sheet (its spritenum): the app draws the icons straight from the sheet (a WebGL
// texture, or a small canvas), so no icon files are bundled. Downloaded files are only read as data,
// never run.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { download, entries, stringField } from './showdown-data.mjs';

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/dex/names.json');

/** id → name, without the CAP ones (they never show in the formats the app plays). */
function names(source) {
  const byId = {};
  for (const [id, body] of entries(source)) {
    const name = stringField(body, 'name');
    if (!name || /[{,]isNonstandard:"CAP"/.test(body)) continue;
    byId[id] = name;
  }
  return byId;
}

/** id → the item's cell in Showdown's icon sheet (24x24, 16 a row), for the items with a name. */
function itemSprites(source, named) {
  const byId = {};
  for (const [id, body] of entries(source)) {
    const spritenum = Number(/[{,]spritenum:(\d+)/.exec(body)?.[1] ?? NaN);
    if (named[id] && Number.isInteger(spritenum) && spritenum > 0) byId[id] = spritenum;
  }
  return byId;
}

const [itemsText, abilitiesText] = await Promise.all(['items.js', 'abilities.js'].map(download));
const items = names(itemsText);
const abilities = names(abilitiesText);
const sprites = itemSprites(itemsText, items);
if (!items.leftovers || !abilities.intimidate || !sprites.leftovers) throw new Error('items.js / abilities.js: unexpected format');
writeFileSync(OUTPUT, `${JSON.stringify({ items, abilities, itemSprites: sprites })}\n`);
console.log(`${Object.keys(items).length} items (${Object.keys(sprites).length} with an icon), ${Object.keys(abilities).length} abilities → ${OUTPUT}`);
