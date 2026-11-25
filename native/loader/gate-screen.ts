// The update gate's screen (native/loader/gate.ts): drawn by the loader before any of the app's code
// runs, on the screen's WebGL2 context, which the app then takes over (test u6: the same context, no
// error left behind; a 2D context instead leaves the app without WebGL). Texts go on one texture,
// drawn on an OffscreenCanvas and uploaded only when they change; the progress bar is drawn as
// rectangles every frame. A and B are read from the controller for the gate's choices.

const W = 1280;
const H = 720;
const GL_OPTIONS: WebGLContextAttributes = { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false };

const COLOURS = {
  background: '#0f1830',
  title: '#ffd34d',
  text: '#eef1f8',
  muted: '#a9b3cc',
  track: [0.16, 0.22, 0.38, 1],
  fill: [1, 0.83, 0.3, 1],
  pill: '#1c2a4f',
  buttonA: '#3fbf6b',
  buttonB: '#e2574c',
} as const;

const BAR = { x: 340, y: 430, w: 600, h: 14 };
/** The detail lines: the first one's baseline, the step between lines, and the band they're redrawn in. */
const DETAIL = { y: 384, step: 32, top: 354 };
/**
 * A detail that changes on its own (a download's MB) is redrawn at most this often, and only its band
 * is read back and uploaded: redrawing and uploading the whole 1280x720 texture for each chunk of a
 * 128 MiB download ran the engine out of native memory half way (test u9: a null pointer in nx.js).
 */
const DETAIL_EVERY_MS = 250;
/** The controller's A and B (navigator.getGamepads()' standard order on the console). */
const BUTTON_A = 1;
const BUTTON_B = 0;

export interface GateView {
  /** The big line: what is happening, or what went wrong. */
  status: string;
  /** Under it, smaller: sizes, a reason, what to do. Lines split on \n. */
  detail?: string;
  /** A fraction for a download, 'busy' for a wait of unknown length, nothing for none. */
  progress?: number | 'busy';
  /** The choices, when the gate waits for the player. */
  actions?: { a: string; b?: string };
}

