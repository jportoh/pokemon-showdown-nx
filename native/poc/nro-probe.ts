// In-app .nro update probe (test u4): can the app download a whole new .nro and put it in place of
// the running one? Checks, on the console:
//
//  1. Which path the running .nro has (Switch.argv[0]) and what FsFile offers.
//  2. Whether FsFile.writable overwrites (truncates) or writes over an existing file.
//  3. Renaming the RUNNING .nro (to .old) and reading RomFS files afterwards: one read before the
//     rename, one never read before. Then it is renamed back (the probe always restores it).
//  4. Streaming a 54 MiB download straight to the SD card in 4 MiB blocks, each hashed with
//     crypto.subtle as it arrives (a whole .nro never fits in memory at once), then reading the file
//     back in blocks to check what was written, renaming it and removing it. Memory, speed and the
//     worst frame are logged.
//
// Results on screen and in sdmc:/switch/pokemon-showdown-nx/nro-probe.log. A runs the download again,
// + exits. If the screen ever says the .nro could not be renamed back, rename
// psb-nro-probe.nro.old to psb-nro-probe.nro in sdmc:/switch/ from a PC.

export {};

declare const __PROBE_A_SHA__: string;
declare const __PROBE_B_SHA__: string;

const W = 1280;
const H = 720;
const SD_DIR = 'sdmc:/switch/pokemon-showdown-nx/';
const WORK_DIR = `${SD_DIR}nro-probe/`;
const LOG_PATH = `${SD_DIR}nro-probe.log`;
const BIG_URL = 'https://github.com/natureglass/nx.js_extended/releases/download/v1.0.0-beta.6/nxjs.nro';
const BLOCK = 4 * 1024 * 1024;

interface Writer {
  write(chunk: Uint8Array | string): Promise<void>;
  close(): Promise<void>;
}
interface ProbeFile {
  readonly size: number;
  readonly writable: { getWriter(): Writer };
  stream(opts?: { chunkSize?: number }): ReadableStream<Uint8Array>;
  text(): Promise<string>;
}
interface ProbeSwitch extends NxSwitch {
  file(path: string): ProbeFile;
  FsFile?: { prototype: object };
  entrypoint?: string;
  renameSync(from: string, to: string): void;
  removeSync(path: string): void;
  statSync(path: string): { size: number } | null;
  memoryUsage?: () => { usedHeapSize?: number; externalMemory?: number; nativeHeapUsed?: number };
}

type Status = 'wait' | 'ok' | 'fail' | 'info';
const nx = Switch as unknown as ProbeSwitch;
const checks = new Map<string, { status: Status; detail: string }>();
const startedAt = Date.now();
let dirty = true;
let running = false;
let stepWorstFrame = 0;

function log(line: string): void {
  try {
    nx.appendFileSync(LOG_PATH, `[${((Date.now() - startedAt) / 1000).toFixed(2).padStart(7)}] ${line}\n`);
  } catch {
    // Best effort.
  }
}

function report(name: string, status: Status, detail: string): void {
  checks.set(name, { status, detail });
  dirty = true;
  log(`${name}: ${status.toUpperCase()} ${detail}`);
}

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
const ms = (value: number) => `${value.toFixed(0)} ms`;
const mib = (bytes: number | undefined) => (bytes === undefined ? '?' : `${(bytes / 1048576).toFixed(1)} MiB`);
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

globalThis.addEventListener('error', (event) => report('Uncaught', 'fail', describe((event as ErrorEvent).error ?? (event as ErrorEvent).message)));
globalThis.addEventListener('unhandledrejection', (event) => report('Unhandled', 'fail', describe((event as PromiseRejectionEvent).reason)));

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
    report(name, 'fail', `${describe(error)} · ${ms(performance.now() - started)}`);
    return false;
  }
}

