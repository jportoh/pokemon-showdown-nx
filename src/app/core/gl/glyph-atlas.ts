import { fillBold, needsFauxBold } from './faux-bold';
import { GlRenderer, Rgba, Texture } from './gl-renderer';
import { TextStyle } from './gl-textures';

/**
 * The characters in an atlas: printable ASCII, Latin-1 (accents, ñ, ¿¡, ·) and the few symbols the
 * app writes (… → – — ’ “ ” • ♂ ♀ × ★ ▲ ▼ ▶). Text with anything else falls back to TextTextures.
 */
const CHARSET = [
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
  ...Array.from({ length: 96 }, (_, i) => String.fromCharCode(160 + i)),
  ...'…→–—‘’“”•♂♀×★▲▼▶',
];
const CHARSET_SET = new Set(CHARSET);
const ATLAS_WIDTH = 1024;
/** Space around each glyph in the atlas, so smoothing doesn't bleed neighbours in. */
const GLYPH_PAD = 2;

interface Glyph {
  uv: readonly [number, number, number, number];
  /** How far the pen moves, in stage pixels. */
  advance: number;
}

interface Face {
  texture: Texture;
  font: string;
  /** Bold the font has no face for: drawn thickened (faux-bold.ts), at this size (stage px). */
  fauxBold: boolean;
  size: number;
  glyphs: Map<string, Glyph>;
  /** The glyphs' row height in texture pixels, and where the next glyph goes. */
  cell: number;
  x: number;
  y: number;
  /** The glyphs' quad height and padding, in stage pixels. */
  height: number;
  pad: number;
}

/**
 * Text drawn glyph by glyph from one texture per font style: for text that changes all the time
 * (chats, lists, counters), where TextTextures would draw and upload a new texture for every new
 * string. A whole line costs no upload, and every glyph of a style batches into one draw call. Each
 * glyph is drawn into its style's texture the first time it's used: making a style's whole charset
 * at once took 10+ ms on a desktop (80 ms for the Calcs tab's styles, far more on the console).
 * No kerning, so it's a hair wider than the browser's own text.
 */
export class GlyphAtlas {
  private readonly faces = new Map<string, Face>();
  private readonly canvas = document.createElement('canvas');
  private readonly context = this.canvas.getContext('2d')!;
  /** Told how long each new glyph took (the stage counts it in the frame's budget for new text). */
  onMake: ((ms: number) => void) | null = null;

  constructor(
    private readonly renderer: GlRenderer,
    private scale: number,
    private readonly family: string,
  ) {}

  /** Draws the glyphs `scale` times denser from now on (the canvas changed size): the atlases are redrawn. */
  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.dispose();
  }

  /** Whether every character of `text` is in the atlas. */
  covers(text: string): boolean {
    for (const char of text) if (!CHARSET_SET.has(char)) return false;
    return true;
  }

  /** Whether every glyph of `text` is made already in this style (drawing it costs nothing new). */
  has(text: string, style: TextStyle): boolean {
    const face = this.faces.get(faceKey(style));
    if (!face) return false;
    for (const char of text) if (!face.glyphs.has(char)) return false;
    return true;
  }

  /** The width of `text` in stage pixels (its glyphs' advances). */
  measure(text: string, style: TextStyle): number {
    const face = this.face(style);
    let width = 0;
    for (const char of text) width += this.glyph(face, char)?.advance ?? 0;
    return width;
  }

  /** `text` cut with an ellipsis to fit `maxWidth`. */
  fit(text: string, style: TextStyle, maxWidth: number): string {
    if (this.measure(text, style) <= maxWidth) return text;
    const face = this.face(style);
    const ellipsis = this.glyph(face, '…')?.advance ?? 0;
    let width = 0;
    let end = 0;
    const chars = [...text];
    while (end < chars.length) {
      const advance = this.glyph(face, chars[end])?.advance ?? 0;
      if (width + advance + ellipsis > maxWidth) break;
      width += advance;
      end++;
    }
    return `${chars.slice(0, end).join('').trimEnd()}…`;
  }

  /** Draws `text` from `x` with its middle at `cy`; returns its width. Every character must be covered. */
  draw(text: string, x: number, cy: number, style: TextStyle, color: Rgba): number {
    const face = this.face(style);
    let pen = x;
    const top = cy - face.height / 2;
    for (const char of text) {
      const glyph = this.glyph(face, char);
      if (!glyph) continue;
      if (char !== ' ') {
        this.renderer.rect(pen - face.pad, top, glyph.advance + face.pad * 2, face.height, { fill: color, texture: face.texture, uv: glyph.uv });
      }
      pen += glyph.advance;
    }
    return pen - x;
  }

  dispose(): void {
    for (const face of this.faces.values()) this.renderer.deleteTexture(face.texture);
    this.faces.clear();
  }

  /** The style's texture, empty at first, with room for the whole charset. */
  private face(style: TextStyle): Face {
    const key = faceKey(style);
    let face = this.faces.get(key);
    if (face) return face;
    const cell = Math.ceil(style.size * 1.4 * this.scale);
    // The widest glyphs (W, —, …) are about one em: rows for every glyph at that width, plus one.
    const box = Math.ceil(style.size * 1.1 * this.scale + GLYPH_PAD * 2 * this.scale);
    const rows = Math.ceil(CHARSET.length / Math.floor(ATLAS_WIDTH / box)) + 1;
    face = {
      texture: this.renderer.emptyTexture(ATLAS_WIDTH, rows * cell, true),
      font: `${style.bold ? 'bold ' : ''}${Math.round(style.size * this.scale)}px ${style.font ?? this.family}`,
      fauxBold: !!style.bold && needsFauxBold(this.context, style.font ?? this.family),
      size: style.size,
      glyphs: new Map(),
      cell,
      x: 0,
      y: 0,
      height: cell / this.scale,
      pad: GLYPH_PAD,
    };
    this.faces.set(key, face);
    return face;
  }

  /** The glyph of `char`, drawn into its face's texture the first time; undefined outside the charset. */
  private glyph(face: Face, char: string): Glyph | undefined {
    const known = face.glyphs.get(char);
    if (known || !CHARSET_SET.has(char)) return known;
    const started = performance.now();
    const context = this.context;
    const pad = GLYPH_PAD * this.scale;
    context.font = face.font;
    const width = context.measureText(char).width;
    const box = Math.ceil(width + pad * 2);
    if (face.x + box > ATLAS_WIDTH) {
      face.x = 0;
      face.y += face.cell;
    }
    const { x, y } = face;
    const size = face.texture.height;
    let uv: Glyph['uv'] = [0, 0, 0, 0];
    if (y + face.cell <= size && char !== ' ') {
      this.canvas.width = box;
      this.canvas.height = face.cell;
      // Resizing resets the context's state.
      context.font = face.font;
      context.textBaseline = 'middle';
      context.fillStyle = '#ffffff';
      context.clearRect(0, 0, box, face.cell);
      if (face.fauxBold) fillBold(context, char, pad, face.cell / 2, face.size, this.scale);
      else context.fillText(char, pad, face.cell / 2);
      this.renderer.drawInto(face.texture, x, y, this.canvas);
      uv = [x / ATLAS_WIDTH, y / size, (x + box) / ATLAS_WIDTH, (y + face.cell) / size];
      face.x += box;
    }
    const glyph: Glyph = { uv, advance: width / this.scale };
    face.glyphs.set(char, glyph);
    this.onMake?.(performance.now() - started);
    return glyph;
  }
}

function faceKey(style: TextStyle): string {
  return `${style.size}|${style.bold ? 1 : 0}|${style.font ?? ''}`;
}
