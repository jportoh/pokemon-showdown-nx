import { GlRenderer, Texture } from '@core/gl/gl-renderer';
import { spriteUrl } from '@shared/components/pokemon-sprite';
import { ImagePriority, SpriteBitmaps } from './sprite-bitmaps';

/** Textures made in one frame at most: a screen drawn from scratch spreads its uploads. */
const UPLOADS_PER_FRAME = 2;

/**
 * The battle screen's images (Showdown's sprites, item icons) as WebGL textures, made from the ones
 * SpriteBitmaps decodes once. On the console any image becomes a texture (probe w1: Brewser doesn't
 * apply CORS); desktop browsers refuse Showdown's sprites, whose server sends no CORS headers. A back
 * sprite that doesn't exist (some new Megas) falls back to the front one, as PokemonSprite does.
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

  /** A sprite on the field: first in line. Null until it's there. */
  get(sprite: string, back: boolean): Texture | null {
    return this.sprite(sprite, back, ImagePriority.Field);
  }

  /** A sprite elsewhere on the screen (team tiles, cards), as soon as `priority` allows. */
  sprite(sprite: string, back: boolean, priority: ImagePriority): Texture | null {
    if (!sprite) return null;
    const url = spriteUrl(sprite, back);
    const texture = this.textures.get(url);
    if (texture) return texture;
    if (back && this.bitmaps.failed(url)) return this.sprite(sprite, false, priority);
    return this.upload(url, priority, false);
  }

  /** Any other image of the screen (an item's icon), smoothed when scaled. */
  image(url: string, priority: ImagePriority = ImagePriority.Screen): Texture | null {
    if (!url) return null;
    return this.textures.get(url) ?? this.upload(url, priority, true);
  }

  /** Still to come (a send-out waits for it, up to a point). */
  pending(sprite: string, back: boolean): boolean {
    if (!sprite) return false;
    const url = spriteUrl(sprite, back);
    if (this.textures.has(url)) return false;
    if (back && this.bitmaps.failed(url)) return this.pending(sprite, false);
    return !this.bitmaps.failed(url);
  }

  dispose(): void {
    for (const texture of this.textures.values()) this.renderer.deleteTexture(texture);
    this.textures.clear();
  }

  /** The texture once the image is decoded and this frame still has room for an upload. */
  private upload(url: string, priority: ImagePriority, smooth: boolean): Texture | null {
    this.bitmaps.request(url, priority);
    const decoded = this.bitmaps.get(url);
    if (!decoded || this.uploadsLeft <= 0) return null;
    this.uploadsLeft--;
    try {
      const started = performance.now();
      const made = this.renderer.textureFromSource(decoded.image, decoded.width, decoded.height, smooth);
      this.onUpload?.(performance.now() - started);
      this.textures.set(url, made);
      return made;
    } catch {
      return null;
    }
  }
}
