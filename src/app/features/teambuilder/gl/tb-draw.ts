import { Rgba, rgba, withAlpha } from '@core/gl/gl-renderer';
import { STAGE_H, STAGE_W } from '@core/gl/gl-stage';
import { PAGE_BAR_H } from '@core/gl/ui/page-bar';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { TextStyle } from '@core/gl/gl-textures';
import { maskOf } from '@core/gl/ui/masks';
import { typeColor } from '@shared/data/type-colors';
import { CATEGORY_ICON_H, CATEGORY_ICON_W, categoryIcon } from '@core/gl/ui/category-icons';

/** The page under the bar. */
export const TOP = PAGE_BAR_H;

/** The controls' legend at the bottom of every view of the teambuilder. */
export const LEGEND_H = 52;

/**
 * The set editor, which has the whole width: its header under the bar, the body (the Pokémon's card
 * on the left, 500 wide, or 260 while a list or the Stats need the room), and the controls' legend.
 */
export const EDIT_X = 24;
export const EDIT_RIGHT = STAGE_W - 24;
export const EDIT_BODY_Y = TOP + 66;
export const EDIT_BODY_BOTTOM = STAGE_H - LEGEND_H - 12;
/** The team's page has no tabs: its card and rows start right under the bar. */
export const TEAM_BODY_Y = TOP + 16;

/** How long the card takes to slide between the team's height and the editor's. */
const CARD_SLIDE_MS = 220;

/**
 * The top of the Pokémon's card, which is higher on the team's page than in the editor (under its
 * tabs): going from one to the other it slides from where the other had it, easing out.
 */
export class CardTop {
  private from: number | null = null;
  private since: number | null = null;

  /** The next frames start the card at `top` and slide it to where it belongs. */
  slideFrom(top: number): void {
    this.from = top;
    this.since = null;
  }

  /** Where the card's top is now, on its way to `target`. */
  at(now: number, target: number): number {
    if (this.from === null) return target;
    this.since ??= now;
    const t = Math.min(1, (now - this.since) / CARD_SLIDE_MS);
    if (t >= 1) this.from = null;
    return this.from === null ? target : this.from + (target - this.from) * (1 - (1 - t) * (1 - t));
  }
}
export const HERO_W = 500;
export const HERO_COMPACT_W = 260;
/** Where what's beside the card starts, beside the full card or the compact one. */
export const BESIDE_HERO_X = EDIT_X + HERO_W + 24;
export const BESIDE_COMPACT_X = EDIT_X + HERO_COMPACT_W + 20;

export const WHITE: Rgba = [1, 1, 1, 1];
/** A move card's detail on its type's colour (a light grey). */
export const ON_TYPE: Rgba = rgba('#d1d5db');
/** The nature's lowered stat (a #2f5f9e badge and #8fb8ee text). */
export const LOWERED_FILL: Rgba = rgba('#2f5f9e');
export const LOWERED_INK: Rgba = rgba('#8fb8ee');
/** The stat bars' fill: yellow, orange once all the points are placed; a segment still free to spend. */
export const BAR_FILL: Rgba = rgba('#e8c547');
export const BAR_FULL: Rgba = rgba('#f0883e');
export const SEGMENT_FREE: Rgba = rgba('#3d5064');

