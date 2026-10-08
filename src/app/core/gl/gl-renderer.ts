/**
 * A small 2D renderer on WebGL (1, so it also runs on a WebGL 2 context): rounded rectangles with a
 * border, circles and textured quads (text, pixel art), all from one shader drawing a signed distance
 * to a rounded box, batched into as few draw calls as textures allow. Coordinates are the stage's CSS
 * pixels (1280x720); the canvas itself can be denser (devicePixelRatio). GlStage owns the one instance.
 */

/** pos 2, local 2, half size 2, radius 1, border 1, softness 1, fill 4, stroke 4, uv 2, textured 1. */
const FLOATS_PER_VERTEX = 20;
/** 16-bit indices: 4 vertices a quad, so at most 16383 quads in one draw call. */
const MAX_QUADS = 16000;

const SHAPE_VERTEX = `
attribute vec2 a_pos;
attribute vec2 a_local;
attribute vec2 a_half;
attribute vec3 a_shape;
attribute vec4 a_fill;
attribute vec4 a_stroke;
attribute vec3 a_uv;
uniform vec2 u_res;
// Scale and offset of the scene on the canvas (a smaller scene drawn bigger).
uniform vec3 u_view;
varying vec2 v_local;
varying vec2 v_half;
varying vec3 v_shape;
varying vec4 v_fill;
varying vec4 v_stroke;
varying vec3 v_uv;
void main() {
  vec2 clip = (a_pos * u_view.x + u_view.yz) / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = a_local;
  v_half = a_half;
  v_shape = a_shape;
  v_fill = a_fill;
  v_stroke = a_stroke;
  v_uv = a_uv;
}`;

const SHAPE_FRAGMENT = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_local;
varying vec2 v_half;
varying vec3 v_shape;
varying vec4 v_fill;
varying vec4 v_stroke;
varying vec3 v_uv;
void main() {
  float radius = v_shape.x;
  float border = v_shape.y;
  // Signed distance to the rounded box: negative inside.
  vec2 q = abs(v_local) - v_half + radius;
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  // Softness fades the edge inwards over that many pixels (1 is a plain antialiased edge).
  float coverage = clamp((0.5 - dist) / v_shape.z, 0.0, 1.0);
  // Everything in premultiplied alpha (textures are uploaded premultiplied).
  vec4 fill = vec4(v_fill.rgb * v_fill.a, v_fill.a);
  // uv.z: 1 textured, +2 additive (light adds up instead of covering).
  bool additive = v_uv.z > 1.5;
  if (v_uv.z - (additive ? 2.0 : 0.0) > 0.5) fill *= texture2D(u_tex, v_uv.xy);
  vec4 color = fill;
  if (border > 0.0) {
    float edge = clamp(dist + border + 0.5, 0.0, 1.0);
    color = mix(fill, vec4(v_stroke.rgb * v_stroke.a, v_stroke.a), edge);
  }
  gl_FragColor = additive ? vec4(color.rgb * coverage, 0.0) : color * coverage;
}`;

const BACKDROP_VERTEX = `
attribute vec2 a_pos;
varying vec2 v_pos;
void main() {
  v_pos = a_pos;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** The stage's background: diagonal bands drifting slowly, darker at the edges (Gen 3 menus). */
const BACKDROP_FRAGMENT = `
precision mediump float;
uniform float u_time;
uniform vec3 u_base;
uniform vec3 u_band;
uniform vec2 u_res;
varying vec2 v_pos;
void main() {
  vec2 px = (v_pos * 0.5 + 0.5) * u_res;
  float band = step(0.5, fract((px.x + px.y + u_time * 24.0) / 64.0));
  vec3 color = mix(u_base, u_band, band * 0.55);
  float vignette = 1.0 - 0.35 * length(v_pos * vec2(0.8, 1.0));
  gl_FragColor = vec4(color * vignette, 1.0);
}`;

export type Rgba = readonly [number, number, number, number];

export interface Texture {
  readonly handle: WebGLTexture;
  readonly width: number;
  readonly height: number;
  /** Only this part of the texture (left, top, right, bottom, 0-1): a sprite in a sheet. */
  readonly uv?: readonly [number, number, number, number];
}

export interface QuadStyle {
  fill: Rgba;
  stroke?: Rgba;
  radius?: number;
  border?: number;
  /** How many pixels the edge fades over: 1 is crisp, more makes a glow or a shadow. */
  softness?: number;
  texture?: Texture | null;
  /** Turned this many radians about its centre (streaks of rain, gusts). */
  angle?: number;
  /** Adds its light to what's under it (glows, sparks) instead of covering it. */
  additive?: boolean;
  /** The part of the texture drawn (u0, v0, u1, v1); the whole of it by default (a glyph of an atlas). */
  uv?: readonly [number, number, number, number];
}

/** Opaque colours already parsed: screens ask for the same few dozen every frame. */
const OPAQUE = new Map<string, Rgba>();
const MAX_OPAQUE = 512;

/** '#rrggbb' to [r, g, b, a] in 0..1 (opaque ones parsed once and shared: an Rgba is never changed). */
export function rgba(hex: string, alpha = 1): Rgba {
  if (alpha === 1) {
    const known = OPAQUE.get(hex);
    if (known) return known;
  }
  const value = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const color: Rgba = [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha];
  if (alpha === 1) {
    if (OPAQUE.size >= MAX_OPAQUE) OPAQUE.clear();
    OPAQUE.set(hex, color);
  }
  return color;
}

export function mixRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * alpha];
}

