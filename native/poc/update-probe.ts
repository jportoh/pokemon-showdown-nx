// Online updates probe (test u1): can the .nro download a new version of the app's code, keep it on
// the SD card and run it at the next start? Checks, on the console, each piece such an updater needs:
//
//  1. Engine: the Switch.* file API (rename, remove, readdir…), crypto.subtle, DecompressionStream.
//  2. Loading code at run time: dynamic import() from the RomFS (control), from an absolute sdmc:
//     path (with and without a relative import inside), from a data: URL and a blob: URL, and running
//     a script with new Function / indirect eval.
//  3. Network: a GitHub release download (302 to release-assets.githubusercontent.com), the GitHub
//     API (latest release as JSON) and a 655 KiB ES module from jsDelivr.
//  4. That module end to end: SHA-256 (crypto.subtle and plain JS), written to the SD card, read back,
//     fetched from sdmc:, imported, and its exports checked.
//  5. Signatures: Ed25519 and ECDSA P-256 verification with crypto.subtle (test vectors from Node).
//  6. On X: a 27 MiB download (another nx.js .nro) streamed in chunks and written to the SD card,
//     with throughput and memory.
//
// Every step logs how long it took and the worst frame while it ran (a frame over ~17 ms is a
// stutter). Results go on screen and to sdmc:/switch/pokemon-showdown-nx/update-probe.log.
// Buttons: A runs the checks again, X the big download, + exits.

const W = 1280;
const H = 720;
const SD_DIR = 'sdmc:/switch/pokemon-showdown-nx/';
const WORK_DIR = `${SD_DIR}update-probe/`;
const LOG_PATH = `${SD_DIR}update-probe.log`;

const GITHUB_ASSET = 'https://github.com/cli/cli/releases/download/v2.40.0/gh_2.40.0_checksums.txt';
const GITHUB_API = 'https://api.github.com/repos/natureglass/nx.js_extended/releases/latest';
const MODULE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const MODULE_SHA256 = '3e690ac7d180b0aadf0891bea39eec643e29e2d3e75c99b18689518665f69ba6';
const BIG_URL = 'https://github.com/natureglass/nx.js_extended/releases/download/WebGL/canvas-webgl.nro';

// Signed by Node (crypto.sign) with throwaway keys: the message, raw public keys and signatures.
const SIGNED_MESSAGE = 'psb update manifest v1';
const ED25519 = {
  key: 'edWDheNX3gsNnpVRuwpJ94wijGYe4GR/hAbhLFot/5M=',
  sig: 'bpH7wiKqwEQOqCKnqARxZQIfjGYtCwV6oZi3/RscKa9eX7VonnE9PGXALkH+6Wu4nfHZc58bdpR5fZejI0+KDw==',
};
const P256 = {
  key: 'BOTC7M/0VcPrBthlxp0PGOjDXhsCERTErFSz5l4Jc7QJCQy9mQ1haLVdQ9a+NtS+4XBYfDbDhuh+BIwtlVjYnxs=',
  sig: 'spCzjpjAFP0tQ21XmuBdu/cLW0cldgX49Ct0ON5y+4L9gaxUTsmDt9305O9+8OCgSAdx1/wd3yGCeeyVQmiMsQ==',
};

interface ProbeSwitch extends NxSwitch {
  memoryUsage?: () => { usedHeapSize?: number; externalMemory?: number; nativeHeapUsed?: number; nativeHeapFree?: number };
}

type Status = 'wait' | 'ok' | 'fail' | 'info';
interface Check {
  status: Status;
  detail: string;
}

const nx = Switch as ProbeSwitch;
const nxTable = Switch as unknown as Record<string, unknown>;
const checks = new Map<string, Check>();
const startedAt = Date.now();
let dirty = true;
let running = false;

// ---------------------------------------------------------------------------------------------
// Log, checks and the worst frame while a step runs
// ---------------------------------------------------------------------------------------------

function log(line: string): void {
  const stamp = ((Date.now() - startedAt) / 1000).toFixed(2).padStart(7);
  try {
    nx.appendFileSync(LOG_PATH, `[${stamp}] ${line}\n`);
  } catch {
    // Best effort: the screen shows everything too.
  }
}