/** The Battle page's pixel triangles: 4x7 pointing left/right, 7x4 pointing up/down. */
export const LEFT = ['...x', '..xx', '.xxx', 'xxxx', '.xxx', '..xx', '...x'];
export const RIGHT = ['x...', 'xx..', 'xxx.', 'xxxx', 'xxx.', 'xx..', 'x...'];
export const UP = ['...x...', '..xxx..', '.xxxxx.', 'xxxxxxx'];
export const DOWN = ['xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];

/** A pixel triangle (or any mask) at `scale`, tinted. */
export function arrow(ctx: UiContext, rows: readonly string[], x: number, y: number, scale: number, color: Rgba): void {
  ctx.renderer.image(maskOf(ctx.renderer, rows), x, y, scale, color);
}

const TYPE_COLORS = new Map<string, Rgba>();

/** A type's colour (type-colors.ts) as Rgba, or null for an unknown type. */
export function typeRgba(type: string): Rgba | null {
  let color = TYPE_COLORS.get(type);
  if (!color) {
    const hex = typeColor(type);
    if (!hex) return null;
    color = rgba(hex);
    TYPE_COLORS.set(type, color);
  }
  return color;
}

/** Type pills in a row from `x` (72x20 and 80 apart). */
export function typePills(ctx: UiContext, types: readonly string[], x: number, y: number, width = 72, step = 80, height = 20, size = 12): void {
  types.forEach((type, i) => {
    const px = x + i * step;
    ctx.renderer.rect(px, y, width, height, { fill: typeRgba(type) ?? ctx.palette.rim, radius: 3 });
    label(ctx, type, px + width / 2, y + height / 2, { size, bold: true }, WHITE, { align: 'center', maxWidth: width - 6 });
  });
}

/** A coloured pill with white text (a type, a move's category), `height` high; returns its width. */
export function tag(ctx: UiContext, text: string, x: number, y: number, fill: Rgba, height = 30, size = 18): number {
  const width = ctx.text.measure(text, { size, bold: true }) + 28;
  ctx.renderer.rect(x, y, width, height, { fill, radius: 4 });
  label(ctx, text, x + width / 2, y + height / 2, { size, bold: true }, WHITE, { align: 'center' });
  return width;
}

/** The moves' categories, in the type colours' style: Physical red, Special blue, Status grey. */
export const CATEGORY_FILL: Readonly<Record<string, Rgba>> = {
  Physical: rgba('#9a2e12'),
  Special: rgba('#1f4e99'),
  Status: rgba('#5b5b58'),
};

/** A move's category as its icon (60x26, as tall as the type pills) centred on `cy`; a plain pill if unknown. */
export function categoryBadge(ctx: UiContext, category: string, x: number, cy: number): void {
  const icon = categoryIcon(ctx.renderer, category);
  const y = cy - CATEGORY_ICON_H / 2;
  if (icon) ctx.renderer.rect(x, y, CATEGORY_ICON_W, CATEGORY_ICON_H, { fill: WHITE, texture: icon });
  else ctx.renderer.rect(x, y, CATEGORY_ICON_W, CATEGORY_ICON_H, { fill: ctx.palette.rim, radius: 4 });
}

export interface LegendEntry {
  keys: readonly string[];
  text: string;
}

/** The legend at the bottom of the page: each control's buttons, and what it does. */
export function controlsLegend(ctx: UiContext, entries: readonly LegendEntry[]): void {
  const p = ctx.palette;
  const top = STAGE_H - LEGEND_H;
  ctx.renderer.rect(0, top, STAGE_W, LEGEND_H, { fill: p.bar });
  ctx.renderer.rect(0, top, STAGE_W, 2, { fill: p.rim });
  const cy = top + LEGEND_H / 2 + 1;
  let x = EDIT_X;
  for (const entry of entries) {
    for (const key of entry.keys) x += keyPill(ctx, key, x, cy) + 6;
    x += label(ctx, entry.text, x + 2, cy, { size: 18 }, p.muted) + 32;
  }
}

/** A controller button's name in a box (A, ZL…), 28 high and centred on `cy`; returns its width. */
export function keyPill(ctx: UiContext, key: string, x: number, cy: number): number {
  const p = ctx.palette;
  const width = keyPillWidth(ctx, key);
  // R3 (the right stick pressed) is a round chip with an R.
  const stick = key === 'R3';
  ctx.renderer.rect(x, cy - 14, width, 28, { fill: p.button, stroke: p.outline, radius: stick ? 14 : 6, border: 2 });
  label(ctx, stick ? 'R' : key, x + width / 2, cy, { size: 16, bold: true }, p.ink, { align: 'center' });
  return width;
}

export interface TabSpec {
  id: string;
  text: string;
  on: boolean;
  disabled?: boolean;
  accept: () => void;
}

const TAB_W = 150;
const TAB_H = 44;

/**
 * The folder tabs under the bar, from EDIT_X: L's pill, the tabs (clicks only, the controller has
 * L/R), R's pill, over a line in the outline's colour as wide as the page; the pills only when
 * `keys`. Returns where the tabs end.
 */
export function tabStrip(ctx: UiContext, tabs: readonly TabSpec[], keys: boolean): number {
  const p = ctx.palette;
  const { renderer } = ctx;
  const y = TOP + 4;
  const line = y + TAB_H;
  const cy = y + TAB_H / 2;
  let x = EDIT_X;
  if (keys) x += keyPill(ctx, 'L', x, cy) + 10;
  for (const tab of tabs) {
    const box = { x, y, w: TAB_W, h: TAB_H };
    const focused = !tab.disabled && ctx.focus.control({ id: tab.id, ...box, accept: tab.accept, skip: true });
    // Taller than shown, so the bottom's rounded corners hide under the line.
    renderer.rect(x, y, TAB_W, TAB_H + 8, { fill: tab.on ? p.select : focused ? p.button : p.panel, stroke: tab.on ? p.outline : p.rim, radius: 8, border: 3 });
    label(ctx, tab.text, x + TAB_W / 2, cy + 1, { size: 20, bold: true }, tab.on ? p.ink : tab.disabled ? p.rim : p.muted, { align: 'center', maxWidth: TAB_W - 16 });
    x += TAB_W + 8;
  }
  renderer.rect(0, line, STAGE_W, 8, { fill: p.bg });
  renderer.rect(EDIT_X, line, EDIT_RIGHT - EDIT_X, 3, { fill: p.outline });
  if (keys) x += 2 + keyPill(ctx, 'R', x + 2, cy);
  return x;
}

/** How wide keyPill draws a button's name. */
export function keyPillWidth(ctx: UiContext, key: string): number {
  if (key === 'R3') return 28;
  return Math.max(34, ctx.text.measure(key, { size: 16, bold: true }) + 14);
}

/** How a card looks: the field whose list is open, or a plain one (lit while focused), or disabled. */
export function card(ctx: UiContext, box: Box, state: { active?: boolean; focused?: boolean; disabled?: boolean }, fill?: Rgba): void {
  const p = ctx.palette;
  const stroke = state.active ? p.accentText : state.disabled ? p.rim : p.outline;
  const background = fill ?? (state.active || state.focused ? p.select : state.disabled ? p.bg : p.panel);
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill: background, stroke, radius: 8, border: 2 });
}

