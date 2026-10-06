import { ITEM_ICON_SIZE, ITEM_SHEET_URL, itemIconCell } from '@core/dex/names';
import { GlRenderer, Rgba, Texture } from '@core/gl/gl-renderer';
import { SpriteSet, spriteUrl } from '@shared/utils/sprite-id';
import { ImagePriority, SpriteBitmaps } from './sprite-bitmaps';
import { SPRITE_SHEET_URLS, SheetSprite, sheetSprite } from './sprite-sheets';

/** Textures made in one frame at most: a screen drawn from scratch spreads its uploads. */
export const UPLOADS_PER_FRAME = 2;
/** How often unused textures are looked for. */
const SWEEP_MS = 10_000;
/** A texture not drawn for this long goes (the last battle's Pokémon, avatars paged past). */
const IDLE_TEXTURE_MS = 90_000;
/** A decoded image nothing made into a texture for this long goes too (a preview's Megas that never came out). */
const IDLE_IMAGE_MS = 300_000;

/**
 * The battle screen's images (Showdown's sprites, item icons) as WebGL textures, made from the ones
 * SpriteBitmaps decodes once. On the console any image becomes a texture (probe w1: Brewser doesn't
 * apply CORS); desktop browsers refuse Showdown's sprites, whose server sends no CORS headers. A back
 * sprite that doesn't exist (some new Megas) falls back to the front one. Champions sprites come from
 * the sheets bundled with the app (sprite-sheets.ts): one texture per sheet, each sprite a part of it.
 * Once a texture is made, its decoded image is let go (the GPU keeps the copy that's drawn). A texture
 * not drawn for a while is let go too, so a long session doesn't pile up every sprite it ever showed;
 * the bundled sheets, the item icons and what the loading screen made stay for good.
 */
export class GlSprites {
  private readonly textures = new Map<string, Texture>();
  /** Sprites in a sheet: its texture, with their part of it. */
  private readonly views = new Map<string, Texture>();
  /** When each texture was last asked for (the frame's time). */
  private readonly lastUsed = new Map<string, number>();
  /** Textures that are never let go. */
  private readonly kept = new Set<string>([...SPRITE_SHEET_URLS, ITEM_SHEET_URL]);
  private now = 0;
  private lastSweep = 0;
  private uploadsLeft = UPLOADS_PER_FRAME;
  /** Textures made per frame at most (the loading screen raises it while nothing else draws). */
  uploadsPerFrame = UPLOADS_PER_FRAME;
  /** Told how long each texture took to upload (diagnostics). */
  onUpload: ((ms: number) => void) | null = null;

  constructor(
    private readonly renderer: GlRenderer,
    private readonly bitmaps: SpriteBitmaps,
  ) {}

  /** Each frame, before drawing: the frame's upload budget, and now and then the unused textures go. */
  startFrame(now: number): void {
    this.uploadsLeft = this.uploadsPerFrame;
    this.now = now;
    if (now - this.lastSweep < SWEEP_MS) return;
    this.lastSweep = now;
    for (const [url, used] of this.lastUsed) {
      if (now - used < IDLE_TEXTURE_MS) continue;
      const texture = this.textures.get(url);
      if (texture) this.renderer.deleteTexture(texture);
      this.textures.delete(url);
      this.lastUsed.delete(url);
      this.bitmaps.forget(url);
    }
    this.bitmaps.dropUnclaimed(IDLE_IMAGE_MS);
  }

  /** The textures made, and their pixels in bytes (the diagnostics). */
  get stats(): { count: number; bytes: number } {
    let bytes = 0;
    for (const texture of this.textures.values()) bytes += texture.width * texture.height * 4;
    return { count: this.textures.size, bytes };
  }

  /** This frame still has room for an upload. */
  get canUpload(): boolean {
    return this.uploadsLeft > 0;
  }

  /**
   * Makes `url`'s texture ahead of its screen (the loading screen), as sprite(), image() or
   * pixelArt() would (`smooth` as image()). True once it's there, or can't be.
   */
  warm(url: string, smooth: boolean): boolean {
    this.kept.add(url);
    if (this.textures.has(url) || this.bitmaps.failed(url)) return true;
    return this.upload(url, ImagePriority.Screen, smooth) !== null;
  }

