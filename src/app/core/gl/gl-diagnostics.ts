import { ApplicationRef, Service, inject } from '@angular/core';

/** What can take the main thread away from a frame. */
export type DiagnosticKind = 'render' | 'text' | 'sprite' | 'arrival';

interface Sample {
  at: number;
  kind: DiagnosticKind;
  ms: number;
}

/** One frame in the graph: how long since the previous one, and what happened in between. */
export interface FrameSample {
  interval: number;
  /** Our own drawing code's time in that frame. */
  own: number;
  render: boolean;
  upload: boolean;
  /** A sprite arrived (downloaded and decoded) since the frame before. */
  arrival: boolean;
}

const WINDOW_MS = 1000;

/** The graph's colours: frames on time, a little late, stutters; and the marks under them. */
export const GRAPH_COLORS = {
  good: [0.45, 0.85, 0.55, 1] as const,
  slow: [0.95, 0.8, 0.3, 1] as const,
  long: [0.95, 0.35, 0.35, 1] as const,
  render: [0.4, 0.65, 1, 1] as const,
  upload: [1, 0.45, 0.85, 1] as const,
  arrival: [1, 0.9, 0.2, 1] as const,
};
const GRAPH_FRAMES = 150;
/** A frame longer than this is a visible stutter (two refreshes or more at 60 Hz). */
export const LONG_FRAME_MS = 25;

/**
 * EXPERIMENT (feat/webgl-probe): what the main thread does around the WebGL field's frames, to find
 * the stutters on the console: Angular's renders (timed by wrapping ApplicationRef's tick), text and
 * sprite textures uploaded, and the field's own drawing time. The field draws it as a graph.
 */
@Service()
export class GlDiagnostics {
  private samples: Sample[] = [];
  private pendingRender = false;
  private pendingUpload = false;
  private pendingArrival = false;
  readonly frames: FrameSample[] = [];

  constructor() {
    const appRef = inject(ApplicationRef) as unknown as Record<string, unknown>;
    let depth = 0;
    // tick() may call _tick() (or the scheduler _tick() alone): time the outermost one only.
    for (const name of ['tick', '_tick']) {
      const original = appRef[name];
      if (typeof original !== 'function') continue;
      appRef[name] = (...args: unknown[]) => {
        const started = performance.now();
        depth++;
        try {
          return (original as (...a: unknown[]) => unknown).apply(appRef, args);
        } finally {
          depth--;
          if (depth === 0) this.record('render', performance.now() - started);
        }
      };
    }
  }

  record(kind: DiagnosticKind, ms: number): void {
    const now = performance.now();
    this.samples.push({ at: now, kind, ms });
    if (kind === 'render') this.pendingRender = true;
    else if (kind === 'arrival') this.pendingArrival = true;
    else this.pendingUpload = true;
    if (this.samples.length > 400) this.samples = this.samples.filter((s) => now - s.at < WINDOW_MS);
  }

  frame(interval: number, own: number): void {
    this.frames.push({ interval, own, render: this.pendingRender, upload: this.pendingUpload, arrival: this.pendingArrival });
    this.pendingRender = false;
    this.pendingUpload = false;
    this.pendingArrival = false;
    if (this.frames.length > GRAPH_FRAMES) this.frames.shift();
  }

  /** The last second: how many of each and the longest. */
  summary(kind: DiagnosticKind): { count: number; max: number; total: number } {
    const now = performance.now();
    const recent = this.samples.filter((s) => s.kind === kind && now - s.at < WINDOW_MS);
    return { count: recent.length, max: Math.max(0, ...recent.map((s) => s.ms)), total: recent.reduce((sum, s) => sum + s.ms, 0) };
  }

  /** The graph's frames: long ones, and the longest interval and own time among them. */
  frameSummary(): { long: number; worst: number; ownAvg: number; ownMax: number } {
    const recent = this.frames.slice(-60);
    return {
      long: recent.filter((f) => f.interval > LONG_FRAME_MS).length,
      worst: Math.max(0, ...recent.map((f) => f.interval)),
      ownAvg: recent.reduce((sum, f) => sum + f.own, 0) / Math.max(1, recent.length),
      ownMax: Math.max(0, ...recent.map((f) => f.own)),
    };
  }

  clearFrames(): void {
    this.frames.length = 0;
  }
}
