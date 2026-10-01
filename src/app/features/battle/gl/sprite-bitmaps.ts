import { Service } from '@angular/core';

/** How soon an image is wanted: what the field shows now, what the screen shows, what may come later. */
export const ImagePriority = { Field: 0, Screen: 1, Ahead: 2 } as const;
export type ImagePriority = (typeof ImagePriority)[keyof typeof ImagePriority];

/** A decoded image, ready to draw (a 2D canvas) or to upload (WebGL). */
export type DecodedImage = ImageBitmap | HTMLImageElement;

/** Downloads at once: waiting on the network costs the main thread nothing. */
const MAX_DOWNLOADS = 6;

type Entry =
  | { state: 'queued'; priority: number }
  | { state: 'downloading'; priority: number }
  | { state: 'downloaded'; priority: number; blob: Blob }
  | { state: 'decoding' }
  | { state: 'ready'; image: DecodedImage; width: number; height: number }
  | { state: 'failed' };

type Listener = (image: DecodedImage | null) => void;

/**
 * Every image the battle screen shows (Pokémon sprites, item icons), decoded once and shared by
 * everything that draws it, for as long as the app runs (the next battle's Pokémon may already be
 * there). Decoding a PNG blocks the console's main thread (tests w3/w4), so images decode one at a
 * time, at most one starting per frame, the most wanted first. Downloading them doesn't block it, so
 * several download at once (test w6: one image at a time from end to end, the team tiles waited for
 * each other's network round trips). fetch + createImageBitmap was the smoothest way on the console
 * (w4); where createImageBitmap is missing, an Image does both steps, one at a time.
 */
@Service()
export class SpriteBitmaps {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private downloads = 0;
  private decoding = false;
  private pumpHandle = 0;
  private readonly bitmaps = typeof createImageBitmap === 'function';
  /** Told when an image arrives, decoded (diagnostics). */
  onArrival: (() => void) | null = null;

  /** Not ready yet (waiting, downloading or decoding), for the diagnostics. */
  get queued(): number {
    let count = 0;
    for (const entry of this.entries.values()) if (entry.state !== 'ready' && entry.state !== 'failed') count++;
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
    return state !== undefined && state !== 'ready' && state !== 'failed';
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
      if (!this.bitmaps) {
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
      if (!this.decoding) {
        const next = this.mostWanted('downloaded');
        if (next) this.decode(next);
      }
    });
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
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
      .then((blob) => {
        const current = this.entries.get(url) as { priority: number };
        this.entries.set(url, { state: 'downloaded', priority: current.priority, blob });
      })
      .catch(() => this.finish(url, null))
      .finally(() => {
        this.downloads--;
        this.schedule();
      });
  }

  private decode(url: string): void {
    const entry = this.entries.get(url);
    if (entry?.state !== 'downloaded') return;
    this.entries.set(url, { state: 'decoding' });
    this.decoding = true;
    createImageBitmap(entry.blob, { premultiplyAlpha: 'premultiply' })
      .then((bitmap) => this.finish(url, bitmap, bitmap.width || 96, bitmap.height || 96))
      .catch(() => this.finish(url, null))
      .finally(() => {
        this.decoding = false;
        this.schedule();
      });
  }

  private loadImage(url: string): void {
    this.entries.set(url, { state: 'decoding' });
    this.decoding = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const done = (ok: boolean) => {
      this.decoding = false;
      this.finish(url, ok ? image : null, image.naturalWidth || image.width || 96, image.naturalHeight || image.height || 96);
      this.schedule();
    };
    image.addEventListener('load', () => done(true));
    image.addEventListener('error', () => done(false));
    image.src = url;
  }

  private finish(url: string, image: DecodedImage | null, width = 0, height = 0): void {
    this.entries.set(url, image ? { state: 'ready', image, width, height } : { state: 'failed' });
    const listeners = this.listeners.get(url);
    this.listeners.delete(url);
    listeners?.forEach((listener) => listener(image));
    this.onArrival?.();
  }
}
