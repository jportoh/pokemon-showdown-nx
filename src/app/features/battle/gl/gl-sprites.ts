import { GlRenderer, Texture } from '@features/gl-home/gl/gl-renderer';
import { spriteUrl } from '@shared/components/pokemon-sprite';
import { ImagePriority, SpriteBitmaps } from './sprite-bitmaps';

/** Textures made in one frame at most: a field redrawn from scratch (a new layout) spreads its uploads. */
const UPLOADS_PER_FRAME = 2;

/**
 * Showdown's sprites as WebGL textures, made from the images SpriteBitmaps decodes once for the whole
 * battle screen (so the DOM tiles don't decode them again). On the console any image becomes a
 * texture (probe w1: Brewser doesn't apply CORS); desktop browsers refuse them, since Showdown's
 * server sends no CORS headers. A back sprite that doesn't exist (some new Megas) falls back to the
 * front one, as PokemonSprite does.
 */
export class GlSprites {
  private readonly textures = new Map<string, Texture>();
  private uploadsLeft = UPLOADS_PER_FRAME;
  /** Told how long each texture took to upload (diagnostics). */
  onUpload: ((ms: number) => void) | null = null;

  constructor(
    private readonly renderer: GlRenderer,
    private readonly bitmaps: SpriteBitmaps,
  ) {}

  /** Each frame, before drawing: the frame's upload budget. */
  startFrame(): void {
    this.uploadsLeft = UPLOADS_PER_FRAME;
  }

  /** The sprite's texture once it's there; null meanwhile (asking for it puts it first in line). */
  get(sprite: string, back: boolean): Texture | null {
    if (!sprite) return null;
    const url = spriteUrl(sprite, back);
    const texture = this.textures.get(url);
    if (texture) return texture;
    this.bitmaps.request(url, ImagePriority.Field);
    if (back && this.bitmaps.failed(url)) return this.get(sprite, false);
    const decoded = this.bitmaps.get(url);
    if (!decoded || this.uploadsLeft <= 0) return null;
    this.uploadsLeft--;
    try {
      const started = performance.now();
      const made = this.renderer.textureFromSource(decoded.image, decoded.width, decoded.height, false);
      this.onUpload?.(performance.now() - started);
      this.textures.set(url, made);
      return made;
    } catch {
      return null;
    }
  }

  /** Still to come (a send-out waits for it, up to a point). */
  pending(sprite: string, back: boolean): boolean {
    if (!sprite) return false;
    const url = spriteUrl(sprite, back);
    if (this.textures.has(url)) return false;
    if (back && this.bitmaps.failed(url)) return this.pending(sprite, false);
    return !this.bitmaps.failed(url);
  }

  /** Asks for it ahead (team preview's Pokémon), behind what the screen shows. */
  preload(sprite: string, back: boolean): void {
    if (sprite) this.bitmaps.request(spriteUrl(sprite, back), ImagePriority.Ahead);
  }

  dispose(): void {
    for (const texture of this.textures.values()) this.renderer.deleteTexture(texture);
    this.textures.clear();
  }
}
