import { PressKey, pillKeys } from '@core/input/console-keys';
import { Align, CanvasFocus, drawText, pillTarget } from '../canvas-ui';
import { GlRenderer, Rgba, Texture, withAlpha } from '../gl-renderer';
import { GlSprites } from '../gl-sprites';
import { TextStyle, TextTextures } from '../gl-textures';
import { Palette } from './gl-theme';

/** What a canvas page draws with in one frame: the stage's resources, its focus, the theme's palette. */
export interface UiContext {
  renderer: GlRenderer;
  text: TextTextures;
  images: GlSprites;
  disc: Texture;
  focus: CanvasFocus;
  palette: Palette;
  now: number;
  /** Presses a controller button as the controller would (StageResources.press: a tapped pill). */
  press: (key: PressKey) => boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const WHITE: Rgba = [1, 1, 1, 1];

/** Text with its middle at `cy` (see drawText); `fast` for text that changes all the time. */
export function label(
  ctx: UiContext,
  value: string,
  x: number,
  cy: number,
  style: TextStyle,
  color: Rgba,
  options: { align?: Align; maxWidth?: number; fast?: boolean } = {},
): number {
  return drawText(ctx.renderer, ctx.text, value, x, cy, style, color, options);
}

/** The focus ring (yellow, amber in light), just inside the box. */
export function focusRing(ctx: UiContext, box: Box, radius = 6): void {
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: [0, 0, 0, 0], stroke: ctx.palette.focus, radius, border: 3 });
}

/** The retro box: the outline colour around a rim, the panel inside. */
export function retroBox(ctx: UiContext, box: Box): void {
  const p = ctx.palette;
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.outline, radius: 14 });
  ctx.renderer.rect(box.x + 3, box.y + 3, box.w - 6, box.h - 6, { fill: p.panel, stroke: p.rim, radius: 11, border: 3 });
}

/** A controller button's name in a pill (ZR, L…). */
export function pill(ctx: UiContext, key: string, x: number, cy: number, height = 24): number {
  const width = Math.max(36, ctx.text.measure(key, { size: 14, bold: true }) + 14);
  ctx.renderer.rect(x, cy - height / 2, width, height, { fill: ctx.palette.select, radius: 3 });
  label(ctx, key, x + width / 2, cy, { size: 14, bold: true }, ctx.palette.ink, { align: 'center' });
  return width;
}

/**
 * A legend along a row, right-aligned at `right`: each button's pill and what it does, each one
 * tappable (pillTarget: "B Back" goes back, "◀▶" splits into its halves), so whatever a legend
 * promises a touch player can do too. Returns where it starts (its left edge).
 */
export function keysLegend(
  ctx: UiContext,
  keys: readonly (readonly [string, string])[],
  right: number,
  cy: number,
  options: { size?: number; color?: Rgba } = {},
): number {
  const size = options.size ?? 18;
  let x = right;
  [...keys].reverse().forEach(([key, text], i) => {
    const end = x;
    x -= ctx.text.measure(text, { size });
    label(ctx, text, x, cy, { size }, options.color ?? ctx.palette.ink);
    const width = Math.max(36, ctx.text.measure(key, { size: 14, bold: true }) + 14);
    x -= 8 + width;
    pill(ctx, key, x, cy, 28);
    const box = pillKeys(key).length > 1 ? { x: x - 4, y: cy - 14, w: width + 8, h: 28 } : { x: x - 6, y: cy - 14, w: end - x + 12, h: 28 };
    pillTarget(ctx, `keys-${Math.round(cy)}-${i}`, box, key);
    x -= 24;
  });
  return x;
}

export interface ButtonOptions {
  /** The main action, in the accent colour. */
  primary?: boolean;
  disabled?: boolean;
  /** The controller button that does the same (a pill at the left). */
  shortcut?: string;
  /** Clicks only: the d-pad never lands on it (a shortcut's button). */
  skip?: boolean;
  size?: number;
  accept: () => void;
}

