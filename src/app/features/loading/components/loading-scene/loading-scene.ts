import { Component, DestroyRef, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CanvasFocus } from '@core/gl/canvas-ui';
import { AssetPreload } from '@core/gl/asset-preload';
import { Texture, rgba } from '@core/gl/gl-renderer';
import { UPLOADS_PER_FRAME } from '@core/gl/gl-sprites';
import { GlStage, STAGE_W, StageFrame } from '@core/gl/gl-stage';
import { pixelTexture } from '@core/gl/gl-textures';
import { ImagePriority, SpriteBitmaps } from '@core/gl/sprite-bitmaps';
import { GlTheme } from '@core/gl/ui/gl-theme';
import { UiContext, label, pill, retroBox } from '@core/gl/ui/retro-kit';
import { CanvasAction } from '@core/input/keyboard-navigation';
import { BALL } from '@features/home/gl/logo-ball';
import { PreloadAsset, preloadList } from '@features/loading/data/preload-list';

/** Textures made per frame while loading (the menu's screens make 2: nothing else is drawn here). */
const LOADING_UPLOADS = 8;
const LOGO_YELLOW = rgba('#f2c14e');
const BAR = { x: 320, y: 392, w: 640, h: 28 };
/** A frame longer than this is a visible stutter (two refreshes or more at 60 Hz). */
const LONG_FRAME_MS = 25;
const MB = 1024 * 1024;

/**
 * The first screen of a launch: the logo, a bar and "Loading assets…" while every image the app
 * shows (preloadList: the item sheet, the move categories and the bundled sheets of Champions sprites)
 * downloads, decodes and becomes a texture, so no screen waits for one later. A stutter costs nothing
 * here, so decoding runs back to back (SpriteBitmaps.rush) and more textures are made per frame.
 *
 * TEST BUILD: once done, it shows the times and sizes and waits for A before the menu.
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
  private readonly assets: readonly PreloadAsset[] = preloadList();
  /** Not a texture yet (nor failed). */
  private waiting: PreloadAsset[] = [...this.assets];
  private readonly started = performance.now();
  /** Every image downloaded and decoded (or failed). */
  private decodedAt = 0;
  private finishedAt = 0;
  private uploadMs = 0;
  private lastFrame = 0;
  private worstFrame = 0;
  private longFrames = 0;
  private report: string[] | null = null;
  private ball: Texture | null = null;

  constructor() {
    if (this.preload.finished()) {
      void this.router.navigateByUrl('/', { replaceUrl: true });
      return;
    }
    this.bitmaps.rush = true;
    for (const asset of this.assets) this.bitmaps.request(asset.url, ImagePriority.Screen);
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

  private onAction(action: CanvasAction): boolean {
    if (action === 'accept' && this.report) void this.router.navigateByUrl('/', { replaceUrl: true });
    return true;
  }

  /** Back to the menu's pace. */
  private restore(): void {
    this.bitmaps.rush = false;
    this.stage.whenReady(({ images }) => (images.uploadsPerFrame = UPLOADS_PER_FRAME));
  }

  private draw(frame: StageFrame): void {
    const p = this.theme.palette();
    const ctx: UiContext = { ...frame, focus: this.focus, palette: p };
    const { renderer, now } = frame;
    if (!this.finishedAt) {
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
      label(ctx, 'Loading assets…', BAR.x, BAR.y + 60, { size: 24 }, p.ink);
      label(ctx, `${done} / ${total}`, BAR.x + BAR.w, BAR.y + 60, { size: 24 }, p.muted, { align: 'right', fast: true });
    }
    this.focus.end();
    renderer.end();
  }

  /** Makes the textures this frame has room for, and notes when each step is over. */
  private load(frame: StageFrame): void {
    const { images } = frame;
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
    if (this.waiting.length === 0) this.finish(frame);
  }

  private measureFrame(now: number): void {
    if (this.lastFrame) {
      const interval = now - this.lastFrame;
      this.worstFrame = Math.max(this.worstFrame, interval);
      if (interval > LONG_FRAME_MS) this.longFrames++;
    }
    this.lastFrame = now;
  }

  private finish({ images, renderer }: StageFrame): void {
    this.finishedAt = performance.now();
    this.restore();
    this.preload.finished.set(true);
    const failed = this.assets.filter((asset) => this.bitmaps.failed(asset.url)).map((asset) => asset.url.split('/').pop());
    const textures = images.totals;
    const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
    const { bytes, decodeMs, browserDecodes, downloads, downloadMs } = this.bitmaps.totals;
    this.report = [
      `Images: ${this.assets.length - failed.length} ready of ${this.assets.length} · failed: ${failed.join(', ') || 'none'}`,
      `Time: ${seconds(this.finishedAt - this.started)} in all · downloaded + decoded in ${seconds(this.decodedAt - this.started)}`,
      `Downloaded: ${(bytes / MB).toFixed(1)} MB, ${(downloadMs / Math.max(1, downloads)).toFixed(0)} ms each · decoding: ${seconds(decodeMs)} (${browserDecodes} by the browser)`,
      `Textures: ${textures.count} made, ${seconds(this.uploadMs)} · ${((textures.pixels * 4) / MB).toFixed(1)} MB on the GPU · largest allowed ${renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE)} px`,
      `Frames: worst ${this.worstFrame.toFixed(0)} ms · ${this.longFrames} over ${LONG_FRAME_MS} ms`,
    ];
    console.info(`[preload] ${this.report.join(' | ')}`);
  }

  private drawReport(ctx: UiContext, lines: string[]): void {
    const p = ctx.palette;
    const box = { x: 120, y: 448, w: 1040, h: 200 };
    retroBox(ctx, box);
    label(ctx, 'Assets loaded', box.x + 24, box.y + 28, { size: 22, bold: true }, p.accentText);
    lines.forEach((line, i) => label(ctx, line, box.x + 24, box.y + 60 + i * 26, { size: 18 }, p.ink, { maxWidth: box.w - 48 }));
    const width = pill(ctx, 'A', box.x + box.w - 220, box.y + 28, 28);
    label(ctx, 'Continue', box.x + box.w - 208 + width, box.y + 28, { size: 20 }, p.ink);
  }
}
