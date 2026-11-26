// The update gate's screen (native/loader/gate.ts), drawn by the loader before any of the app's code
// runs. The check is quiet (black, a spinner and a line in a corner: QUIET); when there's something to
// see (a download, an installation, a question) it's the start of the app's title: the theme the player chose (Settings, read from its file),
// the stage's dotted backdrop, the gold "o!" and POKÉMON SHOWDOWN! with its edition sticker where the
// title has them, and under them what the gate is doing, in the app's retro box, buttons and
// controller pills (src/app/core/gl/ui/retro-kit.ts). It shares the app's palettes, backdrop shader,
// Poké Ball and faux bold (modules with no dependencies), so it stays in step with the app.
//
// It draws on the screen's WebGL2 context, which the app then takes over (test u6: the same
// context, no error left behind; a 2D context instead leaves the app without WebGL). Its texts go on
// one texture, drawn on an OffscreenCanvas and uploaded when they change; the progress bar and the
// spinning ball are drawn on top each frame. A and B are read from the controller.
//
// Memory (nx.js): a texture is uploaded only when its texts change, and a download's own line at most
// every DETAIL_EVERY_MS, as a band (test u9: redrawing the whole texture for each chunk of a 128 MiB
// download ran the engine out of native memory). And no bold font is ever set on the console: each
// `bold …` font loads another copy of the system font and never frees it (native/app/bold-font.ts), so
// bold is thickened by hand, as the app does (faux-bold.ts).

import { BACKDROP_FRAGMENT, BACKDROP_VERTEX } from '../../src/app/core/gl/backdrop-shader';
import { fillBold } from '../../src/app/core/gl/faux-bold';
import { paletteHex, type Appearance, type PaletteRole, type ThemeId } from '../../src/app/core/gl/ui/palettes';
import { COLORS } from '../../src/app/core/gl/ui/pixel-icons';
import { BALL } from '../../src/app/features/home/gl/logo-ball';
import { SD_DIR } from '../update/boot-state';

const W = 1280;
const H = 720;
const GL_OPTIONS: WebGLContextAttributes = { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false };
/** The app's text family on the console (dom-shim's getComputedStyle). */
const FAMILY = 'sans-serif';
/** On the console the system font has no bold: bold is thickened by hand (in a browser preview, real bold). */
const FAUX_BOLD = typeof (globalThis as { Switch?: unknown }).Switch !== 'undefined';
/** Settings' file (src/app/core/settings/app-settings.ts, STORAGE_KEY, as device-storage names it). */
const SETTINGS_PATH = `${SD_DIR}psb.settings.v1.json`;

/** The title's logo (loading-scene.ts, BIG): the "o!" and the wordmark, and the edition sticker. */
const MARK = { x: (W - 120) / 2, y: 96, size: 120, url: 'logo/showdown-gold-120.png' };
const WORDMARK = { cy: 290, gap: 16, size: 64 };
const EDITION = { text: 'NINTENDO SWITCH EDITION', cy: 350, size: 17, red: '#e60012', angle: -0.06 };
/**
 * The check itself is quiet: on black, a small spinning Poké Ball and its line in the bottom right
 * corner, as a console's saving icon. A check that finds nothing is over in a second or two, and the
 * themed screen there only flashed by (test u10): it shows only when there's something to see (a
 * download, an installation, a question).
 */
const QUIET = { right: W - 40, cy: H - 40, ball: 24, gap: 10, size: 16, ink: '#9aa3ad' };
/** The box under the logo, for downloads and questions. */
const BOX = { x: 290, y: 392, w: 700 };
const BUTTON = { w: 250, h: 52, gap: 24 };
const BAR_H = 22;
const LINE = 28;
/** A detail that changes on its own (a download's MB) is redrawn at most this often, and only its band. */
const DETAIL_EVERY_MS = 250;

export interface GateView {
  /** The big line: what is happening, or what went wrong. */
  status: string;
  /** Under it, smaller: sizes, a reason, what to do. Lines split on \n. */
  detail?: string;
  /** A fraction for a download, 'busy' for a wait of unknown length (the spinner), nothing for none. */
  progress?: number | 'busy';
  /** The choices, when the gate waits for the player: A (the main one) and maybe B. */
  actions?: { a: string; b?: string };
}

