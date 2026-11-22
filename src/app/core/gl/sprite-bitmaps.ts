import { Service } from '@angular/core';
import { RawImage, decodePng, decodeRaw } from './png-decode';

/** How soon an image is wanted: what the field shows now, what the screen shows, what may come later. */
export const ImagePriority = { Field: 0, Screen: 1, Ahead: 2 } as const;
export type ImagePriority = (typeof ImagePriority)[keyof typeof ImagePriority];

/** A decoded image, ready to upload (WebGL): the browser's, or our own pixels (decodePng). */
export type DecodedImage = ImageBitmap | HTMLImageElement | RawImage;

/**
 * Downloads at once: waiting on the network costs the main thread nothing. More doesn't help on the
 * console, which takes ~100 ms per request however many run at once (test p3).
 */
const MAX_DOWNLOADS = 6;
/** Time spent decoding in JavaScript per frame: on the menus, and on the loading screen (rush). */
const FRAME_DECODE_MS = 6;
const RUSH_DECODE_MS = 40;

type Entry =
  | { state: 'queued'; priority: number }
  | { state: 'downloading'; priority: number }
  | { state: 'downloaded'; priority: number; bytes: Uint8Array }
  | { state: 'decoding' }
  | { state: 'ready'; image: DecodedImage; width: number; height: number; at: number }
  | { state: 'failed' }
  /** Made into a texture: the decoded image is gone (GlSprites keeps the texture). */
  | { state: 'released' };

type Listener = (image: DecodedImage | null) => void;

/**
 * Every image the battle screen shows (Pokémon sprites, item icons), decoded once and shared by
 * everything that draws it, for as long as the app runs (the next battle's Pokémon may already be
 * there). Several download at once (test w6: one image at a time from end to end, the team tiles
 * waited for each other's network round trips), and they decode the most wanted first. The console's
 * createImageBitmap takes about 100 ms per sprite (test p1), so PNGs decode in JavaScript (decodePng),
 * a few milliseconds' worth per frame; the browser decodes what decodePng can't, one at a time
 * (createImageBitmap, or an Image where it's missing).
 */
@Service()
export class SpriteBitmaps {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private downloads = 0;
  private decoding = false;
  private pumpHandle = 0;
  private readonly bitmaps = typeof createImageBitmap === 'function';
  /** Decodes in JavaScript first (decodePng); 'browser' leaves it all to createImageBitmap. */
  decoder: 'js' | 'browser' = 'js';
  /** Told when an image arrives, decoded (diagnostics). */
  onArrival: (() => void) | null = null;
  /**
   * Decodes back to back (the loading screen, where a stutter costs nothing): more JavaScript decoding
   * per frame, and the browser's next decode without waiting for the next frame.
   */
  rush = false;

