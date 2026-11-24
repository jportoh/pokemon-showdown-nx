// Packages the app as a native Nintendo Switch homebrew app (.nro).
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
//   node scripts/build-nro.mjs --update-probe   the online updates probe (native/poc/update-probe.ts).
//   node scripts/build-nro.mjs --nro-probe      the in-app .nro update probe (native/poc/nro-probe.ts).
// Output: dist/nro/<name>.nro, to copy to the SD card under sdmc:/switch/. The app's build also
// writes its online update to dist/nro/update/ (docs/updates.md); `--baseline=<assets json>|none`
// replaces the baseline release named in native/baseline.json.

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
const browserDir = path.join(root, 'dist/pokemon-showdown-nx/browser');
// `--app-version=x.y.z` overrides package.json's version, e.g. to build a test online update.
/** The repository whose releases carry the online updates (CI sets GITHUB_REPOSITORY). */
const REPO = process.env.GITHUB_REPOSITORY || 'jportoh/pokemon-showdown-nx';
/** An asset pack is downloaded and checked in blocks this big (src/app/core/update). */
const PACK_BLOCK = 4 * 1024 * 1024;
const PACK_MAGIC = 'PSBPACK1';
const packageVersion = option('app-version') ?? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// Homebrew title ids outside Nintendo's application range (high byte 0x05, as homebrew forwarders use).
const TARGETS = {
  app: {
    output: 'pokemon-showdown.nro',
    title: 'Pokémon Showdown',
    version: packageVersion,
    titleId: 0x05f5d0c0de001000n,
    // Showdown's "o!" logo recoloured gold on the app's dark blue (docs/native.md); replace the file to change it.
    icon: path.join(root, 'native/icon.jpg'),
    entry: () => appEntry(),
    // main.js is the loader (native/loader/main.ts), the app goes in app.mjs: see docs/updates.md.
    loader: true,
    files: async () => [...staticFiles(), ...(await showdownSprites()), ...(await showdownCries()), ...(await showdownPokemonSprites()), ...(await renderedAudio())],
  },
  probe: {
    output: 'psb-native-x1.nro',
    title: 'PSB Native Probe',
    version: '0.0.1',
    titleId: 0x05f5d0c0de000000n,
    entry: () => ({ entryPoints: [path.join(root, 'native/poc/main.ts')] }),
    files: () => [['xy-trainer.ogg', path.join(root, 'public/audio/battle/xy-trainer.ogg')]],
  },
  // Can the app draw at 1080p when docked? (native/poc/res-probe.ts)
  resProbe: {
    output: 'psb-res-probe.nro',
    title: 'PSB Resolution Probe',
    version: '0.0.1',
    titleId: 0x05f5d0c0de000001n,
    entry: () => ({ entryPoints: [path.join(root, 'native/poc/res-probe.ts')] }),
    files: () => [],
  },
  // Can the app update its code online? (native/poc/update-probe.ts)
  updateProbe: {
    output: 'psb-update-probe.nro',
    title: 'PSB Update Probe',
    version: '0.0.1',
    titleId: 0x05f5d0c0de000003n,
    entry: () => ({ entryPoints: [path.join(root, 'native/poc/update-probe.ts')] }),
    files: () => [['update-probe-mod.js', path.join(root, 'native/poc/update-probe-mod.js')]],
  },
  // Can the app replace its own .nro? (native/poc/nro-probe.ts)
  nroProbe: {
    output: 'psb-nro-probe.nro',
    title: 'PSB NRO Probe',
    version: '0.0.1',
    titleId: 0x05f5d0c0de000004n,
    entry: () => ({
      entryPoints: [path.join(root, 'native/poc/nro-probe.ts')],
      define: { __PROBE_A_SHA__: JSON.stringify(sha256(probeBytes('a'))), __PROBE_B_SHA__: JSON.stringify(sha256(probeBytes('b'))) },
    }),
    files: () => [
      ['probe-a.bin', probeBytes('a')],
      ['probe-b.bin', probeBytes('b')],
    ],
  },
};

/** 1 MiB of bytes that are the same in every build (the .nro probe's RomFS files). */
function probeBytes(seed) {
  const blocks = [];
  for (let i = 0; i < 32768; i++) blocks.push(crypto.createHash('sha256').update(`${seed}${i}`).digest());
  return Buffer.concat(blocks);
}
const AUTHOR = 'pokemon-showdown-nx';