async function sha256(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function memory(): string {
  const usage = nx.memoryUsage?.();
  return usage ? `heap ${mib(usage.usedHeapSize)} · external ${mib(usage.externalMemory)} · native ${mib(usage.nativeHeapUsed)}` : 'no memoryUsage';
}

/** Reads a bundled RomFS file both ways (file API and relative fetch) and checks its hash. */
async function readRomfs(name: string, expected: string): Promise<string> {
  const raw = nx.readFileSync(`romfs:/${name}`);
  if (!raw) throw new Error(`romfs:/${name} not found`);
  if ((await sha256(raw)) !== expected) throw new Error('readFileSync: wrong bytes');
  const response = await fetch(`./${name}`);
  const fetched = await response.arrayBuffer();
  if ((await sha256(fetched)) !== expected) throw new Error('fetch: wrong bytes');
  return `${name} OK by readFileSync and fetch (${mib(raw.byteLength)})`;
}

function ensureDir(path: string): void {
  try {
    nx.mkdirSync(path);
  } catch {
    // Already there.
  }
}

// ---------------------------------------------------------------------------------------------

function probeInfo(): void {
  const proto = nx.FsFile?.prototype;
  const names = proto ? Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor') : [];
  report('Running .nro', 'info', `argv ${JSON.stringify(nx.argv)} · entrypoint ${nx.entrypoint ?? '?'}`);
  report('FsFile', 'info', names.length ? names.join(', ') : 'no Switch.FsFile prototype');
  report('Memory at start', 'info', memory());
}

async function probeTruncate(): Promise<void> {
  await step('writable truncates?', async () => {
    const path = `${WORK_DIR}truncate.txt`;
    nx.writeFileSync(path, 'XXXXXXXXXX');
    const writer = nx.file(path).writable.getWriter();
    await writer.write(new TextEncoder().encode('ab'));
    await writer.close();
    const text = new TextDecoder().decode(nx.readFileSync(path) ?? new ArrayBuffer(0));
    nx.removeSync(path);
    if (text === 'ab') return 'yes: the old content is gone';
    if (text === 'abXXXXXXXX') return 'NO: it writes over the start (remove the file first)';
    return `unexpected: "${text}"`;
  });
}

async function probeRenameRunning(): Promise<void> {
  const nroPath = nx.argv.find((arg) => /\.nro$/i.test(arg));
  if (!nroPath) {
    report('Rename running .nro', 'fail', 'no .nro path in Switch.argv');
    return;
  }
  const oldPath = `${nroPath}.old`;
  await step('RomFS before', () => readRomfs('probe-a.bin', __PROBE_A_SHA__));
  const renamed = await step('Rename running .nro', () => {
    nx.renameSync(nroPath, oldPath);
    const moved = nx.statSync(oldPath);
    return `${nroPath} → .old (${mib(moved?.size)}), original path free: ${nx.statSync(nroPath) === null}`;
  });
  if (!renamed) return;
  await step('RomFS after (new file)', () => readRomfs('probe-b.bin', __PROBE_B_SHA__));
  await step('RomFS after (read before)', () => readRomfs('probe-a.bin', __PROBE_A_SHA__));
  await step('Rename back', () => {
    nx.renameSync(oldPath, nroPath);
    return `restored, ${mib(nx.statSync(nroPath)?.size)}`;
  });
  if (checks.get('Rename back')?.status !== 'ok') report('ACTION NEEDED', 'fail', `rename ${oldPath} back to ${nroPath} from a PC`);
}

async function probeStreamedDownload(): Promise<void> {
  ensureDir(WORK_DIR);
  const part = `${WORK_DIR}download.part`;
  const done = `${WORK_DIR}download.nro`;
  for (const path of [part, done]) {
    try {
      nx.removeSync(path);
    } catch {
      // Not there.
    }
  }
  report('Memory before', 'info', memory());
  const digests: string[] = [];
  let peak = '';
  let peakExternal = 0;
  let received = 0;
  let worstGap = 0;
  let hashMs = 0;
  let writeMs = 0;
  let writeMax = 0;
  const ok = await step('Streamed download', async () => {
    const begun = performance.now();
    const response = await fetch(BIG_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const total = Number(response.headers.get('content-length') ?? 0);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no response.body stream');
    const writer = nx.file(part).writable.getWriter();
    let block = new Uint8Array(BLOCK);
    let filled = 0;
    const flush = async (): Promise<void> => {
      const data = block.subarray(0, filled);
      let t = performance.now();
      digests.push(await sha256(data));
      hashMs += performance.now() - t;
      t = performance.now();
      await writer.write(data);
      const took = performance.now() - t;
      writeMs += took;
      writeMax = Math.max(writeMax, took);
      block = new Uint8Array(BLOCK);
      filled = 0;
      const external = nx.memoryUsage?.()?.externalMemory ?? 0;
      if (external > peakExternal) {
        peakExternal = external;
        peak = memory();
      }
      report('Streamed download', 'wait', `${mib(received)} of ${mib(total)}`);
    };
    let last = performance.now();
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      const now = performance.now();
      worstGap = Math.max(worstGap, now - last);
      last = now;
      received += value.byteLength;
      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(BLOCK - filled, value.byteLength - offset);
        block.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === BLOCK) await flush();
      }
    }
    if (filled > 0) await flush();
    await writer.close();
    const seconds = (performance.now() - begun) / 1000;
    const size = nx.statSync(part)?.size;
    if (size !== received) throw new Error(`the file has ${size} bytes, ${received} received`);
    return `${mib(received)} in ${seconds.toFixed(1)} s (${(received / 1048576 / seconds).toFixed(2)} MiB/s) · ${digests.length} blocks · hashing ${ms(hashMs)} · writing ${ms(writeMs)} (longest ${ms(writeMax)}) · worst gap ${ms(worstGap)}`;
  });
  report('Memory peak', 'info', peak || memory());
  if (!ok) return;

  await step('Read back + verify', async () => {
    const reader = nx.file(part).stream({ chunkSize: BLOCK }).getReader();
    let block = new Uint8Array(BLOCK);
    let filled = 0;
    let index = 0;
    const check = async (): Promise<void> => {
      if ((await sha256(block.subarray(0, filled))) !== digests[index]) throw new Error(`block ${index} differs`);
      index++;
      filled = 0;
    };
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      let offset = 0;
      while (offset < value.byteLength) {
        const take = Math.min(BLOCK - filled, value.byteLength - offset);
        block.set(value.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === BLOCK) await check();
      }
    }
    if (filled > 0) await check();
    block = new Uint8Array(0);
    if (index !== digests.length) throw new Error(`${index} blocks read, ${digests.length} written`);
    return `${index} blocks match`;
  });
  await step('Rename + remove big', () => {
    nx.renameSync(part, done);
    const size = nx.statSync(done)?.size;
    nx.removeSync(done);
    return `renamed (${mib(size)}) and removed, gone: ${nx.statSync(done) === null}`;
  });
  report('Memory after', 'info', memory());
}

