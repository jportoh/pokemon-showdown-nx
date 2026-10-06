import { COLORS, ICONS, PixelIconName, greyed } from '@core/gl/ui/pixel-icons';
import { GlRenderer, Texture } from './gl-renderer';
import type { GlyphAtlas } from './glyph-atlas';

/** Widths measured, kept for fitting and wrapping. */
const MAX_WIDTHS = 8000;
/** Space either side of the text inside its texture. */
export const TEXT_PAD = 2;
/** Clear pixels between texts on an atlas page, so smoothing doesn't bleed one into the next. */
const PAGE_GAP = 2;
/** Texts too big for a page get a texture of their own; this many at most. */
const MAX_LOOSE = 48;

/** Text is drawn white and tinted when drawn, so one texture serves every colour. */
export interface TextStyle {
  size: number;
  bold?: boolean;
  font?: string;
}

/** How big the atlas gets: its pages' height (pixels; they're as wide as the GPU allows, up to 2048) and how many. */
export interface TextPages {
  height: number;
  count: number;
}

/**
 * The scenes' texts: six 2048x1024 pages (48 MB), about 1800 texts: a battle screen and its Battle
 * info, or the teambuilder's team grid (many teams) and its tabs without one clearing the other's.
 */
export const SCENE_PAGES: TextPages = { height: 1024, count: 6 };
/** Time a frame spends making new texts at most (drawText); the rest wait for the next frames. */
export const TEXT_BUDGET_MS = 4;

/** One texture full of texts, laid out in rows (shelves) of one height each. */
interface Page {
  texture: Texture;
  shelves: { y: number; height: number; x: number }[];
  /** Where the next shelf starts. */
  nextY: number;
  /** The frame it was last drawn from. */
  lastUsed: number;
  keys: string[];
}

interface Entry {
  texture: Texture;
  /** Its atlas page; null for a text with a texture of its own (too big for a page). */
  page: Page | null;
}

/**
 * Text drawn once with the 2D canvas, kept by text and style. The canvas is `scale` times denser
 * than the stage (the WebGL canvas's devicePixelRatio), so it stays sharp. Texts share a few big
 * textures (atlas pages): everything drawn from one page goes to the GPU in one draw call, where a
 * texture per text cost a draw call per text (test-v2: Battle info's team cards took 22 ms a frame on
 * the console). When the pages are full, the one drawn from longest ago is cleared for the new texts.
 */
export class TextTextures {
  private readonly cache = new Map<string, Entry>();
  private readonly pages: Page[] = [];
  private readonly pageWidth: number;
  /** Texts with a texture of their own, oldest first. */
  private readonly loose: string[] = [];
  private frame = 0;
  private readonly widths = new Map<string, number>();
  /** fit()'s cuts, by width and text. */
  private readonly fits = new Map<string, string>();
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null = this.canvas.getContext('2d');
  /** Told how long each new text took to draw and upload (diagnostics). */
  onUpload: ((ms: number) => void) | null = null;
  /** Glyphs for text that changes all the time (drawText's `fast`); the stage sets it. */
  glyphs: GlyphAtlas | null = null;
  /** Time a frame may spend on new texts asked for with `defer` (the stage sets it for the scenes' texts). */
  budgetMs = Infinity;
  private spentMs = 0;
  /** New texts turned away for the frame's budget so far (diagnostics). */
  deferred = 0;

  constructor(
    private readonly renderer: GlRenderer,
    private readonly scale: number,
    private readonly family: string,
    private readonly layout: TextPages = SCENE_PAGES,
  ) {
    this.pageWidth = Math.min(2048, renderer.maxTextureSize);
  }

  get available(): boolean {
    return this.context !== null;
  }

  /** Each frame, before drawing: a page drawn from in this frame is never cleared during it. */
  startFrame(): void {
    this.frame++;
    this.spentMs = 0;
  }

  /** Whether this frame can still make new text (textures or glyphs). */
  get withinBudget(): boolean {
    return this.spentMs < this.budgetMs;
  }

  /** Whether `text`'s width is known already (fitting it costs no new measure). */
  measured(text: string, style: TextStyle): boolean {
    return this.widths.has(this.key(text, style));
  }

