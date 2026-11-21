// Errors on the native .nro go to a log on the SD card: there are no developer tools on the console,
// and once WebGL owns the screen nothing printed is visible. Angular reports its errors through
// console.error, so that is copied too.

const LOG_DIR = 'sdmc:/switch/pokemon-showdown-brewser/';
const LOG_PATH = `${LOG_DIR}native.log`;
const startedAt = Date.now();

interface NxFiles {
  appendFileSync(path: string, data: string): void;
  mkdirSync(path: string): void;
}

const files = (globalThis as unknown as { Switch?: NxFiles }).Switch;

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack.split('\n').slice(1, 6).join('\n')}` : ''}`;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function nativeLog(line: string): void {
  try {
    const stamp = ((Date.now() - startedAt) / 1000).toFixed(2).padStart(7);
    files?.appendFileSync(LOG_PATH, `[${stamp}] ${line}\n`);
  } catch {
    // Best effort: a full or missing SD card must not break the app.
  }
}

try {
  files?.mkdirSync(LOG_DIR);
} catch {
  // Already there.
}
nativeLog(`---- start ${navigator.userAgent} ----`);

const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  nativeLog(`[console.error] ${args.map(describe).join(' ')}`);
  originalError(...args);
};
globalThis.addEventListener('error', (event) => {
  const error = event as ErrorEvent;
  nativeLog(`[error] ${describe(error.error ?? error.message)}`);
});
globalThis.addEventListener('unhandledrejection', (event) => {
  nativeLog(`[unhandled rejection] ${describe((event as PromiseRejectionEvent).reason)}`);
});

// Connection attempts (the home screen once showed "Can't reach Showdown" while connecting).
const NativeWebSocket = globalThis.WebSocket;
if (typeof NativeWebSocket === 'function') {
  let attempt = 0;
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const id = ++attempt;
      const opened = Date.now();
      const since = () => `${Date.now() - opened} ms`;
      nativeLog(`[ws ${id}] connecting to ${String(url)}`);
      this.addEventListener('open', () => nativeLog(`[ws ${id}] open after ${since()}`));
      this.addEventListener('error', () => nativeLog(`[ws ${id}] error after ${since()}`));
      this.addEventListener('close', (event) => nativeLog(`[ws ${id}] closed after ${since()} (code ${(event as CloseEvent).code})`));
    }
  } as typeof WebSocket;
}