interface ScreenCanvas {
  getContext(id: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
}

type Colours = Record<PaletteRole, string>;

/** Where the parts of a view land: the box, the bar, the detail's lines, the buttons. */
interface Layout {
  box: { x: number; y: number; w: number; h: number } | null;
  statusCy: number;
  bar: { x: number; y: number; w: number; h: number } | null;
  detailCy: number;
  buttonsY: number;
}

/** The theme Settings saved (light zafiro, the app's default, until there's one). */
function savedTheme(): { appearance: Appearance; theme: ThemeId } {
  try {
    const read = (globalThis as { Switch?: { readFileSync?(path: string): ArrayBuffer | null } }).Switch?.readFileSync;
    const raw = read?.(SETTINGS_PATH);
    const value = raw ? (JSON.parse(new TextDecoder().decode(raw)) as { appearance?: Appearance; theme?: ThemeId }) : {};
    return { appearance: value.appearance ?? 'light', theme: value.theme ?? 'zafiro' };
  } catch {
    return { appearance: 'light', theme: 'zafiro' };
  }
}

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

const lineCount = (detail: string | undefined) => (detail ? detail.split('\n').length : 0);

/** A wait with nothing to ask or count (the check): the quiet black screen. */
const isQuiet = (view: GateView) => view.progress === 'busy' && !view.actions;

function layout(view: GateView): Layout {
  const lines = lineCount(view.detail);
  if (isQuiet(view)) return { box: null, statusCy: QUIET.cy, bar: null, detailCy: QUIET.cy, buttonsY: 0 };
  let y = BOX.y + 40;
  const statusCy = y;
  y += 30;
  let bar: Layout['bar'] = null;
  if (typeof view.progress === 'number') {
    bar = { x: BOX.x + 50, y, w: BOX.w - 100, h: BAR_H };
    y += BAR_H + 30;
  } else {
    y += 4;
  }
  const detailCy = y;
  y += lines * LINE;
  let buttonsY = 0;
  if (view.actions) {
    buttonsY = y + 10;
    y = buttonsY + BUTTON.h + 8;
  }
  return { box: { x: BOX.x, y: BOX.y, w: BOX.w, h: y + 18 - BOX.y }, statusCy, bar, detailCy, buttonsY };
}

/** Two views whose texts differ only in their detail (and progress, drawn apart): only the detail's band is redrawn. */
function sameButDetail(a: GateView, b: GateView): boolean {
  return (
    a.status === b.status &&
    a.actions?.a === b.actions?.a &&
    a.actions?.b === b.actions?.b &&
    lineCount(a.detail) === lineCount(b.detail) &&
    typeof a.progress === typeof b.progress
  );
}

export class GateScreen {
  private view: GateView = { status: '' };
  /** The view on the texture now (null before the first paint). */
  private painted: GateView | null = null;
  private detailAt = 0;
  private dirty = true;
  private running = true;
  private choice: ((button: 'a' | 'b') => void) | null = null;
  private held = new Set<number>();
  /** When the last tap chose (a lift comes as several events: touchend, pointerup, mouseup, click). */
  private tappedAt = -Infinity;
  private readonly onTap = (event: Event) => this.tap(event as TapEvent);
  private mark: CanvasImageSource | null = null;
  private readonly colours: Colours;
  private readonly gl: WebGL2RenderingContext;
  private readonly surface = new OffscreenCanvas(W, H);
  private readonly context = this.surface.getContext('2d')!;
  private readonly program: WebGLProgram;
  private readonly backdrop: WebGLProgram;
  private readonly shaders: WebGLShader[] = [];
  private readonly quadVao: WebGLVertexArrayObject;
  private readonly backdropVao: WebGLVertexArrayObject;
  private readonly buffers: WebGLBuffer[] = [];
  private readonly textTexture: WebGLTexture;
  private readonly whiteTexture: WebGLTexture;
  private readonly ballTexture: WebGLTexture;
  private readonly at: Record<'rect' | 'tint' | 'radius' | 'angle', WebGLUniformLocation | null>;
  private readonly backdropAt: Record<'base' | 'band' | 'res', WebGLUniformLocation | null>;

