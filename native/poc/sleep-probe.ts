// Sleep probe for the native .nro: which engine feature crashes the app when the console sleeps and
// wakes? The resolution probe (WebGL, frames and files only) survives it; the app doesn't (tests
// x13/x14: 2345-0008 in the engine's controller polling, 2168-0002 in native code called from
// JavaScript). Each build of this probe adds ONE feature on top of the same screen:
//
//  - ws:    a wss:// WebSocket to Showdown kept open, reconnecting when it drops (as the app does);
//  - wsplain: the same over ws:// (no TLS), to tell TLS from any open socket (ws crashed, test s1);
//  - audio: an AudioContext playing a generated tone on a loop;
//  - pad:   navigator.getGamepads() read every frame (as the app's KeyboardNavigation does).
//
// The screen shows the mode and a moving square; the log (sleep-probe.log on the SD card) gets a
// heartbeat every 5 s and a line for each long pause between frames (the sleep) and each event.

declare const __SLEEP_MODE__: 'ws' | 'wsplain' | 'audio' | 'pad';

interface SleepSwitch {
  appendFileSync(path: string, data: string): void;
}

const MODE = __SLEEP_MODE__;
const LOG = 'sdmc:/switch/pokemon-showdown-brewser/sleep-probe.log';
const sw = (globalThis as unknown as { Switch: SleepSwitch }).Switch;
const t0 = Date.now();

function write(line: string): void {
  try {
    sw.appendFileSync(LOG, `[${((Date.now() - t0) / 1000).toFixed(2).padStart(7)}] ${line}\n`);
  } catch {
    // Best effort.
  }
}

write(`---- sleep probe: ${MODE} ----`);
globalThis.addEventListener('error', (event) => write(`error: ${String((event as ErrorEvent).error ?? (event as ErrorEvent).message)}`));
globalThis.addEventListener('unhandledrejection', (event) => write(`unhandled: ${String((event as PromiseRejectionEvent).reason)}`));

// --- The one feature ---------------------------------------------------------------------------

if (MODE === 'ws' || MODE === 'wsplain') {
  let attempt = 0;
  const connect = () => {
    const id = ++attempt;
    write(`ws ${id}: connecting`);
    const socket = new WebSocket(MODE === 'ws' ? 'wss://sim3.psim.us/showdown/websocket' : 'ws://sim3.psim.us:8000/showdown/websocket');
    let messages = 0;
    socket.addEventListener('open', () => write(`ws ${id}: open`));
    socket.addEventListener('message', () => {
      if (++messages <= 2) write(`ws ${id}: message ${messages}`);
    });
    socket.addEventListener('error', () => write(`ws ${id}: error`));
    socket.addEventListener('close', (event) => {
      write(`ws ${id}: closed (${event.code}), reconnecting in 2 s`);
      setTimeout(connect, 2000);
    });
  };
  connect();
}

if (MODE === 'audio') {
  try {
    const context = new AudioContext();
    const rate = context.sampleRate;
    const buffer = context.createBuffer(1, rate, rate);
    const samples = new Float32Array(rate);
    for (let i = 0; i < rate; i++) samples[i] = 0.08 * Math.sin((2 * Math.PI * 330 * i) / rate) * (i < rate / 2 ? 1 : 0);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(context.destination);
    source.start();
    write(`audio: playing (${rate} Hz, state ${context.state})`);
  } catch (error) {
    write(`audio: failed ${String(error)}`);
  }
}

let pressed = '';
const readPads = () => {
  if (MODE !== 'pad') return;
  const pads = navigator.getGamepads();
  const now = pads
    .flatMap((pad) => (pad ? pad.buttons.map((button, i) => (button.pressed ? i : -1)).filter((i) => i >= 0) : []))
    .join(',');
  if (now !== pressed) {
    pressed = now;
    write(`pad: buttons [${now}]`);
  }
};

// --- The screen: the same as the resolution probe's (WebGL clears), plus the heartbeat ----------

const gl = (globalThis as unknown as { screen: { getContext(id: 'webgl2'): WebGL2RenderingContext | null } }).screen.getContext('webgl2');
let last = performance.now();
let beat = last;
const colours: Record<typeof MODE, [number, number, number]> = { ws: [0.3, 0.6, 1], wsplain: [0.8, 0.4, 1], audio: [1, 0.5, 0.3], pad: [0.4, 0.9, 0.4] };
const frame = (time: number) => {
  if (time - last > 1000) write(`frames paused ${((time - last) / 1000).toFixed(1)} s (sleep?), resumed`);
  last = time;
  if (time - beat >= 5000) {
    write('alive');
    beat = time;
  }
  readPads();
  if (gl) {
    const [r, g, b] = colours[MODE];
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(r * 0.25, g * 0.25, b * 0.25, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(100 + ((time / 4) % 1000)), 300, 120, 120);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

// A module: its names stay its own (the probes are type-checked together).
export {};
