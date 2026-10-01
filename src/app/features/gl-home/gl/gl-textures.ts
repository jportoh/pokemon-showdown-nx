import { COLORS, ICONS, PixelIconName, greyed } from '@shared/components/pixel-icon';
import { GlRenderer, Texture } from './gl-renderer';

/** Texts kept at once: the menu needs a few dozen, the FPS line makes a new one every half second. */
const MAX_TEXTS = 200;

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
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null = this.canvas.getContext('2d');
  /** Told how long each new text took to draw and upload (diagnostics). */
  onUpload: ((ms: number) => void) | null = null;

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
    const font = `${style.bold ? 'bold ' : ''}${Math.round(style.size * this.scale)}px ${style.font ?? this.family}`;
    context.font = font;
    const width = Math.max(1, Math.ceil(context.measureText(text).width) + 4);
    const height = Math.ceil(style.size * 1.4 * this.scale);
    this.canvas.width = width;
    this.canvas.height = height;
    // Resizing resets the context's state.
    context.font = font;
    context.textBaseline = 'middle';
    context.fillStyle = '#ffffff';
    context.clearRect(0, 0, width, height);
    context.fillText(text, 2, height / 2);
    const texture = this.renderer.textureFromSource(this.canvas, width / this.scale, height / this.scale, true);
    this.cache.set(key, texture);
    this.onUpload?.(performance.now() - started);
    return texture;
  }

  dispose(): void {
    for (const texture of this.cache.values()) this.renderer.deleteTexture(texture);
    this.cache.clear();
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
  const rows = ICONS[name];
  const pixels = new Uint8Array(24 * 24 * 4);
  rows.forEach((row, y) => {
    for (let x = 0; x < 24; x++) {
      const letter = row[x];
      if (!letter || letter === '.') continue;
      const hex = muted ? greyed(COLORS[letter]) : COLORS[letter];
      const value = parseInt(hex.slice(1), 16);
      const i = (y * 24 + x) * 4;
      pixels[i] = (value >> 16) & 255;
      pixels[i + 1] = (value >> 8) & 255;
      pixels[i + 2] = value & 255;
      pixels[i + 3] = 255;
    }
  });
  return renderer.textureFromPixels(pixels, 24, 24, false);
}