/** Which feature crashes the app on sleep and wake? `--sleep-probe=ws|wsplain|audio|pad` (native/poc/sleep-probe.ts). */
function sleepProbe(mode) {
  if (!['ws', 'wsplain', 'audio', 'pad'].includes(mode)) throw new Error(`Unknown sleep probe "${mode}" (ws, wsplain, audio, pad)`);
  return {
    output: `psb-sleep-${mode}.nro`,
    title: `PSB Sleep Probe (${mode})`,
    version: '0.0.1',
    titleId: 0x05f5d0c0de000002n,
    entry: () => ({ entryPoints: [path.join(root, 'native/poc/sleep-probe.ts')], define: { __SLEEP_MODE__: JSON.stringify(mode) } }),
    files: () => [],
  };
}

async function main() {
  const sleepMode = option('sleep-probe');
  const target = sleepMode
    ? sleepProbe(sleepMode)
    : process.argv.includes('--nro-probe')
      ? TARGETS.nroProbe
      : process.argv.includes('--update-probe')
      ? TARGETS.updateProbe
      : process.argv.includes('--res-probe')
      ? TARGETS.resProbe
      : process.argv.includes('--probe')
        ? TARGETS.probe
        : TARGETS.app;
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
  let assetBytes = 0;
  const assetHashes = [];
  /** The assets as they go in the RomFS (an online update's pack takes the changed ones). */
  const assets = new Map();
  const predecode = target === TARGETS.app ? await loadPngDecoder() : null;
  for (const [name, source] of files) {
    let bytes = Buffer.isBuffer(source) ? source : fs.readFileSync(source);
    if (predecode && PREDECODED.test(name)) bytes = predecode(bytes, name);
    if (predecode && DECODED_MUSIC.test(name)) bytes = await decodeMusic(bytes, name);
    assetBytes += bytes.length;
    assetHashes.push(`${name} ${sha256(bytes)}`);
    if (target.loader) assets.set(name, bytes);
    place(romfs, name, new Blob([bytes]));
  }
  let assetsId = null;
  if (target.loader) {
    // The fingerprint an online update must match to run on this .nro: the engine and every asset.
    assetsId = sha256(Buffer.from([sha256(engine), ...assetHashes.sort()].join('\n'))).slice(0, 16);
    const defines = { __PSB_VERSION__: JSON.stringify(target.version), __PSB_ASSETS_ID__: JSON.stringify(assetsId) };
    const app = await bundle({ ...target.entry(), define: defines }, bundledShowdownDefine(files));
    romfs['app.mjs'] = new Blob([app]);
    romfs['main.js'] = new Blob([await bundle({ entryPoints: [path.join(root, 'native/loader/main.ts')], define: defines })]);
    const index = assetIndex(target.version, sha256(engine), assetsId, assets);
    // The .nro's own list of its assets: the updater checks an update's against it.
    romfs['assets.json'] = new Blob([JSON.stringify(index)]);
    await writeUpdate(app, index, assets);
  } else {
    romfs['main.js'] = new Blob([await bundle(target.entry(), bundledShowdownDefine(files))]);
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
    // hbmenu's (and the forwarder's) icon: a 256x256 JPEG. The probe keeps the engine's.
    icon: target.icon ? new Blob([fs.readFileSync(target.icon)]) : base.icon,
    nacp: new Blob([new Uint8Array(nacp.buffer)]),
    romfs: await RomFS.encode(romfs),
  });
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, suffix ? target.output.replace(/.nro$/, `-${suffix}.nro`) : target.output);
  fs.writeFileSync(outPath, Buffer.from(await nro.arrayBuffer()));
  console.log(`Engine ${label}`);
  if (romfs['app.mjs']) console.log(`app.mjs ${(romfs['app.mjs'].size / 1024).toFixed(0)} KiB, version ${target.version}, assets id ${assetsId}`);
  console.log(`main.js ${(romfs['main.js'].size / 1024).toFixed(0)} KiB, assets ${(assetBytes / 1048576).toFixed(1)} MiB`);
  console.log(`NRO written to ${path.relative(root, outPath)} (${(nro.size / 1048576).toFixed(1)} MiB)`);
  console.log('Copy it to sdmc:/switch/ and open it from hbmenu in application mode (hold R on a game).');
}

/** Every asset's sha256 by its RomFS path, with the engine's and the build's fingerprint. */
function assetIndex(version, engine, assetsId, assets) {
  const files = {};
  for (const name of [...assets.keys()].sort()) files[name] = sha256(assets.get(name));
  return { version, engine, assetsId, files, packed: [] };
}