interface ScreenCanvas {
  getContext(id: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
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
  private readonly gl: WebGL2RenderingContext;
  private readonly surface = new OffscreenCanvas(W, H);
  private readonly context = this.surface.getContext('2d')!;
  private readonly program: WebGLProgram;
  private readonly shaders: WebGLShader[];
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly textTexture: WebGLTexture;
  private readonly whiteTexture: WebGLTexture;
  private readonly rectAt: WebGLUniformLocation | null;
  private readonly tintAt: WebGLUniformLocation | null;

  /** `footer`: the small line at the bottom (the versions). Throws when the screen has no WebGL2. */
  constructor(private readonly footer: string) {
    const gl = (globalThis.screen as unknown as ScreenCanvas).getContext('webgl2', GL_OPTIONS);
    if (!gl) throw new Error('no WebGL2 context on the screen');
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`gate shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    // A unit quad placed by `rect` (pixels: x, y, w, h), its texture tinted by `tint`.
    this.shaders = [
      shader(
        gl.VERTEX_SHADER,
        '#version 300 es\nin vec2 p;uniform vec4 rect;out vec2 uv;void main(){uv=p;vec2 px=rect.xy+p*rect.zw;gl_Position=vec4(px.x/640.-1.,1.-px.y/360.,0.,1.);}',
      ),
      shader(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;in vec2 uv;uniform sampler2D t;uniform vec4 tint;out vec4 o;void main(){o=texture(t,uv)*tint;}'),
    ];
    const program = gl.createProgram()!;
    for (const s of this.shaders) gl.attachShader(program, s);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`gate program: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    this.rectAt = gl.getUniformLocation(program, 'rect');
    this.tintAt = gl.getUniformLocation(program, 'tint');
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    this.textTexture = this.texture(W, H, null);
    this.whiteTexture = this.texture(1, 1, new Uint8Array([255, 255, 255, 255]));
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
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.buffer);
    gl.deleteTexture(this.textTexture);
    gl.deleteTexture(this.whiteTexture);
    gl.deleteProgram(this.program);
    for (const s of this.shaders) gl.deleteShader(s);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
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
        const lines = Math.max(1, lineCount(painted.detail), lineCount(this.view.detail));
        this.painted = this.view;
        const height = lines * DETAIL.step + 8;
        this.context.fillStyle = COLOURS.background;
        this.context.fillRect(0, DETAIL.top, W, height);
        this.paintDetail();
        this.upload(DETAIL.top, height);
      }
    }
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    this.rect(this.textTexture, 0, 0, W, H, [1, 1, 1, 1]);
    const progress = this.view.progress;
    if (progress !== undefined) {
      this.rect(this.whiteTexture, BAR.x, BAR.y, BAR.w, BAR.h, COLOURS.track);
      if (progress === 'busy') {
        // A segment sliding back and forth.
        const span = BAR.w * 0.25;
        const t = (Math.sin(time / 420) + 1) / 2;
        this.rect(this.whiteTexture, BAR.x + t * (BAR.w - span), BAR.y, span, BAR.h, COLOURS.fill);
      } else {
        this.rect(this.whiteTexture, BAR.x, BAR.y, BAR.w * Math.max(0, Math.min(1, progress)), BAR.h, COLOURS.fill);
      }
    }
    requestAnimationFrame((next) => this.frame(next));
  }

  /** Reads rows [top, top + height) of the canvas back and puts them on the text texture. */
  private upload(top: number, height: number): void {
    const gl = this.gl;
    const image = this.context.getImageData(0, top, W, height);
    gl.bindTexture(gl.TEXTURE_2D, this.textTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, top, W, height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength));
  }

  private rect(texture: WebGLTexture, x: number, y: number, w: number, h: number, tint: readonly number[]): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform4f(this.rectAt, x, y, w, h);
    gl.uniform4f(this.tintAt, tint[0], tint[1], tint[2], tint[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private paint(): void {
    const c = this.context;
    const view = this.view;
    c.fillStyle = COLOURS.background;
    c.fillRect(0, 0, W, H);
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillStyle = COLOURS.title;
    c.font = 'bold 46px system-ui';
    c.fillText('Pokémon Showdown', W / 2, 250);
    c.fillStyle = COLOURS.text;
    c.font = 'bold 30px system-ui';
    c.fillText(view.status, W / 2, 340);
    this.paintDetail();
    if (view.actions) {
      const buttons: [string, string, string][] = [['A', view.actions.a, COLOURS.buttonA]];
      if (view.actions.b) buttons.push(['B', view.actions.b, COLOURS.buttonB]);
      c.font = 'bold 24px system-ui';
      const widths = buttons.map(([, label]) => c.measureText(label).width + 84);
      let x = W / 2 - (widths.reduce((sum, w) => sum + w, 0) + (buttons.length - 1) * 32) / 2;
      buttons.forEach(([letter, label, colour], i) => {
        const y = 520;
        c.fillStyle = COLOURS.pill;
        pillShape(c, x, y, widths[i], 56);
        c.fillStyle = colour;
        c.beginPath();
        c.arc(x + 30, y + 28, 18, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffffff';
        c.textAlign = 'center';
        c.fillText(letter, x + 30, y + 37);
        c.fillStyle = COLOURS.text;
        c.textAlign = 'left';
        c.fillText(label, x + 60, y + 37);
        x += widths[i] + 32;
      });
    }
    c.textAlign = 'left';
    c.fillStyle = COLOURS.muted;
    c.font = '18px system-ui';
    c.fillText(this.footer, 32, H - 28);
  }

  private paintDetail(): void {
    const c = this.context;
    if (!this.view.detail) return;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillStyle = COLOURS.muted;
    c.font = '22px system-ui';
    this.view.detail.split('\n').forEach((line, i) => c.fillText(line, W / 2, DETAIL.y + i * DETAIL.step, W - 160));
  }

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

const lineCount = (detail: string | undefined) => (detail ? detail.split('\n').length : 0);

/** Two views that differ only in their detail text (and progress, drawn apart): only the detail's band is redrawn. */
function sameButDetail(a: GateView, b: GateView): boolean {
  return a.status === b.status && a.actions?.a === b.actions?.a && a.actions?.b === b.actions?.b && lineCount(a.detail) === lineCount(b.detail);
}

/** A pill (ends as half circles of radius h/2), with arc(): the console's arcTo() bit into the right end (test u7). */
function pillShape(c: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const r = h / 2;
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  c.lineTo(x + r, y + h);
  c.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  c.closePath();
  c.fill();
}
