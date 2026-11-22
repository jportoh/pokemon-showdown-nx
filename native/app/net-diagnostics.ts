// Why connecting to Showdown is slow or fails on the native .nro (tests x3–x6: the first attempts
// failed with code 1006 after ~1.8 s or ~20 ms, or opened only after 8–9 s).
//
// nx.js reports a failed WebSocket only as `error` + close 1006: the reason is swallowed. So each
// attempt is logged, and after a failure the steps it takes are repeated one by one (DNS lookup, then
// a TLS connection to the same host) to log which one fails, how long it took and the engine's own
// error message. nx.js runs the TLS handshake on the main thread, between other work, so the main
// thread's lag (how late a 100 ms timer fires) and the number of fetches in flight are logged too.

import { nativeLog } from './native-log';

interface NxSocket {
  readonly opened: Promise<unknown>;
  close(): void;
}

interface NxNet {
  resolveDns?: (hostname: string) => Promise<string[]>;
  connect?: (address: string, options: { secureTransport: 'on' | 'off' }) => NxSocket;
}

const net = (globalThis as unknown as { Switch?: NxNet }).Switch ?? {};

/** The main thread's worst lag in the current period, and the fetches running now. */
export const netStats = { lagMs: 0, fetches: 0, maxFetches: 0 };

let expected = performance.now() + 100;
setInterval(() => {
  const now = performance.now();
  const lag = now - expected;
  netStats.lagMs = Math.max(netStats.lagMs, lag);
  // Each long block on its own line, to line it up with the fetches and uploads logged around it.
  if (lag > 300) nativeLog(`[lag] main thread held ~${lag.toFixed(0)} ms`);
  expected = now + 100;
}, 100);

// Frames that take long (the app draws, loads and synthesizes in requestAnimationFrame callbacks).
const nativeFrame = globalThis.requestAnimationFrame.bind(globalThis);
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  nativeFrame((time) => {
    const started = performance.now();
    try {
      callback(time);
    } finally {
      const took = performance.now() - started;
      if (took > 200) nativeLog(`[frame] a frame callback took ${took.toFixed(0)} ms`);
    }
  });

// Audio decoding runs on a worker, but its result is handed over on the main thread.
const audioPrototype = (globalThis as unknown as { AudioContext?: { prototype: BaseAudioContext } }).AudioContext?.prototype;
if (audioPrototype) {
  const decode = audioPrototype.decodeAudioData;
  audioPrototype.decodeAudioData = function (this: BaseAudioContext, data: ArrayBuffer, ...rest: unknown[]) {
    const started = performance.now();
    const size = data.byteLength;
    const result = (decode as (...args: unknown[]) => Promise<AudioBuffer>).call(this, data, ...rest);
    void result.then(
      (buffer) => nativeLog(`[audio] decoded ${(size / 1024).toFixed(0)} KB → ${buffer.duration.toFixed(1)} s in ${(performance.now() - started).toFixed(0)} ms`),
      () => undefined,
    );
    return result;
  } as typeof audioPrototype.decodeAudioData;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function diagnose(id: number, url: URL): Promise<void> {
  const host = url.hostname;
  let started = performance.now();
  try {
    const addresses = await net.resolveDns?.(host);
    nativeLog(`[ws ${id} check] DNS ${host} → ${addresses?.join(', ') || 'nothing'} in ${(performance.now() - started).toFixed(0)} ms`);
  } catch (error) {
    nativeLog(`[ws ${id} check] DNS ${host} FAILED after ${(performance.now() - started).toFixed(0)} ms: ${describe(error)}`);
    return;
  }
  if (!net.connect) return;
  started = performance.now();
  try {
    const port = url.port || (url.protocol === 'wss:' ? '443' : '80');
    const socket = net.connect(`${host}:${port}`, { secureTransport: url.protocol === 'wss:' ? 'on' : 'off' });
    await socket.opened;
    nativeLog(`[ws ${id} check] TLS connection opened in ${(performance.now() - started).toFixed(0)} ms`);
    socket.close();
  } catch (error) {
    nativeLog(`[ws ${id} check] TLS connection FAILED after ${(performance.now() - started).toFixed(0)} ms: ${describe(error)}`);
  }
}

const NativeWebSocket = globalThis.WebSocket;
if (typeof NativeWebSocket === 'function') {
  let attempt = 0;
  globalThis.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const id = ++attempt;
      const opened = performance.now();
      const since = () => `${(performance.now() - opened).toFixed(0)} ms`;
      nativeLog(`[ws ${id}] connecting to ${String(url)} (${netStats.fetches} fetches in flight)`);
      this.addEventListener('open', () => nativeLog(`[ws ${id}] open after ${since()}`));
      this.addEventListener('error', () => {
        nativeLog(`[ws ${id}] error after ${since()} (${netStats.fetches} fetches in flight)`);
        void diagnose(id, new URL(String(url)));
      });
      this.addEventListener('close', (event) => nativeLog(`[ws ${id}] closed after ${since()} (code ${(event as CloseEvent).code})`));
      // The app's handler for each server message, timed: a long one is logged with the message's start.
      // (nx.js calls `this.onmessage` itself, so the property hands it the timed wrapper.)
      let wrapped: ((event: MessageEvent) => void) | null = null;
      Object.defineProperty(this, 'onmessage', {
        get: () => wrapped,
        set: (handler: ((this: WebSocket, event: MessageEvent) => unknown) | null) => {
          wrapped = handler
            ? (event: MessageEvent) => {
                const started = performance.now();
                try {
                  handler.call(this, event);
                } finally {
                  const took = performance.now() - started;
                  const text = typeof event.data === 'string' ? event.data : '';
                  if (took > 100 || text.length > 20000) {
                    nativeLog(`[ws ${id}] message of ${text.length} chars handled in ${took.toFixed(0)} ms: ${JSON.stringify(text.slice(0, 60))}`);
                  }
                }
              }
            : null;
        },
        configurable: true,
      });
    }
  } as typeof WebSocket;
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  netStats.fetches++;
  netStats.maxFetches = Math.max(netStats.maxFetches, netStats.fetches);
  const started = performance.now();
  try {
    return await nativeFetch(input, init);
  } finally {
    netStats.fetches--;
    const took = performance.now() - started;
    const url = input instanceof Request ? input.url : String(input);
    if (took > 1000) nativeLog(`[fetch] ${url} took ${took.toFixed(0)} ms`);
  }
};