function report(name: string, status: Status, detail: string): void {
  checks.set(name, { status, detail });
  dirty = true;
  log(`${name}: ${status.toUpperCase()} ${detail}`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

globalThis.addEventListener('error', (event) => {
  report('Uncaught', 'fail', describeError((event as ErrorEvent).error ?? (event as ErrorEvent).message));
});
globalThis.addEventListener('unhandledrejection', (event) => {
  report('Unhandled', 'fail', describeError((event as PromiseRejectionEvent).reason));
});

/** The longest frame since the last reset, kept by the frame loop. */
let stepWorstFrame = 0;

/** Runs one step, reporting its time and the worst frame while it ran. */
async function step(name: string, body: () => Promise<string> | string): Promise<boolean> {
  report(name, 'wait', '…');
  await nextFrame();
  stepWorstFrame = 0;
  const started = performance.now();
  try {
    const detail = await body();
    report(name, 'ok', `${detail} · ${ms(performance.now() - started)} · worst frame ${ms(stepWorstFrame)}`);
    return true;
  } catch (error) {
    report(name, 'fail', `${describeError(error)} · ${ms(performance.now() - started)}`);
    return false;
  }
}

const ms = (value: number) => `${value.toFixed(0)} ms`;
const kib = (bytes: number) => `${(bytes / 1024).toFixed(0)} KiB`;
const mib = (bytes: number | undefined) => (bytes === undefined ? '?' : `${(bytes / 1048576).toFixed(1)} MiB`);
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** import() with a run-time URL; esbuild leaves a non-literal import() alone. */
const dynamicImport = (url: string): Promise<Record<string, unknown>> => import(url);

function writeText(path: string, text: string): void {
  nx.writeFileSync(path, text);
}

function readBytes(path: string): ArrayBuffer {
  const raw = nx.readFileSync(path);
  if (!raw) throw new Error(`${path} not found`);
  return raw;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Text(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// ---------------------------------------------------------------------------------------------
// SHA-256 in plain JS, in case the engine has no crypto.subtle
// ---------------------------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Js(data: ArrayBuffer): string {
  const input = new Uint8Array(data);
  const length = input.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(input);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length << 3) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((word) => word.toString(16).padStart(8, '0')).join('');
}

// ---------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------

function probeEngine(): void {
  const switchKeys = Object.keys(nxTable).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(nxTable) ?? {}));
  const names = [...new Set(switchKeys)].filter((name) => name !== 'constructor').sort();
  log(`Switch.* = ${names.join(', ')}`);
  const fileApi = ['readFileSync', 'writeFileSync', 'appendFileSync', 'removeSync', 'renameSync', 'readDirSync', 'statSync', 'mkdirSync', 'file', 'readFile', 'writeFile', 'remove', 'rename', 'stat', 'readDir'];
  report('Switch file API', 'info', fileApi.map((name) => `${name} ${typeof nxTable[name] === 'function' ? 'yes' : 'no'}`).join(' · '));
  const restart = ['exit', 'reload', 'restart', 'relaunch', 'appletType', 'version', 'entrypoint'].filter((name) => name in nxTable);
  report('Switch other', 'info', `has: ${restart.join(', ') || 'none'} · ${names.length} names in log`);

  const subtle = globalThis.crypto?.subtle;
  report(
    'Web APIs',
    'info',
    [
      `crypto ${typeof globalThis.crypto !== 'undefined'}`,
      `subtle ${typeof subtle !== 'undefined'}`,
      `digest ${typeof subtle?.digest === 'function'}`,
      `verify ${typeof subtle?.verify === 'function'}`,
      `DecompressionStream ${typeof (globalThis as unknown as Record<string, unknown>)['DecompressionStream'] !== 'undefined'}`,
      `createObjectURL ${typeof URL.createObjectURL === 'function'}`,
      `ReadableStream ${typeof ReadableStream !== 'undefined'}`,
    ].join(' · '),
  );
  report('Engine', 'info', `${navigator.userAgent} · import.meta.url ${import.meta.url}`);
}

/** The first SD-card way to import a module that worked, used for the big module. */
let sdImport: ((path: string, text: string) => Promise<Record<string, unknown>>) | null = null;

