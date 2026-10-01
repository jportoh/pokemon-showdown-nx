import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { AssetPreload } from '@core/gl/asset-preload';
import { Texture, rgba } from '@core/gl/gl-renderer';
import { GlStage, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { UPLOADS_PER_FRAME } from '@core/gl/gl-sprites';
import { pixelTexture } from '@core/gl/gl-textures';
import { decodePng } from '@core/gl/png-decode';
import { ImagePriority, MAX_DOWNLOADS, SpriteBitmaps } from '@core/gl/sprite-bitmaps';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { UiContext, label, pill, retroBox } from '@core/gl/ui/retro-kit';
import { CanvasAction } from '@core/input/keyboard-navigation';
import { ChampionsDex } from '@core/dex/champions-dex';
import { BALL } from '@features/home/gl/logo-ball';
import { PreloadAsset, preloadList } from '@features/loading/data/preload-list';

/** Textures made per frame while loading (the menu's screens make 2: nothing else is drawn here). */
const LOADING_UPLOADS = 8;
/**
 * Downloads at once while loading. Test p2: each async step on the console takes ~100 ms however
 * small (createImageBitmap 30 one by one 2.9 s, all at once 0.2 s), so 6 at a time took 70 s.
 */
const LOADING_DOWNLOADS = 32;
const LOGO_YELLOW = rgba('#f2c14e');
const BAR = { x: 320, y: 392, w: 640, h: 28 };
/** A frame longer than this is a visible stutter (two refreshes or more at 60 Hz). */
const LONG_FRAME_MS = 25;
const MB = 1024 * 1024;
/** Sprites the decoders are timed on before loading (test build). */
const BENCHMARK_SPRITES = 30;

/** What the test build shows once everything is loaded, to read off the console. */
interface LoadReport {
  lines: string[];
}

/**
 * The first screen of a launch: the logo, a bar and "Loading assets…" while every image the app
 * shows (preloadList) downloads, decodes and becomes a texture, so no screen waits for one later.
 * Decoding blocks the console's main thread, which costs nothing here: decodes run back to back
 * (SpriteBitmaps.rush) and more textures are made per frame than elsewhere.
 *
 * TEST BUILD: first it times three ways of decoding the same sprites (test p1: the console's
 * createImageBitmap took 100 ms per sprite); once done, it shows the times and sizes and waits for A.
 */
@Component({
  selector: 'app-loading-scene',
  template: '',
})
export class LoadingScene {
  private readonly router = inject(Router);
  private readonly stage = inject(GlStage);
  private readonly theme = inject(GlTheme);
  private readonly bitmaps = inject(SpriteBitmaps);
  private readonly preload = inject(AssetPreload);

  private readonly focus = new CanvasFocus();
  private readonly assets: readonly PreloadAsset[] = preloadList(inject(ChampionsDex));
  /** Not a texture yet (nor failed). */
  private waiting: PreloadAsset[] = [...this.assets];
  private started = performance.now();
  /** The decoders' times (test build), and whether loading has begun. */
  private benchmark = '';
  private downloadBenchmark = '';
  private loading = false;
  /** Every image downloaded and decoded (or failed). */
  private decodedAt = 0;
  private finishedAt = 0;
  private uploadMs = 0;
  private lastFrame = 0;
  private worstFrame = 0;
  private longFrames = 0;
  private report: LoadReport | null = null;
  private ball: Texture | null = null;

  constructor() {
    if (this.preload.finished()) {
      void this.router.navigateByUrl('/', { replaceUrl: true });
      return;
    }
    this.bitmaps.rush = true;
    this.bitmaps.maxDownloads = LOADING_DOWNLOADS;
    void this.timeDecoders().then(() => this.startLoading());
    const hide = this.stage.show({
      draw: (frame) => this.draw(frame),
      input: (action) => this.onAction(action),
    });
    this.stage.whenReady(({ renderer, images }) => {
      this.ball = pixelTexture(renderer, BALL);
      images.uploadsPerFrame = LOADING_UPLOADS;
    });
    inject(DestroyRef).onDestroy(() => {
      hide();
      this.restore();
      this.stage.whenReady(({ renderer }) => this.ball && renderer.deleteTexture(this.ball));
    });
  }

  private startLoading(): void {
    this.started = performance.now();
    this.loading = true;
    for (const asset of this.assets) this.bitmaps.request(asset.url, asset.kind === 'back' ? ImagePriority.Ahead : ImagePriority.Screen);
  }

  /**
   * TEST BUILD: the same sprites decoded by the browser one by one (as test p1 loaded), by the
   * browser all at once, and in JavaScript (decodePng, what loading now uses).
   */
  private async timeDecoders(): Promise<void> {
    const fronts = this.assets.filter((asset) => asset.kind === 'front').map((asset) => asset.url);
    const get = (url: string) => fetch(url).then((response) => response.arrayBuffer()).then((buffer) => new Uint8Array(buffer));
    let files: Uint8Array[];
    const downloads: string[] = [];
    try {
      // Different sprites for each, so neither finds the other's in the HTTP cache.
      let started = performance.now();
      files = await Promise.all(fronts.slice(0, BENCHMARK_SPRITES).map(get));
      downloads.push(`all at once ${(performance.now() - started).toFixed(0)} ms`);
      started = performance.now();
      const queue = fronts.slice(BENCHMARK_SPRITES, BENCHMARK_SPRITES * 2);
      const lane = async () => {
        for (let url = queue.shift(); url; url = queue.shift()) await get(url);
      };
      await Promise.all(Array.from({ length: MAX_DOWNLOADS }, lane));
      downloads.push(`${MAX_DOWNLOADS} at a time ${(performance.now() - started).toFixed(0)} ms`);
      started = performance.now();
      const one = fronts.slice(BENCHMARK_SPRITES * 2, BENCHMARK_SPRITES * 2 + 10);
      for (const url of one) await get(url);
      downloads.push(`10 one by one ${(performance.now() - started).toFixed(0)} ms`);
    } catch {
      this.benchmark = 'Decoders: sprites not downloaded';
      return;
    }
    this.downloadBenchmark = `Downloads (${BENCHMARK_SPRITES} sprites): ${downloads.join(' · ')}`;
    const parts: string[] = [];
    if (typeof createImageBitmap === 'function') {
      const decode = (file: Uint8Array) => createImageBitmap(new Blob([file as BlobPart]), { premultiplyAlpha: 'premultiply' }).then((bitmap) => bitmap.close?.());
      let started = performance.now();
      for (const file of files) await decode(file).catch(() => undefined);
      parts.push(`browser one by one ${(performance.now() - started).toFixed(0)} ms`);
      started = performance.now();
      await Promise.all(files.map((file) => decode(file).catch(() => undefined)));
      parts.push(`all at once ${(performance.now() - started).toFixed(0)} ms`);
    }
    const started = performance.now();
    const decoded = files.filter((file) => decodePng(file) !== null).length;
    parts.push(`JavaScript ${(performance.now() - started).toFixed(0)} ms (${decoded} ok)`);
    this.benchmark = `Decoders (${files.length} sprites): ${parts.join(' · ')}`;
  }

  private onAction(action: CanvasAction): boolean {
    if (action === 'accept' && this.report) void this.router.navigateByUrl('/', { replaceUrl: true });
    return true;
  }

  /** Back to the menu's pace. */
  private restore(): void {
    this.bitmaps.rush = false;
    this.bitmaps.maxDownloads = MAX_DOWNLOADS;
    this.stage.whenReady(({ images }) => (images.uploadsPerFrame = UPLOADS_PER_FRAME));
  }

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    if (this.loading && !this.finishedAt) {
      this.load(frame);
      this.measureFrame(now);
    }
    renderer.begin(now / 1000, p.bg, p.rim);
    this.focus.begin();

    if (this.ball) renderer.image(this.ball, (STAGE_W - 120) / 2, 116, 5);
    const style = { size: 64, bold: true };
    const first = ctx.text.measure('POKÉMON', style);
    const whole = first + 16 + ctx.text.measure('SHOWDOWN!', style);
    const left = (STAGE_W - whole) / 2;
    label(ctx, 'POKÉMON', left, 310, style, [1, 1, 1, 1]);
    label(ctx, 'SHOWDOWN!', left + first + 16, 310, style, LOGO_YELLOW);

    const total = this.assets.length;
    const done = total - this.waiting.length;
    renderer.rect(BAR.x, BAR.y, BAR.w, BAR.h, { fill: p.input, stroke: p.outline, radius: 8, border: 3 });
    const filled = Math.round((BAR.w - 12) * (done / Math.max(1, total)));
    if (filled > 0) renderer.rect(BAR.x + 6, BAR.y + 6, filled, BAR.h - 12, { fill: p.accentText, radius: 4 });

    if (this.report) this.drawReport(ctx, this.report);
    else {
      label(ctx, this.loading ? 'Loading assets…' : 'Timing the decoders…', BAR.x, BAR.y + 60, { size: 24 }, p.ink);
      label(ctx, `${done} / ${total}`, BAR.x + BAR.w, BAR.y + 60, { size: 24 }, p.muted, { align: 'right', fast: true });
    }
    this.focus.end();
    renderer.end();
  }

  /** Makes the textures this frame has room for, and notes when each step is over. */
  private load({ images }: StageFrame): void {
    const still: PreloadAsset[] = [];
    for (const asset of this.waiting) {
      if (images.canUpload) {
        const started = performance.now();
        if (images.warm(asset.url, asset.smooth)) {
          this.uploadMs += performance.now() - started;
          continue;
        }
      }
      still.push(asset);
    }
    this.waiting = still;
    if (!this.decodedAt && this.waiting.every((asset) => !this.bitmaps.pending(asset.url))) this.decodedAt = performance.now();
    if (this.waiting.length === 0) this.finish(images.totals);
  }

  private measureFrame(now: number): void {
    if (this.lastFrame) {
      const interval = now - this.lastFrame;
      this.worstFrame = Math.max(this.worstFrame, interval);
      if (interval > LONG_FRAME_MS) this.longFrames++;
    }
    this.lastFrame = now;
  }

  private finish(textures: { count: number; pixels: number }): void {
    this.finishedAt = performance.now();
    this.restore();
    this.preload.finished.set(true);
    const failed = (kind: PreloadAsset['kind']) => this.assets.filter((asset) => asset.kind === kind && this.bitmaps.failed(asset.url)).length;
    const ready = this.assets.filter((asset) => this.bitmaps.get(asset.url)).length;
    const decodedPixels = this.assets.reduce((sum, asset) => {
      const image = this.bitmaps.get(asset.url);
      return sum + (image ? image.width * image.height : 0);
    }, 0);
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
    const { bytes, decodeMs, browserDecodes, downloads, downloadMs } = this.bitmaps.totals;
    this.report = {
      lines: [
        `Images: ${ready} ready of ${this.assets.length} · failed: ${failed('image')} shared, ${failed('front')} fronts, ${failed('back')} backs`,
        `Time: ${seconds(this.finishedAt - this.started)} in all · downloaded + decoded in ${seconds(this.decodedAt - this.started)}`,
        `Downloaded: ${(bytes / MB).toFixed(1)} MB, ${LOADING_DOWNLOADS} at a time, ${(downloadMs / Math.max(1, downloads)).toFixed(0)} ms each · decoding: ${seconds(decodeMs)} (${(decodeMs / Math.max(1, ready)).toFixed(1)} ms each, ${browserDecodes} by the browser)`,
        `Textures: ${textures.count} made, ${seconds(this.uploadMs)} · ${((textures.pixels * 4) / MB).toFixed(1)} MB on the GPU`,
        `Decoded images kept: ${((decodedPixels * 4) / MB).toFixed(1)} MB`,
        memory ? `JS heap: ${(memory.usedJSHeapSize / MB).toFixed(1)} MB used of ${(memory.jsHeapSizeLimit / MB).toFixed(0)} MB` : 'JS heap: not reported',
        `Frames: worst ${this.worstFrame.toFixed(0)} ms · ${this.longFrames} over ${LONG_FRAME_MS} ms`,
        this.benchmark,
        this.downloadBenchmark,
      ],
    };
    console.info(`[preload] ${this.report.lines.join(' | ')}`);
  }

  private drawReport(ctx: UiContext, report: LoadReport): void {
    const p = ctx.palette;
    const box = { x: 120, y: 432, w: 1040, h: 284 };
    retroBox(ctx, box);
    label(ctx, 'Assets loaded', box.x + 24, box.y + 28, { size: 22, bold: true }, p.accentText);
    report.lines.forEach((line, i) => label(ctx, line, box.x + 24, box.y + 56 + i * 24, { size: 18 }, p.ink, { maxWidth: box.w - 48 }));
    const width = pill(ctx, 'A', box.x + box.w - 220, box.y + 28, 28);
    label(ctx, 'Continue', box.x + box.w - 208 + width, box.y + 28, { size: 20 }, p.ink);
  }
}
