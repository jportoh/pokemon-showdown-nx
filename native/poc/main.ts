// Phase 0 probe for the native .nro: checks, on the console, every engine feature the
// app relies on, on one diagnostics screen, and appends the results to a log on the SD card.
//
//  - WebGL2 on the screen, and a 2D OffscreenCanvas uploaded as a texture (how the app draws text).
//  - Fonts: the glyphs the UI uses, and text measurement.
//  - Controller: which button index each physical button reports.
//  - Network: wss://sim3.psim.us (TLS WebSocket) and an https image fetch + decode.
//  - Web Audio: decoding a bundled ogg, playing it, and a generated beep.
//  - Storage: a launch counter in a SD file and in localStorage.
//  - Which browser globals exist (scopes the DOM shim Angular will need in phase 1).

const W = 1280;
const H = 720;
const SD_DIR = 'sdmc:/switch/pokemon-showdown-nx/';
const LOG_PATH = `${SD_DIR}native-probe.log`;
const WS_URL = 'wss://sim3.psim.us/showdown/websocket';
const SPRITE_URL = 'https://play.pokemonshowdown.com/sprites/gen5/pikachu.png';
const GLYPHS = 'Aa Áé ñ ü ▶ ◀ ● ★ ♂ ♀ ✓ ✕ ← → ↑ ↓ … · ×';

type Status = 'wait' | 'ok' | 'fail';

interface Check {
  status: Status;
  detail: string;
}

const checks = new Map<string, Check>();
const startedAt = Date.now();
let dirty = true;

// ---------------------------------------------------------------------------------------------
// Log + checks
// ---------------------------------------------------------------------------------------------