  /** A sprite on the field: first in line. Null until it's there. */
  get(sprite: string, back: boolean, set: SpriteSet = 'gen5'): Texture | null {
    return this.sprite(sprite, back, ImagePriority.Field, set);
  }

  /**
   * A sprite elsewhere on the screen (team tiles, cards), as soon as `priority` allows. Gen 3's sprites
   * come from Showdown alone (the sheets are Black/White's), falling back to the gen5 one when the
   * species has none.
   */
  sprite(sprite: string, back: boolean, priority: ImagePriority, set: SpriteSet = 'gen5'): Texture | null {
    if (!sprite) return null;
    const sheet = set === 'gen5' ? sheetSprite(sprite, back) : null;
    // A sheet that can't be loaded leaves its sprites to Showdown.
    if (sheet && !this.bitmaps.failed(sheet.url)) return this.inSheet(`${back ? 'back' : 'front'}:${sprite}`, sheet, priority);
    const url = spriteUrl(sprite, back, set);
    const texture = this.lookup(url);
    if (texture) return texture;
    if (set !== 'gen5' && this.bitmaps.failed(url)) return this.sprite(sprite, back, priority);
    if (back && this.bitmaps.failed(url)) return this.sprite(sprite, false, priority);
    return this.upload(url, priority, false);
  }

  /** Any other image of the screen (a move category's icon), smoothed when scaled. */
  image(url: string, priority: ImagePriority = ImagePriority.Screen): Texture | null {
    if (!url) return null;
    return this.lookup(url) ?? this.upload(url, priority, true);
  }

  /** Pixel art from a URL (a trainer avatar), sampled without smoothing so its pixels stay square. */
  pixelArt(url: string, priority: ImagePriority = ImagePriority.Screen): Texture | null {
    if (!url) return null;
    return this.lookup(url) ?? this.upload(url, priority, false);
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
  pending(sprite: string, back: boolean, set: SpriteSet = 'gen5'): boolean {
    if (!sprite) return false;
    const sheet = set === 'gen5' ? sheetSprite(sprite, back) : null;
    if (sheet && !this.bitmaps.failed(sheet.url)) return !this.textures.has(sheet.url);
    const url = spriteUrl(sprite, back, set);
    if (this.textures.has(url)) return false;
    if (set !== 'gen5' && this.bitmaps.failed(url)) return this.pending(sprite, back);
    if (back && this.bitmaps.failed(url)) return this.pending(sprite, false);
    return !this.bitmaps.failed(url);
  }

  dispose(): void {
    for (const texture of this.textures.values()) this.renderer.deleteTexture(texture);
    this.textures.clear();
    this.views.clear();
    this.lastUsed.clear();
  }

  /** A sprite's part of its sheet, once the sheet's texture is made. */
  private inSheet(key: string, sheet: SheetSprite, priority: ImagePriority): Texture | null {
    const view = this.views.get(key);
    if (view) return view;
    const texture = this.textures.get(sheet.url) ?? this.upload(sheet.url, priority, false);
    if (!texture) return null;
    const made = { handle: texture.handle, width: sheet.width, height: sheet.height, uv: sheet.uv };
    this.views.set(key, made);
    return made;
  }

  /** The texture once the image is decoded and this frame still has room for an upload. */
  private upload(url: string, priority: ImagePriority, smooth: boolean): Texture | null {
    this.bitmaps.request(url, priority);
    const decoded = this.bitmaps.get(url);
    if (!decoded || this.uploadsLeft <= 0) return null;
    this.uploadsLeft--;
    try {
      const started = performance.now();
      const { image, width, height } = decoded;
      // Our own decoder's pixels come premultiplied already.
      const made = 'pixels' in image ? this.renderer.textureFromPixels(image.pixels, width, height, smooth) : this.renderer.textureFromSource(image, width, height, smooth);
      this.onUpload?.(performance.now() - started);
      this.textures.set(url, made);
      if (!this.kept.has(url)) this.lastUsed.set(url, this.now);
      this.bitmaps.release(url);
      return made;
    } catch {
      return null;
    }
  }

  /** A texture already made, marked as used this frame (the sheets and what's kept for good don't need it). */
  private lookup(url: string): Texture | undefined {
    const texture = this.textures.get(url);
    if (texture && !this.kept.has(url)) this.lastUsed.set(url, this.now);
    return texture;
  }
}