async function probeCodeLoading(): Promise<void> {
  try {
    nx.mkdirSync(WORK_DIR);
  } catch {
    // Already there.
  }
  const plain = `export const answer = 42; globalThis.__psbProbeRuns = (globalThis.__psbProbeRuns || 0) + 1;`;
  writeText(`${WORK_DIR}plain.mjs`, plain);
  writeText(`${WORK_DIR}dep.mjs`, `export const dep = 2;`);
  writeText(`${WORK_DIR}with-dep.mjs`, `import { dep } from './dep.mjs'; export const answer = 40 + dep;`);
  const stamp = Date.now(); // A query defeats the module cache when A runs the checks again.

  const expect42 = (module: Record<string, unknown>) => {
    if (module['answer'] !== 42) throw new Error(`answer = ${String(module['answer'])}`);
    return 'answer = 42';
  };

  await step('import romfs', async () => expect42(await dynamicImport('./update-probe-mod.js')));
  const sdPlain = await step('import sdmc:', async () => expect42(await dynamicImport(`${WORK_DIR}plain.mjs?${stamp}`)));
  if (!sdPlain) await step('import sdmc: (no ?)', async () => expect42(await dynamicImport(`${WORK_DIR}plain.mjs`)));
  await step('import sdmc: + dep', async () => expect42(await dynamicImport(`${WORK_DIR}with-dep.mjs?${stamp}`)));
  const viaData = await step('import data:', async () => expect42(await dynamicImport(`data:text/javascript;base64,${base64Text(plain)}`)));
  const viaBlob = await step('import blob:', async () => {
    const url = URL.createObjectURL(new Blob([plain], { type: 'text/javascript' }));
    try {
      return expect42(await dynamicImport(url));
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  await step('new Function', () => {
    const result = new Function(new TextDecoder().decode(readBytes(`${WORK_DIR}dep.mjs`)).replace('export const dep = 2;', 'return 42;'))();
    if (result !== 42) throw new Error(`returned ${String(result)}`);
    return 'script from the SD card returned 42';
  });
  await step('indirect eval', () => {
    const indirect = eval;
    const result = indirect('globalThis.__psbEval = 42; globalThis.__psbEval');
    if (result !== 42) throw new Error(`returned ${String(result)}`);
    return 'global script ran';
  });

  if (checks.get('import sdmc:')?.status === 'ok') {
    sdImport = (path) => dynamicImport(`${path}?${Date.now()}`);
  } else if (checks.get('import sdmc: (no ?)')?.status === 'ok') {
    sdImport = (path) => dynamicImport(path);
  } else if (viaBlob) {
    sdImport = async (_path, text) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
      try {
        return await dynamicImport(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
  } else if (viaData) {
    sdImport = (_path, text) => dynamicImport(`data:text/javascript;base64,${base64Text(text)}`);
  }
}

async function probeNetwork(): Promise<void> {
  await step('GitHub release', async () => {
    const response = await fetch(GITHUB_ASSET);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const host = response.url ? new URL(response.url).host : '(no response.url)';
    return `${text.length} B, redirected ${response.redirected}, ended at ${host}, first line ${text.split('\n')[0].slice(0, 20)}…`;
  });
  await step('GitHub API', async () => {
    const response = await fetch(GITHUB_API, { headers: { Accept: 'application/vnd.github+json' } });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 80)}`);
    const release = JSON.parse(body) as { tag_name?: string; assets?: unknown[] };
    return `latest ${release.tag_name}, ${release.assets?.length ?? 0} assets, rate limit left ${response.headers.get('x-ratelimit-remaining')}`;
  });
}

async function probeModuleEndToEnd(): Promise<void> {
  let bytes: ArrayBuffer | null = null;
  let text = '';
  const path = `${WORK_DIR}three.module.min.js`;
  const downloaded = await step('Download module', async () => {
    const response = await fetch(MODULE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
    return `${kib(bytes.byteLength)} from jsDelivr`;
  });
  if (!downloaded || !bytes) return;
  const data: ArrayBuffer = bytes;

  await step('SHA-256 subtle', async () => {
    if (!globalThis.crypto?.subtle) throw new Error('no crypto.subtle');
    const digest = hex(await crypto.subtle.digest('SHA-256', data));
    if (digest !== MODULE_SHA256) throw new Error(`mismatch ${digest.slice(0, 12)}…`);
    return 'matches';
  });
  await step('SHA-256 JS', () => {
    const digest = sha256Js(data);
    if (digest !== MODULE_SHA256) throw new Error(`mismatch ${digest.slice(0, 12)}…`);
    return 'matches';
  });
  await step('Write to SD', () => {
    nx.writeFileSync(path, data);
    return kib(data.byteLength);
  });
  await step('Read from SD', () => {
    const back = readBytes(path);
    if (back.byteLength !== data.byteLength) throw new Error(`${back.byteLength} B read back`);
    text = new TextDecoder().decode(back);
    return `${kib(back.byteLength)} + decode`;
  });
  await step('fetch(sdmc:)', async () => {
    const response = await fetch(path);
    const back = await response.arrayBuffer();
    if (back.byteLength !== data.byteLength) throw new Error(`${back.byteLength} B`);
    return `${kib(back.byteLength)}, status ${response.status}`;
  });
  await step('Import module', async () => {
    if (!sdImport) throw new Error('no way to import from the SD card worked');
    const module = await sdImport(path, text);
    if (module['REVISION'] !== '160') throw new Error(`REVISION = ${String(module['REVISION'])}`);
    return `three.js r${module['REVISION']}, ${Object.keys(module).length} exports`;
  });
}

async function verifySignature(name: string, algorithm: AlgorithmIdentifier | EcKeyImportParams, verifyWith: AlgorithmIdentifier | EcdsaParams, vector: { key: string; sig: string }): Promise<void> {
  await step(name, async () => {
    if (!globalThis.crypto?.subtle) throw new Error('no crypto.subtle');
    const key = await crypto.subtle.importKey('raw', base64Bytes(vector.key), algorithm, false, ['verify']);
    const message = new TextEncoder().encode(SIGNED_MESSAGE);
    const good = await crypto.subtle.verify(verifyWith, key, base64Bytes(vector.sig), message);
    const tampered = await crypto.subtle.verify(verifyWith, key, base64Bytes(vector.sig), new TextEncoder().encode(`${SIGNED_MESSAGE}!`));
    if (!good) throw new Error('valid signature rejected');
    if (tampered) throw new Error('tampered message accepted');
    return 'valid accepted, tampered rejected';
  });
}

async function probeSignatures(): Promise<void> {
  await verifySignature('Ed25519 verify', { name: 'Ed25519' }, { name: 'Ed25519' }, ED25519);
  await verifySignature('ECDSA P-256 verify', { name: 'ECDSA', namedCurve: 'P-256' }, { name: 'ECDSA', hash: 'SHA-256' }, P256);
}

async function probeBigDownload(): Promise<void> {
  const before = nx.memoryUsage?.();
  let chunks = 0;
  let received = 0;
  let worstChunkGap = 0;
  await step('Big download', async () => {
    const response = await fetch(BIG_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length') ?? 0);
    const parts: Uint8Array[] = [];
    const reader = response.body?.getReader();
    if (reader) {
      let last = performance.now();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const now = performance.now();
        worstChunkGap = Math.max(worstChunkGap, now - last);
        last = now;
        parts.push(value);
        chunks++;
        received += value.byteLength;
        if (chunks % 20 === 0) report('Big download', 'wait', `${mib(received)} of ${mib(total)}, ${chunks} chunks`);
      }
    } else {
      const whole = new Uint8Array(await response.arrayBuffer());
      parts.push(whole);
      received = whole.byteLength;
    }
    const seconds = stepSeconds();
    const joined = new Uint8Array(received);
    let offset = 0;
    for (const part of parts) {
      joined.set(part, offset);
      offset += part.byteLength;
    }
    const writeStarted = performance.now();
    nx.writeFileSync(`${WORK_DIR}big.nro`, joined.buffer);
    const writeMs = performance.now() - writeStarted;
    return `${mib(received)} in ${seconds.toFixed(1)} s (${(received / 1048576 / seconds).toFixed(2)} MiB/s), ${reader ? `${chunks} chunks, worst gap ${ms(worstChunkGap)}` : 'no body stream'}, SD write ${ms(writeMs)}`;
  });
  const after = nx.memoryUsage?.();
  report('Big memory', 'info', `heap ${mib(before?.usedHeapSize)} → ${mib(after?.usedHeapSize)} · external ${mib(before?.externalMemory)} → ${mib(after?.externalMemory)} · native ${mib(before?.nativeHeapUsed)} → ${mib(after?.nativeHeapUsed)}`);
  try {
    (nxTable['removeSync'] as ((path: string) => void) | undefined)?.(`${WORK_DIR}big.nro`);
  } catch (error) {
    log(`removeSync big.nro failed: ${describeError(error)}`);
  }
}

let bigStartedAt = 0;
const stepSeconds = () => (performance.now() - bigStartedAt) / 1000;

async function probeRename(): Promise<void> {
  const rename = nxTable['renameSync'] as ((from: string, to: string) => void) | undefined;
  const remove = nxTable['removeSync'] as ((path: string) => void) | undefined;
  await step('Rename + remove', () => {
    if (!rename) throw new Error('no Switch.renameSync');
    writeText(`${WORK_DIR}swap-new.txt`, 'new');
    try {
      remove?.(`${WORK_DIR}swap.txt`);
    } catch {
      // Not there yet.
    }
    rename(`${WORK_DIR}swap-new.txt`, `${WORK_DIR}swap.txt`);
    const text = new TextDecoder().decode(readBytes(`${WORK_DIR}swap.txt`));
    if (text !== 'new') throw new Error(`read "${text}"`);
    if (!remove) return 'renamed (no removeSync)';
    remove(`${WORK_DIR}swap.txt`);
    return `renamed and removed, gone: ${nx.readFileSync(`${WORK_DIR}swap.txt`) === null}`;
  });
}

async function runAll(): Promise<void> {
  if (running) return;
  running = true;
  log('---- update probe u1: checks ----');
  probeEngine();
  await probeCodeLoading();
  await probeRename();
  await probeNetwork();
  await probeModuleEndToEnd();
  await probeSignatures();
  log('---- checks done ----');
  running = false;
}

async function runBig(): Promise<void> {
  if (running) return;
  running = true;
  log('---- update probe u1: big download ----');
  bigStartedAt = performance.now();
  await probeBigDownload();
  running = false;
}

// ---------------------------------------------------------------------------------------------
// Screen (plain 2D) and buttons
// ---------------------------------------------------------------------------------------------

let previousButtons: boolean[] = [];

function pollGamepad(): void {
  const pad = navigator.getGamepads().find((candidate): candidate is Gamepad => candidate !== null);
  if (!pad) return;
  const pressed = pad.buttons.map((button) => button.pressed);
  pressed.forEach((isDown, index) => {
    if (!isDown || previousButtons[index]) return;
    if (index === 1) void runAll(); // A
    if (index === 3) void runBig(); // X
  });
  previousButtons = pressed;
}

function paint(c: CanvasRenderingContext2D, fps: number, worst: number): void {
  c.fillStyle = '#10151a';
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'top';
  c.font = '26px sans-serif';
  c.fillStyle = '#6cb0ff';
  c.fillText('Pokémon Showdown · online updates probe (u1)', 28, 16);
  c.font = '16px sans-serif';
  c.fillStyle = '#90a4b8';
  c.fillText(`fps ${fps} · worst frame ${worst.toFixed(1)} ms · ${running ? 'running…' : 'idle'} · A = run again · X = 27 MiB download · + = exit`, 28, 52);

  let y = 82;
  for (const [name, check] of checks) {
    c.fillStyle = check.status === 'ok' ? '#5ad17a' : check.status === 'fail' ? '#ff6b6b' : check.status === 'info' ? '#6cb0ff' : '#e0c050';
    c.fillText(check.status === 'wait' ? '…' : check.status.toUpperCase(), 28, y);
    c.fillStyle = '#e6eef5';
    c.fillText(name, 80, y);
    c.fillStyle = '#bcd6f2';
    c.fillText(fit(c, check.detail, W - 280), 250, y);
    y += 21;
  }
  c.fillStyle = '#90a4b8';
  c.fillText(`Log: ${LOG_PATH}`, 28, H - 26);
}

function fit(c: CanvasRenderingContext2D, text: string, width: number): string {
  if (c.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && c.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function main(): void {
  try {
    nx.mkdirSync(SD_DIR);
  } catch {
    // Already there.
  }
  const c = (globalThis.screen as unknown as NxScreen).getContext('2d');
  let frames = 0;
  let fps = 0;
  let worst = 0;
  let worstShown = 0;
  let second = performance.now();
  let last = second;
  const frame = (now: number): void => {
    const gap = now - last;
    last = now;
    worst = Math.max(worst, gap);
    stepWorstFrame = Math.max(stepWorstFrame, gap);
    frames++;
    if (now - second >= 1000) {
      fps = frames;
      worstShown = worst;
      frames = 0;
      worst = 0;
      second = now;
      dirty = true;
    }
    pollGamepad();
    if (c && dirty) {
      dirty = false;
      paint(c, fps, worstShown);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  void runAll();
}

main();
