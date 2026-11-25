// .nro update probe (test u8): what an online .nro update with a stable name needs (docs/updates.md):
// the new .nro is downloaded next to the old one under a versioned name, opened once from the
// Homebrew Menu, and then copies itself over the stable name the HOME menu forwarder points to.
// Checks, on the console:
//
//  1. Which path the running .nro has (Switch.argv) when opened from the Homebrew Menu and when
//     opened from a HOME menu forwarder, and which .nro files sdmc:/switch/ holds.
//  2. Copying the RUNNING .nro (reading its own file while its RomFS is in use) to
//     sdmc:/switch/psb-u8-copy.nro (.part, checked block by block, renamed): opening that copy from
//     the Homebrew Menu must show this probe again.
//  3. Downloading a real .nro (v0.5.1's, 128 MiB) to sdmc:/switch/psb-u8-v0.5.1.nro (.part, each
//     4 MiB block checked against hashes known at build time, renamed): the Homebrew Menu must list
//     it and open it.
//  4. Copying that big .nro to another name (the self-copy's real size) and removing the copy (a
//     .nro that isn't running).
//
// Results on screen and in sdmc:/switch/pokemon-showdown-nx/forwarder-probe.log. A runs it all
// again, X removes every psb-u8-* file but the running one, + exits.

export {};

/** Injected by scripts/build-nro.mjs: the downloaded .nro, its size and each 4 MiB block's sha256. */
declare const __U8_URL__: string;
declare const __U8_SIZE__: number;
declare const __U8_BLOCKS__: string[];

const W = 1280;
const H = 720;
const SWITCH_DIR = 'sdmc:/switch/';
const SD_DIR = 'sdmc:/switch/pokemon-showdown-nx/';
const LOG_PATH = `${SD_DIR}forwarder-probe.log`;
const COPY_PATH = `${SWITCH_DIR}psb-u8-copy.nro`;
const DOWNLOAD_PATH = `${SWITCH_DIR}psb-u8-v0.5.1.nro`;
const BIG_COPY_PATH = `${SWITCH_DIR}psb-u8-big-copy.nro`;
const BLOCK = 4 * 1024 * 1024;

interface Writer {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}
interface ProbeFile {
  readonly size: number;
  readonly writable: { getWriter(): Writer };
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}
interface ProbeSwitch extends NxSwitch {
  file(path: string): ProbeFile;
  entrypoint?: string;
  renameSync(from: string, to: string): void;
  removeSync(path: string): void;
  statSync(path: string): { size: number } | null;
  readDirSync(path: string): string[] | null;
}

type Status = 'wait' | 'ok' | 'fail' | 'info';
const nx = Switch as unknown as ProbeSwitch;
const checks = new Map<string, { status: Status; detail: string }>();
const startedAt = Date.now();
let dirty = true;
let running = false;

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
  if (status !== 'wait') log(`${name}: ${status.toUpperCase()} ${detail}`);
}

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
const mib = (bytes: number | undefined) => (bytes === undefined ? '?' : `${(bytes / 1048576).toFixed(1)} MiB`);
const seconds = (since: number) => `${((performance.now() - since) / 1000).toFixed(1)} s`;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

globalThis.addEventListener('error', (event) => report('Uncaught', 'fail', describe((event as ErrorEvent).error ?? (event as ErrorEvent).message)));
globalThis.addEventListener('unhandledrejection', (event) => report('Unhandled', 'fail', describe((event as PromiseRejectionEvent).reason)));

async function step(name: string, body: () => Promise<string> | string): Promise<boolean> {
  report(name, 'wait', '…');
  await nextFrame();
  try {
    report(name, 'ok', await body());
    return true;
  } catch (error) {
    report(name, 'fail', describe(error));
    return false;
  }
}