/** A button (RETRO_PRIMARY/SECONDARY_BUTTON): declared to the focus, ringed while focused. */
export function button(ctx: UiContext, id: string, box: Box, text: string, options: ButtonOptions): boolean {
  const p = ctx.palette;
  const focused = !options.disabled && ctx.focus.control({ id, ...box, accept: options.accept, skip: options.skip });
  const fill = options.disabled ? p.disabledFill : options.primary ? p.accent : p.button;
  const border = options.disabled ? p.disabledBorder : options.primary ? p.bar : p.outline;
  const ink = options.disabled ? p.disabledInk : options.primary ? WHITE : p.ink;
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke: border, radius: 6, border: 2 });
  const size = options.size ?? 18;
  if (options.shortcut) {
    const width = pill(ctx, options.shortcut, box.x + 10, box.y + box.h / 2);
    label(ctx, text, box.x + 10 + width + (box.w - 20 - width) / 2, box.y + box.h / 2, { size, bold: true }, ink, { align: 'center', maxWidth: box.w - width - 24 });
  } else {
    label(ctx, text, box.x + box.w / 2, box.y + box.h / 2, { size, bold: true }, ink, { align: 'center', maxWidth: box.w - 16 });
  }
  if (focused) focusRing(ctx, box);
  return focused;
}

/**
 * A setting with a few values: its name, and the value between arrows; left/right change it while
 * focused (A steps forward too). The value's text is the caller's (it may say more than the id).
 */
export function stepper(ctx: UiContext, id: string, box: Box, name: string, value: string, step: (by: 1 | -1) => void): boolean {
  const p = ctx.palette;
  const focused = ctx.focus.control({
    id,
    ...box,
    accept: () => step(1),
    move: (direction) => {
      if (direction !== 'left' && direction !== 'right') return false;
      step(direction === 'right' ? 1 : -1);
      return true;
    },
  });
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: focused ? p.select : p.button, stroke: p.outline, radius: 6, border: 2 });
  label(ctx, name, box.x + 16, box.y + box.h / 2, { size: 18, bold: true }, p.ink, { maxWidth: box.w * 0.45 });
  const valueRight = box.x + box.w - 16;
  label(ctx, '▶', valueRight, box.y + box.h / 2, { size: 14 }, focused ? p.accentText : p.muted, { align: 'right' });
  const valueWidth = box.w * 0.5 - 60;
  label(ctx, value, valueRight - 28 - valueWidth / 2, box.y + box.h / 2, { size: 18 }, p.ink, { align: 'center', maxWidth: valueWidth });
  label(ctx, '◀', valueRight - valueWidth - 40, box.y + box.h / 2, { size: 14 }, focused ? p.accentText : p.muted);
  if (focused) focusRing(ctx, box);
  return focused;
}

/** Tabs in a row: the active one lit; ZL/ZR (the page's) or the d-pad and A switch them. */
export function tabs(ctx: UiContext, id: string, box: Box, names: readonly string[], active: number, select: (index: number) => void): void {
  const p = ctx.palette;
  const gap = 8;
  const width = (box.w - gap * (names.length - 1)) / names.length;
  names.forEach((name, i) => {
    const tab = { x: box.x + i * (width + gap), y: box.y, w: width, h: box.h };
    const focused = ctx.focus.control({ id: `${id}-${i}`, ...tab, accept: () => select(i) });
    const on = i === active;
    ctx.renderer.rect(tab.x, tab.y, tab.w, tab.h, { fill: on ? p.select : p.button, stroke: on ? p.accentText : p.outline, radius: 6, border: 2 });
    label(ctx, name, tab.x + tab.w / 2, tab.y + tab.h / 2, { size: 18, bold: true }, on ? p.ink : p.muted, { align: 'center', maxWidth: tab.w - 12 });
    if (focused) focusRing(ctx, tab);
  });
}

/**
 * A text field: its value (stars for a password, a placeholder while empty). A opens the canvas
 * on-screen keyboard (the caller's `edit`), never on its own: the console's keyboard must not open.
 */