  /** Counts time spent on new text elsewhere (the glyph atlas) in the frame's budget. */
  spend(ms: number): void {
    this.spentMs += ms;
  }

  /**
   * The texture for `text`, sized in stage pixels (its pixels are `scale` times as many). With `defer`,
   * a new text is only made while the frame's budget lasts, else null: a screen drawn from scratch
   * spreads its texts over a few frames instead of stalling one.
   */
  get(text: string, style: TextStyle, defer = false): Texture | null {
    const context = this.context;
    if (!context || !text) return null;
    const key = this.key(text, style);
    const cached = this.cache.get(key);
    if (cached) {
      if (cached.page) cached.page.lastUsed = this.frame;
      return cached.texture;
    }
    if (defer && this.spentMs >= this.budgetMs) {
      this.deferred++;
      return null;
    }
    const font = this.font(style);
    // Its width is often measured already (fit, measure): measureText is slow on the console.
    const width = Math.max(1, Math.ceil(this.measure(text, style) * this.scale) + TEXT_PAD * 2 * this.scale);
    const started = performance.now();
    const height = Math.ceil(style.size * 1.4 * this.scale);
    this.canvas.width = width;
    this.canvas.height = height;
    // Resizing resets the context's state.
    context.font = font;
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.clearRect(0, 0, width, height);
    context.fillText(text, TEXT_PAD * this.scale, height / 2);
    const entry = this.place(key, width, height) ?? this.alone(key, width, height);
    this.cache.set(key, entry);
    const took = performance.now() - started;
    this.spentMs += took;
    this.onUpload?.(took);
    return entry.texture;
  }

  /** How wide `text` is, in stage pixels, without drawing it. */
  measure(text: string, style: TextStyle): number {
    const context = this.context;
    if (!context || !text) return 0;
    const key = this.key(text, style);
    const known = this.widths.get(key);
    if (known !== undefined) return known;
    const started = performance.now();
    context.font = this.font(style);
    const width = context.measureText(text).width / this.scale;
    if (this.widths.size >= MAX_WIDTHS) this.widths.clear();
    this.widths.set(key, width);
    // New measures count in the frame's budget too (fitting a long text takes a few).
    this.spentMs += performance.now() - started;
    return width;
  }

  /**
   * `text`, cut with an ellipsis to fit `maxWidth` stage pixels. The cut starts where the average
   * character width puts it and steps to the longest that fits: two or three measures where a binary
   * search took eight (measureText is slow on the console: test-w2's first Calcs frame spent most of
   * its time there). Kept, as every frame asks again.
   */
  fit(text: string, style: TextStyle, maxWidth: number): string {
    const full = this.measure(text, style);
    if (full <= maxWidth) return text;
    const key = `${maxWidth}|${this.key(text, style)}`;
    const known = this.fits.get(key);
    if (known !== undefined) return known;
    const cut = (n: number) => `${text.slice(0, n).trimEnd()}…`;
    let n = Math.max(0, Math.min(text.length - 1, Math.floor((text.length * maxWidth) / full)));
    while (n > 0 && this.measure(cut(n), style) > maxWidth) n--;
    while (n + 1 < text.length && this.measure(cut(n + 1), style) <= maxWidth) n++;
    if (this.fits.size >= MAX_WIDTHS) this.fits.clear();
    this.fits.set(key, cut(n));
    return cut(n);
  }