async function runAll(): Promise<void> {
  if (running) return;
  running = true;
  log('---- nro probe u4 ----');
  ensureDir(SD_DIR);
  ensureDir(WORK_DIR);
  probeInfo();
  await probeTruncate();
  await probeRenameRunning();
  await probeStreamedDownload();
  log('---- done ----');
  running = false;
}

async function runDownload(): Promise<void> {
  if (running) return;
  running = true;
  log('---- nro probe u4: download again ----');
  await probeStreamedDownload();
  running = false;
}

// ---------------------------------------------------------------------------------------------

let previousButtons: boolean[] = [];

function pollGamepad(): void {
  const pad = navigator.getGamepads().find((candidate): candidate is Gamepad => candidate !== null);
  if (!pad) return;
  const pressed = pad.buttons.map((button) => button.pressed);
  if (pressed[1] && !previousButtons[1]) void runDownload(); // A
  previousButtons = pressed;
}

function fit(c: CanvasRenderingContext2D, text: string, width: number): string {
  if (c.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && c.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function paint(c: CanvasRenderingContext2D, fps: number, worst: number): void {
  c.fillStyle = '#10151a';
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'top';
  c.font = '26px sans-serif';
  c.fillStyle = '#6cb0ff';
  c.fillText('Pokémon Showdown · in-app .nro update probe (u4)', 28, 16);
  c.font = '16px sans-serif';
  c.fillStyle = '#90a4b8';
  c.fillText(`fps ${fps} · worst frame ${worst.toFixed(1)} ms · ${running ? 'running…' : 'idle'} · A = download again · + = exit`, 28, 52);
  let y = 84;
  for (const [name, check] of checks) {
    c.fillStyle = check.status === 'ok' ? '#5ad17a' : check.status === 'fail' ? '#ff6b6b' : check.status === 'info' ? '#6cb0ff' : '#e0c050';
    c.fillText(check.status === 'wait' ? '…' : check.status.toUpperCase(), 28, y);
    c.fillStyle = '#e6eef5';
    c.fillText(name, 80, y);
    c.fillStyle = '#bcd6f2';
    c.fillText(fit(c, check.detail, W - 300), 270, y);
    y += 24;
  }
  c.fillStyle = '#90a4b8';
  c.fillText(`Log: ${LOG_PATH}`, 28, H - 26);
}

function main(): void {
  ensureDir(SD_DIR);
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
