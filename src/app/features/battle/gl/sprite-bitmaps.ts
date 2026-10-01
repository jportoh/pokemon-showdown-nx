import { Service } from '@angular/core';

/** How soon an image is wanted: what the field shows now, what the screen shows, what may come later. */
export const ImagePriority = { Field: 0, Screen: 1, Ahead: 2 } as const;
export type ImagePriority = (typeof ImagePriority)[keyof typeof ImagePriority];

/** A decoded image, ready to draw (a 2D canvas) or to upload (WebGL). */
export type DecodedImage = ImageBitmap | HTMLImageElement;

type Entry =
  | { state: 'queued'; priority: number }
  | { state: 'loading' }
  | { state: 'ready'; image: DecodedImage; width: number; height: number }
  | { state: 'failed' };

type Listener = (image: DecodedImage | null) => void;

/**
 * EXPERIMENT (feat/webgl-probe): every image the battle screen shows (Pokémon sprites, item icons),
 * decoded once and shared by the WebGL field (as textures) and the DOM tiles (drawn on small
 * canvases). Decoding a PNG blocks the console's main thread (tests w3/w4), so images load one at a
 * time, at most one starting per frame, the most wanted first; fetch + createImageBitmap was the
 * smoothest way on the console (w4), with an Image where it's missing.
 */
@Service()
export class SpriteBitmaps {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private active = 0;
  private pumpHandle = 0;
  /** Told when an image arrives, decoded (diagnostics). */
  onArrival: (() => void) | null = null;

  /** Waiting and loading, for the diagnostics. */
  get queued(): number {
    let count = this.active;
    for (const entry of this.entries.values()) if (entry.state === 'queued') count++;
    return count;
  }

  /** Asks for an image (again: a more urgent ask moves it up the queue). */
  request(url: string, priority: ImagePriority): void {
    const entry = this.entries.get(url);
    if (!entry) {
      this.entries.set(url, { state: 'queued', priority });
      this.schedule();
    } else if (entry.state === 'queued' && priority < entry.priority) {
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
    return state === 'queued' || state === 'loading';
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

  /** Starts the most wanted queued image on the next frame, if none is loading. */
  private schedule(): void {
    if (this.pumpHandle) return;
    this.pumpHandle = requestAnimationFrame(() => {
      this.pumpHandle = 0;
      if (this.active > 0) return;
      let next: string | null = null;
      let best = Infinity;
      for (const [url, entry] of this.entries) {
        if (entry.state === 'queued' && entry.priority < best) {
          next = url;
          best = entry.priority;
        }
      }
      if (next) this.start(next);
    });
  }

  private start(url: string): void {
    this.entries.set(url, { state: 'loading' });
    this.active++;
    const finish = (image: DecodedImage | null, width = 0, height = 0) => {
      this.active--;
      this.entries.set(url, image ? { state: 'ready', image, width, height } : { state: 'failed' });
      const listeners = this.listeners.get(url);
      this.listeners.delete(url);
      listeners?.forEach((listener) => listener(image));
      this.onArrival?.();
      this.schedule();
    };
    if (typeof createImageBitmap === 'function') {
      fetch(url)
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
        .then((blob) => createImageBitmap(blob, { premultiplyAlpha: 'premultiply' }))
        .then((bitmap) => finish(bitmap, bitmap.width || 96, bitmap.height || 96))
        .catch(() => finish(null));
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => finish(image, image.naturalWidth || image.width || 96, image.naturalHeight || image.height || 96));
    image.addEventListener('error', () => finish(null));
    image.src = url;
  }
}