function log(line: string): void {
  const stamp = ((Date.now() - startedAt) / 1000).toFixed(2).padStart(7);
  try {
    Switch.appendFileSync(LOG_PATH, `[${stamp}] ${line}\n`);
  } catch {
    // The log is best effort; the screen still shows everything.
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

// ---------------------------------------------------------------------------------------------
// Probes that don't need the screen
// ---------------------------------------------------------------------------------------------

function probeGlobals(): void {
  const names = [
    'document', 'window', 'location', 'history', 'navigator', 'requestAnimationFrame', 'queueMicrotask',
    'MutationObserver', 'Image', 'OffscreenCanvas', 'createImageBitmap', 'AudioContext', 'WebSocket',
    'fetch', 'localStorage', 'performance', 'TextEncoder', 'URL', 'EventTarget', 'CustomEvent',
    'structuredClone', 'Intl', 'WeakRef', 'FinalizationRegistry',
  ];
  const table = globalThis as unknown as Record<string, unknown>;
  const missing = names.filter((name) => typeof table[name] === 'undefined');
  report('Globals', 'ok', missing.length ? `missing: ${missing.join(', ')}` : 'all present');
  report('Engine', 'ok', `${navigator.userAgent} · argv ${Switch.argv.length}`);
}

function probeStorage(): void {
  try {
    try {
      Switch.mkdirSync(SD_DIR);
    } catch {
      // Already there.
    }
    const path = `${SD_DIR}native-probe.json`;
    const raw = Switch.readFileSync(path);
    const previous = raw ? (JSON.parse(new TextDecoder().decode(raw)) as { launches?: number }).launches ?? 0 : 0;
    Switch.writeFileSync(path, JSON.stringify({ launches: previous + 1 }));
    report('SD file', 'ok', `launch #${previous + 1} (counts up if it persists)`);
  } catch (error) {
    report('SD file', 'fail', describeError(error));
  }
  try {
    const previous = Number(localStorage.getItem('psb.nativeProbe.launches') ?? '0');
    localStorage.setItem('psb.nativeProbe.launches', String(previous + 1));
    report('localStorage', 'ok', `launch #${previous + 1}`);
  } catch (error) {
    report('localStorage', 'fail', describeError(error));
  }
}

let wsFrames = 0;
let wsLast = '';

function probeWebSocket(): void {
  report('WebSocket', 'wait', `connecting to ${WS_URL}`);
  const opened = Date.now();
  try {
    const socket = new WebSocket(WS_URL);
    socket.onopen = () => report('WebSocket', 'ok', `open in ${Date.now() - opened} ms, waiting for |challstr|`);
    socket.onmessage = (event: MessageEvent) => {
      wsFrames++;
      const text = typeof event.data === 'string' ? event.data : '(binary)';
      wsLast = text.replace(/\s+/g, ' ').slice(0, 70);
      if (text.includes('|challstr|')) report('WebSocket', 'ok', `challstr received after ${Date.now() - opened} ms`);
      dirty = true;
    };
    socket.onerror = () => report('WebSocket', 'fail', 'error event');
    socket.onclose = (event: CloseEvent) => report('WebSocket', checks.get('WebSocket')?.status === 'ok' ? 'ok' : 'fail', `closed (code ${event.code})`);
  } catch (error) {
    report('WebSocket', 'fail', describeError(error));
  }
}

let sprite: ImageBitmap | null = null;

async function probeSprite(): Promise<void> {
  report('HTTPS image', 'wait', SPRITE_URL);
  const opened = Date.now();
  try {
    const response = await fetch(SPRITE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    sprite = await createImageBitmap(new Blob([bytes]));
    report('HTTPS image', 'ok', `${bytes.byteLength} B, ${sprite.width}x${sprite.height}, ${Date.now() - opened} ms`);
  } catch (error) {
    report('HTTPS image', 'fail', describeError(error));
  }
}

let audio: AudioContext | null = null;
let music: AudioBuffer | null = null;
let musicSource: AudioBufferSourceNode | null = null;

async function probeAudio(): Promise<void> {
  try {
    audio = new AudioContext();
    const raw = Switch.readFileSync('romfs:/xy-trainer.ogg');
    if (!raw) throw new Error('romfs:/xy-trainer.ogg not found');
    const size = raw.byteLength; // decodeAudioData detaches the buffer.
    const started = Date.now();
    music = await audio.decodeAudioData(raw);
    report('Audio decode', 'ok', `ogg ${(size / 1024).toFixed(0)} KB → ${music.duration.toFixed(1)} s, ${music.sampleRate} Hz, ${Date.now() - started} ms`);
  } catch (error) {
    report('Audio decode', 'fail', describeError(error));
  }
}

function toggleMusic(): void {
  if (!audio || !music) return;
  if (musicSource) {
    musicSource.stop();
    musicSource = null;
    report('Audio play', 'ok', 'music stopped');
    return;
  }
  const gain = audio.createGain();
  gain.gain.value = 0.5;
  gain.connect(audio.destination);
  musicSource = audio.createBufferSource();
  musicSource.buffer = music;
  musicSource.loop = true;
  musicSource.connect(gain);
  musicSource.start();
  report('Audio play', 'ok', 'music playing (did you hear it?)');
}

function beep(): void {
  if (!audio) return;
  const rate = audio.sampleRate;
  const buffer = audio.createBuffer(1, Math.floor(rate * 0.15), rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * 880 * i) / rate) * 0.3 * (1 - i / data.length);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start();
  report('Audio play', 'ok', 'beep (generated buffer)');
}

// ---------------------------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------------------------

let previousButtons: boolean[] = [];
let padSummary = 'no gamepad';
const seenButtons = new Set<number>();

function pollGamepad(): void {
  const pads = navigator.getGamepads().filter((pad): pad is Gamepad => pad !== null);
  const pad = pads[0];
  if (!pad) {
    padSummary = 'no gamepad';
    return;
  }
  const pressed = pad.buttons.map((button) => button.pressed);
  const held = pressed.flatMap((isDown, index) => (isDown ? [index] : []));
  const axes = pad.axes.map((value) => value.toFixed(2)).join(' ');
  padSummary = `${pads.length} pad(s), mapping "${pad.mapping}", held [${held.join(', ')}], axes ${axes}`;
  pressed.forEach((isDown, index) => {
    if (isDown && !previousButtons[index]) onButton(index);
  });
  previousButtons = pressed;
}

function onButton(index: number): void {
  seenButtons.add(index);
  log(`button ${index} pressed`);
  dirty = true;
  if (index === 0) toggleMusic();
  if (index === 1) beep();
}

// ---------------------------------------------------------------------------------------------
// Screen: a 2D panel uploaded as a texture each time it changes, plus a GL-drawn moving square
// ---------------------------------------------------------------------------------------------

const panel = new OffscreenCanvas(W, H);
const panelContext = panel.getContext('2d')!;
let uploadMs = 0;
let paintMs = 0;

function paintPanel(fps: number, worstFrameMs: number): void {
  const started = performance.now();
  const c = panelContext;
  c.fillStyle = '#10151a';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#6cb0ff';
  c.font = 'bold 30px sans-serif';
  c.textBaseline = 'top';
  c.fillText('Pokémon Showdown · native probe (x1)', 32, 20);
  c.font = '18px sans-serif';
  c.fillStyle = '#90a4b8';
  c.fillText(`fps ${fps} · worst frame ${worstFrameMs.toFixed(1)} ms · panel paint ${paintMs.toFixed(1)} ms · texture upload ${uploadMs.toFixed(1)} ms · up ${((Date.now() - startedAt) / 1000).toFixed(0)} s`, 32, 62);

  let y = 100;
  for (const [name, check] of checks) {
    c.fillStyle = check.status === 'ok' ? '#5ad17a' : check.status === 'fail' ? '#ff6b6b' : '#e0c050';
    c.fillText(check.status === 'ok' ? 'OK' : check.status === 'fail' ? 'FAIL' : '…', 32, y);
    c.fillStyle = '#e6eef5';
    c.fillText(name, 100, y);
    c.fillStyle = '#bcd6f2';
    c.fillText(fit(c, check.detail, W - 300), 270, y);
    y += 28;
  }

  y += 8;
  c.fillStyle = '#e6eef5';
  c.fillText(`Controller: ${padSummary}`, 32, y);
  y += 28;
  c.fillText(`Buttons seen: [${[...seenButtons].sort((a, b) => a - b).join(', ')}]  ·  0 = music on/off, 1 = beep, + exits`, 32, y);
  y += 28;
  c.fillText(`WS frames ${wsFrames}: ${wsLast}`, 32, y);
  y += 36;

  c.font = '24px sans-serif';
  c.fillText(GLYPHS, 32, y);
  const measured = measureAt(24);
  c.font = '16px sans-serif';
  c.fillStyle = '#90a4b8';
  c.fillText(`measureText("Showdown") at 24px = ${measured} px (Chrome ≈ 104)`, 32, y + 34);
  c.font = '24px monospace';
  c.fillStyle = '#e6eef5';
  c.fillText('monospace 0123456789', 700, y);

  if (sprite) c.drawImage(sprite, W - 140, H - 140);
  c.font = '14px sans-serif';
  c.fillStyle = '#90a4b8';
  c.fillText(`Log: ${LOG_PATH}`, 32, H - 28);
  paintMs = performance.now() - started;
}

function measureAt(size: number): string {
  panelContext.font = `${size}px sans-serif`;
  return panelContext.measureText('Showdown').width.toFixed(1);
}

function fit(c: OffscreenCanvasRenderingContext2D, text: string, width: number): string {
  if (c.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && c.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

const VERTEX = `#version 300 es
in vec2 a_pos;
uniform vec4 u_rect;
out vec2 v_uv;
void main() {
  vec2 p = u_rect.xy + a_pos * u_rect.zw;
  v_uv = a_pos;
  gl_Position = vec4(p.x / ${W}.0 * 2.0 - 1.0, 1.0 - p.y / ${H}.0 * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_color;
uniform float u_textured;
out vec4 color;
void main() {
  color = u_textured > 0.5 ? texture(u_tex, v_uv) : u_color;
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader error');
  return shader;
}

function startRenderer(gl: WebGL2RenderingContext): void {
  report('WebGL2', 'ok', `${gl.getParameter(gl.VERSION)} · ${gl.getParameter(gl.RENDERER)}`);
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link error');
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const rect = gl.getUniformLocation(program, 'u_rect');
  const colorUniform = gl.getUniformLocation(program, 'u_color');
  const textured = gl.getUniformLocation(program, 'u_textured');
  gl.viewport(0, 0, W, H);

  let frames = 0;
  let fps = 0;
  let worst = 0;
  let worstShown = 0;
  let second = performance.now();
  let last = second;
  let lastPaint = 0;
  let uploadFailed = false;

  const frame = (now: number): void => {
    worst = Math.max(worst, now - last);
    last = now;
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

    if (dirty && now - lastPaint > 100 && !uploadFailed) {
      dirty = false;
      lastPaint = now;
      paintPanel(fps, worstShown);
      const started = performance.now();
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panel as unknown as TexImageSource);
        uploadMs = performance.now() - started;
      } catch (error) {
        uploadFailed = true;
        report('Texture upload', 'fail', describeError(error));
      }
    }

    gl.clearColor(0.06, 0.08, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(textured, 1);
    gl.uniform4f(rect, 0, 0, W, H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // A square sliding along the bottom: stutter here means dropped frames.
    const x = ((now / 4) % (W - 240)) + 100;
    gl.uniform1f(textured, 0);
    gl.uniform4f(colorUniform, 1, 0.8, 0.2, 1);
    gl.uniform4f(rect, x, H - 70, 40, 40);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function showNoWebGl(): void {
  // Without WebGL2 (applet mode has too little memory for the GL driver) fall back to 2D to explain.
  const c = (globalThis.screen as unknown as NxScreen).getContext('2d');
  if (!c) return;
  c.fillStyle = '#10151a';
  c.fillRect(0, 0, W, H);
  c.fillStyle = '#ff6b6b';
  c.font = '28px sans-serif';
  c.fillText('WebGL2 is not available.', 40, 80);
  c.fillStyle = '#e6eef5';
  c.font = '20px sans-serif';
  c.fillText('Open hbmenu in application mode: hold R while launching a game, then open this app.', 40, 130);
  c.fillText('Press + to exit.', 40, 170);
}

// ---------------------------------------------------------------------------------------------

function main(): void {
  log('---- native probe x1 start ----');
  probeGlobals();
  probeStorage();
  const gl = (globalThis.screen as unknown as NxScreen).getContext('webgl2');
  if (!gl) {
    report('WebGL2', 'fail', 'getContext("webgl2") returned null (applet mode?)');
    showNoWebGl();
    return;
  }
  try {
    startRenderer(gl);
  } catch (error) {
    report('WebGL2', 'fail', describeError(error));
  }
  probeWebSocket();
  void probeSprite();
  void probeAudio();
}

main();