export function textField(ctx: UiContext, id: string, box: Box, value: string, options: { placeholder?: string; masked?: boolean; edit: () => void }): boolean {
  const p = ctx.palette;
  const focused = ctx.focus.control({ id, ...box, accept: options.edit });
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: p.input, stroke: p.outline, radius: 6, border: 2 });
  const shown = options.masked ? '•'.repeat(value.length) : value;
  if (shown) label(ctx, shown, box.x + 12, box.y + box.h / 2, { size: 18 }, p.ink, { maxWidth: box.w - 24, fast: true });
  else label(ctx, options.placeholder ?? '', box.x + 12, box.y + box.h / 2, { size: 18 }, p.muted, { maxWidth: box.w - 24 });
  if (focused) focusRing(ctx, box);
  return focused;
}

/**
 * A modal view over the page: the page dims, the focus is trapped in what's drawn next (its controls
 * only), and the box is drawn. The caller draws its content after.
 */
export function modal(ctx: UiContext, box: Box, dim = 0.6): void {
  ctx.renderer.rect(0, 0, 1280, 720, { fill: withAlpha(ctx.palette.bg, dim) });
  ctx.focus.trap();
  retroBox(ctx, box);
}

/** One row of a list, as ListView draws it. */
export interface ListRow {
  box: Box;
  index: number;
  focused: boolean;
}

/**
 * A long list shown a page of rows at a time:
 * the d-pad walks the rows, and going past the first or last one shown moves the window a row (L/R,
 * the page's, move it a page). Its rows are controls `${id}-${index}`; the caller draws each one.
 */
export class ListView {
  /** The first row shown. */
  start = 0;

  constructor(
    readonly id: string,
    private readonly rowHeight: number,
    /** Rows shown at once (a page). */
    readonly visible: number,
    private readonly gap = 8,
    /** ▲ ▼ over and under the rows when there's more (off when the page says where it is otherwise). */
    private readonly arrows = true,
  ) {}

  /** The row `index` focuses (and the window moves so it shows). */
  reveal(index: number, count: number): void {
    if (index < this.start) this.start = index;
    if (index >= this.start + this.visible) this.start = index - this.visible + 1;
    this.start = Math.max(0, Math.min(this.start, Math.max(0, count - this.visible)));
  }

  /** Moves the window a page; true when it moved. */
  page(by: 1 | -1, count: number, focus: CanvasFocus): boolean {
    const before = this.start;
    this.start = Math.max(0, Math.min(this.start + by * this.visible, Math.max(0, count - this.visible)));
    if (this.start === before) return false;
    focus.focus(`${this.id}-${this.start}`);
    return true;
  }

  /** Home/End: the first or last row, focused. */
  jump(to: 'first' | 'last', count: number, focus: CanvasFocus): void {
    if (count === 0) return;
    const index = to === 'first' ? 0 : count - 1;
    this.reveal(index, count);
    focus.focus(`${this.id}-${index}`);
  }

  /** "11–18 of 120", for over the list. */
  range(count: number): string {
    if (count === 0) return '';
    return `${this.start + 1}–${Math.min(count, this.start + this.visible)} of ${count}`;
  }

