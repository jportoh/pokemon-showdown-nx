// Packages the app as a native Nintendo Switch homebrew app (.nro) that runs without Brewser.
//
// The engine is nx.js_extended (MIT, natureglass/nx.js_extended): V8 + Skia + WebGL2 + Web Audio,
// published as a prebuilt `nxjs.nro`. An nx.js app is that engine's code segment plus a RomFS holding
// `main.js` (and any assets), an icon and NACP metadata (title, author, version, title id). So no
// devkitPro or C toolchain is needed: we download the pinned engine once, bundle our entry with
// esbuild and splice the parts together. See docs/native.md.
//
// Usage:
//   npm run build:nro         the app: `ng build`, then this script bundles Angular's output after the
//                             native shims (native/app) and puts the static files in the RomFS.
//   npm run build:nro:probe   the phase 0 engine probe (native/poc/main.ts).
// Output: dist/nro/<name>.nro, to copy to the SD card under sdmc:/switch/.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as NRO from '@tootallnate/nro';
import * as RomFS from '@tootallnate/romfs';
import { NACP } from '@tootallnate/nacp';

const root = fileURLToPath(new URL('..', import.meta.url));

// The engine releases, pinned by version and checksum (the release asset's sha256 digest).
// `--engine=beta5` picks another one, and `--engine-file=<path.nro>` takes the engine of any nx.js
// NRO (to compare builds); either way the output's name and title say which.
const ENGINES = {
  beta6: {
    version: 'v1.0.0-beta.6',
    url: 'https://github.com/natureglass/nx.js_extended/releases/download/v1.0.0-beta.6/nxjs.nro',
    sha256: '40b9f7a26339866917010add7589adbab477e10b554657ebb9a5d81f0dac09b6',
  },
  beta5: {
    version: 'v1.0.0-beta.5',
    url: 'https://github.com/natureglass/nx.js_extended/releases/download/v1.0.0-beta.5/nxjs.nro',
    sha256: 'a45bb9c42b046a838750f7e8a7072ccfb89dda349e15ab6563d3d720978ee816',
  },
};
const DEFAULT_ENGINE = 'beta6';
// Files of the engine's own RomFS that apps keep (the console font and the runtime's source map).
const ENGINE_FILES = ['GeistMono.ttf', 'runtime.js.map'];
const cacheDir = path.join(root, 'dist/nro-cache');
const outDir = path.join(root, 'dist/nro');
const browserDir = path.join(root, 'dist/pokemon-showdown-brewser/browser');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// Homebrew title ids outside Nintendo's application range (high byte 0x05, like Brewser's forwarders).
const TARGETS = {
  app: {
    output: 'pokemon-showdown.nro',
    title: 'Pokémon Showdown',
    version: packageVersion,
    titleId: 0x05f5d0c0de001000n,
    entry: () => appEntry(),
    files: async () => [...staticFiles(), ...(await showdownSprites()), ...(await renderedAudio())],
  },
  probe: {
    output: 'psb-native-x1.nro',
    title: 'PSB Native Probe',
    version: '0.0.1',
    titleId: 0x05f5d0c0de000000n,
    entry: () => ({ entryPoints: [path.join(root, 'native/poc/main.ts')] }),
    files: () => [['xy-trainer.ogg', path.join(root, 'public/audio/battle/xy-trainer.ogg')]],
  },
};
const AUTHOR = 'pokemon-showdown-brewser';

