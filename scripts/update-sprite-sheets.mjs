// Packs Showdown's sprites of every Champions species and Mega (front and back, 96x96) into a few PNG
// sheets bundled with the app (public/sprites/), with a map of where each one is
// (src/app/core/dex/sprite-sheets.json).
//
//   npm run update:sprites              adds the sprites not in the sheets yet, on new sheets
//   npm run update:sprites -- --repack  packs every sprite again, from the first sheet
//
// Why: the console's network takes ~100 ms per request however many run at once (test p3: 30 sprites
// all at once 3.6 s, 6 at a time 2.9 s), so 685 sprites took 70 s to load; a few sheets take a few
// requests. Fronts fill the first sheets (the team builder needs only those), backs the last ones.
// Run it again after update:champions. Sprites missing-sprites.json links come from there instead
// (see sprite-overrides.mjs); those with no back anywhere (some new Megas) are left out: the app draws
// their front instead.
//
// By default it only appends: the sheets already made stay byte for byte as they are, and the new
// species go on new sheets. An online update then carries just those new sheets in its asset pack
// (docs/updates.md), not every sheet again. --repack (all sheets change) is for a new baseline .nro.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { downloadOverride, loadOverrides, overrideUrl } from './sprite-overrides.mjs';
import { addSheetTops, spriteTop } from './sprite-tops.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEX = join(ROOT, 'src/app/core/dex/champions-regmc.json');
const MAP = join(ROOT, 'src/app/core/dex/sprite-sheets.json');
const SHEETS_DIR = join(ROOT, 'public/sprites');
const SPRITES_URL = 'https://play.pokemonshowdown.com/sprites';
/** Sprites the app shows outside the format (the login box's Pikachu). */
const EXTRA = ['pikachu'];
const SIZE = 96;
/** Clear pixels between cells, so scaled sprites never pick up their neighbours' edges. */
const GUTTER = 2;
const CELL = SIZE + GUTTER;
/** 20 x 20 cells: 1960 px, under the 2048 every WebGL GPU takes. */
const COLUMNS = 20;
const ROWS = 20;
const DOWNLOADS = 8;

/**
 * A sprite at most a cell big. Fan-made ones are often Showdown-style sprites drawn at twice the size
 * (each pixel a 2x2 block): those are halved, losing nothing. Any extra margin is cropped, keeping the
 * Pokémon whole.
 */
function fitCell(name, image) {
  let { width, height, pixels } = image;
  const grid = width > SIZE || height > SIZE ? blockGrid(image) : null;
  if (grid) {
    const [halfW, halfH] = [Math.floor((width - grid.x) / 2), Math.floor((height - grid.y) / 2)];
    const half = Buffer.alloc(halfW * halfH * 4);
    for (let y = 0; y < halfH; y++) {
      for (let x = 0; x < halfW; x++) {
        const at = ((grid.y + 2 * y) * width + grid.x + 2 * x) * 4;
        pixels.copy(half, (y * halfW + x) * 4, at, at + 4);
      }
    }
    [width, height, pixels] = [halfW, halfH, half];
  }
  if (width <= SIZE && height <= SIZE) return { width, height, pixels };
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pixels[(y * width + x) * 4 + 3]) continue;
      [left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)];
    }
  }
  if (right - left >= SIZE || bottom - top >= SIZE) throw new Error(`${name}: ${right - left + 1}x${bottom - top + 1} drawn, bigger than a cell`);
  // The centre of the picture, moved as little as needed to keep the Pokémon in.
  const crop = (size, first, last) => (size <= SIZE ? 0 : Math.min(first, Math.max(last - SIZE + 1, Math.floor((size - SIZE) / 2))));
  const [cropX, cropY] = [crop(width, left, right), crop(height, top, bottom)];
  const [w, h] = [Math.min(width, SIZE), Math.min(height, SIZE)];
  const cropped = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) pixels.copy(cropped, y * w * 4, ((cropY + y) * width + cropX) * 4, ((cropY + y) * width + cropX + w) * 4);
  return { width: w, height: h, pixels: cropped };
}

/**
 * Where the 2x2 blocks of a picture drawn at twice the size start (the grid can be a pixel off, and the
 * size odd, when the edge rows and columns out of it are clear), or null if it isn't one.
 */