const NO_STROKE: Rgba = [0, 0, 0, 0];

export class GlRenderer {
  readonly gl: WebGLRenderingContext;
  readonly version: 1 | 2;
  readonly width: number;
  readonly height: number;
  /** Draw calls so far in this frame. */
  drawCalls = 0;
  /** Draw calls in the whole last frame, for the HUD. */
  lastDrawCalls = 0;
  /** Time in flush() so far in this frame, and in the whole last frame (the HUD). */
  private flushMs = 0;
  lastFlushMs = 0;
  /** Added to every position drawn: shakes the whole scene. */
  originX = 0;
  originY = 0;

  private readonly shapeProgram: WebGLProgram;
  private readonly backdropProgram: WebGLProgram;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly backdropBuffer: WebGLBuffer;
  private readonly data = new Float32Array(MAX_QUADS * 4 * FLOATS_PER_VERTEX);
  private readonly whiteTexture: Texture;
  /**
   * Quads written this frame, and how many of them are drawn already. Each batch goes after the last
   * in the vertex buffer instead of over it: the GPU may still be reading the earlier ones, and writing
   * over them would make the driver wait for it.
   */
  private quads = 0;
  private flushed = 0;
  /** The shape program, its buffers and attributes are set up (the backdrop's drawing undoes it). */
  private shapeReady = false;
  /** The view changed since it was last given to the shader. */
  private viewDirty = true;
  /** The texture of the batch being written; quads without a texture go in any batch. */
  private texture: Texture;
  private readonly attributes: { location: number; size: number; offset: number }[] = [];
  private readonly shapeResolution: WebGLUniformLocation | null;
  private readonly shapeView: WebGLUniformLocation | null;
  private view: [number, number, number] = [1, 0, 0];
  private readonly backdropUniforms: Record<'time' | 'base' | 'band' | 'res', WebGLUniformLocation | null>;
  private readonly backdropPosition: number;

  constructor(
    readonly canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ) {
    this.width = width;
    this.height = height;
    const options: WebGLContextAttributes = { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false };
    const gl2 = canvas.getContext('webgl2', options) as WebGLRenderingContext | null;
    const gl = gl2 ?? (canvas.getContext('webgl', options) as WebGLRenderingContext | null) ?? (canvas.getContext('experimental-webgl', options) as WebGLRenderingContext | null);
    if (!gl) throw new Error('No WebGL context');
    this.gl = gl;
    this.version = gl2 ? 2 : 1;

    this.shapeProgram = program(gl, SHAPE_VERTEX, SHAPE_FRAGMENT);
    this.backdropProgram = program(gl, BACKDROP_VERTEX, BACKDROP_FRAGMENT);
    this.shapeResolution = gl.getUniformLocation(this.shapeProgram, 'u_res');
    this.shapeView = gl.getUniformLocation(this.shapeProgram, 'u_view');
    this.backdropUniforms = {
      time: gl.getUniformLocation(this.backdropProgram, 'u_time'),
      base: gl.getUniformLocation(this.backdropProgram, 'u_base'),
      band: gl.getUniformLocation(this.backdropProgram, 'u_band'),
      res: gl.getUniformLocation(this.backdropProgram, 'u_res'),
    };
    this.backdropPosition = gl.getAttribLocation(this.backdropProgram, 'a_pos');

    let offset = 0;
    for (const [name, size] of [['a_pos', 2], ['a_local', 2], ['a_half', 2], ['a_shape', 3], ['a_fill', 4], ['a_stroke', 4], ['a_uv', 3]] as const) {
      this.attributes.push({ location: gl.getAttribLocation(this.shapeProgram, name), size, offset });
      offset += size;
    }

    this.vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    const indices = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0; i < MAX_QUADS; i++) {
      indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    this.indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    this.backdropBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.backdropBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.whiteTexture = this.textureFromPixels(new Uint8Array([255, 255, 255, 255]), 1, 1, false);
    this.texture = this.whiteTexture;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
  }

