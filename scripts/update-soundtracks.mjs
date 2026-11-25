// Makes the official game music the app bundles beyond Showdown's battle tracks: the soundtracks
// Settings picks from (Sound > Soundtrack: the music of the title screen, the menus, team preview and
// a battle's end) and the official battle tracks battles pick among with Showdown's. Each track in
// TRACKS goes to public/audio/music/<game>-<title>.ogg (mono, 24 kHz, Vorbis, cut just past its
// loop's end, at the battle music's loudness) and the list with the loop points to
// src/app/core/audio/official-music.ts.
//
//   npm run update:soundtracks   (needs ffmpeg with libvorbis: on the PATH, or its path in FFMPEG)
//
// The sources stay out of git, in references/music/, in any format ffmpeg reads. A track from Smash
// Custom Music (`scm`, its song id) is the BRSTM downloaded from its page by hand (the site doesn't
// allow scripts to download them), found by its id, or its game and title, in the file's name; any
// other is a `file` there. The loop comes from a BRSTM's header (one marked as not looping is a
// jingle, played once), or else from `loop` (seconds from the file's start), or else it's found where
// the music repeats (find-loop.mjs: rips usually play the loop twice and fade out); a file that
// doesn't repeat is looped whole. Check what it prints.
//
// The music belongs to Nintendo, Game Freak and The Pokémon Company. The BRSTMs are from Smash Custom
// Music: Pokémon Champions' (smashcustommusic.net/game/5776) uploaded by FlamboyantPayne, Pokémon
// Emerald's (smashcustommusic.net/game/785) by Soneek and FlameHyenard.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLoop } from './find-loop.mjs';

/**
 * Every track: a soundtrack's, for `roles` (ROLES), or a battle track (`roles: ['battle']`, for every
 * soundtrack). A soundtrack is offered once it has a menu track.
 */
const TRACKS = [
  { soundtrack: 'champions', roles: ['titleScreen'], game: 'Pokémon Champions', title: 'Main Theme', scm: 121944 },
  { soundtrack: 'champions', roles: ['menu'], game: 'Pokémon Champions', title: 'Main Lobby', scm: 121945 },
  { soundtrack: 'champions', roles: ['preview'], game: 'Pokémon Champions', title: 'Team Select', scm: 121952 },
  { soundtrack: 'champions', roles: ['victory', 'defeat'], game: 'Pokémon Champions', title: 'Match Results', scm: 121953 },
  { roles: ['battle'], game: 'Pokémon Champions', title: 'Battle Arena', scm: 121941 },
  { roles: ['battle'], game: 'Pokémon Champions', title: 'Gym Court', scm: 121942 },
  { soundtrack: 'classic', roles: ['titleScreen'], game: 'Pokémon Emerald', title: 'Battle Frontier', scm: 23240 },
  { soundtrack: 'classic', roles: ['menu'], game: 'Pokémon Emerald', title: 'Battle Tower', scm: 37558 },
  { soundtrack: 'classic', roles: ['preview'], game: 'Pokémon Emerald', title: 'Battle Dome', scm: 37557 },
  // A jingle: the menu track goes on after it.
  { soundtrack: 'classic', roles: ['victory'], game: 'Pokémon Emerald', title: 'Battle Symbol Get!', scm: 11775 },
  { soundtrack: 'classic', roles: ['defeat'], game: 'Pokémon Emerald', title: 'Battle Pyramid 1', scm: 23241 },
];
const SOUNDTRACKS = ['champions', 'classic'];
/**
 * What a soundtrack's track plays for: the title screen (before START), the menus (taking turns),
 * team preview, and a battle's end, won or lost.
 */