  /**
   * `text` broken into lines that fit `maxWidth`, at spaces (and inside words too long for a line).
   * A line's width is its words' plus the spaces': words come back in other texts (kept measures),
   * each candidate line is new.
   */
  wrap(text: string, style: TextStyle, maxWidth: number): string[] {
    const lines: string[] = [];
    const space = this.measure(' ', style);
    let line = '';
    let lineWidth = 0;
    for (const word of text.split(' ')) {
      const wordWidth = this.measure(word, style);
      const candidateWidth = line ? lineWidth + space + wordWidth : wordWidth;
      if (candidateWidth <= maxWidth) {
        line = line ? `${line} ${word}` : word;
        lineWidth = candidateWidth;
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
      lineWidth = this.measure(line, style);
    }
    if (line) lines.push(line);
    return lines;
  }

  /** What the cache holds now (the diagnostics): texts, and the pixels of their textures in bytes. */
  get stats(): { count: number; bytes: number } {
    let bytes = this.pages.length * this.pageWidth * this.layout.height * 4;
    for (const key of this.loose) {
      const texture = this.cache.get(key)?.texture;
      if (texture) bytes += Math.round(texture.width * this.scale) * Math.round(texture.height * this.scale) * 4;
    }
    return { count: this.cache.size, bytes };
  }

  dispose(): void {
    for (const page of this.pages) this.renderer.deleteTexture(page.texture);
    for (const key of this.loose) {
      const texture = this.cache.get(key)?.texture;
      if (texture) this.renderer.deleteTexture(texture);
    }
    this.pages.length = 0;
    this.loose.length = 0;
    this.cache.clear();
  }

  /** The canvas's text on an atlas page: in a shelf of its height with room left, a new shelf, or a page cleared for it. */
  private place(key: string, width: number, height: number): Entry | null {
    const pageWidth = this.pageWidth;
    const pageHeight = this.layout.height;
    if (width + PAGE_GAP > pageWidth || height + PAGE_GAP > pageHeight) return null;
    let spot: { page: Page; x: number; y: number } | null = null;
    for (const page of this.pages) {
      spot = this.spotOn(page, width, height);
      if (spot) break;
    }
    if (!spot && this.pages.length < this.layout.count) {
      const page: Page = { texture: this.renderer.emptyTexture(pageWidth, pageHeight, true), shelves: [], nextY: 0, lastUsed: this.frame, keys: [] };
      this.pages.push(page);
      spot = this.spotOn(page, width, height);
    }
    if (!spot) {
      // Every page is full: the one drawn from longest ago is cleared, unless it's in use in this very frame.
      const oldest = this.pages.reduce((a, b) => (b.lastUsed < a.lastUsed ? b : a));
      if (oldest.lastUsed === this.frame) return null;
      for (const old of oldest.keys) this.cache.delete(old);
      oldest.keys = [];
      oldest.shelves = [];
      oldest.nextY = 0;
      this.renderer.emptyTexture(pageWidth, pageHeight, true, oldest.texture.handle);
      spot = this.spotOn(oldest, width, height);
    }
    if (!spot) return null;
    const { page, x, y } = spot;
    this.renderer.drawInto(page.texture, x, y, this.canvas);
    page.lastUsed = this.frame;
    page.keys.push(key);
    const texture: Texture = {
      handle: page.texture.handle,
      width: width / this.scale,
      height: height / this.scale,
      uv: [x / pageWidth, y / pageHeight, (x + width) / pageWidth, (y + height) / pageHeight],
    };
    return { texture, page };
  }

  /** Room for a `width` x `height` text on `page` (taken once returned), or null. */
  private spotOn(page: Page, width: number, height: number): { page: Page; x: number; y: number } | null {
    for (const shelf of page.shelves) {
      if (shelf.height !== height || shelf.x + width > this.pageWidth) continue;
      const x = shelf.x;
      shelf.x += width + PAGE_GAP;
      return { page, x, y: shelf.y };
    }
    if (page.nextY + height > this.layout.height) return null;
    const shelf = { y: page.nextY, height, x: width + PAGE_GAP };
    page.shelves.push(shelf);
    page.nextY += height + PAGE_GAP;
    return { page, x: 0, y: shelf.y };
  }

  /** A text too big for a page (or with every page busy this frame): a texture of its own, the oldest such going first. */
  private alone(key: string, width: number, height: number): Entry {
    if (this.loose.length >= MAX_LOOSE) {
      const oldest = this.loose.shift()!;
      const texture = this.cache.get(oldest)?.texture;
      if (texture) this.renderer.deleteTexture(texture);
      this.cache.delete(oldest);
    }
    this.loose.push(key);
    return { texture: this.renderer.textureFromSource(this.canvas, width / this.scale, height / this.scale, true), page: null };
  }

  private key(text: string, style: TextStyle): string {
    return `${style.size}|${style.bold ? 1 : 0}|${style.font ?? ''}|${text}`;
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

/** Pixel art (rows of pixel-icons' colour letters, "." transparent) as a texture; in greys when muted. */
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
