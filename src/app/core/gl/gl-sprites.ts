import { ITEM_ICON_SIZE, ITEM_SHEET_URL, itemIconCell } from '@core/dex/names';
import { GlRenderer, Rgba, Texture } from '@core/gl/gl-renderer';
import { spriteUrl } from '@shared/utils/sprite-id';
import { ImagePriority, SpriteBitmaps } from './sprite-bitmaps';

/** Textures made in one frame at most: a screen drawn from scratch spreads its uploads. */
const UPLOADS_PER_FRAME = 2;

/**
 * The battle screen's images (Showdown's sprites, item icons) as WebGL textures, made from the ones
 * SpriteBitmaps decodes once. On the console any image becomes a texture (probe w1: Brewser doesn't
 * apply CORS); desktop browsers refuse Showdown's sprites, whose server sends no CORS headers. A back
 * sprite that doesn't exist (some new Megas) falls back to the front one.
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

  /** Any other image of the screen (a move category's icon), smoothed when scaled. */
  image(url: string, priority: ImagePriority = ImagePriority.Screen): Texture | null {
    if (!url) return null;
    return this.textures.get(url) ?? this.upload(url, priority, true);
  }

  /** Pixel art from a URL (a trainer avatar), sampled without smoothing so its pixels stay square. */
  pixelArt(url: string, priority: ImagePriority = ImagePriority.Screen): Texture | null {
    if (!url) return null;
    return this.textures.get(url) ?? this.upload(url, priority, false);
  }

  /** Asks for an image ahead (the next page of avatars), behind what the screen shows. */
  prefetch(url: string): void {
    if (url && !this.textures.has(url)) this.bitmaps.request(url, ImagePriority.Ahead);
  }

  /**
   * An item's icon, `size` px square: a cell of Showdown's icon sheet (one texture for every item,
   * sampled by coordinates, so no icon files are bundled). Nothing until the sheet has loaded.
   */
  drawItem(item: string, x: number, y: number, size: number, tint: Rgba = [1, 1, 1, 1]): void {
    const cell = item ? itemIconCell(item) : null;
    if (!cell) return;
    // Nearest sampling: smoothing would bleed the neighbouring icons in at the cell's edges.
    const sheet = this.textures.get(ITEM_SHEET_URL) ?? this.upload(ITEM_SHEET_URL, ImagePriority.Screen, false);
    if (!sheet) return;
    const uv = [cell.x / sheet.width, cell.y / sheet.height, (cell.x + ITEM_ICON_SIZE) / sheet.width, (cell.y + ITEM_ICON_SIZE) / sheet.height] as const;
    this.renderer.rect(x, y, size, size, { fill: tint, texture: sheet, uv });
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
