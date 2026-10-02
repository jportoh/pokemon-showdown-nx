// Builds the teambuilder's game data for [Gen 9 Champions] VGC 2026 Reg M-C from Showdown's client
// data, into one compact JSON file bundled with the app (src/app/core/dex/champions-regmc.json).
//
//   npm run update:champions
//
// The console can't reasonably download Showdown's data at runtime (the Champions tables live in
// teambuilder-tables.js, ~16 MB), so only what the format allows is kept: the species that can be
// used (no battle-only or cosmetic formes), their learnsets as indexes into one move list (sorted by
// name), the legal items in Showdown's order (popular ones first), and the Megas: each one is its base
// species holding a Mega Stone, with the stats, types and ability it Mega Evolves into, and the short
// descriptions of the abilities they all have. Item icons come from Showdown's icon sheet at runtime
// (see update-names.mjs, which records each item's place in it). Run it again when Showdown updates
// the format. Downloaded files are only read as data, never run.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_URL = 'https://play.pokemonshowdown.com/data';
/** Showdown's Black/White-style sprites (96x96), the ones it has for every species and most formes. */
const SPRITES_URL = 'https://play.pokemonshowdown.com/sprites/gen5';
const FORMAT = { id: 'gen9championsvgc2026regmc', name: '[Gen 9 Champions] VGC 2026 Reg M-C' };
const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '../src/app/core/dex/champions-regmc.json');
const ABILITY_SLOTS = ['0', '1', 'H', 'S'];
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
/** Items listed with Showdown's popular ones although it doesn't count them as such. */
const EXTRA_POPULAR_ITEMS = ['sitrusberry', 'psychicseed'];

async function download(file) {
  const response = await fetch(`${DATA_URL}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

/** The table is a JSON string inside `JSON.parse('…')`; only \' and \\ escapes need undoing. */
function parseTeambuilderTables(source) {
  const start = source.indexOf("JSON.parse('") + "JSON.parse('".length;
  const end = source.lastIndexOf("')");
  if (start < "JSON.parse('".length || end < start) throw new Error('teambuilder-tables.js: unexpected format');
  return JSON.parse(source.slice(start, end).replace(/\\(['\\])/g, '$1'));
}

/** Reads `field:"value"` from an entry in items.js or abilities.js (object literals, not JSON). */
function entryFields(source, id) {
  const body = entryBody(source, id);
  if (body === undefined) return undefined;
  const field = (name) => {
    const match = new RegExp(`[{,]${name}:"((?:[^"\\\\]|\\\\.)*)"`).exec(body);
    return match ? JSON.parse(`"${match[1]}"`) : '';
  };
  return { name: field('name'), desc: field('shortDesc') || field('desc') };
}

/** The `{…}` object literal of an entry, braces included. */
function entryBody(source, id) {
  const start = source.search(new RegExp(`[{,\\s]"?${id}"?:\\{`));
  if (start === -1) return undefined;
  const open = source.indexOf('{', start + 1);
  let depth = 0;
  let end = open;
  for (; end < source.length; end++) {
    const char = source[end];
    if (char === '"' || char === "'") {
      for (end++; end < source.length && source[end] !== char; end++) if (source[end] === '\\') end++;
    } else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) break;
  }
  return source.slice(open, end + 1);
}

const toId = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Showdown's sprite file name: "garchomp", "arcanine-hisui", "garchomp-megaz", "meowstic-fmega". */
function spriteId(entry) {
  const base = toId(entry.baseSpecies ?? entry.name);
  return entry.forme ? `${base}-${toId(entry.forme)}` : base;
}

/** Showdown's availability flag, with the Champions override when there is one. */
function nonstandard(entry, override) {
  return override && 'isNonstandard' in override ? override.isNonstandard : entry.isNonstandard;
}

const [pokedexText, movesText, itemsText, abilitiesText, tablesText] = await Promise.all(
  ['pokedex.json', 'moves.json', 'items.js', 'abilities.js', 'teambuilder-tables.js'].map(download),
);
const pokedex = JSON.parse(pokedexText);
const moves = JSON.parse(movesText);
const champions = parseTeambuilderTables(tablesText).champions;
if (!champions?.learnsets) throw new Error('teambuilder-tables.js: no Champions table');

// A species' moves: its own learnset, the species it changes from (formes), the base species' for
// formes without a learnset of their own, and its pre-evolutions', as Showdown's validator does.
function learnable(id, visited = new Set()) {
  const species = pokedex[id];
  if (!species || visited.has(id)) return new Set();
  visited.add(id);
  const own = champions.learnsets[id];
  const result = new Set(own ? Object.keys(own) : []);
  const parents = [];
  if (species.changesFrom) parents.push(species.changesFrom);
  else if (!own && species.baseSpecies) parents.push(species.baseSpecies);
  if (species.prevo) parents.push(species.prevo);
  for (const parent of parents) for (const move of learnable(toId(parent), visited)) result.add(move);
  return result;
}

