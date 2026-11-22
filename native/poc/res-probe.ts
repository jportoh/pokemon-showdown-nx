// Resolution probe for the native .nro: can the app draw at 1920x1080 when docked?
//
// nx.js makes the screen a 1280x720 canvas (`canvasNew(1280, 720)`) and builds its GL surface from
// it. This asks the screen for 1920x1080 before taking its WebGL2 context, then logs what the context
// got (drawingBufferWidth/Height, the viewport and its limits) and draws a pattern that shows it:
//
//  - a 4 px green border at the drawing buffer's edges: all four sides visible means the buffer
//    fills the screen exactly (a missing right/bottom side means it's bigger than what's shown);
//  - left half: 1 px black and white lines (vertical on top, horizontal below). At a true 1080p
//    output they stay crisp lines on the TV; scaled from 720p they blur into grey;
//  - a yellow square that moves, so the frame rate shows.
//
// The log goes to sdmc:/switch/pokemon-showdown-brewser/res-probe.log, with the console's operation
// mode (handheld or docked) at start and whenever it changes. Run it docked, then undock it.

interface ProbeScreen {
  width: number;
  height: number;
  getContext(contextId: 'webgl2'): WebGL2RenderingContext | null;
}

interface ProbeSwitch {
  appendFileSync(path: string, data: string): void;
  operationMode?: () => unknown;
}

const LOG = 'sdmc:/switch/pokemon-showdown-brewser/res-probe.log';
const nx = (globalThis as unknown as { Switch: ProbeSwitch }).Switch;
const probeScreen = (globalThis as unknown as { screen: ProbeScreen }).screen;
const begun = Date.now();

function note(line: string): void {
  try {
    nx.appendFileSync(LOG, `[${((Date.now() - begun) / 1000).toFixed(2).padStart(7)}] ${line}\n`);
  } catch {
    // Best effort.
  }
}

function mode(): string {
  try {
    return String(nx.operationMode?.() ?? 'unknown');
  } catch (error) {
    return `error ${String(error)}`;
  }
}

note(`---- res probe ---- mode ${mode()} · screen ${probeScreen.width}x${probeScreen.height}`);
for (const [name, set] of [
  ['width', () => (probeScreen.width = 1920)],
  ['height', () => (probeScreen.height = 1080)],
] as const) {
  try {
    set();
    note(`set screen.${name}: ok`);
  } catch (error) {
    note(`set screen.${name}: threw ${String(error)}`);
  }
}
note(`screen now ${probeScreen.width}x${probeScreen.height}`);

const gl = probeScreen.getContext('webgl2');
if (!gl) {
  note('getContext(webgl2): null');
} else {
  const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const maxDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  note(`drawingBuffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight} · viewport ${Array.from(viewport).join(',')} · max viewport ${Array.from(maxDims).join('x')} · screen ${probeScreen.width}x${probeScreen.height}`);

  let lastMode = mode();
  let frames = 0;
  let second = performance.now();
  const draw = (time: number) => {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.05, 0.09, 0.13, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    const fill = (x: number, y: number, rw: number, rh: number, r: number, g: number, b: number) => {
      // Scissor boxes count from the bottom.
      gl.scissor(x, h - y - rh, rw, rh);
      gl.clearColor(r, g, b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    const half = Math.floor(w / 2);
    const mid = Math.floor(h / 2);
    for (let x = 0; x < half; x += 2) fill(x, 0, 1, mid, 1, 1, 1);
    for (let y = mid; y < h; y += 2) fill(0, y, half, 1, 1, 1, 1);
    fill(0, 0, w, 4, 0.2, 0.9, 0.3);
    fill(0, h - 4, w, 4, 0.2, 0.9, 0.3);
    fill(0, 0, 4, h, 0.2, 0.9, 0.3);
    fill(w - 4, 0, 4, h, 0.2, 0.9, 0.3);
    const x = half + 40 + ((time / 4) % (half - 200));
    fill(Math.floor(x), mid - 60, 120, 120, 0.95, 0.76, 0.3);

    frames++;
    if (time - second >= 1000) {
      const now = mode();
      if (now !== lastMode) {
        note(`mode changed to ${now} · drawingBuffer ${w}x${h} · screen ${probeScreen.width}x${probeScreen.height}`);
        lastMode = now;
      }
      if (frames < 50) note(`only ${frames} fps`);
      frames = 0;
      second = time;
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// A module: its names stay its own (the probes are type-checked together).
export {};
