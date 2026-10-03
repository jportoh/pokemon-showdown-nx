// Packs Showdown's sprites of every Champions species and Mega (front and back, 96x96) into a few PNG
// sheets bundled with the app (public/sprites/), with a map of where each one is
// (src/app/core/dex/sprite-sheets.json).
//
//   npm run update:sprites
//
// Why: the console's network takes ~100 ms per request however many run at once (test p3: 30 sprites
// all at once 3.6 s, 6 at a time 2.9 s), so 685 sprites took 70 s to load; a few sheets take a few
// requests. Fronts fill the first sheets (the team builder needs only those), backs the last ones.
// Run it again after update:champions. Sprites missing-sprites.json links come from there instead
// (see sprite-overrides.mjs); those with no back anywhere (some new Megas) are left out: the app draws
// their front instead.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { downloadOverride, loadOverrides, overrideUrl } from './sprite-overrides.mjs';

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

/** A PNG's pixels, straight RGBA (8-bit palette, grey or RGB(A); what Showdown's sprites are). */
function decodePng(bytes) {
  let width = 0, height = 0, depth = 0, type = 0, palette = null, alphas = null;
  const idat = [];
  for (let at = 8; at + 8 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const name = bytes.toString('latin1', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (name === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12] !== 0) throw new Error('interlaced');
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') alphas = data;
    else if (name === 'IDAT') idat.push(data);
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || (type === 3 ? depth > 8 : depth !== 8)) throw new Error(`unsupported PNG (type ${type}, depth ${depth})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, (channels * depth) / 8);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1) + 1;
    const filter = raw[start - 1];
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? raw[start + i - bpp] : 0;
      const up = y > 0 ? raw[start + i - stride - 1] : 0;
      const corner = y > 0 && i >= bpp ? raw[start + i - stride - 1 - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      raw[start + i] = (raw[start + i] + add) & 255;
    }
  }
  const key = alphas && (type === 0 || type === 2) ? [1, 3, 5].slice(0, type === 0 ? 1 : 3).map((i) => alphas[i]) : null;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let r, g, b, a;
      if (type === 3) {
        const index = depth === 8 ? raw[row + x] : (raw[row + ((x * depth) >> 3)] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
        [r, g, b] = [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]];
        a = alphas && index < alphas.length ? alphas[index] : 255;
      } else {
        const i = row + x * channels;
        if (type === 0 || type === 4) {
          r = g = b = raw[i];
          a = type === 4 ? raw[i + 1] : key && r === key[0] ? 0 : 255;
        } else {
          [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]];
          a = type === 6 ? raw[i + 3] : key && r === key[0] && g === key[1] && b === key[2] ? 0 : 255;
        }
      }
      // Clear pixels all alike, so they compress to nothing.
      if (a === 0) r = g = b = 0;
      pixels.set([r, g, b, a], out);
    }
  }
  return { width, height, pixels };
}

/** An RGBA PNG, each row with the filter that leaves the smallest values (the usual heuristic). */
function encodePng(width, height, pixels) {
  const stride = width * 4;
  const out = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let best = Infinity;
    for (let filter = 0; filter <= 4; filter++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const left = i >= 4 ? row[i - 4] : 0;
        const up = above ? above[i] : 0;
        const corner = above && i >= 4 ? above[i - 4] : 0;
        let predicted = 0;
        if (filter === 1) predicted = left;
        else if (filter === 2) predicted = up;
        else if (filter === 3) predicted = (left + up) >> 1;
        else if (filter === 4) {
          const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
          predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
        }
        const value = (row[i] - predicted) & 255;
        candidate[i] = value;
        score += value < 128 ? value : 256 - value;
      }
      if (score < best) {
        best = score;
        out[y * (stride + 1)] = filter;
        candidate.copy(out, y * (stride + 1) + 1);
      }
    }
  }
  const chunk = (name, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(name, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(out, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A sprite at most a cell big. Fan-made ones are often Showdown-style sprites drawn at twice the size
 * (each pixel a 2x2 block): those are halved, losing nothing. Any extra margin is cropped, keeping the
 * Pokémon whole.
 */
function fitCell(name, image) {
  let { width, height, pixels } = image;
  const doubled = (width > SIZE || height > SIZE) && width % 2 === 0 && height % 2 === 0;
  if (doubled && everyBlockAlike(image)) {
    const half = Buffer.alloc((width / 2) * (height / 2) * 4);
    for (let y = 0; y < height / 2; y++) {
      for (let x = 0; x < width / 2; x++) pixels.copy(half, (y * (width / 2) + x) * 4, (2 * y * width + 2 * x) * 4, (2 * y * width + 2 * x) * 4 + 4);
    }
    [width, height, pixels] = [width / 2, height / 2, half];
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

/** Whether every 2x2 block of the picture is one colour. */
function everyBlockAlike({ width, height, pixels }) {
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const pixel = pixels.readUInt32BE((y * width + x) * 4);
      for (const at of [y * width + x + 1, (y + 1) * width + x, (y + 1) * width + x + 1]) if (pixels.readUInt32BE(at * 4) !== pixel) return false;
    }
  }
  return true;
}

async function download({ name, back }) {
  const own = overrideUrl(overrides, name, back);
  if (own) return downloadOverride(own);
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
const jobs = [...names.map((name) => ({ name, back: false })), ...names.map((name) => ({ name, back: true }))];
console.log(`Downloading ${jobs.length} sprites…`);
const files = await downloadAll(jobs);

const placed = [];
const missing = [];
jobs.forEach((job, i) => {
  if (!files[i]) return missing.push(`${job.name}${job.back ? ' (back)' : ''}`);
  placed.push({ ...job, image: fitCell(job.name, decodePng(files[i])) });
});

const perSheet = COLUMNS * ROWS;
const sheets = [];
const map = { sheets: [], front: {}, back: {} };
mkdirSync(SHEETS_DIR, { recursive: true });
for (let first = 0; first < placed.length; first += perSheet) {
  const group = placed.slice(first, first + perSheet);
  const index = sheets.length;
  const width = COLUMNS * CELL;
  const height = Math.ceil(group.length / COLUMNS) * CELL;
  const pixels = Buffer.alloc(width * height * 4);
  group.forEach(({ name, back, image }, i) => {
    const x = (i % COLUMNS) * CELL + GUTTER / 2;
    const y = Math.floor(i / COLUMNS) * CELL + GUTTER / 2;
    for (let row = 0; row < image.height; row++) {
      image.pixels.copy(pixels, ((y + row) * width + x) * 4, row * image.width * 4, (row + 1) * image.width * 4);
    }
    (back ? map.back : map.front)[name] = [index, x, y, image.width, image.height];
  });
  const file = `champions-${index}.png`;
  const png = encodePng(width, height, pixels);
  writeFileSync(join(SHEETS_DIR, file), png);
  map.sheets.push({ url: `sprites/${file}`, width, height });
  sheets.push(file);
  console.log(`${file}: ${group.length} sprites, ${width}x${height}, ${(png.length / 1024).toFixed(0)} KB`);
}
writeFileSync(MAP, JSON.stringify(map));
console.log(`Missing on Showdown: ${missing.join(', ') || 'none'}`);
