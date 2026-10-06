import { inject } from '@angular/core';
import { GRAPH_COLORS, GlDiagnostics, LONG_FRAME_MS } from './gl-diagnostics';
import { Rgba, rgba } from './gl-renderer';
import type { StageFrame } from './gl-stage';
import { SpriteBitmaps } from './sprite-bitmaps';

const TITLE: Rgba = rgba('#a7f3d0');
const WHITE: Rgba = [1, 1, 1, 1];
const WIDTH = 380;
/** How often the numbers are worked out again (the graph moves every frame). */
const UPDATE_MS = 500;

/**
 * The frame-time diagnostics the stage shows over any screen (L3): frame rate, stutters and what
 * came before them, the text and image caches, draw calls, and a graph of the last frames. `extra`
 * adds the shown screen's own lines. Made in an injection context (the stage's field).
 */
export class PerfHud {
  private readonly diagnostics = inject(GlDiagnostics);
  private readonly bitmaps = inject(SpriteBitmaps);
  shown = false;
  private lines: string[] = [];
  private updated = 0;
  private deferredBefore = 0;
  /** GlRenderer.lastFlushMs over the frames since the last update. */
  private flushTotal = 0;
  private flushMax = 0;
  private flushFrames = 0;

  constructor(
    private readonly extra: () => string[] = () => [],
  ) {}

  toggle(): boolean {
    this.shown = !this.shown;
    return true;
  }

  /** Over the frame's drawing, before renderer.end(); `right` is the stage's right edge. */
  draw({ renderer, overlayText: text, text: texts, images, now }: StageFrame, right: number): void {
    if (!this.shown) return;
    this.flushTotal += renderer.lastFlushMs;
    this.flushMax = Math.max(this.flushMax, renderer.lastFlushMs);
    this.flushFrames++;
    if (now - this.updated > UPDATE_MS) {
      const flush = `GL flush ${(this.flushTotal / Math.max(1, this.flushFrames)).toFixed(1)} ms (max ${this.flushMax.toFixed(1)})`;
      this.flushTotal = this.flushMax = this.flushFrames = 0;
      const seconds = this.updated > 0 ? (now - this.updated) / 1000 : 1;
      this.updated = now;
      const frames = this.diagnostics.frameSummary();
      const render = this.diagnostics.summary('render');
      const uploads = this.diagnostics.summary('text');
      const arrivals = this.diagnostics.summary('arrival');
      const socket = this.diagnostics.summary('socket');
      const audio = this.diagnostics.summary('audio');
      const recent = this.diagnostics.frames.slice(-60);
      const average = recent.reduce((sum, f) => sum + f.interval, 0) / Math.max(1, recent.length);
      const fps = average > 0 ? Math.round(1000 / average) : 0;
      const deferred = Math.round((texts.deferred - this.deferredBefore) / seconds);
      this.deferredBefore = texts.deferred;
      const sprites = images.stats;
      const words = texts.stats;
      const waiting = this.bitmaps.unclaimed;
      this.lines = [
        `${fps} fps · ${frames.long} stutters (> ${LONG_FRAME_MS} ms) · worst ${Math.round(frames.worst)} ms`,
        `Our frame ${frames.ownAvg.toFixed(1)} ms (max ${frames.ownMax.toFixed(1)}) · ${renderer.lastDrawCalls} draw calls`,
        `${flush}: GPU stalls show here`,
        `Outside our frame ${frames.outsideAvg.toFixed(1)} ms a frame (~9 at 60 fps: the rest is other work)`,
        `Text uploads: ${uploads.count}/s · ${uploads.total.toFixed(1)} ms · longest ${uploads.max.toFixed(1)} ms · held back ${deferred}/s`,
        `Angular renders: ${render.count}/s · longest ${render.max.toFixed(1)} ms`,
        `Server messages: ${socket.count}/s · ${socket.total.toFixed(1)} ms · longest ${socket.max.toFixed(1)} ms`,
        `Audio synthesis: ${audio.total.toFixed(1)} ms/s · longest ${audio.max.toFixed(1)} ms`,
        `Images: ${this.bitmaps.queued} to load · ${arrivals.count}/s arrived`,
        `Memory: ${sprites.count} images ${megabytes(sprites.bytes)} · ${words.count} texts ${megabytes(words.bytes)} · ${waiting.count} decoded ${megabytes(waiting.bytes)}`,
        ...this.diagnostics.loading,
        ...this.extra(),
        'L3 hides this',
      ];
    }
    const x = right - WIDTH - 8;
    const y = 54;
    const graphTop = y + 6 + this.lines.length * 17;
    renderer.rect(x, y, WIDTH, graphTop - y + 80, { fill: [0, 0, 0, 0.7], radius: 8 });
    this.lines.forEach((line, i) => {
      const texture = text.get(line, { size: 12, bold: i === 0 });
      if (texture) renderer.image(texture, x + 8, y + 6 + i * 17, Math.min(1, (WIDTH - 16) / texture.width), i === 0 ? TITLE : WHITE);
    });
    const base = graphTop + 64;
    renderer.rect(x + 8, base - 16.7, 300, 1, { fill: [1, 1, 1, 0.3] });
    renderer.rect(x + 8, base - 33.3, 300, 1, { fill: [1, 0.4, 0.4, 0.4] });
    this.diagnostics.frames.forEach((f, i) => {
      const h = Math.min(60, f.interval);
      const color = f.interval <= 20 ? GRAPH_COLORS.good : f.interval <= LONG_FRAME_MS ? GRAPH_COLORS.slow : GRAPH_COLORS.long;
      renderer.rect(x + 8 + i * 2, base - h, 2, h, { fill: color });
      if (f.render) renderer.rect(x + 8 + i * 2, base + 2, 2, 3, { fill: GRAPH_COLORS.render });
      if (f.upload) renderer.rect(x + 8 + i * 2, base + 5, 2, 3, { fill: GRAPH_COLORS.upload });
      if (f.arrival) renderer.rect(x + 8 + i * 2, base + 8, 2, 3, { fill: GRAPH_COLORS.arrival });
    });
  }
}

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
