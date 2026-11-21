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
    files: () => staticFiles(),
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
  romfs['main.js'] = new Blob([await bundle(target.entry())]);
  let assetBytes = 0;
  for (const [name, source] of target.files()) {
    const bytes = fs.readFileSync(source);
    assetBytes += bytes.length;
    place(romfs, name, new Blob([bytes]));
  }

  const nacp = new NACP((await base.nacp.arrayBuffer()).slice(0));
  const suffix = engineName === DEFAULT_ENGINE ? '' : engineFile ? path.basename(engineFile, '.nro') : engineName;
  nacp.title = suffix ? `${target.title} (${suffix})` : target.title;
  nacp.author = AUTHOR;
  nacp.version = target.version;
  nacp.id = target.titleId;

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
  const imports = [path.join(root, 'native/app/main.ts'), path.join(browserDir, mains[0])];
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

async function bundle(entry) {
  const result = await esbuild.build({
    ...entry,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    write: false,
    minify: true,
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
