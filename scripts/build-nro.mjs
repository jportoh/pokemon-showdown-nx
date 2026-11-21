// Packages a native Nintendo Switch homebrew app (.nro) that runs without Brewser.
//
// The engine is nx.js_extended (MIT, natureglass/nx.js_extended): V8 + Skia + WebGL2 + Web Audio,
// published as a prebuilt `nxjs.nro`. An nx.js app is that engine's code segment plus a RomFS holding
// `main.js` (and any assets), an icon and NACP metadata (title, author, version, title id). So no
// devkitPro or C toolchain is needed: we download the pinned engine once, bundle our entry with
// esbuild and splice the parts together.
//
// Usage: `npm run build:nro` (builds the phase 0 probe, native/poc/main.ts).
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

// The engine, pinned by version and checksum (the release asset's sha256 digest).
const ENGINE = {
  version: 'v1.0.0-beta.6',
  url: 'https://github.com/natureglass/nx.js_extended/releases/download/v1.0.0-beta.6/nxjs.nro',
  sha256: '40b9f7a26339866917010add7589adbab477e10b554657ebb9a5d81f0dac09b6',
};
const cacheDir = path.join(root, 'dist/nro-cache');
const outDir = path.join(root, 'dist/nro');

const APP = {
  entry: path.join(root, 'native/poc/main.ts'),
  tsconfig: path.join(root, 'native/tsconfig.json'),
  output: 'psb-native-x1.nro',
  title: 'PSB Native Probe',
  author: 'pokemon-showdown-brewser',
  version: '0.0.1',
  // Homebrew title id outside Nintendo's application range (high byte 0x05, like Brewser's forwarders).
  titleId: 0x05f5d0c0de000000n,
  // Extra RomFS files: [path inside romfs, source file].
  assets: [['xy-trainer.ogg', path.join(root, 'public/audio/battle/xy-trainer.ogg')]],
};

async function main() {
  typecheck();
  const engine = await loadEngine();
  const base = await NRO.decode(new Blob([engine]));
  if (!base.nacp) throw new Error('The engine NRO has no NACP section.');

  const romfs = base.romfs ? await RomFS.decode(base.romfs) : Object.create(null);
  romfs['main.js'] = new Blob([await bundle(APP.entry)]);
  for (const [name, source] of APP.assets) romfs[name] = new Blob([fs.readFileSync(source)]);

  const nacp = new NACP((await base.nacp.arrayBuffer()).slice(0));
  nacp.title = APP.title;
  nacp.author = APP.author;
  nacp.version = APP.version;
  nacp.id = APP.titleId;

  const nro = await NRO.encode({
    data: base.data,
    icon: base.icon, // The engine's default icon for now (phase 3 adds our own).
    nacp: new Blob([new Uint8Array(nacp.buffer)]),
    romfs: await RomFS.encode(romfs),
  });
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, APP.output);
  fs.writeFileSync(outPath, Buffer.from(await nro.arrayBuffer()));
  console.log(`Engine nx.js_extended ${ENGINE.version}`);
  console.log(`NRO written to ${path.relative(root, outPath)} (${(nro.size / 1048576).toFixed(1)} MiB)`);
  console.log('Copy it to sdmc:/switch/ and open it from hbmenu in application mode (hold R on a game).');
}

function typecheck() {
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', APP.tsconfig], { stdio: 'inherit' });
}

async function loadEngine() {
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
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    write: false,
    minify: false,
    legalComments: 'none',
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