const ROLES = ['titleScreen', 'menu', 'preview', 'victory', 'defeat'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(root, 'references/music');
const OUTPUT = join(root, 'public/audio/music');
const BATTLE = join(root, 'public/audio/battle');
const LIST = join(root, 'src/app/core/audio/official-music.ts');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const RATE = 24000;
/** Vorbis quality (−1 to 10): 2 is ~45 kb/s in mono at 24 kHz, as the battle music. */
const QUALITY = 2;
/** The loop's start played again past its end, so the loop never runs into the buffer's end (the app keeps it: TAIL_S). */
const TAIL_S = 0.1;
/** The loudest a sample may get after levelling: Vorbis overshoots it by up to ~2 dB, under 1 once decoded. */
const PEAK = 0.8;
/** At most this much of a track's peaks is limited to bring it to the battle music's level (dB). */
const MAX_LIMITING_DB = 4;
/** The limiter eases its gain down over this before a peak, and back up with this time constant after it. */
const ATTACK_S = 0.005;
const RELEASE_S = 0.08;
/** Below this share of its loop repeating, a found loop is reported as doubtful. */
const DOUBTFUL = 0.9;

// Every source first, so one run says all that's missing.
const files = TRACKS.map(source);
const missing = TRACKS.filter((_, i) => !files[i]);
if (missing.length) {
  for (const track of missing) {
    console.error(`${track.game} - ${track.title}: not in references/music/.${track.scm ? ` Download its BRSTM from https://smashcustommusic.net/song/${track.scm} into it.` : ''}`);
  }
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'soundtracks-'));
mkdirSync(OUTPUT, { recursive: true });
try {
  // The battle music's loudness (RMS over each track), which these are levelled to.
  const battle = readdirSync(BATTLE).filter((name) => name.endsWith('.ogg'));
  const target = battle.map((name) => rms(decode(join(BATTLE, name)))).reduce((sum, level) => sum + level, 0) / battle.length;
  console.log(`Battle music level: ${db(target).toFixed(1)} dB RMS`);

  const made = new Map();
  for (const [i, track] of TRACKS.entries()) {
    const file = files[i];
    const samples = decode(file);
    const { start, end, once, how } = loopOf(track, file, samples);
    if (!(start >= 0 && end > start && end <= samples.length)) throw new Error(`${track.title}: the loop ${seconds(start)} → ${seconds(end)} s isn't inside the file (${seconds(samples.length)} s)`);
    console.log(`${track.game} - ${track.title}: ${once ? `${seconds(end)} s, played once` : `loop ${seconds(start)} → ${seconds(end)} s (${seconds(end - start)} s long`}, ${how})`);

    const gain = Math.min(target / rms(samples.subarray(start, end)), (PEAK / peak(samples.subarray(0, end))) * 10 ** (MAX_LIMITING_DB / 20));
    const kept = levelled(samples, start, end, once, gain);
    const pcm = join(work, 'track.f32');
    writeFileSync(pcm, Buffer.from(kept.buffer));
    const base = slug(`${track.game.replace(/^Pokémon /, '')} ${track.title}`);
    let name = base;
    for (let n = 2; made.has(name); n++) name = `${base}-${n}`;
    const output = join(OUTPUT, `${name}.ogg`);
    ffmpeg(['-y', '-v', 'error', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', pcm, '-c:a', 'libvorbis', '-q:a', String(QUALITY), '-map_metadata', '-1', output]);
    console.log(`  → ${name}.ogg: ${(statSync(output).size / 1024).toFixed(0)} KB, ${seconds(kept.length)} s, ${gain >= 1 ? '+' : ''}${db(gain).toFixed(1)} dB`);
    made.set(name, { ...track, url: `audio/music/${name}.ogg`, loopStart: start / RATE, loopEnd: end / RATE, once });
  }
  // The last run's files that weren't made again.
  for (const name of readdirSync(OUTPUT)) if (name.endsWith('.ogg') && !made.has(name.slice(0, -4))) rmSync(join(OUTPUT, name));
  writeFileSync(LIST, list([...made.values()]));
  console.log(`${LIST}: ${made.size} tracks`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

/**
 * A track's source file in references/music/ (or a folder in it), or null: its `file`, or a Smash
 * Custom Music BRSTM with the song's id, or its game and title, in its name.
 */
function source(track) {
  if (track.file) return existsSync(join(LOCAL, track.file)) ? join(LOCAL, track.file) : null;
  const plain = (text) => slug(text).replace(/-/g, '');
  const [game, title] = [plain(track.game), plain(track.title)];
  const id = String(track.scm);
  const found = localFiles().find((file) => {
    const name = file.slice(file.lastIndexOf('/') + 1, file.length - extname(file).length);
    return extname(file).toLowerCase() === '.brstm' && (name.includes(id) || (plain(name).includes(game) && plain(name).includes(title)));
  });
  return found ? join(LOCAL, found) : null;
}

/** Every file under references/music/, as paths relative to it. */
function localFiles() {
  if (!existsSync(LOCAL)) return [];
  return readdirSync(LOCAL, { recursive: true })
    .map((file) => String(file).replace(/\\/g, '/'))
    .filter((file) => statSync(join(LOCAL, file)).isFile());
}

/** Where a track loops, in samples at RATE (or, `once`, that it doesn't: a jingle), and how that was known. */
function loopOf(track, file, samples) {
  const header = brstmLoop(readFileSync(file));
  if (header?.loops === false) return { start: 0, end: samples.length, once: true, how: 'BRSTM header' };
  if (header) {
    return { start: Math.round((header.start / header.rate) * RATE), end: Math.min(samples.length, Math.round((header.end / header.rate) * RATE)), how: 'BRSTM header' };
  }
  if (track.loop) return { start: Math.round(track.loop.start * RATE), end: Math.round(track.loop.end * RATE), how: 'given' };
  const found = findLoop(samples, RATE);
  if (!found) {
    console.warn(`${track.title}: no repeat found, so the whole file loops. Give its \`loop\` if it isn't one.`);
    return { start: 0, end: samples.length, how: 'whole file' };
  }
  const doubt = found.match < DOUBTFUL ? ' ← DOUBTFUL, check it (or give its `loop`)' : '';
  return { start: found.start, end: found.end, how: `found: ${Math.round(found.match * 100)}% of ${found.checked.toFixed(1)} s repeat${doubt}` };
}

/** A BRSTM's loop (start and end in samples, at its rate), from its header, or `loops: false`; null for other files. */
function brstmLoop(bytes) {
  if (bytes.length < 0x40 || bytes.toString('latin1', 0, 4) !== 'RSTM') return null;
  const little = bytes.readUInt16BE(4) === 0xfffe;
  const u32 = (at) => (little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at));
  const u16 = (at) => (little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at));
  const head = u32(0x10);
  if (bytes.toString('latin1', head, head + 4) !== 'HEAD') return null;
  // The first part of HEAD (its offset after the chunk's 8-byte header): codec, loop flag, channels,
  // padding, the rate (16-bit), padding, the loop's start, the samples (the loop's end).
  const info = head + 8 + u32(head + 0x0c);
  if (bytes[info + 1] !== 1) return { loops: false };
  return { rate: u16(info + 4), start: u32(info + 8), end: u32(info + 12) };
}

/** A file's audio, as ffmpeg decodes it: mono, RATE Hz. */
function decode(file) {
  const run = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (run.status !== 0) throw new Error(`ffmpeg can't read ${file} (${run.error?.message ?? run.stderr.toString().trim()})`);
  const bytes = run.stdout;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function ffmpeg(args) {
  const run = spawnSync(FFMPEG, args, { stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`ffmpeg failed (${run.error?.message ?? `exit ${run.status}`})`);
}

/**
 * A track as it's bundled: up to its loop's end, then the loop's start again for TAIL_S (a jingle:
 * whole), times `gain`, its peaks limited. The loop is limited as it plays after the first time round
 * (from the third of four times through), so its end runs into its start with no jump in the gain.
 */
function levelled(samples, start, end, once, gain) {
  if (once) {
    const out = samples.slice(0, end).map((sample) => sample * gain);
    limit(out, PEAK);
    return out;
  }
  const loop = end - start;
  const played = new Float32Array(start + 4 * loop);
  played.set(samples.subarray(0, end));
  for (let pass = 1; pass < 4; pass++) played.set(samples.subarray(start, end), start + pass * loop);
  for (let i = 0; i < played.length; i++) played[i] *= gain;
  limit(played, PEAK);
  const steady = played.subarray(start + 2 * loop, start + 3 * loop);
  const tail = Math.min(loop, Math.round(TAIL_S * RATE));
  const out = new Float32Array(end + tail);
  out.set(played.subarray(0, start));
  out.set(steady, start);
  out.set(steady.subarray(0, tail), end);
  return out;
}

/**
 * A look-ahead peak limiter, in place: no sample goes past `ceiling`. Each sample's gain is the
 * average, over the ATTACK before it, of the lowest gain needed from there to ATTACK ahead (so it
 * ramps down before a peak and never lets one through), then eases back up over RELEASE.
 */
function limit(x, ceiling) {
  const n = x.length;
  const attack = Math.max(1, Math.round(ATTACK_S * RATE));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = Math.min(1, ceiling / Math.max(1e-9, Math.abs(x[i])));
  // The lowest need over [i, i + attack): a sliding minimum, through a queue of indices.
  const lowest = new Float32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[queue[tail - 1]] >= need[i]) tail--;
    queue[tail++] = i;
    if (queue[head] >= i + attack) head++;
    lowest[i] = need[queue[head]];
  }
  // Averaged over the attack before each sample, then released slowly.
  const rise = 1 - Math.exp(-1 / (RELEASE_S * RATE));
  let sum = 0;
  let gain = 1;
  for (let i = 0; i < n; i++) {
    sum += lowest[i] - (i >= attack ? lowest[i - attack] : 1);
    const target = (sum + attack) / attack;
    gain = Math.min(target, gain + (1 - gain) * rise);
    x[i] *= gain;
  }
}

function rms(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function peak(samples) {
  let max = 0;
  for (const sample of samples) max = Math.max(max, Math.abs(sample));
  return max || 1;
}

function db(level) {
  return 20 * Math.log10(level);
}

function seconds(samples) {
  return (samples / RATE).toFixed(3);
}

/** A name for a file: plain lowercase letters and digits, words joined by '-'. */
function slug(title) {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'track'
  );
}

/** official-music.ts, with the tracks made. */
function list(tracks) {
  const entry = (track) =>
    `{ url: '${track.url}', title: ${quote(`${track.title} (${track.game.replace(/^Pokémon /, '')})`)}, loopStart: ${round(track.loopStart)}, loopEnd: ${round(track.loopEnd)}${track.once ? ', once: true' : ''} }`;
  const lines = [
    '// Made by scripts/update-soundtracks.mjs (npm run update:soundtracks): change its TRACKS and run it again.',
    '',
    '/** An official track the app bundles (public/audio/music): its file, its name, and where its loop starts and ends (seconds). */',
    'export interface OfficialTrack {',
    '  url: string;',
    '  title: string;',
    '  loopStart: number;',
    '  loopEnd: number;',
    "  /** A jingle: played through once, then the soundtrack's menu track goes on. */",
    '  once?: boolean;',
    '}',
    '',
    "/** A soundtrack's music: the title screen's (before START), the menus' (taking turns), team preview's and a battle's end, won or lost. */",
    'export interface OfficialSoundtrack {',
    '  titleScreen: OfficialTrack | null;',
    '  menu: readonly OfficialTrack[];',
    '  preview: OfficialTrack | null;',
    '  victory: OfficialTrack | null;',
    '  defeat: OfficialTrack | null;',
    '}',
    '',
    "/** The soundtracks of official tracks (Settings > Sound > Soundtrack), besides the app's own themes. */",
    `export type OfficialSoundtrackId = ${SOUNDTRACKS.map((id) => `'${id}'`).join(' | ')};`,
    '',
    "/** Each soundtrack's tracks: one is offered once it has a menu track. */",
    'export const OFFICIAL_SOUNDTRACKS: Record<OfficialSoundtrackId, OfficialSoundtrack> = {',
  ];
  for (const id of SOUNDTRACKS) {
    const of = (role) => tracks.filter((track) => track.soundtrack === id && track.roles.includes(role));
    lines.push(`  ${id}: {`);
    for (const role of ROLES) {
      const found = of(role);
      if (role === 'menu') lines.push(found.length ? `    menu: [\n${found.map((track) => `      ${entry(track)},`).join('\n')}\n    ],` : '    menu: [],');
      else lines.push(`    ${role}: ${found[0] ? entry(found[0]) : 'null'},`);
    }
    lines.push('  },');
  }
  lines.push('};', '');
  lines.push("/** The official battle tracks: battles pick among them and Showdown's (BattleMusic), whatever the soundtrack. */");
  const battle = tracks.filter((track) => track.roles.includes('battle'));
  lines.push(battle.length ? `export const OFFICIAL_BATTLE_TRACKS: readonly OfficialTrack[] = [\n${battle.map((track) => `  ${entry(track)},`).join('\n')}\n];` : 'export const OFFICIAL_BATTLE_TRACKS: readonly OfficialTrack[] = [];');
  lines.push('');
  return lines.join('\n');
}

/** A TypeScript string, in single quotes unless it has one (as prettier writes it). */
function quote(text) {
  if (text.includes("'") && !text.includes('"')) return JSON.stringify(text);
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Seconds to the sample (24 kHz) and no further. */
function round(value) {
  return Number(value.toFixed(6));
}
