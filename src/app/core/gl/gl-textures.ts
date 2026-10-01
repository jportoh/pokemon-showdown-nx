import { COLORS, ICONS, PixelIconName, greyed } from '@shared/components/pixel-icon';
import { GlRenderer, Texture } from './gl-renderer';
import type { GlyphAtlas } from './glyph-atlas';

/** Texts kept at once: a whole battle screen shows a few hundred (names, chips, the log's lines). */
const MAX_TEXTS = 600;
/** Widths measured, kept for fitting and wrapping. */
const MAX_WIDTHS = 2000;
/** Space either side of the text inside its texture. */
export const TEXT_PAD = 2;

/** Text is drawn white and tinted when drawn, so one texture serves every colour. */
export interface TextStyle {
  size: number;
  bold?: boolean;
  font?: string;
}

/**
 * Text drawn once with the 2D canvas into a texture, kept by text and style. The canvas is
 * `scale` times denser than the stage (the WebGL canvas's devicePixelRatio), so it stays sharp.
 */
export class TextTextures {
  private readonly cache = new Map<string, Texture>();
  private readonly widths = new Map<string, number>();
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null = this.canvas.getContext('2d');
  /** Told how long each new text took to draw and upload (diagnostics). */
  onUpload: ((ms: number) => void) | null = null;
  /** Glyphs for text that changes all the time (drawText's `fast`); the stage sets it. */
  glyphs: GlyphAtlas | null = null;

  constructor(
    private readonly renderer: GlRenderer,
    private readonly scale: number,
    private readonly family: string,
  ) {}

  get available(): boolean {
    return this.context !== null;
  }

  /** The texture for `text`, sized in stage pixels (its pixels are `scale` times as many). */
  get(text: string, style: TextStyle): Texture | null {
    const context = this.context;
    if (!context || !text) return null;
    const key = `${style.size}|${style.bold ? 1 : 0}|${text}`;
    const cached = this.cache.get(key);
    if (cached) {
      // Most recently used last, so the oldest go first when the cache is full.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    if (this.cache.size >= MAX_TEXTS) {
      const [oldestKey, oldest] = this.cache.entries().next().value!;
      this.renderer.deleteTexture(oldest);
      this.cache.delete(oldestKey);
    }

    const started = performance.now();
    const font = this.font(style);
    context.font = font;
    const width = Math.max(1, Math.ceil(context.measureText(text).width) + TEXT_PAD * 2 * this.scale);
    const height = Math.ceil(style.size * 1.4 * this.scale);
    this.canvas.width = width;
    this.canvas.height = height;
    // Resizing resets the context's state.
    context.font = font;
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.clearRect(0, 0, width, height);
    context.fillText(text, TEXT_PAD * this.scale, height / 2);
    const texture = this.renderer.textureFromSource(this.canvas, width / this.scale, height / this.scale, true);
    this.cache.set(key, texture);
    this.onUpload?.(performance.now() - started);
    return texture;
  }

  /** How wide `text` is, in stage pixels, without drawing it. */
  measure(text: string, style: TextStyle): number {
    const context = this.context;
    if (!context || !text) return 0;
    const key = `${style.size}|${style.bold ? 1 : 0}|${text}`;
    const known = this.widths.get(key);
    if (known !== undefined) return known;
    context.font = this.font(style);
    const width = context.measureText(text).width / this.scale;
    if (this.widths.size >= MAX_WIDTHS) this.widths.clear();
    this.widths.set(key, width);
    return width;
  }

  /** `text`, cut with an ellipsis to fit `maxWidth` stage pixels. */
  fit(text: string, style: TextStyle, maxWidth: number): string {
    if (this.measure(text, style) <= maxWidth) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.measure(`${text.slice(0, mid).trimEnd()}…`, style) <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return `${text.slice(0, low).trimEnd()}…`;
  }

  /** `text` broken into lines that fit `maxWidth`, at spaces (and inside words too long for a line). */
  wrap(text: string, style: TextStyle, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.measure(candidate, style) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      // A word wider than the line: cut it where it fills one.
      while (this.measure(line, style) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && this.measure(line.slice(0, cut), style) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  dispose(): void {
    for (const texture of this.cache.values()) this.renderer.deleteTexture(texture);
    this.cache.clear();
  }

  private font(style: TextStyle): string {
    return `${style.bold ? 'bold ' : ''}${Math.round(style.size * this.scale)}px ${style.font ?? this.family}`;
  }
}

/**
 * A white disc with a smooth edge, 128px: stretched, it draws ellipses (platforms, shadows); the
 * SDF boxes only round their corners.
 */
export function discTexture(renderer: GlRenderer): Texture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const a = Math.round(Math.max(0, Math.min(1, r - d)) * 255);
      const i = (y * size + x) * 4;
      // Premultiplied white.
      pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = a;
    }
  }
  return renderer.textureFromPixels(pixels, size, size, true);
}

/** The home menu's 24x24 pixel-art icons as textures (nearest sampling keeps the pixels square). */
export function iconTexture(renderer: GlRenderer, name: PixelIconName, muted: boolean): Texture {
  return pixelTexture(renderer, ICONS[name], muted);
}

/** Pixel art (rows of PixelIcon's colour letters, "." transparent) as a texture; in greys when muted. */
export function pixelTexture(renderer: GlRenderer, rows: readonly string[], muted = false): Texture {
  const width = rows[0]?.length ?? 0;
  const height = rows.length;
  const pixels = new Uint8Array(width * height * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const letter = row[x];
      if (!letter || letter === '.') continue;
      const hex = muted ? greyed(COLORS[letter]) : COLORS[letter];
      const value = parseInt(hex.slice(1), 16);
      const i = (y * width + x) * 4;
      pixels[i] = (value >> 16) & 255;
      pixels[i + 1] = (value >> 8) & 255;
      pixels[i + 2] = value & 255;
      pixels[i + 3] = 255;
    }
  });
  return renderer.textureFromPixels(pixels, width, height, false);
}

/** A white shape ("x" set, anything else clear) as a texture, for drawing tinted (cursors, arrows). */
export function maskTexture(renderer: GlRenderer, rows: readonly string[]): Texture {
  const width = rows[0]?.length ?? 0;
  const pixels = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) => [...row].forEach((c, x) => c === 'x' && pixels.set([255, 255, 255, 255], (y * width + x) * 4)));
  return renderer.textureFromPixels(pixels, width, rows.length, false);
}