  /** `footer`: the small line at the bottom (the versions). Throws when the screen has no WebGL2. */
  constructor(private readonly footer: string) {
    const { appearance, theme } = savedTheme();
    this.colours = paletteHex(appearance, theme);
    const gl = (globalThis.screen as unknown as ScreenCanvas).getContext('webgl2', GL_OPTIONS);
    if (!gl) throw new Error('no WebGL2 context on the screen');
    this.gl = gl;
    // A unit quad placed by `rect` (x, y, w, h in stage pixels) and turned by `angle` round its middle,
    // its texture tinted by `tint`, its corners rounded by `radius` (antialiased).
    this.program = this.link(
      '#version 300 es\nin vec2 p;uniform vec4 rect;uniform float angle;out vec2 uv;out vec2 local;void main(){uv=p;local=(p-.5)*rect.zw;float c=cos(angle),s=sin(angle);vec2 px=rect.xy+rect.zw*.5+vec2(c*local.x-s*local.y,s*local.x+c*local.y);gl_Position=vec4(px.x/640.-1.,1.-px.y/360.,0.,1.);}',
      '#version 300 es\nprecision mediump float;in vec2 uv;in vec2 local;uniform sampler2D t;uniform vec4 tint;uniform highp vec4 rect;uniform float radius;out vec4 o;void main(){vec2 q=abs(local)-rect.zw*.5+radius;float d=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;o=texture(t,uv)*tint;o.a*=radius>0.?clamp(.5-d,0.,1.):1.;}',
    );
    this.backdrop = this.link(BACKDROP_VERTEX, BACKDROP_FRAGMENT);
    this.at = {
      rect: gl.getUniformLocation(this.program, 'rect'),
      tint: gl.getUniformLocation(this.program, 'tint'),
      radius: gl.getUniformLocation(this.program, 'radius'),
      angle: gl.getUniformLocation(this.program, 'angle'),
    };
    this.backdropAt = {
      base: gl.getUniformLocation(this.backdrop, 'u_base'),
      band: gl.getUniformLocation(this.backdrop, 'u_band'),
      res: gl.getUniformLocation(this.backdrop, 'u_res'),
    };
    this.quadVao = this.vertexArray(this.program, 'p', [0, 0, 1, 0, 0, 1, 1, 1]);
    this.backdropVao = this.vertexArray(this.backdrop, 'a_pos', [-1, -1, 1, -1, -1, 1, 1, 1]);
    this.textTexture = this.texture(W, H, null);
    this.whiteTexture = this.texture(1, 1, new Uint8Array([255, 255, 255, 255]));
    this.ballTexture = this.texture(24, 24, ballPixels());
    void this.loadMark();
    // A finger on a button chooses it too (on its lift, which the console always tells).
    for (const type of TAP_EVENTS) window.addEventListener(type, this.onTap, { passive: true });
    requestAnimationFrame((time) => this.frame(time));
  }

  show(view: GateView): void {
    this.view = view;
    this.dirty = true;
  }

  /** Shows a view with actions and resolves with the button pressed (a button held from before must be let go first). */
  choose(view: GateView): Promise<'a' | 'b'> {
    this.show(view);
    this.held = new Set(this.pressedButtons());
    return new Promise((resolve) => {
      this.choice = (button) => {
        this.choice = null;
        resolve(button);
      };
    });
  }

  /** Stops drawing and leaves the context as a fresh one for the app: nothing of the gate bound or alive. */
  close(): void {
    if (!this.running) return;
    this.running = false;
    for (const type of TAP_EVENTS) window.removeEventListener(type, this.onTap);
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    gl.disable(gl.BLEND);
    gl.deleteVertexArray(this.quadVao);
    gl.deleteVertexArray(this.backdropVao);
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    for (const texture of [this.textTexture, this.whiteTexture, this.ballTexture]) gl.deleteTexture(texture);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.backdrop);
    for (const s of this.shaders) gl.deleteShader(s);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private link(vertex: string, fragment: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram()!;
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`gate shader: ${gl.getShaderInfoLog(shader)}`);
      gl.attachShader(program, shader);
      this.shaders.push(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`gate program: ${gl.getProgramInfoLog(program)}`);
    return program;
  }