async function main() {
  const target = process.argv.includes('--probe') ? TARGETS.probe : TARGETS.app;
  const engineFile = option('engine-file');
  const engineName = engineFile ? 'file' : (option('engine') ?? DEFAULT_ENGINE);
  if (!engineFile && !ENGINES[engineName]) throw new Error(`Unknown engine "${engineName}" (${Object.keys(ENGINES).join(', ')})`);
  const label = engineFile ? path.basename(engineFile) : `nx.js_extended ${ENGINES[engineName].version}`;
  typecheck();
  const engine = engineFile ? fs.readFileSync(engineFile) : await loadEngine(ENGINES[engineName]);
  const base = await NRO.decode(new Blob([engine]));
  if (!base.nacp) throw new Error('The engine NRO has no NACP section.');

  const engineRomfs = base.romfs ? await RomFS.decode(base.romfs) : {};
  const romfs = Object.create(null);
  for (const name of ENGINE_FILES) if (engineRomfs[name] instanceof Blob) romfs[name] = engineRomfs[name];
  const files = await target.files();
  romfs['main.js'] = new Blob([await bundle(target.entry(), bundledSpritesDefine(files))]);
  let assetBytes = 0;
  const predecode = target === TARGETS.app ? await loadPngDecoder() : null;
  for (const [name, source] of files) {
    let bytes = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
    if (predecode && PREDECODED.test(name)) bytes = predecode(bytes, name);
    if (predecode && DECODED_MUSIC.test(name)) bytes = await decodeMusic(bytes, name);
    assetBytes += bytes.length;
    place(romfs, name, new Blob([bytes]));
  }

  const nacp = new NACP((await base.nacp.arrayBuffer()).slice(0));
  const suffix = engineName === DEFAULT_ENGINE ? '' : engineFile ? path.basename(engineFile, '.nro') : engineName;
  nacp.title = suffix ? `${target.title} (${suffix})` : target.title;
  nacp.author = AUTHOR;
  nacp.version = target.version;
  nacp.id = target.titleId;
  // No user account: the app keeps its data in files on the SD card (device-storage), not in a user's
  // save data. nx.js keeps localStorage in a user's save data and shows the "Who is playing?" picker
  // on its first use (test x10); without save data in the NACP it doesn't, and dom-shim gives the app
  // an in-memory localStorage instead.
  nacp.startupUserAccount = 0;
  nacp.userAccountSaveDataSize = 0n;
  nacp.userAccountSaveDataJournalSize = 0n;

  const nro = await NRO.encode({
    data: base.data,
    icon: base.icon, // The engine's default icon for now (phase 3 adds our own).
    nacp: new Blob([new Uint8Array(nacp.buffer)]),
    romfs: await RomFS.encode(romfs),
  });
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, suffix ? target.output.replace(/.nro$/, `-${suffix}.nro`) : target.output);
  fs.writeFileSync(outPath, Buffer.from(await nro.arrayBuffer()));
  console.log(`Engine ${label}`);
  console.log(`main.js ${(romfs['main.js'].size / 1024).toFixed(0)} KiB, assets ${(assetBytes / 1048576).toFixed(1)} MiB`);
  console.log(`NRO written to ${path.relative(root, outPath)} (${(nro.size / 1048576).toFixed(1)} MiB)`);
  console.log('Copy it to sdmc:/switch/ and open it from hbmenu in application mode (hold R on a game).');
}

/** Angular's production build, run after the native shims (they must exist before any app code). */
function appEntry() {
  if (!fs.existsSync(browserDir)) throw new Error(`${path.relative(root, browserDir)} not found. Run "ng build" first.`);
  const mains = fs.readdirSync(browserDir).filter((file) => /^main-.*\.js$/.test(file));
  if (mains.length !== 1) throw new Error(`Expected one main-*.js in ${browserDir}, found ${mains.length}.`);
  const imports = [path.join(root, 'native/app/main.ts'), path.join(browserDir, mains[0]), path.join(root, 'native/app/after-app.ts')];
  return {
    stdin: {
      contents: imports.map((file) => `import ${JSON.stringify(file.split(path.sep).join('/'))};`).join('\n'),
      resolveDir: root,
      sourcefile: 'native-entry.js',
      loader: 'js',
    },
  };
}

/** The build's static files (sprites, audio…), at the same paths: relative URLs resolve to romfs:/. */
function staticFiles() {
  const bundled = /^(index\.html|main-.*\.js|chunk-.*\.js|styles-.*\.css|.*\.map|favicon\.ico)$/;
  const list = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(browserDir, full).split(path.sep).join('/');
      if (entry.isDirectory()) walk(full);
      else if (!bundled.test(relative)) list.push([relative, full]);
    }
  };
  walk(browserDir);
  return list;
}

/**
 * The big sprite sheets go in already decoded (src/app/core/gl/png-decode.ts, decodeRaw): decoding
 * them in JavaScript held the console's main thread for seconds (test x8). Same path, so the app's
 * URLs don't change; it tells the raw format by its header.
 */
const PREDECODED = /^(sprites\/champions-\d+|showdown\/sprites\/itemicons-sheet)\.png$/;

async function loadPngDecoder() {
  const module = await importTs('src/app/core/gl/png-decode.ts');
  return (bytes, name) => {
    const image = module.decodePng(new Uint8Array(bytes));
    if (!image) throw new Error(`${name}: the app's PNG decoder can't read it`);
    const header = Buffer.alloc(16);
    header.write(module.RAW_MAGIC, 0, 'latin1');
    header.writeUInt32LE(image.width, 8);
    header.writeUInt32LE(image.height, 12);
    return Buffer.concat([header, image.pixels]);
  };
}

/**
 * Showdown's images every session loads, bundled (native/app/bundled-sprites.ts reads them from the
 * RomFS in place of the network): the item sheet and every trainer avatar the app knows by name.
 * Downloaded once into dist/nro-cache/showdown and refreshed when older than a week (the item sheet
 * grows with new items).
 */
const SHOWDOWN_SPRITES = 'https://play.pokemonshowdown.com/sprites/';
const SHOWDOWN_LOCAL = 'showdown/sprites/';
const SHOWDOWN_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