  /** Not ready yet (waiting, downloading or decoding), for the diagnostics. */
  get queued(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.state !== 'ready' && entry.state !== 'failed' && entry.state !== 'released') count++;
    return count;
  }

  /** Asks for an image (again: a more urgent ask moves it up both queues). */
  request(url: string, priority: ImagePriority): void {
    const entry = this.entries.get(url);
    if (!entry) {
      this.entries.set(url, { state: 'queued', priority });
      this.schedule();
    } else if ('priority' in entry && priority < entry.priority) {
      entry.priority = priority;
    }
  }

  /** The decoded image once it's there, with its size. */
  get(url: string): { image: DecodedImage; width: number; height: number } | null {
    const entry = this.entries.get(url);
    return entry?.state === 'ready' ? entry : null;
  }

  failed(url: string): boolean {
    return this.entries.get(url)?.state === 'failed';
  }

  /** Still to come. */
  pending(url: string): boolean {
    const state = this.entries.get(url)?.state;
    return state !== undefined && state !== 'ready' && state !== 'failed' && state !== 'released';
  }

  /**
   * Lets a decoded image go once its texture is made (25 MB of sprites, test p1): the GPU has the
   * copy that's drawn. It isn't decoded again.
   */
  release(url: string): void {
    const entry = this.entries.get(url);
    if (entry?.state !== 'ready') return;
    if ('close' in entry.image) entry.image.close();
    this.entries.set(url, { state: 'released' });
  }

  /** Forgets an image whose texture was let go (GlSprites): asked for again, it downloads and decodes again. */
  forget(url: string): void {
    const entry = this.entries.get(url);
    if (entry?.state === 'released') this.entries.delete(url);
  }

  /**
   * Lets go of images decoded more than `idleMs` ago that nothing has made into a texture (a team
   * preview's Megas that never came out, avatars fetched ahead): asked for again, they load again.
   */
  dropUnclaimed(idleMs: number): void {
    const before = performance.now() - idleMs;
    for (const [url, entry] of this.entries) {
      if (entry.state !== 'ready' || entry.at > before || this.listeners.has(url)) continue;
      if ('close' in entry.image) entry.image.close();
      this.entries.delete(url);
    }
  }

  /** Decoded images waiting to become textures, and their pixels in bytes (the diagnostics). */
  get unclaimed(): { count: number; bytes: number } {
    let count = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      if (entry.state !== 'ready') continue;
      count++;
      bytes += entry.width * entry.height * 4;
    }
    return { count, bytes };
  }

  /**
   * Calls `listener` once the image is there (straight away if it is), or with null if it can't be
   * loaded. Returns a function that stops listening.
   */
  whenReady(url: string, priority: ImagePriority, listener: Listener): () => void {
    this.request(url, priority);
    const entry = this.entries.get(url)!;
    if (entry.state === 'ready') {
      listener(entry.image);
      return () => undefined;
    }
    if (entry.state === 'failed') {
      listener(null);
      return () => undefined;
    }
    let set = this.listeners.get(url);
    if (!set) this.listeners.set(url, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  /** On the next frame: starts the downloads there's room for, and the most wanted decode if none is running. */
  private schedule(): void {
    if (this.pumpHandle) return;
    this.pumpHandle = requestAnimationFrame(() => {
      this.pumpHandle = 0;
      this.pump();
    });
  }

  /** After a decode: the next one straight away when rushing, else on the next frame. */
  private next(): void {
    if (this.rush) this.pump();
    else this.schedule();
  }

  private pump(): void {
    if (!this.bitmaps && this.decoder === 'browser') {
      // An Image downloads and decodes in one go: one at a time, as before.
      if (!this.decoding) {
        const next = this.mostWanted('queued');
        if (next) this.loadImage(next);
      }
      return;
    }
    while (this.downloads < MAX_DOWNLOADS) {
      const next = this.mostWanted('queued');
      if (!next) break;
      this.download(next);
    }
    if (this.decoding) return;
    const deadline = performance.now() + (this.rush ? RUSH_DECODE_MS : FRAME_DECODE_MS);
    for (let next = this.mostWanted('downloaded'); next; next = this.mostWanted('downloaded')) {
      // The browser's decode calls next() when it's done.
      if (!this.decode(next)) return;
      if (performance.now() >= deadline) {
        if (this.mostWanted('downloaded')) this.schedule();
        return;
      }
    }
  }

  /** The queued (or downloaded) image wanted the soonest, the first asked for among equals. */
  private mostWanted(state: 'queued' | 'downloaded'): string | null {
    let next: string | null = null;
    let best = Infinity;
    for (const [url, entry] of this.entries) {
      if (entry.state === state && entry.priority < best) {
        next = url;
        best = entry.priority;
      }
    }
    return next;
  }

  private download(url: string): void {
    const entry = this.entries.get(url) as { priority: number };
    this.entries.set(url, { state: 'downloading', priority: entry.priority });
    this.downloads++;
    fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
      .then((buffer) => {
        const current = this.entries.get(url) as { priority: number };
        this.entries.set(url, { state: 'downloaded', priority: current.priority, bytes: new Uint8Array(buffer) });
      })
      .catch(() => this.finish(url, null))
      .finally(() => {
        this.downloads--;
        this.schedule();
      });
  }

  /** Decodes a downloaded image: true if it's done (in JavaScript), false while the browser decodes it. */
  private decode(url: string): boolean {
    const entry = this.entries.get(url);
    if (entry?.state !== 'downloaded') return true;
    // Already pixels (the native build's pre-decoded sheets): nothing to decode.
    const raw = decodeRaw(entry.bytes);
    if (raw) {
      this.finish(url, raw, raw.width, raw.height);
      return true;
    }
    if (this.decoder === 'js') {
      let image: RawImage | null = null;
      try {
        image = decodePng(entry.bytes);
      } catch {
        image = null;
      }
      if (image) {
        this.finish(url, image, image.width, image.height);
        return true;
      }
    }
    if (!this.bitmaps) {
      this.loadImage(url);
      return false;
    }
    this.entries.set(url, { state: 'decoding' });
    this.decoding = true;
    createImageBitmap(new Blob([entry.bytes as BlobPart]), { premultiplyAlpha: 'premultiply' })
      .then((bitmap) => this.finish(url, bitmap, bitmap.width || 96, bitmap.height || 96))
      .catch(() => this.finish(url, null))
      .finally(() => {
        this.decoding = false;
        this.next();
      });
    return false;
  }

  private loadImage(url: string): void {
    this.entries.set(url, { state: 'decoding' });
    this.decoding = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const done = (ok: boolean) => {
      this.decoding = false;
      this.finish(url, ok ? image : null, image.naturalWidth || image.width || 96, image.naturalHeight || image.height || 96);
      this.next();
    };
    image.addEventListener('load', () => done(true));
    image.addEventListener('error', () => done(false));
    image.src = url;
  }

  private finish(url: string, image: DecodedImage | null, width = 0, height = 0): void {
    this.entries.set(url, image ? { state: 'ready', image, width, height, at: performance.now() } : { state: 'failed' });
    const listeners = this.listeners.get(url);
    this.listeners.delete(url);
    listeners?.forEach((listener) => listener(image));
    this.onArrival?.();
  }
}
