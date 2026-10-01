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
  glyphs: Map<string, Glyph>;
  /** The glyphs' quad height and padding, in stage pixels. */
  height: number;
  pad: number;
}

/**
 * Text drawn glyph by glyph from one texture per font style, made once: for text that changes all the
 * time (chats, lists, counters), where TextTextures would draw and upload a new texture for every
 * new string. A whole line costs no upload, and every glyph of a style batches into one draw call.
 * No kerning, so it's a hair wider than the browser's own text.
 */
export class GlyphAtlas {
  private readonly faces = new Map<string, Face>();

  constructor(
    private readonly renderer: GlRenderer,
    private readonly scale: number,
    private readonly family: string,
  ) {}

  /** Whether every character of `text` is in the atlas. */
  covers(text: string): boolean {
    for (const char of text) if (!CHARSET_SET.has(char)) return false;
    return true;
  }

  /** The width of `text` in stage pixels (its glyphs' advances). */
  measure(text: string, style: TextStyle): number {
    const face = this.face(style);
    let width = 0;
    for (const char of text) width += face.glyphs.get(char)?.advance ?? 0;
    return width;
  }

  /** `text` cut with an ellipsis to fit `maxWidth`. */
  fit(text: string, style: TextStyle, maxWidth: number): string {
    if (this.measure(text, style) <= maxWidth) return text;
    const face = this.face(style);
    const ellipsis = face.glyphs.get('…')?.advance ?? 0;
    let width = 0;
    let end = 0;
    const chars = [...text];
    while (end < chars.length) {
      const advance = face.glyphs.get(chars[end])?.advance ?? 0;
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
      const glyph = face.glyphs.get(char);
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

  /** The style's glyphs, drawn into an atlas the first time it's used. */
  private face(style: TextStyle): Face {
    const key = `${style.size}|${style.bold ? 1 : 0}|${style.font ?? ''}`;
    let face = this.faces.get(key);
    if (face) return face;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const font = `${style.bold ? 'bold ' : ''}${Math.round(style.size * this.scale)}px ${style.font ?? this.family}`;
    context.font = font;
    const pad = GLYPH_PAD * this.scale;
    const cell = Math.ceil(style.size * 1.4 * this.scale);
    // Lay the glyphs out in rows, then draw them all at once.
    const placed: { char: string; x: number; y: number; width: number }[] = [];
    let x = 0;
    let y = 0;
    for (const char of CHARSET) {
      const width = context.measureText(char).width;
      const box = Math.ceil(width + pad * 2);
      if (x + box > ATLAS_WIDTH) {
        x = 0;
        y += cell;
      }
      placed.push({ char, x, y, width });
      x += box;
    }
    canvas.width = ATLAS_WIDTH;
    canvas.height = y + cell;
    context.font = font;
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    for (const { char, x: gx, y: gy } of placed) context.fillText(char, gx + pad, gy + cell / 2);
    const texture = this.renderer.textureFromSource(canvas, canvas.width / this.scale, canvas.height / this.scale, true);
    const glyphs = new Map<string, Glyph>();
    for (const { char, x: gx, y: gy, width } of placed) {
      glyphs.set(char, {
        uv: [gx / canvas.width, gy / canvas.height, (gx + width + pad * 2) / canvas.width, (gy + cell) / canvas.height],
        advance: width / this.scale,
      });
    }
    face = { texture, glyphs, height: cell / this.scale, pad: GLYPH_PAD };
    this.faces.set(key, face);
    return face;
  }
}

const CHARSET_SET = new Set(CHARSET);
