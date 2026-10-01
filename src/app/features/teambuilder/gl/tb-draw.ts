import { Rgba, rgba } from '@core/gl/gl-renderer';
import { PAGE_BAR_H } from '@core/gl/ui/page-bar';
import { Box, UiContext, focusRing, label } from '@core/gl/ui/retro-kit';
import { TextStyle } from '@core/gl/gl-textures';
import { maskOf } from '@core/gl/ui/masks';
import { typeColor } from '@shared/data/type-colors';

/** The page under the bar: the team list's column on the left, the panel (920 wide) beside it. */
export const TOP = PAGE_BAR_H;
export const PANEL_X = 360;

export const WHITE: Rgba = [1, 1, 1, 1];
/** A move card's detail on its type's colour (Tailwind's gray-300, as the DOM cards). */
export const ON_TYPE: Rgba = rgba('#d1d5db');
/** The nature's lowered stat (the DOM's #2f5f9e badge and #8fb8ee text). */
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

/** Type pills in a row from `x` (72x20 and 80 apart, as the DOM cards'). */
export function typePills(ctx: UiContext, types: readonly string[], x: number, y: number, width = 72, step = 80, height = 20): void {
  types.forEach((type, i) => {
    const px = x + i * step;
    ctx.renderer.rect(px, y, width, height, { fill: typeRgba(type) ?? ctx.palette.rim, radius: 3 });
    label(ctx, type, px + width / 2, y + height / 2, { size: 12, bold: true }, WHITE, { align: 'center', maxWidth: width - 6 });
  });
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

/** A click-only button with a controller button's pill and a label (the DOM's data-kb-skip shortcuts). */
export function shortcutButton(
  ctx: UiContext,
  id: string,
  box: Box,
  key: string,
  text: string,
  options: { primary?: boolean; disabled?: boolean; size?: number; accept: () => void },
): void {
  const p = ctx.palette;
  const focused = !options.disabled && ctx.focus.control({ id, ...box, accept: options.accept, skip: true });
  const fill = options.disabled ? p.bg : options.primary ? p.accent : focused ? p.select : p.button;
  const stroke = options.disabled ? p.rim : options.primary ? p.bar : p.outline;
  const ink = options.disabled ? p.muted : options.primary ? WHITE : p.ink;
  ctx.renderer.rect(box.x, box.y, box.w, box.h, { fill, stroke, radius: 6, border: 2 });
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