function blockGrid({ width, height, pixels }) {
  const pixel = (x, y) => pixels.readUInt32BE((y * width + x) * 4);
  for (const [gx, gy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const [right, bottom] = [gx + 2 * Math.floor((width - gx) / 2), gy + 2 * Math.floor((height - gy) / 2)];
    let alike = true;
    for (let y = 0; y < height && alike; y++) {
      for (let x = 0; x < width && alike; x++) {
        const outside = x < gx || y < gy || x >= right || y >= bottom;
        if (outside) alike = pixels[(y * width + x) * 4 + 3] === 0;
        else alike = pixel(x, y) === pixel(x - ((x - gx) % 2), y - ((y - gy) % 2));
      }
    }
    if (alike) return { x: gx, y: gy };
  }
  return null;
}

async function download({ name, back }) {
  const own = overrideUrl(overrides, name, back);
  if (own) return downloadOverride(own);
  // A front from elsewhere with no back: the app draws that front, not Showdown's back to another one.
  if (back && overrideUrl(overrides, name, false)) return null;
  const url = `${SPRITES_URL}/${back ? 'gen5-back' : 'gen5'}/${name}.png`;
  const response = await fetch(url);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Downloads `jobs` a few at a time, in order. */
async function downloadAll(jobs) {
  const results = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await download(jobs[i]);
    }
  };
  await Promise.all(Array.from({ length: DOWNLOADS }, lane));
  return results;
}

const dex = JSON.parse(readFileSync(DEX, 'utf8'));
const overrides = loadOverrides();
const names = [...new Set([...dex.species.map((s) => s.sprite), ...dex.megas.map((m) => m.sprite), ...EXTRA])].sort();
const unused = Object.keys(overrides).filter((name) => !names.includes(name));
if (unused.length) console.log(`Not in the format, skipped: ${unused.join(', ')}`);
const repack = process.argv.includes('--repack') || !existsSync(MAP);
/** Appending: the sheets made before, kept as they are. */
const previous = repack ? { sheets: [], front: {}, back: {} } : JSON.parse(readFileSync(MAP, 'utf8'));
const jobs = [
  ...names.filter((name) => !previous.front[name]).map((name) => ({ name, back: false })),
  ...names.filter((name) => !previous.back[name]).map((name) => ({ name, back: true })),
];
console.log(`${repack ? 'Repacking' : 'Appending'}: downloading ${jobs.length} sprites…`);
const files = await downloadAll(jobs);

const placed = [];
const missing = [];
jobs.forEach((job, i) => {
  if (!files[i]) return missing.push(`${job.name}${job.back ? ' (back)' : ''}`);
  placed.push({ ...job, image: fitCell(job.name, decodePng(files[i])) });
});

const perSheet = COLUMNS * ROWS;
const sheets = [];
const map = { sheets: [...previous.sheets], front: { ...previous.front }, back: { ...previous.back } };
if (!repack && placed.length === 0) console.log('Every sprite is in the sheets already: nothing to add.');
mkdirSync(SHEETS_DIR, { recursive: true });
for (let first = 0; first < placed.length; first += perSheet) {
  const group = placed.slice(first, first + perSheet);
  const index = map.sheets.length;
  const width = COLUMNS * CELL;
  const height = Math.ceil(group.length / COLUMNS) * CELL;
  const pixels = Buffer.alloc(width * height * 4);
  group.forEach(({ name, back, image }, i) => {
    const x = (i % COLUMNS) * CELL + GUTTER / 2;
    const y = Math.floor(i / COLUMNS) * CELL + GUTTER / 2;
    for (let row = 0; row < image.height; row++) {
      image.pixels.copy(pixels, ((y + row) * width + x) * 4, row * image.width * 4, (row + 1) * image.width * 4);
    }
    // The 6th number: where the picture starts (sprite-tops.mjs), for the labels over its head.
    (back ? map.back : map.front)[name] = [index, x, y, image.width, image.height, spriteTop(image.pixels, image.width, 0, 0, image.width, image.height)];
  });
  const file = `champions-${index}.png`;
  const png = encodePng(width, height, pixels);
  writeFileSync(join(SHEETS_DIR, file), png);
  map.sheets.push({ url: `sprites/${file}`, width, height });
  sheets.push(file);
  console.log(`${file}: ${group.length} sprites, ${width}x${height}, ${(png.length / 1024).toFixed(0)} KB`);
}
// Places packed before tops were kept get theirs from their sheet.
addSheetTops(map, SHEETS_DIR);
writeFileSync(MAP, JSON.stringify(map));
console.log(`Missing on Showdown: ${missing.join(', ') || 'none'}`);
