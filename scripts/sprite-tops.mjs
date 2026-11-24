// Where each bundled sprite's picture starts: the first row (from its cell's top) with a pixel that
// shows, kept as the 6th number of its place in src/app/core/dex/sprite-sheets.json. The battle field
// puts a move's (or an item's, an ability's) label just over the Pokémon's head with it, instead of
// over its 96x96 box, mostly empty above a small or a back sprite (bugs L92).
//
// update-sprite-sheets.mjs fills it in as it packs; run alone (`node scripts/sprite-tops.mjs`) it adds
// it to the places that lack it, from the sheets' PNGs.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png.mjs';

/** A pixel this see-through or more doesn't count (a soft edge, a shadow's fringe). */
const MIN_ALPHA = 24;

/** The first row of the `w` x `h` area at (x, y) of an RGBA image `width` wide with a pixel that shows; `h` if none. */
export function spriteTop(pixels, width, x, y, w, h) {
  for (let row = 0; row < h; row++) {
    const start = ((y + row) * width + x) * 4 + 3;
    for (let i = 0; i < w; i++) if (pixels[start + i * 4] >= MIN_ALPHA) return row;
  }
  return h;
}

/** Gives every place of `map` (sprite-sheets.json) without its top one, reading the sheets from `sheetsDir`. */
export function addSheetTops(map, sheetsDir) {
  const decoded = new Map();
  const sheet = (index) => {
    if (!decoded.has(index)) decoded.set(index, decodePng(readFileSync(join(sheetsDir, map.sheets[index].url.replace(/^sprites\//, '')))));
    return decoded.get(index);
  };
  let added = 0;
  for (const places of [map.front, map.back]) {
    for (const place of Object.values(places)) {
      if (place.length >= 6) continue;
      const [index, x, y, w, h] = place;
      const image = sheet(index);
      place[5] = spriteTop(image.pixels, image.width, x, y, w, h);
      added++;
    }
  }
  return added;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const mapFile = join(root, 'src/app/core/dex/sprite-sheets.json');
  const map = JSON.parse(readFileSync(mapFile, 'utf8'));
  const added = addSheetTops(map, join(root, 'public/sprites'));
  writeFileSync(mapFile, JSON.stringify(map));
  console.log(`Tops added to ${added} sprites.`);
}