  /** RGBA pixels, premultiplied (the icons' alpha is only 0 or 255; decodePng premultiplies). */
  textureFromPixels(pixels: Uint8Array, width: number, height: number, smooth: boolean): Texture {
    const gl = this.gl;
    const handle = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    setSampling(gl, smooth);
    return { handle, width, height };
  }

  /** A canvas, an image or an ImageBitmap; premultiplied on upload. */
  textureFromSource(source: TexImageSource, width: number, height: number, smooth: boolean): Texture {
    const gl = this.gl;
    const handle = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    setSampling(gl, smooth);
    return { handle, width, height };
  }

  /** A texture of `width` x `height` pixels, all clear, to fill in parts (an atlas page); again on an existing one clears it. */
  emptyTexture(width: number, height: number, smooth: boolean, reuse?: WebGLTexture): Texture {
    const gl = this.gl;
    const handle = reuse ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    setSampling(gl, smooth);
    return { handle, width, height };
  }

  /** Copies a canvas into part of a texture, at (x, y) pixels; premultiplied on upload. */
  drawInto(texture: Texture, x: number, y: number, source: TexImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture.handle);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /** The biggest texture side this GPU takes. */
  get maxTextureSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
  }

  deleteTexture(texture: Texture): void {
    this.gl.deleteTexture(texture.handle);
  }

  /** Draws only inside this box (stage pixels) until clip(null): effects can't spill out of the field. */
  clip(box: { x: number; y: number; w: number; h: number } | null): void {
    const gl = this.gl;
    this.flush();
    if (!box) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const sx = this.canvas.width / this.width;
    const sy = this.canvas.height / this.height;
    gl.enable(gl.SCISSOR_TEST);
    // WebGL counts y from the bottom.
    gl.scissor(Math.round(box.x * sx), Math.round(this.canvas.height - (box.y + box.h) * sy), Math.round(box.w * sx), Math.round(box.h * sy));
  }

  /** Draws everything after this `scale` times bigger, moved by (x, y) canvas pixels (stage units). */
  setView(scale: number, x: number, y: number): void {
    const view = this.view;
    if (view[0] === scale && view[1] === x && view[2] === y) return;
    this.flush();
    this.view = [scale, x, y];
    this.viewDirty = true;
  }

  /** Starts a frame on a plain colour, no backdrop. */
  beginPlain(color: Rgba): void {
    const gl = this.gl;
    this.startFrame();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(color[0], color[1], color[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Starts a frame: the backdrop over the whole canvas. */
  begin(time: number, base: Rgba, band: Rgba): void {
    const gl = this.gl;
    this.startFrame();
    // The backdrop's program and attributes replace the shapes' until the next flush sets them again.
    this.shapeReady = false;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.backdropProgram);
    gl.uniform1f(this.backdropUniforms.time, time);
    gl.uniform3f(this.backdropUniforms.base, base[0], base[1], base[2]);
    gl.uniform3f(this.backdropUniforms.band, band[0], band[1], band[2]);
    gl.uniform2f(this.backdropUniforms.res, this.width, this.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.backdropBuffer);
    for (const { location } of this.attributes) if (location >= 0) gl.disableVertexAttribArray(location);
    gl.enableVertexAttribArray(this.backdropPosition);
    gl.vertexAttribPointer(this.backdropPosition, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(this.backdropPosition);
    this.drawCalls++;
  }

  /** What every frame starts with: last frame's count kept, the batch emptied, the vertex buffer from its start. */
  private startFrame(): void {
    this.gl.disable(this.gl.SCISSOR_TEST);
    this.lastDrawCalls = this.drawCalls;
    this.drawCalls = 0;
    this.lastFlushMs = this.flushMs;
    this.flushMs = 0;
    this.quads = 0;
    this.flushed = 0;
    this.texture = this.whiteTexture;
  }

  /** A rectangle from its top-left corner, rounded and bordered as the style says. */
  rect(x: number, y: number, width: number, height: number, style: QuadStyle): void {
    // Quads without a texture never sample it (the shader's textured flag): they join whatever batch is open.
    // Sprites of one sheet, and texts of one atlas page, share a handle: drawn one after another, they stay in one batch.
    const texture = style.texture ?? this.texture;
    if (texture.handle !== this.texture.handle) {
      this.flush();
      this.texture = texture;
    }
    if (this.quads >= MAX_QUADS) {
      // The buffer is full: draw what's there and start over from its beginning.
      this.flush();
      this.quads = 0;
      this.flushed = 0;
    }
    const halfW = width / 2;
    const halfH = height / 2;
    const radius = Math.min(style.radius ?? 0, halfW, halfH);
    const border = style.border ?? 0;
    const softness = Math.max(1, style.softness ?? 1);
    const fill = style.fill;
    const stroke = style.stroke ?? NO_STROKE;
    const textured = (style.texture ? 1 : 0) + (style.additive ? 2 : 0);
    const uv = style.uv ?? texture.uv;
    const angle = style.angle ?? 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = x + halfW + this.originX;
    const cy = y + halfH + this.originY;
    const data = this.data;
    let i = this.quads * 4 * FLOATS_PER_VERTEX;
    for (let corner = 0; corner < 4; corner++) {
      const right = corner === 1 || corner === 2 ? 1 : 0;
      const bottom = corner >= 2 ? 1 : 0;
      const lx = (right * 2 - 1) * halfW;
      const ly = (bottom * 2 - 1) * halfH;
      data[i++] = cx + lx * cos - ly * sin;
      data[i++] = cy + lx * sin + ly * cos;
      data[i++] = lx;
      data[i++] = ly;
      data[i++] = halfW;
      data[i++] = halfH;
      data[i++] = radius;
      data[i++] = border;
      data[i++] = softness;
      data[i++] = fill[0];
      data[i++] = fill[1];
      data[i++] = fill[2];
      data[i++] = fill[3];
      data[i++] = stroke[0];
      data[i++] = stroke[1];
      data[i++] = stroke[2];
      data[i++] = stroke[3];
      data[i++] = uv ? (right ? uv[2] : uv[0]) : right;
      data[i++] = uv ? (bottom ? uv[3] : uv[1]) : bottom;
      data[i++] = textured;
    }
    this.quads++;
  }

  /** A filled circle: a rounded box whose radius is half its size. */
  circle(cx: number, cy: number, r: number, fill: Rgba): void {
    this.rect(cx - r, cy - r, r * 2, r * 2, { fill, radius: r });
  }

  /** A texture at its own size (scaled by `scale`), tinted by `tint` (white keeps its colours). */
  image(texture: Texture, x: number, y: number, scale = 1, tint: Rgba = [1, 1, 1, 1]): void {
    this.rect(x, y, texture.width * scale, texture.height * scale, { fill: tint, texture });
  }

  /** Draws what's batched, timed (the diagnostics: a GPU busy taking in textures stalls these calls). */
  flush(): void {
    const started = performance.now();
    this.drawBatch();
    this.flushMs += performance.now() - started;
  }

  private drawBatch(): void {
    const count = this.quads - this.flushed;
    if (count <= 0) return;
    const gl = this.gl;
    if (!this.shapeReady) {
      // Once a frame (again after the backdrop): the program, its buffers and where each attribute reads.
      gl.useProgram(this.shapeProgram);
      gl.uniform2f(this.shapeResolution, this.width, this.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      const stride = FLOATS_PER_VERTEX * 4;
      for (const { location, size, offset } of this.attributes) {
        if (location < 0) continue;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
      }
      gl.activeTexture(gl.TEXTURE0);
      this.shapeReady = true;
      this.viewDirty = true;
    }
    if (this.viewDirty) {
      gl.uniform3f(this.shapeView, this.view[0], this.view[1], this.view[2]);
      this.viewDirty = false;
    }
    const floatsPerQuad = 4 * FLOATS_PER_VERTEX;
    gl.bufferSubData(gl.ARRAY_BUFFER, this.flushed * floatsPerQuad * 4, this.data.subarray(this.flushed * floatsPerQuad, this.quads * floatsPerQuad));
    gl.bindTexture(gl.TEXTURE_2D, this.texture.handle);
    // The index buffer counts quads from the buffer's start: these begin `flushed` quads in (6 two-byte indices each).
    gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_SHORT, this.flushed * 12);
    this.drawCalls++;
    this.flushed = this.quads;
  }

  end(): void {
    this.flush();
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteBuffer(this.backdropBuffer);
    gl.deleteProgram(this.shapeProgram);
    gl.deleteProgram(this.backdropProgram);
    gl.deleteTexture(this.whiteTexture.handle);
  }
}

function setSampling(gl: WebGLRenderingContext, smooth: boolean): void {
  const filter = smooth ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function program(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const result = gl.createProgram()!;
  gl.attachShader(result, shader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(result, shader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(result);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(`Link: ${gl.getProgramInfoLog(result)}`);
  return result;
}

function shader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type)!;
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(result)}`);
  return result;
}