  private vertexArray(program: WebGLProgram, attribute: string, points: number[]): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const buffer = gl.createBuffer()!;
    this.buffers.push(buffer);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, attribute);
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private texture(width: number, height: number, pixels: Uint8Array | null): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels ?? new Uint8Array(width * height * 4));
    return texture;
  }

  /** The gold "o!" from the RomFS (as the title draws it); the screen goes on without it until it's in. */
  private async loadMark(): Promise<void> {
    try {
      const blob = await (await fetch(MARK.url)).blob();
      this.mark = await createImageBitmap(blob);
      this.painted = null;
      this.dirty = true;
    } catch {
      // No logo: the wordmark still says what this is.
    }
  }

  private frame(time: number): void {
    if (!this.running) return;
    this.readButtons();
    const gl = this.gl;
    if (this.dirty) {
      const painted = this.painted;
      if (!painted || !sameButDetail(painted, this.view)) {
        this.dirty = false;
        this.painted = this.view;
        this.paint();
        this.upload(0, H);
      } else if (time - this.detailAt >= DETAIL_EVERY_MS) {
        this.dirty = false;
        this.detailAt = time;
        this.painted = this.view;
        const place = layout(this.view);
        const top = place.detailCy - LINE / 2 - 2;
        const height = Math.max(1, lineCount(this.view.detail)) * LINE + 4;
        const left = place.box ? place.box.x + 8 : 0;
        const width = place.box ? place.box.w - 16 : W;
        this.context.clearRect(left, top, width, height);
        if (place.box) {
          this.context.fillStyle = this.colours.panel;
          this.context.fillRect(left, top, width, height);
        }
        this.paintDetail(place);
        this.upload(top, height);
      }
    }
    gl.viewport(0, 0, W, H);
    const quiet = isQuiet(this.view);
    // The stage's backdrop (black while quiet), then the texts, then what moves.
    gl.disable(gl.BLEND);
    if (quiet) {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else {
      this.drawBackdrop();
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.quadVao);
    gl.activeTexture(gl.TEXTURE0);
    this.quad(this.textTexture, 0, 0, W, H, [1, 1, 1, 1]);
    if (quiet) this.quad(this.ballTexture, this.quietBallX(), QUIET.cy - QUIET.ball / 2, QUIET.ball, QUIET.ball, [1, 1, 1, 1], 0, (time / 1000) * 6);
    const place = layout(this.view);
    if (place.bar && typeof this.view.progress === 'number') {
      const { x, y, w, h } = place.bar;
      const fill = Math.max(0, Math.min(1, this.view.progress));
      if (fill > 0) this.quad(this.whiteTexture, x + 4, y + 4, Math.max(h - 8, (w - 8) * fill), h - 8, [...rgb(this.colours.accent), 1], (h - 8) / 2);
    }
    requestAnimationFrame((next) => this.frame(next));
  }

  /** The stage's dotted backdrop in the theme's colours. */
  private drawBackdrop(): void {
    const gl = this.gl;
    gl.useProgram(this.backdrop);
    gl.bindVertexArray(this.backdropVao);
    const [r, g, b] = rgb(this.colours.bg);
    const [br, bg, bb] = rgb(this.colours.rim);
    gl.uniform3f(this.backdropAt.base, r, g, b);
    gl.uniform3f(this.backdropAt.band, br, bg, bb);
    gl.uniform2f(this.backdropAt.res, W, H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private quad(texture: WebGLTexture, x: number, y: number, w: number, h: number, tint: readonly number[], radius = 0, angle = 0): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4f(this.at.rect, x, y, w, h);
    gl.uniform4f(this.at.tint, tint[0], tint[1], tint[2], tint[3]);
    gl.uniform1f(this.at.radius, radius);
    gl.uniform1f(this.at.angle, angle);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Reads rows [top, top + height) of the canvas back and puts them on the text texture. */
  private upload(top: number, height: number): void {
    const gl = this.gl;
    const image = this.context.getImageData(0, top, W, height);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, top, W, height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength));
  }

  // --- The texts' layer (transparent: the backdrop shows through) ---------------------------------

  private font(size: number, bold: boolean): string {
    return `${bold && !FAUX_BOLD ? 'bold ' : ''}${size}px ${FAMILY}`;
  }

  /** Text at (x, y) in the context's colour and alignment; bold thickened by hand on the console. */
  private say(text: string, x: number, y: number, size: number, colour: string, bold = false, maxWidth?: number): void {
    const c = this.context;
    c.font = this.font(size, bold);
    c.fillStyle = colour;
    const fitted = maxWidth ? fit(c, text, maxWidth) : text;
    if (bold && FAUX_BOLD) fillBold(c, fitted, x, y, size, 1);
    else c.fillText(fitted, x, y);
  }

  private paint(): void {
    const c = this.context;
    const p = this.colours;
    const view = this.view;
    const place = layout(view);
    c.clearRect(0, 0, W, H);
    c.textBaseline = 'middle';
    if (isQuiet(view)) {
      c.textAlign = 'right';
      this.say(view.status, QUIET.right, QUIET.cy, QUIET.size, QUIET.ink);
      return;
    }
    this.paintLogo();

    if (place.box) {
      // retroBox: the outline colour around a rim, the panel inside.
      const { x, y, w, h } = place.box;
      c.fillStyle = 'rgba(0, 0, 0, 0.16)';
      roundRect(c, x, y + 6, w, h, 14);
      c.fillStyle = p.outline;
      roundRect(c, x, y, w, h, 14);
      c.fillStyle = p.panel;
      roundRect(c, x + 3, y + 3, w - 6, h - 6, 11);
      c.strokeStyle = p.rim;
      c.lineWidth = 3;
      roundRect(c, x + 4.5, y + 4.5, w - 9, h - 9, 10, true);
      c.textAlign = 'center';
      this.say(view.status, W / 2, place.statusCy, 24, p.ink, true, w - 60);
    }

    if (place.bar) {
      const { x, y, w, h } = place.bar;
      c.fillStyle = p.input;
      roundRect(c, x, y, w, h, h / 2);
      c.strokeStyle = p.outline;
      c.lineWidth = 2;
      roundRect(c, x + 1, y + 1, w - 2, h - 2, (h - 2) / 2, true);
    }
    this.paintDetail(place);
    if (view.actions) this.paintButtons(place);

    c.textAlign = 'center';
    this.say(this.footer, W / 2, H - 16, 14, p.muted);
  }

  /** The gold "o!", POKÉMON SHOWDOWN! and the edition sticker, where the title has them. */
  private paintLogo(): void {
    const c = this.context;
    const p = this.colours;
    if (this.mark) c.drawImage(this.mark, MARK.x, MARK.y, MARK.size, MARK.size);
    c.font = this.font(WORDMARK.size, true);
    const first = c.measureText('POKÉMON').width;
    const second = c.measureText('SHOWDOWN!').width;
    const left = (W - (first + WORDMARK.gap + second)) / 2;
    c.textAlign = 'left';
    this.say('POKÉMON', left, WORDMARK.cy, WORDMARK.size, p.logoInk, true);
    this.say('SHOWDOWN!', left + first + WORDMARK.gap, WORDMARK.cy, WORDMARK.size, p.logo, true);

    // The red sticker, tilted, under SHOWDOWN!'s end.
    c.font = this.font(EDITION.size, true);
    const w = c.measureText(EDITION.text).width + 40;
    const h = 36;
    const cx = (W + first + WORDMARK.gap + second) / 2 - 150;
    c.save();
    c.translate(cx, EDITION.cy);
    c.rotate(EDITION.angle);
    c.fillStyle = 'rgba(0, 0, 0, 0.18)';
    roundRect(c, -w / 2 + 3, -h / 2 + 4, w, h, h / 2);
    c.fillStyle = '#ffffff';
    roundRect(c, -w / 2, -h / 2, w, h, h / 2);
    c.fillStyle = EDITION.red;
    roundRect(c, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, (h - 6) / 2);
    c.textAlign = 'center';
    this.say(EDITION.text, 0, 1, EDITION.size, '#ffffff', true);
    c.restore();
  }

  private paintDetail(place: Layout): void {
    if (!this.view.detail) return;
    const c = this.context;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const width = place.box ? place.box.w - 60 : W - 160;
    this.view.detail.split('\n').forEach((line, i) => this.say(line, W / 2, place.detailCy + i * LINE, 18, this.colours.muted, false, width));
  }

  /** Where the view's buttons are, side by side under the box's text: A's, then B's when it has one. */
  private buttonBoxes(view: GateView, place: Layout): { choice: 'a' | 'b'; x: number; y: number }[] {
    if (!view.actions) return [];
    const choices: ('a' | 'b')[] = view.actions.b ? ['a', 'b'] : ['a'];
    const total = choices.length * BUTTON.w + (choices.length - 1) * BUTTON.gap;
    const left = (W - total) / 2;
    return choices.map((choice, i) => ({ choice, x: left + i * (BUTTON.w + BUTTON.gap), y: place.buttonsY }));
  }

  /** The app's buttons (retro-kit `button`, with its controller pill): A the main one, in the accent. */
  private paintButtons(place: Layout): void {
    const actions = this.view.actions;
    if (!actions) return;
    const c = this.context;
    const p = this.colours;
    for (const { choice, x, y } of this.buttonBoxes(this.view, place)) {
      const button = choice === 'a' ? { key: 'A', label: actions.a, primary: true } : { key: 'B', label: actions.b ?? '', primary: false };
      c.fillStyle = button.primary ? p.accent : p.button;
      roundRect(c, x, y, BUTTON.w, BUTTON.h, 6);
      c.strokeStyle = button.primary ? p.bar : p.outline;
      c.lineWidth = 2;
      roundRect(c, x + 1, y + 1, BUTTON.w - 2, BUTTON.h - 2, 5, true);
      // The pill: the button's name on the select colour.
      const pillW = 36;
      const pillX = x + 10;
      const cy = y + BUTTON.h / 2;
      c.fillStyle = p.select;
      roundRect(c, pillX, cy - 12, pillW, 24, 3);
      c.textAlign = 'center';
      this.say(button.key, pillX + pillW / 2, cy, 14, p.ink, true);
      const labelX = pillX + pillW + (BUTTON.w - 20 - pillW) / 2;
      this.say(button.label, labelX, cy, 18, button.primary ? '#ffffff' : p.ink, true, BUTTON.w - pillW - 30);
    }
  }

  /** The quiet spinner's left edge: just before its line, which ends at the corner. */
  private quietBallX(): number {
    const c = this.context;
    c.font = this.font(QUIET.size, false);
    return QUIET.right - c.measureText(this.view.status).width - QUIET.gap - QUIET.ball;
  }

  // --- The touchscreen ---------------------------------------------------------------------------

  /** A lift on one of the view's buttons, while it asks: that choice (the rest of the lift's events are copies). */
  private tap(event: TapEvent): void {
    if (!this.choice) return;
    const now = performance.now();
    if (now - this.tappedAt < TAP_COPIES_MS) return;
    const source = event.changedTouches?.[0] ?? event;
    if (typeof source.clientX !== 'number' || typeof source.clientY !== 'number') return;
    // The screen is the stage (720p), but a browser window may be another size.
    const scale = W / (window.innerWidth || W);
    const x = source.clientX * scale;
    const y = source.clientY * scale;
    const hit = this.buttonBoxes(this.view, layout(this.view)).find((box) => x >= box.x && x < box.x + BUTTON.w && y >= box.y && y < box.y + BUTTON.h);
    if (!hit) return;
    this.tappedAt = now;
    this.choice(hit.choice);
  }

  // --- The controller ----------------------------------------------------------------------------

  private pressedButtons(): number[] {
    try {
      const pad = navigator.getGamepads().find((candidate): candidate is Gamepad => candidate !== null);
      if (!pad) return [];
      return [BUTTON_A, BUTTON_B].filter((index) => pad.buttons[index]?.pressed);
    } catch {
      return [];
    }
  }

  private readButtons(): void {
    const pressed = this.pressedButtons();
    for (const button of this.held) if (!pressed.includes(button)) this.held.delete(button);
    if (!this.choice) return;
    for (const button of pressed) {
      if (this.held.has(button)) continue;
      this.held.add(button);
      if (button === BUTTON_A) this.choice('a');
      else if (button === BUTTON_B && this.view.actions?.b) this.choice('b');
      return;
    }
  }
}