export function ring(ctx: UiContext, box: Box, focused: boolean): void {
  if (focused) focusRing(ctx, box, 8);
}

/**
 * Wrapped lines, kept by text and width (descriptions are drawn every frame; wrapping measures word
 * after word): at most `maxLines`, the last one cut with an ellipsis when there's more.
 */
export class WrapCache {
  private readonly lines = new Map<string, string[]>();

  get(ctx: UiContext, text: string, style: TextStyle, maxWidth: number, maxLines: number): string[] {
    const key = `${style.size}|${style.bold ? 1 : 0}|${maxWidth}|${maxLines}|${text}`;
    let lines = this.lines.get(key);
    if (!lines) {
      const all = ctx.text.wrap(text, style, maxWidth);
      lines = all.slice(0, maxLines);
      if (all.length > maxLines) lines[lines.length - 1] = ctx.text.fit(`${lines[lines.length - 1]} ${all.slice(maxLines).join(' ')}`, style, maxWidth);
      if (this.lines.size > 400) this.lines.clear();
      this.lines.set(key, lines);
    }
    return lines;
  }

  /** The lines drawn from `top` (the first line's top), `lineHeight` apart. */
  draw(ctx: UiContext, text: string, x: number, top: number, maxWidth: number, lineHeight: number, style: TextStyle, color: Rgba, maxLines: number): void {
    this.get(ctx, text, style, maxWidth, maxLines).forEach((line, i) => label(ctx, line, x, top + i * lineHeight + lineHeight / 2, style, color));
  }
}

/** A click-only button with a controller button's pill and a label. */
export function shortcutButton(
  ctx: UiContext,
  id: string,
  box: Box,
  key: string,
  text: string,
  options: { primary?: boolean; disabled?: boolean; size?: number; accept: () => void; held?: { progress: number; color: Rgba } },
): void {
  const p = ctx.palette;
  const focused = !options.disabled && ctx.focus.control({ id, ...box, accept: options.accept, skip: true });
  const fill = options.disabled ? p.bg : options.primary ? p.accent : focused ? p.select : p.button;
  const stroke = options.disabled ? p.rim : options.primary ? p.bar : p.outline;
  const held = options.held && options.held.progress > 0 ? options.held : null;
  // Over halfway filled, the text sits on the fill.
  const ink = options.disabled ? p.muted : options.primary || (held && held.progress > 0.5) ? WHITE : p.ink;
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke, radius: 6, border: 2 });
  if (held) {
    const width = (box.w - 4) * Math.min(1, held.progress);
    ctx.renderer.rect(box.x + 2, box.y + 2, width, box.h - 4, { fill: held.color, radius: Math.min(4, width / 2) });
  }
  const pillH = Math.min(24, box.h - 10);
  const pillW = Math.max(28, ctx.text.measure(key, { size: 14, bold: true }) + 12);
  ctx.renderer.rect(box.x + 7, box.y + (box.h - pillH) / 2, pillW, pillH, { fill: options.primary ? p.accentHover : p.bg, radius: 3 });
  label(ctx, key, box.x + 7 + pillW / 2, box.y + box.h / 2, { size: 14, bold: true }, options.primary ? WHITE : p.ink, { align: 'center' });
  const textLeft = box.x + 7 + pillW + 4;
  label(ctx, text, textLeft + (box.x + box.w - 6 - textLeft) / 2, box.y + box.h / 2, { size: options.size ?? 16, bold: !!options.primary }, ink, {
    align: 'center',
    maxWidth: box.x + box.w - 6 - textLeft,
  });
  if (focused) focusRing(ctx, box);
}

/** How far an entrance has come, 0 to 1 (easing out): `delay` ms after `since`, over `ms`. */
export function entrance(now: number, since: number, delay: number, ms = 340): number {
  const t = Math.max(0, Math.min(1, (now - since - delay) / ms));
  return 1 - (1 - t) * (1 - t);
}

/** Something coming in: the page's background over it, fading out as `shown` reaches 1. */
export function fadeIn(ctx: UiContext, box: Box, shown: number): void {
  if (shown < 1) ctx.renderer.rect(box.x - 4, box.y - 4, box.w + 8, box.h + 8, { fill: withAlpha(ctx.palette.bg, 1 - shown) });
}