async function showdownSprites() {
  const { AVATAR_ALIASES } = await importTs('src/app/features/trainer-card/data/avatar-aliases.ts');
  const avatars = [...new Set(['unknown', ...Object.values(AVATAR_ALIASES)])].filter((name) => !name.includes('.') && !name.startsWith('#')); // Custom ones live elsewhere.
  const wanted = ['itemicons-sheet.png', ...avatars.map((name) => `trainers/${name}.png`)];
  const cache = path.join(cacheDir, 'showdown');
  const list = [];
  const missing = [];
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const relative = wanted[next++];
      const file = path.join(cache, relative);
      const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < SHOWDOWN_MAX_AGE_MS;
      if (!fresh) {
        try {
          const response = await fetch(SHOWDOWN_SPRITES + relative.split('/').map(encodeURIComponent).join('/'));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          // An old copy beats none; without one the app loads it from Showdown as before.
          if (!fs.existsSync(file)) {
            missing.push(`${relative} (${error instanceof Error ? error.message : error})`);
            continue;
          }
        }
      }
      list.push([SHOWDOWN_LOCAL + relative, file]);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (missing.length) console.warn(`Showdown sprites not bundled (${missing.length}): ${missing.slice(0, 5).join(', ')}`);
  return list.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * The sounds and themes the app synthesizes, synthesized here with the same code
 * (src/app/core/audio/synth-pieces.ts) and stored as raw audio (raw-audio.ts), which AudioEngine
 * reads on the native .nro: synthesizing them took seconds of the console's CPU while loading.
 */
const RENDERED_RATE = 48000;

async function renderedAudio() {
  const pieces = await importTs('src/app/core/audio/synth-pieces.ts');
  const { encodeRawAudio, RENDERED_AUDIO_DIR } = await importTs('src/app/core/audio/raw-audio.ts');
  return pieces.SYNTH_PIECES.map((piece) => {
    const samples = new Float32Array(Math.ceil(pieces.pieceSeconds(piece) * RENDERED_RATE));
    for (const steps = pieces.renderPiece(piece, samples, RENDERED_RATE); !steps.next().done; );
    return [`${RENDERED_AUDIO_DIR}${piece}.pcm`, Buffer.from(encodeRawAudio(samples, RENDERED_RATE))];
  });
}

/**
 * The battle music, decoded here into raw audio at the same paths (AudioEngine.decode tells it by
 * its header): the console decoded each track on a worker, but handing the result over held its main
 * thread for 300–550 ms at a time (test x11). Mono 24 kHz as the files are, so ~20 MiB for the four.
 */
const DECODED_MUSIC = /^audio\/battle\/.*\.ogg$/;

async function decodeMusic(bytes, name) {
  const [{ OggVorbisDecoder }, { encodeRawAudio }] = await Promise.all([
    import('@wasm-audio-decoders/ogg-vorbis'),
    importTs('src/app/core/audio/raw-audio.ts'),
  ]);
  const decoder = new OggVorbisDecoder();
  await decoder.ready;
  try {
    const { channelData, sampleRate, errors } = await decoder.decodeFile(new Uint8Array(bytes));
    if (errors.length || !channelData.length) throw new Error(`${name}: can't decode it (${errors[0]?.message ?? 'no audio'})`);
    // Mono: the channels' average (the tracks are mono already).
    const mono = channelData.length === 1 ? channelData[0] : channelData[0].map((_, i) => channelData.reduce((sum, channel) => sum + channel[i], 0) / channelData.length);
    return Buffer.from(encodeRawAudio(mono, sampleRate));
  } finally {
    decoder.free();
  }
}

/** The bundled Showdown sprites' paths, for native/app/bundled-sprites.ts. */
function bundledSpritesDefine(files) {
  const paths = files.filter(([name]) => name.startsWith(SHOWDOWN_LOCAL)).map(([name]) => name.slice(SHOWDOWN_LOCAL.length));
  return { __PSB_BUNDLED_SPRITES__: JSON.stringify(paths) };
}

/** One of the app's modules (TypeScript without path aliases), bundled and loaded in Node. */
async function importTs(relative) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, relative)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'warning',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

function place(tree, relative, blob) {
  const parts = relative.split('/');
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || node[part] instanceof Blob) node[part] = Object.create(null);
    node = node[part];
  }
  node[parts[parts.length - 1]] = blob;
}

function typecheck() {
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', path.join(root, 'native/tsconfig.json')], { stdio: 'inherit' });
}

function option(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function loadEngine(ENGINE) {
  const cached = path.join(cacheDir, `nxjs-${ENGINE.version}.nro`);
  if (fs.existsSync(cached) && sha256(fs.readFileSync(cached)) === ENGINE.sha256) return fs.readFileSync(cached);
  console.log(`Downloading nx.js_extended ${ENGINE.version}…`);
  const response = await fetch(ENGINE.url);
  if (!response.ok) throw new Error(`Engine download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== ENGINE.sha256) throw new Error(`Engine checksum mismatch: got ${digest}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, bytes);
  return bytes;
}

async function bundle(entry, define = {}) {
  const result = await esbuild.build({
    ...entry,
    define,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    write: false,
    minify: process.env.NRO_MINIFY !== '0',
    legalComments: 'none',
    logLevel: 'warning',
  });
  return result.outputFiles[0].contents;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
