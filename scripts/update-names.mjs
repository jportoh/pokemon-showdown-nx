// Builds the names of every item and ability in Showdown's data, into a small JSON file bundled with
// the app (src/app/core/dex/names.json): { "items": { "leftovers": "Leftovers", … }, "abilities": { … } }.
//
//   npm run update:names
//
// A battle's requests name our Pokémon's items and abilities by ID ("heavydutyboots"). The Champions
// data (update-champions-data.mjs) only has what that format allows, and Random Battle uses many
// more. Only the names are kept, not the whole items.js and abilities.js. It also writes the icon of
// every item current games use to public/items, next to the Champions ones (Mega Stones and other
// items the current games dropped only have one if Champions allows them). Downloaded files are only
// read as data, never run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cropScaled, decodePng, encodePng, isBlank } from './png.mjs';

const DATA_URL = 'https://play.pokemonshowdown.com/data';
const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/dex/names.json');
const ITEM_SHEET_URL = 'https://play.pokemonshowdown.com/sprites/itemicons-sheet.png';
const ITEM_ICON_SIZE = 24;
/** Served as items/<id>.png (48x48), bundled with the app like the data. */
const ITEM_ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/items');

async function download(file) {
  const response = await fetch(`${DATA_URL}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

/** The top-level entries of `exports.X = {id:{…},…}` (object literals, not JSON), as [id, body]. */
function entries(source) {
  const result = [];
  let i = source.indexOf('{') + 1;
  while (i < source.length) {
    const key = /^\s*,?\s*"?([a-z0-9]+)"?:\{/.exec(source.slice(i, i + 80));
    if (!key) break;
    const open = i + key[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === '"' || char === "'") {
        for (end++; end < source.length && source[end] !== char; end++) if (source[end] === '\\') end++;
      } else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) break;
    }
    result.push([key[1], source.slice(open, end + 1)]);
    i = end + 1;
  }
  return result;
}

/** id → name, without the CAP ones (they never show in the formats the app plays). */
function names(source) {
  const byId = {};
  for (const [id, body] of entries(source)) {
    const name = /[{,]name:"((?:[^"\\]|\\.)*)"/.exec(body)?.[1];
    if (!name || /[{,]isNonstandard:"CAP"/.test(body)) continue;
    byId[id] = JSON.parse(`"${name}"`);
  }
  return byId;
}

const [itemsText, abilitiesText] = await Promise.all(['items.js', 'abilities.js'].map(download));
const items = names(itemsText);
const abilities = names(abilitiesText);
if (!items.leftovers || !abilities.intimidate) throw new Error('items.js / abilities.js: unexpected format');
writeFileSync(OUTPUT, `${JSON.stringify({ items, abilities })}\n`);

// Item icons, as update-champions-data.mjs cuts them: cells of Showdown's sheet (24x24, 16 per row, at
// the item's spritenum), at twice the size so they stay crisp. Only the items current games use.
const sheetResponse = await fetch(ITEM_SHEET_URL);
if (!sheetResponse.ok) throw new Error(`itemicons-sheet.png: HTTP ${sheetResponse.status}`);
const sheet = decodePng(Buffer.from(await sheetResponse.arrayBuffer()));
mkdirSync(ITEM_ICONS_DIR, { recursive: true });
let icons = 0;
for (const [id, body] of entries(itemsText)) {
  if (/[{,]isNonstandard:/.test(body)) continue;
  const spritenum = Number(/[{,]spritenum:(\d+)/.exec(body)?.[1] ?? NaN);
  const left = (spritenum % 16) * ITEM_ICON_SIZE;
  const top = Math.floor(spritenum / 16) * ITEM_ICON_SIZE;
  if (!Number.isInteger(spritenum) || top + ITEM_ICON_SIZE > sheet.height) continue;
  const icon = cropScaled(sheet, left, top, ITEM_ICON_SIZE, 2);
  if (isBlank(icon)) continue;
  writeFileSync(join(ITEM_ICONS_DIR, `${id}.png`), encodePng(icon));
  icons++;
}
console.log(`${icons} item icons → ${ITEM_ICONS_DIR}`);
console.log(`${Object.keys(items).length} items, ${Object.keys(abilities).length} abilities → ${OUTPUT}`);