async function sha256(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function removeQuietly(path: string): void {
  try {
    nx.removeSync(path);
  } catch {
    // Not there.
  }
}

function ownPath(): string | null {
  return nx.argv.find((arg) => /\.nro$/i.test(arg)) ?? null;
}

// ---------------------------------------------------------------------------------------------

function probeInfo(): void {
  report('argv', 'info', `${JSON.stringify(nx.argv)} · entrypoint ${nx.entrypoint ?? '?'}`);
  const own = ownPath();
  report('Own .nro', own ? 'info' : 'fail', own ? `${own} · ${mib(nx.statSync(own)?.size)}` : 'no .nro path in argv');
  try {
    const names = (nx.readDirSync(SWITCH_DIR) ?? []).filter((name) => /\.nro$/i.test(name));
    report('sdmc:/switch/', 'info', names.map((name) => `${name} (${mib(nx.statSync(`${SWITCH_DIR}${name}`)?.size)})`).join(', ') || 'no .nro');
  } catch (error) {
    report('sdmc:/switch/', 'fail', describe(error));
  }
}

/**
 * Copies `from` to `to` in BLOCK-sized reads (never all in memory), hashing each block, then reads the
 * copy back and compares, then renames the .part into place (removing what was there).
 */
async function copyChecked(name: string, from: string, to: string): Promise<boolean> {
  return step(name, async () => {
    const begun = performance.now();
    const source = nx.file(from);
    const size = nx.statSync(from)?.size ?? 0;
    if (!size) throw new Error(`${from} not found`);
    const part = `${to}.part`;
    removeQuietly(part);
    const writer = nx.file(part).writable.getWriter();
    const digests: string[] = [];
    for (let at = 0; at < size; at += BLOCK) {
      const bytes = new Uint8Array(await source.slice(at, Math.min(size, at + BLOCK)).arrayBuffer());
      digests.push(await sha256(bytes));
      await writer.write(bytes);
      report(name, 'wait', `${mib(at + bytes.byteLength)} of ${mib(size)}`);
    }
    await writer.close();
    const written = seconds(begun);
    const copy = nx.file(part);
    for (let at = 0, i = 0; at < size; at += BLOCK, i++) {
      const bytes = await copy.slice(at, Math.min(size, at + BLOCK)).arrayBuffer();
      if ((await sha256(bytes)) !== digests[i]) throw new Error(`block ${i} of the copy differs`);
    }
    removeQuietly(to);
    nx.renameSync(part, to);
    return `${mib(size)} → ${to} · copied in ${written}, checked + renamed by ${seconds(begun)}`;
  });
}

async function probeSelfCopy(): Promise<void> {
  const own = ownPath();
  if (!own) return;
  await copyChecked('Copy the running .nro', own, COPY_PATH);
}

async function probeDownload(): Promise<boolean> {
  return step('Download v0.5.1 .nro', async () => {
    const begun = performance.now();
    const part = `${DOWNLOAD_PATH}.part`;
    removeQuietly(part);
    const response = await fetch(__U8_URL__);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('no response.body stream');
    const writer = nx.file(part).writable.getWriter();
    let block = new Uint8Array(BLOCK);
    let filled = 0;
    let index = 0;
    let received = 0;
    const flush = async (): Promise<void> => {
      const data = block.subarray(0, filled);
      if ((await sha256(data)) !== __U8_BLOCKS__[index]) throw new Error(`block ${index} doesn't match`);
      await writer.write(data);
      index++;
      filled = 0;
      block = new Uint8Array(BLOCK);
      report('Download v0.5.1 .nro', 'wait', `${mib(received)} of ${mib(__U8_SIZE__)} · ${seconds(begun)}`);
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
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
    if (received !== __U8_SIZE__ || index !== __U8_BLOCKS__.length) throw new Error(`${received} bytes, ${index} blocks`);
    removeQuietly(DOWNLOAD_PATH);
    nx.renameSync(part, DOWNLOAD_PATH);
    const took = (performance.now() - begun) / 1000;
    return `${mib(received)} in ${took.toFixed(1)} s (${(received / 1048576 / took).toFixed(2)} MiB/s), all ${index} blocks OK → ${DOWNLOAD_PATH}`;
  });
}

async function probeBigCopyAndRemove(): Promise<void> {
  if (!(await copyChecked('Copy a 128 MiB .nro', DOWNLOAD_PATH, BIG_COPY_PATH))) return;
  await step('Remove that copy', () => {
    const begun = performance.now();
    nx.removeSync(BIG_COPY_PATH);
    return `gone: ${nx.statSync(BIG_COPY_PATH) === null} · ${(performance.now() - begun).toFixed(0)} ms`;
  });
}

function cleanUp(): void {
  const own = ownPath();
  const removed: string[] = [];
  for (const path of [COPY_PATH, DOWNLOAD_PATH, BIG_COPY_PATH, `${COPY_PATH}.part`, `${DOWNLOAD_PATH}.part`, `${BIG_COPY_PATH}.part`]) {
    if (path === own || !nx.statSync(path)) continue;
    removeQuietly(path);
    removed.push(path.slice(SWITCH_DIR.length));
  }
  report('Clean up (X)', 'info', removed.length ? `removed ${removed.join(', ')}` : 'nothing to remove');
  probeInfo();
}

async function runAll(): Promise<void> {
  if (running) return;
  running = true;
  log('---- forwarder probe u8 ----');
  probeInfo();
  await probeSelfCopy();
  if (await probeDownload()) await probeBigCopyAndRemove();
  probeInfo();
  log('---- done ----');
  running = false;
  dirty = true;
}

// ---------------------------------------------------------------------------------------------

let previousButtons: boolean[] = [];

function pollGamepad(): void {
  const pad = navigator.getGamepads().find((candidate): candidate is Gamepad => candidate !== null);
  if (!pad) return;
  const pressed = pad.buttons.map((button) => button.pressed);
  if (!running && pressed[1] && !previousButtons[1]) void runAll(); // A
  if (!running && pressed[3] && !previousButtons[3]) cleanUp(); // X
  previousButtons = pressed;
}

function fit(c: CanvasRenderingContext2D, text: string, width: number): string {
  if (c.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && c.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function wrap(c: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).map((l) => fit(c, l, width));
}

function paint(c: CanvasRenderingContext2D): void {
  c.fillStyle = '#10151a';
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'top';
  c.font = '26px sans-serif';
  c.fillStyle = '#6cb0ff';
  c.fillText('Pokémon Showdown · .nro update probe (u8)', 28, 16);
  c.font = '16px sans-serif';
  c.fillStyle = '#90a4b8';
  c.fillText(`${running ? 'running…' : 'idle'} · A = run again · X = remove the psb-u8 files · + = exit`, 28, 52);
  let y = 84;
  for (const [name, check] of checks) {
    c.fillStyle = check.status === 'ok' ? '#5ad17a' : check.status === 'fail' ? '#ff6b6b' : check.status === 'info' ? '#6cb0ff' : '#e0c050';
    c.fillText(check.status === 'wait' ? '…' : check.status.toUpperCase(), 28, y);
    c.fillStyle = '#e6eef5';
    c.fillText(name, 80, y);
    c.fillStyle = '#bcd6f2';
    for (const line of wrap(c, check.detail, W - 360)) {
      c.fillText(line, 330, y);
      y += 22;
    }
    y += 8;
  }
  c.fillStyle = '#90a4b8';
  c.fillText(`Log: ${LOG_PATH}`, 28, H - 26);
}

function main(): void {
  try {
    nx.mkdirSync(SD_DIR);
  } catch {
    // Already there.
  }
  const c = (globalThis.screen as unknown as NxScreen).getContext('2d');
  const frame = (): void => {
    pollGamepad();
    if (c && dirty) {
      dirty = false;
      paint(c);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  void runAll();
}

main();