/** The events a lift comes as (several at once on the console); the first one chooses. */
const TAP_EVENTS = ['touchend', 'pointerup', 'mouseup', 'click'] as const;
/** Later events of the same lift come within this. */
const TAP_COPIES_MS = 400;

interface TapEvent {
  clientX?: number;
  clientY?: number;
  changedTouches?: ArrayLike<{ clientX?: number; clientY?: number }>;
}

/** The controller's A and B (navigator.getGamepads()' standard order on the console). */
const BUTTON_A = 1;
const BUTTON_B = 0;

/** The menu's Poké Ball (logo-ball.ts) as RGBA pixels, in the pixel icons' colours. */
function ballPixels(): Uint8Array {
  const pixels = new Uint8Array(24 * 24 * 4);
  BALL.forEach((row, y) => {
    for (let x = 0; x < 24; x++) {
      const hex = COLORS[row[x]];
      if (!hex) continue;
      const [r, g, b] = rgb(hex);
      pixels.set([r * 255, g * 255, b * 255, 255], (y * 24 + x) * 4);
    }
  });
  return pixels;
}

function fit(c: OffscreenCanvasRenderingContext2D, text: string, width: number): string {
  if (c.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && c.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * A rounded rectangle, filled (or stroked), drawn with arc(): the console's arcTo() bit into the
 * corners (test u7).
 */
function roundRect(c: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, stroke = false): void {
  const radius = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + radius, y);
  c.lineTo(x + w - radius, y);
  c.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
  c.lineTo(x + w, y + h - radius);
  c.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
  c.lineTo(x + radius, y + h);
  c.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
  c.lineTo(x, y + radius);
  c.arc(x + radius, y + radius, radius, Math.PI, (3 * Math.PI) / 2);
  c.closePath();
  if (stroke) c.stroke();
  else c.fill();
}