  /** `move` gets the d-pad on a row first (left/right to another column), as a control's own `move`. */
  draw(
    ctx: UiContext,
    x: number,
    y: number,
    width: number,
    count: number,
    drawRow: (row: ListRow) => void,
    accept: (index: number) => void,
    move?: (index: number, direction: 'up' | 'down' | 'left' | 'right') => boolean,
  ): void {
    this.start = Math.max(0, Math.min(this.start, Math.max(0, count - this.visible)));
    const end = Math.min(count, this.start + this.visible);
    for (let index = this.start; index < end; index++) {
      const box = { x, y: y + (index - this.start) * (this.rowHeight + this.gap), w: width, h: this.rowHeight };
      const focused = ctx.focus.control({
        id: `${this.id}-${index}`,
        ...box,
        accept: () => accept(index),
        move: (direction) => {
          if (move?.(index, direction)) return true;
          // Past the rows shown: the window moves on to the next row.
          if (direction === 'down' && index === end - 1 && index < count - 1) {
            this.start++;
            ctx.focus.focus(`${this.id}-${index + 1}`);
            return true;
          }
          if (direction === 'up' && index === this.start && index > 0) {
            this.start--;
            ctx.focus.focus(`${this.id}-${index - 1}`);
            return true;
          }
          return false;
        },
      });
      drawRow({ box, index, focused });
    }
    // Arrows when there's more above or below: tapped, a page that way.
    if (!this.arrows) return;
    const p = ctx.palette;
    const below = y + this.visible * (this.rowHeight + this.gap) + 4;
    if (this.start > 0) {
      label(ctx, '▲', x + width - 14, y - 12, { size: 14 }, p.muted, { align: 'center' });
      ctx.focus.control({ id: `${this.id}-up`, x: x + width - 50, y: y - 34, w: 72, h: 44, skip: true, accept: () => this.page(-1, count, ctx.focus) });
    }
    if (end < count) {
      label(ctx, '▼', x + width - 14, below, { size: 14 }, p.muted, { align: 'center' });
      ctx.focus.control({ id: `${this.id}-down`, x: x + width - 50, y: below - 22, w: 72, h: 44, skip: true, accept: () => this.page(1, count, ctx.focus) });
    }
  }

  /** Whether there are rows past the window that way. */
  canPage(by: 1 | -1, count: number): boolean {
    return by < 0 ? this.start > 0 : this.start + this.visible < count;
  }
}

/**
 * A small square button with an arrow (▲ ▼ ◀ ▶) for what a finger can't scroll or step with the d-pad:
 * click only (the controller has its own way), faded and inert when there's nothing that way.
 */
export function arrowButton(ctx: UiContext, id: string, box: Box, arrow: string, enabled: boolean, accept: () => void): void {
  const p = ctx.palette;
  const focused = enabled && ctx.focus.control({ id, ...box, skip: true, accept });
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: enabled ? (focused ? p.select : p.button) : withAlpha(p.button, 0.4), stroke: enabled ? p.outline : withAlpha(p.outline, 0.4), radius: 8, border: 2 });
  label(ctx, arrow, box.x + box.w / 2, box.y + box.h / 2, { size: 18, bold: true }, enabled ? p.ink : withAlpha(p.ink, 0.35), { align: 'center' });
}

/**
 * For a list a finger can't scroll: ▲ and ▼ buttons (a page each, the focus on its first row) at the
 * ends of `box`, and the list's range between them ("9–16 of 120").
 */
export function listPager(ctx: UiContext, id: string, box: Box, list: ListView, count: number): void {
  const w = Math.min(96, box.w / 3);
  arrowButton(ctx, `${id}-up`, { x: box.x, y: box.y, w, h: box.h }, '▲', list.canPage(-1, count), () => list.page(-1, count, ctx.focus));
  arrowButton(ctx, `${id}-down`, { x: box.x + box.w - w, y: box.y, w, h: box.h }, '▼', list.canPage(1, count), () => list.page(1, count, ctx.focus));
  label(ctx, list.range(count), box.x + box.w / 2, box.y + box.h / 2, { size: 16, bold: true }, ctx.palette.muted, { align: 'center', maxWidth: box.w - 2 * w - 16 });
}

/**
 * Text wrapped into lines `lineHeight` apart from `top` (the first line's top), at most `maxLines`
 * (the last one cut with an ellipsis when there's more).
 */
export function paragraph(ctx: UiContext, value: string, x: number, top: number, maxWidth: number, lineHeight: number, style: TextStyle, color: Rgba, maxLines = Infinity): void {
  const lines = ctx.text.wrap(value, style, maxWidth);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown[shown.length - 1] = ctx.text.fit(`${shown[shown.length - 1]} ${lines.slice(maxLines).join(' ')}`, style, maxWidth);
  shown.forEach((line, i) => label(ctx, line, x, top + i * lineHeight + lineHeight / 2, style, color));
}