/**
 * The online update for this build (docs/updates.md), in dist/nro/update/:
 *
 *  - app-<version>.mjs: the app's code;
 *  - assets-<version>.json: every asset the code expects (path → sha256), and which come in the pack;
 *  - assets-<hash>.pack: the assets that differ from the baseline release's .nro (none when this build
 *    is the baseline), the ones a player with that .nro lacks;
 *  - update.json: the manifest (signed by scripts/sign-update.mjs).
 *
 * A .nro runs the update when each asset the code expects is in its RomFS with the same hash, or in
 * the pack, and its engine is the same.
 */
async function writeUpdate(app, index, assets) {
  const { version } = index;
  const dir = path.join(outDir, 'update');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const baseline = await loadBaseline(version);
  if (baseline && baseline.engine !== index.engine) {
    throw new Error(`The baseline ${baseline.version} has another engine: this release needs a new baseline (native/baseline.json, docs/updates.md).`);
  }
  const packed = baseline ? Object.keys(index.files).filter((name) => baseline.files[name] !== index.files[name]) : [];
  const file = `app-${version}.mjs`;
  fs.writeFileSync(path.join(dir, file), app);
  const indexFile = `assets-${version}.json`;
  const indexBytes = Buffer.from(JSON.stringify({ ...index, packed }));
  fs.writeFileSync(path.join(dir, indexFile), indexBytes);
  const manifest = {
    version,
    file,
    size: app.length,
    sha256: sha256(app),
    engine: index.engine,
    assetsId: index.assetsId,
    index: { file: indexFile, size: indexBytes.length, sha256: sha256(indexBytes) },
  };
  if (packed.length) {
    const pack = buildPack(packed, assets);
    const packFile = `assets-${sha256(pack).slice(0, 16)}.pack`;
    fs.writeFileSync(path.join(dir, packFile), pack);
    const blocks = [];
    for (let at = 0; at < pack.length; at += PACK_BLOCK) blocks.push(sha256(pack.subarray(at, at + PACK_BLOCK)));
    manifest.pack = { file: packFile, size: pack.length, blockSize: PACK_BLOCK, blocks };
    console.log(`Asset pack over the baseline ${baseline.version}: ${packed.length} files, ${(pack.length / 1048576).toFixed(1)} MiB (${packFile})`);
  } else {
    console.log(baseline ? `No asset differs from the baseline ${baseline.version}: no pack.` : 'No baseline: this build is one (no pack).');
  }
  fs.writeFileSync(path.join(dir, 'update.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * An asset pack: PACK_MAGIC, the header's length (u32 LE), the header (JSON: each file's path, its
 * offset after the header and its size), then the files one after another. The loader reads files
 * out of it in place (native/loader/asset-pack.ts).
 */
function buildPack(names, assets) {
  let offset = 0;
  const entries = names.map((name) => {
    const entry = { path: name, offset, size: assets.get(name).length };
    offset += entry.size;
    return entry;
  });
  const header = Buffer.from(JSON.stringify({ files: entries }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return Buffer.concat([Buffer.from(PACK_MAGIC, 'latin1'), length, header, ...names.map((name) => assets.get(name))]);
}

/**
 * The baseline release's asset list (native/baseline.json names its tag), or null when there is
 * none or this release is it. `--baseline=<file>` reads a local one instead, `--baseline=none` builds
 * without. Kept in dist/nro-cache once downloaded (a release never changes).
 */
async function loadBaseline(version) {
  const forced = option('baseline');
  if (forced === 'none') return null;
  if (forced) return JSON.parse(fs.readFileSync(forced, 'utf8'));
  const { tag } = JSON.parse(fs.readFileSync(path.join(root, 'native/baseline.json'), 'utf8'));
  if (!tag || tag === `v${version}`) return null;
  const name = `assets-${tag.replace(/^v/, '')}.json`;
  const cached = path.join(cacheDir, 'baselines', name);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, 'utf8'));
  const url = `https://github.com/${REPO}/releases/download/${tag}/${name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The baseline's asset list ${url}: HTTP ${response.status} (or build with --baseline=none)`);
  const text = await response.text();
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, text);
  return JSON.parse(text);
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
 * Showdown's images every session loads, bundled (native/app/bundled-showdown.ts reads them from the
 * RomFS in place of the network): the item sheet and every trainer avatar the app knows by name.
 * Downloaded once into dist/nro-cache/showdown and refreshed when older than a week (the item sheet
 * grows with new items).
 */
const SHOWDOWN = 'https://play.pokemonshowdown.com/';
const SHOWDOWN_LOCAL = 'showdown/';
const SPRITES_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

async function showdownSprites() {
  const { AVATAR_ALIASES } = await importTs('src/app/features/trainer-card/data/avatar-aliases.ts');
  const avatars = [...new Set(['unknown', ...Object.values(AVATAR_ALIASES)])].filter((name) => !name.includes('.') && !name.startsWith('#')); // Custom ones live elsewhere.
  const wanted = ['itemicons-sheet.png', ...avatars.map((name) => `trainers/${name}.png`)].map((name) => `sprites/${name}`);
  return cachedShowdownFiles(wanted, SPRITES_MAX_AGE_MS);
}

/**
 * Every Pokémon's cry (Showdown's mp3s, ~1250 files, ~11 MiB), bundled like the sprites: BattleCries
 * fetched the two teams' together when a battle started, and their TLS handshakes held the console's
 * main thread ~0.6–0.7 s (test x13). The list comes from Showdown's directory index; a cry once
 * downloaded is kept (they don't change), and without the index the cached ones are used.
 */
const CRIES_DIR = 'audio/cries/';

async function showdownCries() {
  return cachedShowdownFiles(await showdownDirectory(CRIES_DIR, '.mp3'), Infinity);
}

/**
 * The Pokémon sprites battles show outside the bundled Champions sheets, bundled like the cries: each
 * was its own https request, so a battle's dozen sprites cost ~65 ms of handshake apiece on the
 * console's main thread. Black/White's (every species: ~2650 files once the sheets' ~700 are left
 * out, ~2.5 MiB) for any format with species outside Champions (Gen 9 Random Battle…), and
 * Ruby/Sapphire's (~845 files) and Diamond/Pearl's (~1360 files), under 1 MiB each, for Gen 3 and
 * Gen 4. A copy once downloaded is kept; new species come with Showdown's directory index.
 */
const SPRITE_DIRS = ['sprites/gen5/', 'sprites/gen5-back/', 'sprites/gen3/', 'sprites/gen3-back/', 'sprites/gen4/', 'sprites/gen4-back/'];
const SPRITE_MAP = path.join(root, 'src/app/core/dex/sprite-sheets.json');

async function showdownPokemonSprites() {
  // The sheets' sprites never reach Showdown's URLs (gl-sprites.ts draws them from the sheets).
  const map = JSON.parse(fs.readFileSync(SPRITE_MAP, 'utf8'));
  const inSheets = new Set([...Object.keys(map.front).map((id) => `sprites/gen5/${id}.png`), ...Object.keys(map.back).map((id) => `sprites/gen5-back/${id}.png`)]);
  const listed = (await Promise.all(SPRITE_DIRS.map((dir) => showdownDirectory(dir, '.png')))).flat();
  return cachedShowdownFiles(listed.filter((file) => !inSheets.has(file)), Infinity);
}

/**
 * The `extension` files of one of Showdown's directories (paths relative to its root), from its
 * directory index; without the index, the ones already in the cache.
 */
async function showdownDirectory(dir, extension) {
  let names;
  try {
    const response = await fetch(SHOWDOWN + dir);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const pattern = new RegExp(`href="\\./([^"/]+\\${extension})"`, 'g');
    names = [...(await response.text()).matchAll(pattern)].map((match) => decodeURIComponent(match[1]));
    if (!names.length) throw new Error(`no ${extension} in the index`);
  } catch (error) {
    const cached = path.join(cacheDir, 'showdown', dir);
    names = fs.existsSync(cached) ? fs.readdirSync(cached).filter((name) => name.endsWith(extension)) : [];
    console.warn(`Showdown's ${dir} index failed (${error instanceof Error ? error.message : error}): bundling the ${names.length} cached files`);
  }
  return [...new Set(names)].map((name) => dir + name);
}

/** Showdown's files (paths relative to its root), downloaded into dist/nro-cache/showdown unless a copy younger than maxAgeMs is there. */
async function cachedShowdownFiles(wanted, maxAgeMs) {
  const cache = path.join(cacheDir, 'showdown');
  const list = [];
  const missing = [];
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const relative = wanted[next++];
      const file = path.join(cache, relative);
      const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < maxAgeMs;
      if (!fresh) {
        try {
          const response = await fetch(SHOWDOWN + relative.split('/').map(encodeURIComponent).join('/'));
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
  if (missing.length) console.warn(`Showdown files not bundled (${missing.length}): ${missing.slice(0, 5).join(', ')}`);
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

/** The bundled Showdown files' paths, for native/app/bundled-showdown.ts. */
function bundledShowdownDefine(files) {
  const paths = files.filter(([name]) => name.startsWith(SHOWDOWN_LOCAL)).map(([name]) => name.slice(SHOWDOWN_LOCAL.length));
  return { __PSB_BUNDLED_SHOWDOWN__: JSON.stringify(paths) };
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
    define: { ...entry.define, ...define },
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
