// Makes the battle music the app bundles, from Showdown's tracks, into public/audio/battle/<name>.ogg:
// mono, 24 kHz, Vorbis, cut just past each track's loop end (nothing after it ever plays).
//
//   npm run update:battle-music   (needs ffmpeg with libvorbis: on the PATH, or its path in FFMPEG)
//
// The console took 2–3.5 s to decode each of Showdown's stereo 44.1 kHz mp3s at launch, and a few
// more to download them (test-m2); these are a quarter of the samples and come with the app. Vorbis,
// not mp3: an mp3 encoder pads the start, which would move the loop points (BattleMusic's TRACKS,
// Showdown's own client's values, measured on the original files as decoded with the padding removed).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '../public/audio/battle');
const SOURCE = 'https://play.pokemonshowdown.com/audio';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const RATE = 24000;
/** Vorbis quality (−1 to 10): 2 is ~45 kb/s in mono at 24 kHz. */
const QUALITY = 2;
/** Kept past the loop's end, as BattleMusic keeps it (TAIL_S). */
const TAIL_S = 0.1;

/** The tracks and where their loops end (ms): the same as BattleMusic's TRACKS. */
const TRACKS = [
  { name: 'hgss-johto-trainer', loopEnd: 125086 },
  { name: 'bw-trainer', loopEnd: 110109 },
  { name: 'xy-trainer', loopEnd: 82469 },
  { name: 'sm-trainer', loopEnd: 89230 },
];

const work = mkdtempSync(join(tmpdir(), 'battle-music-'));
mkdirSync(OUTPUT, { recursive: true });
try {
  for (const { name, loopEnd } of TRACKS) {
    const response = await fetch(`${SOURCE}/${name}.mp3`);
    if (!response.ok) throw new Error(`${name}.mp3: HTTP ${response.status}`);
    const source = join(work, `${name}.mp3`);
    writeFileSync(source, Buffer.from(await response.arrayBuffer()));
    const target = join(OUTPUT, `${name}.ogg`);
    const args = ['-y', '-v', 'error', '-i', source, '-t', String(loopEnd / 1000 + TAIL_S), '-ac', '1', '-ar', String(RATE)];
    args.push('-c:a', 'libvorbis', '-q:a', String(QUALITY), '-map_metadata', '-1', target);
    const run = spawnSync(FFMPEG, args, { stdio: 'inherit' });
    if (run.status !== 0) throw new Error(`ffmpeg failed on ${name} (${run.error?.message ?? `exit ${run.status}`})`);
    console.log(`${name}.ogg: ${(statSync(target).size / 1024).toFixed(0)} KB`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
