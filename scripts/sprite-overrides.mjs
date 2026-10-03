// Sprites from elsewhere for the ones Showdown lacks (the new Megas) or has worse ones of:
// missing-sprites.json at the repo root maps a sprite id to the links of its front and back,
//
//   { "raichu-megax": { "front": "https://…/026_3.png", "back": "" }, … }
//
// An empty or absent link leaves that sprite to Showdown (and a back Showdown lacks to the front).
// Without the file, both update:champions and update:sprites use Showdown alone.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '../missing-sprites.json');
/** wiki.gg (Cloudflare) blocks requests that don't look like a browser's, and serves WebP if allowed. */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'image/png',
};

/** Sprite id → its links, the empty ones left out. */
export function loadOverrides() {
  if (!existsSync(FILE)) {
    console.log('No missing-sprites.json: Showdown sprites only.');
    return {};
  }
  const overrides = {};
  for (const [sprite, links] of Object.entries(JSON.parse(readFileSync(FILE, 'utf8')))) {
    if (sprite.startsWith('_')) continue;
    overrides[sprite] = Object.fromEntries(['front', 'back'].filter((side) => links[side]).map((side) => [side, links[side]]));
  }
  return overrides;
}

/** The link to a sprite's front or back from missing-sprites.json, if there is one. */
export function overrideUrl(overrides, sprite, back) {
  return overrides[sprite]?.[back ? 'back' : 'front'];
}

export async function downloadOverride(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