const moveIndex = new Map();
const moveList = [];
function moveRef(id) {
  if (!moveIndex.has(id)) {
    const move = { ...moves[id], ...champions.overrideMoveData[id] };
    moveIndex.set(id, moveList.length);
    moveList.push({
      id,
      name: move.name,
      type: move.type,
      category: move.category,
      basePower: move.basePower ?? 0,
      accuracy: move.accuracy === true ? 0 : (move.accuracy ?? 0),
      pp: move.pp ?? 5,
      priority: move.priority ?? 0,
      target: move.target ?? 'normal',
      desc: move.shortDesc || move.desc || '',
    });
  }
  return moveIndex.get(id);
}
const legalMove = (id) => moves[id]?.name && !nonstandard(moves[id], champions.overrideMoveData[id]);

const species = [];
for (const [id, entry] of Object.entries(pokedex)) {
  if (!entry.name || nonstandard(entry, champions.overrideSpeciesData[id])) continue;
  if (entry.battleOnly || entry.isCosmeticForme || /Mega/.test(entry.forme ?? '')) continue;
  const learnset = [...learnable(id)].filter(legalMove);
  if (learnset.length === 0) continue;
  species.push({
    id,
    name: entry.name,
    sprite: spriteId(entry),
    types: entry.types,
    abilities: ABILITY_SLOTS.map((slot) => entry.abilities?.[slot]).filter(Boolean),
    baseStats: STATS.map((stat) => entry.baseStats[stat]),
    gender: entry.gender ?? '',
    moves: learnset.sort((a, b) => moves[a].name.localeCompare(moves[b].name)).map(moveRef),
  });
}
species.sort((a, b) => a.name.localeCompare(b.name));

// The table lists items in sections, each after a ['header', title] entry; the "Popular items" one
// is kept (with our extras) as the list the teambuilder shows before anything is typed.
const items = [];
const popularItems = [...EXTRA_POPULAR_ITEMS];
let section = '';
for (const id of champions.items) {
  if (typeof id !== 'string') {
    section = Array.isArray(id) && id[0] === 'header' ? id[1] : section;
    continue;
  }
  if (section === 'Popular items' && !popularItems.includes(id)) popularItems.push(id);
  const item = entryFields(itemsText, id);
  if (!item?.name) throw new Error(`items.js: no entry for ${id}`);
  items.push({ id, ...item });
}

// Megas aren't species a team can hold: they're the base species plus its stone. Their base is the
// forme they Mega Evolve from (Meowstic-F, Floette-Eternal), else their base species.
const speciesIds = new Set(species.map((entry) => entry.id));
const itemIds = new Set(items.map((item) => item.id));
const megas = [];
for (const [id, entry] of Object.entries(pokedex)) {
  if (!/Mega/.test(entry.forme ?? '') || nonstandard(entry, champions.overrideSpeciesData[id])) continue;
  const base = toId(entry.battleOnly ?? entry.baseSpecies);
  const item = toId(entry.requiredItem ?? '');
  if (!speciesIds.has(base) || !itemIds.has(item)) continue;
  megas.push({
    id,
    name: entry.name,
    sprite: spriteId(entry),
    base,
    item,
    types: entry.types,
    ability: entry.abilities['0'],
    baseStats: STATS.map((stat) => entry.baseStats[stat]),
  });
}
megas.sort((a, b) => a.name.localeCompare(b.name));

const abilityNames = new Set([...species.flatMap((entry) => entry.abilities), ...megas.map((mega) => mega.ability)]);
const abilities = [];
for (const name of [...abilityNames].sort((a, b) => a.localeCompare(b))) {
  const id = toId(name);
  const ability = entryFields(abilitiesText, id);
  if (!ability?.name) throw new Error(`abilities.js: no entry for ${id}`);
  abilities.push({ id, ...ability });
}

// Some formes (new Megas especially) don't have a sprite yet: they show their base species' instead.
const baseSprite = (sprite) => sprite.split('-')[0];
const entries = [...species, ...megas];
for (let i = 0; i < entries.length; i += 16) {
  await Promise.all(
    entries.slice(i, i + 16).map(async (entry) => {
      if (entry.sprite === baseSprite(entry.sprite)) return;
      const response = await fetch(`${SPRITES_URL}/${entry.sprite}.png`, { method: 'HEAD' });
      if (response.status === 404) {
        console.log(`No sprite for ${entry.name}: using ${baseSprite(entry.sprite)}`);
        entry.sprite = baseSprite(entry.sprite);
      } else if (!response.ok) {
        throw new Error(`${entry.sprite}.png: HTTP ${response.status}`);
      }
    }),
  );
}

const data = { format: FORMAT, generated: new Date().toISOString().slice(0, 10), species, megas, moves: moveList, items, popularItems, abilities };
if (popularItems.length === EXTRA_POPULAR_ITEMS.length) throw new Error('teambuilder-tables.js: no "Popular items" section');
for (const id of EXTRA_POPULAR_ITEMS) if (!items.some((item) => item.id === id)) throw new Error(`${id} isn't a legal item`);
writeFileSync(OUTPUT, JSON.stringify(data) + '\n');
console.log(`${species.length} species, ${megas.length} Megas, ${moveList.length} moves, ${items.length} items (${popularItems.length} popular), ${abilities.length} abilities →${OUTPUT} (${Math.round(JSON.stringify(data).length / 1024)} KB)`);
