import { STAGE_H, STAGE_W } from './gl-stage';

/** The events a tap or a click can arrive as: browsers send several for one press, a console engine maybe only some. */
const PRESS_EVENTS = ['touchstart', 'pointerdown', 'mousedown', 'touchend', 'pointerup', 'mouseup', 'click'] as const;
type Family = 'touch' | 'pointer' | 'mouse';
const FAMILY: Record<string, Family> = {
  touchstart: 'touch',
  touchend: 'touch',
  pointerdown: 'pointer',
  pointerup: 'pointer',
  mousedown: 'mouse',
  mouseup: 'mouse',
  click: 'mouse',
};
const DOWNS = new Set(['touchstart', 'pointerdown', 'mousedown']);
/** Another family's events this soon after the leading family's last one are copies of the same presses. */
const COPIES_MS = 800;
/** Events this close after the previous one, near its point, belong to the same moment (a burst). */
const BURST_MS = 30;
/** How near a burst's events are to its first one (farther, it's another finger). */
const SAME_PRESS_PX = 40;
/** The last raw events kept for the diagnostics (L3). */
const LOG_SIZE = 8;

interface PointLike {
  clientX?: number;
  clientY?: number;
  pageX?: number;
  pageY?: number;
  offsetX?: number;
  offsetY?: number;
}

interface PressEvent extends PointLike {
  type: string;
  pointerType?: string;
  target?: EventTarget | null;
  touches?: ArrayLike<PointLike>;
  changedTouches?: ArrayLike<PointLike>;
}

type Point = { x: number; y: number };

/**
 * The touchscreen and the mouse on the stage's canvas, turned into stage coordinates (1280x720).
 * Listens on the window, not the canvas, as a console may not aim its touch events at the canvas.
 * A console engine may tell each moment of a press as a burst (seen on the console): on lift, touchend ×3, pointerup ×2,
 * click ×2 and mouseup within 1 ms, all different objects (L3 log, test-x4). So a burst is ONE
 * moment, decided by its first event: a down presses (the tap: the control under it is focused and
 * pressed, like A), an up or click lifts the held press, and an up or click with nothing held (a
 * screen that only tells lifts) is the tap. Keeps the last raw events and the last tap's point for
 * the diagnostics.
 */
export class PointerInput {
  /** The last raw events, newest last (L3). */
  readonly log: string[] = [];
  /** Where the last tap landed, in stage coordinates (L3 draws a dot there). */
  lastTap: Point | null = null;
  /** The family whose events count as the presses; the others' are copies while it goes on. */
  private leader: Family | null = null;
  private leaderAt = 0;
  /** Where the press went down, until it lifts. */
  private held: Point | null = null;
  /** The current burst: when its last event came, and where its first one was. */
  private burstAt = -Infinity;
  private burstPoint: Point | null = null;
  private lastLogAt = 0;
  private readonly seen = new WeakSet<object>();
  /** The last touch: the mouse moves a browser makes up after it don't move the focus. */
  private touchedAt = -Infinity;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onTap: (x: number, y: number) => void,
    private readonly onHover: (x: number, y: number) => void,
  ) {}

  /** Starts listening; returns the function that stops. */
  listen(): () => void {
    const press = (event: Event) => this.press(event as unknown as PressEvent);
    // Plain listeners: a template binding would render the app on every mouse move.
    const move = (event: Event) => {
      if (performance.now() - this.touchedAt < COPIES_MS) return;
      const point = this.point(event as unknown as PressEvent);
      if (point) this.onHover(point.x, point.y);
    };
    for (const type of PRESS_EVENTS) window.addEventListener(type, press, { passive: true });
    window.addEventListener('mousemove', move, { passive: true });
    return () => {
      for (const type of PRESS_EVENTS) window.removeEventListener(type, press);
      window.removeEventListener('mousemove', move);
    };
  }

  private press(event: PressEvent): void {
    // The same event handed over more than once.
    if (this.seen.has(event)) return;
    this.seen.add(event);
    const point = this.point(event);
    const now = performance.now();
    this.record(event, point, now);
    const family = FAMILY[event.type];
    if (family === 'touch' || (event.pointerType && event.pointerType !== 'mouse')) this.touchedAt = now;
    // One press arrives in several families (pointer, touch, the mouse events a browser makes up
    // after a touch, maybe late): the first one leads, and the others are copies while it goes on.
    if (this.leader && family !== this.leader && now - this.leaderAt < COPIES_MS) return;
    this.leader = family;
    this.leaderAt = now;
    const sameBurst =
      now - this.burstAt < BURST_MS && (!point || !this.burstPoint || distance(point, this.burstPoint) < SAME_PRESS_PX);
    this.burstAt = now;
    if (sameBurst) return;
    this.burstPoint = point;
    let tap: boolean;
    if (DOWNS.has(event.type)) {
      tap = true;
      this.held = point;
    } else {
      tap = !this.held;
      this.held = null;
    }
    if (!tap || !point) return;
    this.lastTap = point;
    this.onTap(point.x, point.y);
  }

  /** The event's point in stage coordinates, or null when it has none or falls outside the stage. */
  private point(event: PressEvent): Point | null {
    const source = event.changedTouches?.[0] ?? event.touches?.[0] ?? event;
    const rect = this.canvas.getBoundingClientRect?.();
    const width = rect?.width || STAGE_W;
    const height = rect?.height || STAGE_H;
    let x: number;
    let y: number;
    if (isNumber(source.clientX) && isNumber(source.clientY)) {
      x = source.clientX - (rect?.left ?? 0);
      y = source.clientY - (rect?.top ?? 0);
    } else if (isNumber(source.pageX) && isNumber(source.pageY)) {
      x = source.pageX - (rect?.left ?? 0) - (window.scrollX || 0);
      y = source.pageY - (rect?.top ?? 0) - (window.scrollY || 0);
    } else if (isNumber(source.offsetX) && isNumber(source.offsetY)) {
      x = source.offsetX;
      y = source.offsetY;
    } else {
      return null;
    }
    x = (x * STAGE_W) / width;
    y = (y * STAGE_H) / height;
    if (x < 0 || y < 0 || x >= STAGE_W || y >= STAGE_H) return null;
    return { x, y };
  }

  private record(event: PressEvent, point: Point | null, now: number): void {
    const source = event.changedTouches?.[0] ?? event.touches?.[0] ?? event;
    const target = (event.target as Element | null)?.nodeName?.toLowerCase() ?? '?';
    const pair = (a?: number, b?: number) => (isNumber(a) && isNumber(b) ? `${Math.round(a)},${Math.round(b)}` : '-');
    const touches = event.touches ? ` t${event.touches.length}` : '';
    const at = point ? `→ ${Math.round(point.x)},${Math.round(point.y)}` : '→ none';
    // The page point only matters when the client point is missing (the HUD's lines are narrow).
    const page = isNumber(source.clientX) ? '' : ` p${pair(source.pageX, source.pageY)}`;
    // How long after the previous event it came: copies of one press come within a few ms.
    const after = Math.min(9999, Math.round(now - this.lastLogAt));
    this.lastLogAt = now;
    this.log.push(`+${after} ${event.type} ${target}${touches} c${pair(source.clientX, source.clientY)}${page} o${pair(source.offsetX, source.offsetY)} ${at}`);
    if (this.log.length > LOG_SIZE) this.log.shift();
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
